// Turning a finished ROI into an edge of the surface.
//
// Areas are delineated in sequence, and each one's border is mostly the border
// of the area before it: V1 is drawn first, then V2 shares the whole V1/V2
// boundary with it, then V3 shares its outer boundary with V2. Re-clicking that
// shared border for every area is both tedious and wrong — the two areas end up
// with slightly different boundaries and a sliver of unassigned cortex between
// them.
//
// The fix reuses the machinery already built for flat patches. A cut in the
// surface works as a barrier because the 1-ring graph has no edges crossing it;
// so cutting a finished ROI out of the graph gives its rim exactly the same
// standing. V1 becomes a hole, the rim of that hole becomes an edge, and V2 can
// be closed against it by `closeOnEdge` with nothing else changed.
//
// This also works on a closed surface, where there was no edge to begin with:
// once V1 is excluded, `lh.pial` is a sphere with a hole in it, and every edge
// closure applies.

/**
 * @typedef {object} ExcludedSurface
 * @property {import('./adjacency.js').SurfaceGraph} graph the walkable graph,
 *   with excluded vertices isolated
 * @property {Uint8Array} openEdge vertices that now act as an edge: the mesh's
 *   own cut, plus everything bordering an excluded region
 * @property {number} excludedCount
 */

/**
 * Cut a set of vertices out of the surface graph.
 *
 * Excluded vertices are left in place but stripped of their edges, so they keep
 * their indices — which matters, because every ROI, label file and click refers
 * to a vertex by index. Being isolated is enough to keep them out of paths and
 * fills: `fill.js` and `adjacency.isIsolated` already skip vertices with no
 * neighbours, so nothing downstream needs to know this happened.
 *
 * @param {import('./adjacency.js').SurfaceGraph} graph
 * @param {Uint8Array} excluded length V, 1 for vertices to cut out
 * @param {Uint8Array} [baseEdge] the mesh's own open edge, kept in the result
 * @returns {ExcludedSurface}
 */
export function excludeVertices(graph, excluded, baseEdge = null) {
  const { V, adjOffset, adjNeighbor, adjWeight } = graph;
  if (!excluded || excluded.length !== V) {
    throw new Error('excluded length must equal vertex count');
  }
  if (baseEdge && baseEdge.length !== V) {
    throw new Error('baseEdge length must equal vertex count');
  }

  const openEdge = new Uint8Array(V);
  if (baseEdge) openEdge.set(baseEdge);

  const newOffset = new Uint32Array(V + 1);
  const newNeighbor = new Uint32Array(adjNeighbor.length);
  const newWeight = new Float32Array(adjWeight.length);
  let k = 0;
  let excludedCount = 0;

  for (let v = 0; v < V; v++) {
    newOffset[v] = k;
    if (excluded[v]) {
      excludedCount++;
      // An excluded vertex is not somewhere a border can be anchored, even if
      // it sat on the mesh's own cut before.
      openEdge[v] = 0;
      continue;
    }
    let bordersExcluded = false;
    for (let e = adjOffset[v]; e < adjOffset[v + 1]; e++) {
      const w = adjNeighbor[e];
      if (excluded[w]) {
        bordersExcluded = true;
        continue;
      }
      newNeighbor[k] = w;
      newWeight[k] = adjWeight[e];
      k++;
    }
    if (bordersExcluded) openEdge[v] = 1;
  }
  newOffset[V] = k;

  return {
    graph: {
      V,
      adjOffset: newOffset,
      adjNeighbor: newNeighbor.subarray(0, k),
      adjWeight: newWeight.subarray(0, k)
    },
    openEdge,
    excludedCount
  };
}

/**
 * Union of several ROI masks, for the "use as edge" set.
 * @param {number} V
 * @param {Array<Uint8Array>} masks
 * @returns {Uint8Array}
 */
export function unionMasks(V, masks) {
  const union = new Uint8Array(V);
  for (const mask of masks) {
    if (!mask || mask.length !== V) continue;
    for (let v = 0; v < V; v++) if (mask[v]) union[v] = 1;
  }
  return union;
}
