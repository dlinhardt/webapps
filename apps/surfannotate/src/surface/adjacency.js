// Vertex adjacency for a triangular surface mesh, stored as CSR (compressed
// sparse row) typed arrays.
//
// Everything downstream — path finding and flood fill — walks the 1-ring vertex
// graph built here. A half-edge structure is not needed for either, and CSR is
// both cheaper to build and faster to traverse.
//
// IMPORTANT: this graph must stay a pure 1-ring. Augmenting it (unfolded 2-ring
// edges, k-ring neighbourhoods) makes drawn boundaries leak under flood fill,
// because the extra edges cross faces and so can hop over a barrier. See
// fill.js for why the barrier argument depends on edges meeting only at vertices.

/**
 * @typedef {object} SurfaceGraph
 * @property {number} V              vertex count
 * @property {Uint32Array} adjOffset length V+1; neighbours of v are the slice
 *                                   [adjOffset[v], adjOffset[v+1])
 * @property {Uint32Array} adjNeighbor neighbour vertex indices
 * @property {Float32Array} adjWeight  edge length matching adjNeighbor
 */

/**
 * Build the 1-ring adjacency graph.
 *
 * Edge weights come from `weightVertices` when supplied, otherwise `vertices`.
 * That split matters for inflated surfaces: you render `lh.inflated` but want
 * path lengths measured on `lh.white`, which has identical topology and
 * different geometry. Pass the white coordinates as `weightVertices` and the
 * drawn boundary follows anatomical distance rather than inflated distance.
 *
 * @param {Float32Array} vertices   3*V, xyz interleaved
 * @param {Uint32Array}  triangles  3*F, vertex indices
 * @param {Float32Array} [weightVertices] alternate geometry for edge lengths
 * @returns {SurfaceGraph}
 */
export function buildAdjacency(vertices, triangles, weightVertices = null) {
  if (!vertices || vertices.length % 3 !== 0) {
    throw new Error('vertices must be a Float32Array of length 3*V');
  }
  if (!triangles || triangles.length % 3 !== 0) {
    throw new Error('triangles must be a Uint32Array of length 3*F');
  }

  const V = vertices.length / 3;
  const F = triangles.length / 3;
  const geom = weightVertices || vertices;
  if (geom.length !== vertices.length) {
    throw new Error('weightVertices must have the same vertex count as vertices');
  }

  // Pass 1 — count directed edges per vertex, duplicates included. Each corner
  // of each face sees the two other corners.
  const degree = new Uint32Array(V);
  for (let f = 0; f < F; f++) {
    const a = triangles[3 * f];
    const b = triangles[3 * f + 1];
    const c = triangles[3 * f + 2];
    if (a >= V || b >= V || c >= V) {
      throw new Error(`triangle ${f} references a vertex outside 0..${V - 1}`);
    }
    degree[a] += 2;
    degree[b] += 2;
    degree[c] += 2;
  }

  const rawOffset = new Uint32Array(V + 1);
  for (let v = 0, sum = 0; v <= V; v++) {
    rawOffset[v] = sum;
    if (v < V) sum += degree[v];
  }

  // Pass 2 — scatter every directed edge into its vertex slice.
  const cursor = rawOffset.slice(0, V);
  const raw = new Uint32Array(rawOffset[V]);
  for (let f = 0; f < F; f++) {
    const a = triangles[3 * f];
    const b = triangles[3 * f + 1];
    const c = triangles[3 * f + 2];
    raw[cursor[a]++] = b; raw[cursor[a]++] = c;
    raw[cursor[b]++] = a; raw[cursor[b]++] = c;
    raw[cursor[c]++] = a; raw[cursor[c]++] = b;
  }

  // Pass 3 — sort each slice, drop duplicates and self-loops, measure edges.
  // Slices are ~12 long on a cortical mesh, so insertion sort beats Array#sort
  // and allocates nothing.
  const adjOffset = new Uint32Array(V + 1);
  const adjNeighbor = new Uint32Array(rawOffset[V]);
  const adjWeight = new Float32Array(rawOffset[V]);
  let k = 0;

  for (let v = 0; v < V; v++) {
    adjOffset[v] = k;
    const start = rawOffset[v];
    const end = rawOffset[v + 1];

    for (let i = start + 1; i < end; i++) {
      const x = raw[i];
      let j = i - 1;
      while (j >= start && raw[j] > x) {
        raw[j + 1] = raw[j];
        j--;
      }
      raw[j + 1] = x;
    }

    const vx = geom[3 * v];
    const vy = geom[3 * v + 1];
    const vz = geom[3 * v + 2];
    let previous = -1;
    for (let i = start; i < end; i++) {
      const w = raw[i];
      if (w === previous || w === v) continue;
      previous = w;
      const dx = geom[3 * w] - vx;
      const dy = geom[3 * w + 1] - vy;
      const dz = geom[3 * w + 2] - vz;
      adjNeighbor[k] = w;
      adjWeight[k] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      k++;
    }
  }
  adjOffset[V] = k;

  return {
    V,
    adjOffset,
    adjNeighbor: adjNeighbor.subarray(0, k),
    adjWeight: adjWeight.subarray(0, k)
  };
}

/**
 * True when the vertex has no incident edges. Isolated vertices are excluded
 * from fills so they never land in an ROI by accident.
 * @param {SurfaceGraph} graph
 * @param {number} v
 */
export function isIsolated(graph, v) {
  return graph.adjOffset[v] === graph.adjOffset[v + 1];
}

/**
 * Vertices lying on an open boundary of the surface — an edge used by exactly
 * one triangle. Closed surfaces (FreeSurfer white/pial after topology fixing)
 * have none; flat patches and cut surfaces do.
 *
 * A loop drawn on a surface with boundary does not necessarily separate it into
 * two pieces, so automatic inside/outside detection is unsafe there and the
 * caller should require an explicit interior seed.
 *
 * @param {Uint32Array} triangles
 * @param {number} V
 * @returns {Uint8Array} length V, 1 where the vertex is on a boundary edge
 */
export function findBoundaryVertices(triangles, V) {
  const F = triangles.length / 3;
  // Count how many faces use each undirected edge, keyed by min*V+max. A Map
  // keeps this O(E) without allocating a V*V matrix.
  const useCount = new Map();
  const bump = (a, b) => {
    const key = a < b ? a * V + b : b * V + a;
    useCount.set(key, (useCount.get(key) || 0) + 1);
  };
  for (let f = 0; f < F; f++) {
    const a = triangles[3 * f];
    const b = triangles[3 * f + 1];
    const c = triangles[3 * f + 2];
    bump(a, b); bump(b, c); bump(c, a);
  }
  const onBoundary = new Uint8Array(V);
  for (const [key, count] of useCount) {
    if (count !== 1) continue;
    const a = Math.floor(key / V);
    const b = key % V;
    onBoundary[a] = 1;
    onBoundary[b] = 1;
  }
  return onBoundary;
}
