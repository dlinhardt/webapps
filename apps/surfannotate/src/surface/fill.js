// Flood fill the region enclosed by a closed boundary chain.
//
// Two strategies, matching the two production tools:
//
//   seeded  — the user clicks a vertex inside the region and we BFS outwards
//             until the barrier stops us. This is FreeSurfer freeview's model
//             (`LayerSurface::FillPath(nvo, ...)`, where nvo is the clicked
//             vertex). Unambiguous, and the right escape hatch.
//
//   auto    — seed from the vertex furthest from the boundary centroid, which
//             is guaranteed to be OUTSIDE, flood, then take the complement.
//             This is Connectome Workbench's model. Their source carries a
//             candid note that they first tried deducing the interior from
//             boundary winding, could not make it robust, and switched to
//             "finding nodes outside a border is much easier".
//
// Correctness rests on the barrier being a chain of pairwise-adjacent vertices
// (see pathfinder.validateChain). On a 2-manifold, an edge from an interior to
// an exterior vertex would have to cross the boundary curve — but the curve is
// itself made of mesh edges, and mesh edges meet only at vertices. So the only
// ways to leak are a gap in the chain, or filling over an augmented graph.

import { isIsolated } from './adjacency.js';

/** Fraction of the surface above which a fill is treated as having escaped. */
const DEFAULT_MAX_FRACTION = 0.4;

/**
 * @typedef {object} FillResult
 * @property {Uint8Array|null} inside  length V, 1 for vertices in the region
 * @property {number} count            number of vertices set
 * @property {string|null} error       machine-readable failure code, or null
 * @property {number} components       connected pieces the region fell into
 */

/**
 * @param {import('./adjacency.js').SurfaceGraph} graph
 * @param {Uint8Array} barrier length V, 1 marks a boundary vertex
 * @param {object} [options]
 * @param {number} [options.seed] interior vertex; omit or -1 for auto mode
 * @param {Float32Array} [options.vertices] required for auto mode (centroid)
 * @param {boolean} [options.includeBoundary] add barrier vertices to the region
 * @param {number} [options.maxFraction] escape threshold, default 0.4
 * @returns {FillResult}
 */
export function fillClosedRegion(graph, barrier, options = {}) {
  const {
    seed = -1,
    vertices = null,
    includeBoundary = false,
    maxFraction = DEFAULT_MAX_FRACTION
  } = options;

  const V = graph.V;
  if (barrier.length !== V) throw new Error('barrier length must equal vertex count');

  let barrierCount = 0;
  for (let v = 0; v < V; v++) if (barrier[v]) barrierCount++;
  if (barrierCount === 0) return fail('EMPTY_BOUNDARY');

  // Every guard below is a fraction of the surface the fill can actually reach,
  // which is NOT graph.V. `excludeVertices` leaves a completed ROI's vertices
  // in place — they keep their indices, which every label and click depends on —
  // and merely strips their edges. So once any ROI is saved, graph.V counts
  // vertices no flood can ever touch, and measuring against it makes the guards
  // progressively blinder as the parcellation fills up.
  const walkable = walkableCount(graph);

  const result = seed >= 0
    ? fillFromSeed(graph, barrier, seed, maxFraction, walkable)
    : fillByComplement(graph, barrier, vertices, maxFraction, walkable);

  if (result.error) return result;

  if (includeBoundary) {
    for (let v = 0; v < V; v++) {
      if (barrier[v] && !result.inside[v]) {
        result.inside[v] = 1;
        result.count++;
      }
    }
  }
  return result;
}

/** Vertices a flood could reach: everything still joined to something. */
function walkableCount(graph) {
  let walkable = 0;
  for (let v = 0; v < graph.V; v++) if (!isIsolated(graph, v)) walkable++;
  return walkable;
}

/** BFS outwards from an interior vertex; the barrier stops the flood. */
function fillFromSeed(graph, barrier, seed, maxFraction, walkable) {
  const V = graph.V;
  if (seed >= V || seed < 0) throw new Error(`seed ${seed} outside 0..${V - 1}`);
  if (barrier[seed]) return fail('SEED_ON_BOUNDARY');

  const { inside, count } = floodFrom(graph, barrier, seed);
  if (count > maxFraction * walkable) {
    // Either the chain has a gap, or the click landed outside the loop.
    return { inside: null, count, error: 'FILL_ESCAPED', components: 1 };
  }
  return { inside, count, error: null, components: 1 };
}

/** Flood the exterior, then keep everything that is neither exterior nor barrier. */
function fillByComplement(graph, barrier, vertices, maxFraction, walkable) {
  const V = graph.V;
  if (!vertices) throw new Error('auto fill needs options.vertices for the centroid');

  const exteriorSeed = findFurthestFromBoundary(graph, barrier, vertices);
  if (exteriorSeed < 0) return fail('NO_EXTERIOR_VERTEX');

  const flood = floodFrom(graph, barrier, exteriorSeed);
  let outside = flood.inside;
  let outsideCount = flood.count;

  const inside = new Uint8Array(V);
  let insideCount = 0;
  for (let v = 0; v < V; v++) {
    if (!outside[v] && !barrier[v] && !isIsolated(graph, v)) {
      inside[v] = 1;
      insideCount++;
    }
  }

  // The seed is geometrically outside the boundary, but if the loop encircles
  // most of the surface the smaller side is the one the user meant. Workbench
  // applies the same >half-the-surface rule — expressed here as a direct
  // comparison rather than against a total, so it needs no denominator and
  // cannot be fooled by vertices that were cut out of the graph.
  if (outsideCount < insideCount) {
    for (let v = 0; v < V; v++) {
      const swap = inside[v];
      inside[v] = outside[v];
      outside[v] = swap;
    }
    insideCount = outsideCount;
  }

  if (insideCount === 0) return fail('EMPTY_REGION');
  if (insideCount > maxFraction * walkable) {
    return { inside: null, count: insideCount, error: 'AMBIGUOUS_REGION', components: 0 };
  }

  // A boundary that touches itself splits the interior into several pieces.
  // Taking the complement captures them all, which matches "everything not
  // outside" — but the caller should surface the count, since a figure-eight is
  // usually a drawing mistake rather than an intent.
  const components = countComponents(graph, inside);
  return { inside, count: insideCount, error: null, components };
}

/**
 * Label every connected piece the barrier leaves behind.
 *
 * This is the third strategy, and the one used when the ROI was closed against
 * a cut edge rather than looped back on itself. It needs no seed and no
 * geometric guess about which side is "outside": the barrier either separates
 * the surface or it does not, and the component count says which. That is a
 * fact about the graph, so unlike the auto strategy it stays sound on a surface
 * with an open edge.
 *
 * Isolated vertices are left unlabelled so they cannot drift into an ROI.
 *
 * @param {import('./adjacency.js').SurfaceGraph} graph
 * @param {Uint8Array} barrier length V
 * @returns {{labels: Int32Array, sizes: number[], count: number}} `labels` is
 *   -1 on barrier, isolated and unreachable vertices, otherwise a component id.
 */
export function regionComponents(graph, barrier) {
  const { V, adjOffset, adjNeighbor } = graph;
  if (barrier.length !== V) throw new Error('barrier length must equal vertex count');

  const labels = new Int32Array(V).fill(-1);
  const sizes = [];
  const stack = new Int32Array(V);

  for (let start = 0; start < V; start++) {
    if (barrier[start] || labels[start] !== -1 || isIsolated(graph, start)) continue;
    const id = sizes.length;
    let size = 0;
    let top = 0;
    labels[start] = id;
    stack[top++] = start;
    while (top > 0) {
      const u = stack[--top];
      size++;
      for (let e = adjOffset[u]; e < adjOffset[u + 1]; e++) {
        const w = adjNeighbor[e];
        if (barrier[w] || labels[w] !== -1) continue;
        labels[w] = id;
        stack[top++] = w;
      }
    }
    sizes.push(size);
  }

  return { labels, sizes, count: sizes.length };
}

/**
 * One labelled component as a mask.
 * @param {Int32Array} labels from regionComponents
 * @param {number} id
 * @returns {{mask: Uint8Array, count: number}}
 */
export function componentMask(labels, id) {
  const mask = new Uint8Array(labels.length);
  let count = 0;
  for (let v = 0; v < labels.length; v++) {
    if (labels[v] === id) { mask[v] = 1; count++; }
  }
  return { mask, count };
}

function floodFrom(graph, barrier, start) {
  const { V, adjOffset, adjNeighbor } = graph;
  const visited = new Uint8Array(V);
  const stack = new Int32Array(V);
  let top = 0;
  let count = 0;

  visited[start] = 1;
  stack[top++] = start;
  while (top > 0) {
    const u = stack[--top];
    count++;
    for (let e = adjOffset[u]; e < adjOffset[u + 1]; e++) {
      const w = adjNeighbor[e];
      if (visited[w] || barrier[w]) continue;
      visited[w] = 1;
      stack[top++] = w;
    }
  }
  return { inside: visited, count };
}

/**
 * The vertex furthest from the boundary's centroid. On a closed surface this is
 * reliably outside any loop that encloses less than half the mesh.
 */
function findFurthestFromBoundary(graph, barrier, vertices) {
  const V = graph.V;
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let v = 0; v < V; v++) {
    if (!barrier[v]) continue;
    cx += vertices[3 * v];
    cy += vertices[3 * v + 1];
    cz += vertices[3 * v + 2];
    n++;
  }
  if (n === 0) return -1;
  cx /= n; cy /= n; cz /= n;

  let best = -1;
  let bestDistance = -1;
  for (let v = 0; v < V; v++) {
    if (barrier[v] || isIsolated(graph, v)) continue;
    const dx = vertices[3 * v] - cx;
    const dy = vertices[3 * v + 1] - cy;
    const dz = vertices[3 * v + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > bestDistance) { bestDistance = d; best = v; }
  }
  return best;
}

function countComponents(graph, mask) {
  const { V, adjOffset, adjNeighbor } = graph;
  const seen = new Uint8Array(V);
  const stack = new Int32Array(V);
  let components = 0;

  for (let start = 0; start < V; start++) {
    if (!mask[start] || seen[start]) continue;
    components++;
    let top = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const u = stack[--top];
      for (let e = adjOffset[u]; e < adjOffset[u + 1]; e++) {
        const w = adjNeighbor[e];
        if (!mask[w] || seen[w]) continue;
        seen[w] = 1;
        stack[top++] = w;
      }
    }
  }
  return components;
}

function fail(error) {
  return { inside: null, count: 0, error, components: 0 };
}

/** Human-readable text for each failure code, for the app's status line. */
export const FILL_ERRORS = Object.freeze({
  EMPTY_BOUNDARY: 'No boundary drawn yet.',
  SEED_ON_BOUNDARY: 'That vertex is on the boundary — click inside the region.',
  FILL_ESCAPED: 'The fill spread across the surface. The boundary is probably not closed.',
  NO_EXTERIOR_VERTEX: 'Could not find a vertex outside the boundary.',
  EMPTY_REGION: 'The boundary encloses no vertices.',
  AMBIGUOUS_REGION: 'Both sides of the boundary are large — click inside the region you want.',
  NO_SEPARATION: 'The border and the surface edge do not enclose a region. Both ends of the ' +
    'border must reach the same edge of the patch.',
  NO_OPEN_EDGE: 'This surface has no open edge, so there is nothing to close against.',
  EDGE_UNREACHABLE: 'No surface edge is reachable from that border point.'
});

/** Convert a mask to the sorted vertex indices the exporters expect. */
export function maskToIndices(mask) {
  let n = 0;
  for (let v = 0; v < mask.length; v++) if (mask[v]) n++;
  const out = new Int32Array(n);
  let i = 0;
  for (let v = 0; v < mask.length; v++) if (mask[v]) out[i++] = v;
  return out;
}
