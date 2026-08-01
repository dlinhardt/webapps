// A parcellation: an ordered list of areas that together partition the surface.
//
// Independent masks are the wrong model for delineating adjacent areas. V1 and
// V2 share a boundary, so moving it changes both — but with independent masks
// only the one being edited changes, and the other is left claiming vertices
// that are no longer its own, or leaving a strip that belongs to nobody.
//
// So an area is not a mask. An area is a *definition* — its border points, how
// they were closed, and which side was filled — and the masks are derived by
// resolving the whole list in order, each area cut out of the surface before the
// next one is resolved. Disjointness then holds by construction rather than by
// checking, and editing an area's border re-derives everything after it: shrink
// V1 and V2 grows into the space, because V2's border was always defined as
// "my line, and whatever lies between it and the area below me".
//
// This is the same rule the rest of the app already follows — the clicked
// vertices are the only authoritative state — applied one level up.

import { excludeVertices } from './exclude.js';
import { SurfacePathfinder } from './pathfinder.js';
import { RoiSession, CLOSURE_EDGE } from './roiSession.js';

/**
 * @typedef {object} AreaDefinition
 * @property {number} id
 * @property {string} name
 * @property {number[]} clicks         border points, in the order placed
 * @property {string} closure          'loop' or 'edge'
 * @property {number} [regionIndex]    which side of an edge closure was taken
 * @property {number} [anchor]         a vertex that was inside the region
 * @property {boolean} [includeBoundary]
 */

/**
 * @typedef {object} ResolvedArea
 * @property {Uint8Array|null} mask  null when the area could not be resolved
 * @property {Int32Array} chain
 * @property {string|null} error
 */

/**
 * Resolve definitions into disjoint regions, in order.
 *
 * Each area is drawn on a surface with every area before it cut away, which is
 * exactly the situation it was drawn in. An area that cannot be resolved — its
 * border points swallowed by an area now in front of it, say — is reported with
 * an error and claims nothing, rather than being silently dropped.
 *
 * @param {object} base
 * @param {import('./adjacency.js').SurfaceGraph} base.graph
 * @param {Float32Array} base.positions
 * @param {Uint8Array|null} base.openEdge the mesh's own cut, if it has one
 * @param {AreaDefinition[]} areas
 * @returns {{areas: Array<AreaDefinition & ResolvedArea>, owner: Int32Array,
 *   assigned: number}} `owner` holds the id of the area owning each vertex, or
 *   -1 where nothing does.
 */
export function resolveParcellation(base, areas) {
  const V = base.graph.V;
  const owner = new Int32Array(V).fill(-1);
  const claimed = new Uint8Array(V);
  const resolved = [];
  let assigned = 0;

  for (const area of areas) {
    const result = resolveArea(base, claimed, area);
    resolved.push(result);
    if (!result.mask) continue;
    for (let v = 0; v < V; v++) {
      if (!result.mask[v]) continue;
      owner[v] = area.id;
      claimed[v] = 1;
      assigned++;
    }
  }

  return { areas: resolved, owner, assigned };
}

/**
 * Resolve one area against a surface with `claimed` already taken.
 *
 * Exported because the app needs the same "surface as this area sees it" when
 * the area is being drawn interactively, not only when the list is re-derived.
 *
 * @param {object} base
 * @param {Uint8Array} claimed vertices already belonging to an earlier area
 * @param {AreaDefinition} area
 * @returns {AreaDefinition & ResolvedArea}
 */
export function resolveArea(base, claimed, area) {
  const cut = excludeVertices(base.graph, claimed, base.openEdge);
  const finder = new SurfacePathfinder(cut.graph, base.positions);
  const session = new RoiSession(cut.graph, finder, base.positions, {
    openEdge: cut.openEdge
  });

  for (const vertex of area.clicks) session.addClick(vertex);
  if (session.clicks.length !== area.clicks.length) {
    return { ...area, mask: null, chain: new Int32Array(0), error: 'LOST_POINTS' };
  }

  const closed = area.closure === CLOSURE_EDGE ? session.closeOnEdge() : session.closePath();
  if (!closed.ok) {
    return { ...area, mask: null, chain: session.chain, error: closed.error || 'BROKEN_BOUNDARY' };
  }

  const anchor = usableAnchor(cut.graph, session, area.anchor);
  const filled = area.closure === CLOSURE_EDGE
    ? session.fill({
      region: area.regionIndex ?? 0,
      preferVertex: anchor,
      includeBoundary: area.includeBoundary
    })
    : session.fill({ seed: anchor, includeBoundary: area.includeBoundary });

  if (!filled.ok) {
    return { ...area, mask: null, chain: session.chain, error: filled.error };
  }
  return { ...area, mask: session.filled, chain: session.chain, error: null };
}

/** The stored anchor, if it is still a vertex this area could be filled from. */
function usableAnchor(graph, session, anchor) {
  if (anchor === undefined || anchor === null || anchor < 0 || anchor >= graph.V) return -1;
  if (graph.adjOffset[anchor] === graph.adjOffset[anchor + 1]) return -1; // cut away
  const boundary = session.boundaryMask();
  return boundary[anchor] ? -1 : anchor;
}

/**
 * A vertex deep inside a region, to recognise it by after the borders move.
 *
 * The furthest vertex from the border, by hop count, is the one most likely to
 * still be inside after an edit — a vertex near the border is exactly what a
 * neighbouring area takes when it grows.
 *
 * @param {import('./adjacency.js').SurfaceGraph} graph
 * @param {Uint8Array} mask
 * @param {Int32Array|number[]} border
 * @returns {number} -1 when the mask is empty
 */
export function anchorVertex(graph, mask, border) {
  const { V, adjOffset, adjNeighbor } = graph;
  const seen = new Uint8Array(V);
  const queue = new Int32Array(V);
  let head = 0;
  let tail = 0;

  for (const v of border) {
    if (v < 0 || v >= V || seen[v]) continue;
    seen[v] = 1;
    queue[tail++] = v;
  }
  // No border to measure from: any vertex will do.
  if (tail === 0) {
    for (let v = 0; v < V; v++) if (mask[v]) return v;
    return -1;
  }

  let deepest = -1;
  while (head < tail) {
    const u = queue[head++];
    if (mask[u]) deepest = u;
    for (let e = adjOffset[u]; e < adjOffset[u + 1]; e++) {
      const w = adjNeighbor[e];
      if (seen[w] || !mask[w]) continue;
      seen[w] = 1;
      queue[tail++] = w;
    }
  }
  if (deepest >= 0) return deepest;
  for (let v = 0; v < V; v++) if (mask[v]) return v;
  return -1;
}

/** Human-readable text for the states an area can end up in. */
export const AREA_ERRORS = Object.freeze({
  LOST_POINTS: 'Some of its border points now belong to an area above it in the list.',
  BROKEN_BOUNDARY: 'Its border could not be traced on the surface left to it.',
  NO_SEPARATION: 'Its border no longer encloses a region.',
  EMPTY_REGION: 'Its border encloses nothing that is still free.',
  FILL_ESCAPED: 'Its fill spread across the surface — the border is not closed.',
  AMBIGUOUS_REGION: 'Both sides of its border are large; it needs redrawing.',
  SEED_ON_BOUNDARY: 'Its interior point now sits on its border.'
});
