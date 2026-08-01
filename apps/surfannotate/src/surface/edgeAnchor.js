// Closing an ROI against the open edge of a cut surface.
//
// A flat patch is topologically a disk: the cortex was cut so it could be
// unfolded, and the mesh therefore has an open edge. Areas delineated on such a
// patch often run right up to that cut — V1 on an occipital patch, say — so the
// natural ROI border is partly the line the user draws and partly the edge of
// the patch itself. Clicking along that edge to close the loop is tedious, and
// it puts the border wherever the clicks happened to land rather than exactly on
// the cut.
//
// It is also unnecessary. Flood fill walks the 1-ring vertex graph, and no edge
// of that graph crosses the cut — there is nothing on the other side to connect
// to. The open edge is therefore *already* an impassable barrier. A chain whose
// two ends reach it separates the patch on its own, with no need to trace along
// it at all.
//
// So all this module does is run each end of the user's line out to the nearest
// edge vertex, turning "nearly reaches the cut" into "reaches it exactly". One
// multi-source Dijkstra from every edge vertex gives, for every vertex at once,
// its distance to the cut and the first step along the shortest route there —
// so anchoring either end is then a pointer walk.

/**
 * @typedef {object} EdgeAnchor
 * @property {boolean} hasEdge        false when the surface is closed
 * @property {Float64Array} distance  geodesic distance to the nearest edge vertex
 * @property {Int32Array} parent      next vertex towards the edge, -1 when on it
 * @property {(v: number) => Int32Array|null} pathToEdge
 */

/**
 * Distance-to-edge field over the whole surface.
 *
 * @param {import('./adjacency.js').SurfaceGraph} graph
 * @param {Uint8Array} onEdge length V, 1 where the vertex lies on an open edge
 *   (see `findBoundaryVertices`)
 * @returns {EdgeAnchor}
 */
export function buildEdgeAnchor(graph, onEdge) {
  const { V, adjOffset, adjNeighbor, adjWeight } = graph;
  if (!onEdge || onEdge.length !== V) {
    throw new Error('onEdge length must equal vertex count');
  }

  const distance = new Float64Array(V).fill(Infinity);
  const parent = new Int32Array(V).fill(-1);
  const settled = new Uint8Array(V);

  // Lazy deletion rather than decrease-key, as in the pathfinder: one heap entry
  // per source plus at most one per successful relaxation.
  const capacity = V + adjNeighbor.length + 16;
  const heapKey = new Float64Array(capacity);
  const heapVal = new Int32Array(capacity);
  let heapSize = 0;

  const push = (key, value) => {
    let i = heapSize++;
    while (i > 0) {
      const above = (i - 1) >> 1;
      if (heapKey[above] <= key) break;
      heapKey[i] = heapKey[above];
      heapVal[i] = heapVal[above];
      i = above;
    }
    heapKey[i] = key;
    heapVal[i] = value;
  };

  const pop = () => {
    const top = heapVal[0];
    const lastKey = heapKey[--heapSize];
    const lastVal = heapVal[heapSize];
    if (heapSize > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= heapSize) break;
        const right = left + 1;
        const child = right < heapSize && heapKey[right] < heapKey[left] ? right : left;
        if (heapKey[child] >= lastKey) break;
        heapKey[i] = heapKey[child];
        heapVal[i] = heapVal[child];
        i = child;
      }
      heapKey[i] = lastKey;
      heapVal[i] = lastVal;
    }
    return top;
  };

  let edgeCount = 0;
  for (let v = 0; v < V; v++) {
    if (!onEdge[v]) continue;
    edgeCount++;
    distance[v] = 0;
    push(0, v);
  }

  while (heapSize > 0) {
    const u = pop();
    if (settled[u]) continue;
    settled[u] = 1;
    const du = distance[u];
    for (let e = adjOffset[u]; e < adjOffset[u + 1]; e++) {
      const w = adjNeighbor[e];
      if (settled[w]) continue;
      const candidate = du + adjWeight[e];
      if (candidate < distance[w]) {
        distance[w] = candidate;
        parent[w] = u;
        push(candidate, w);
      }
    }
  }

  /**
   * The shortest chain from `v` out to the cut, starting at `v` and ending on an
   * edge vertex. A vertex already on the edge yields the single-vertex chain
   * `[v]`. Returns null when no edge is reachable — an isolated vertex, or a
   * closed component of a mesh whose edge lies elsewhere.
   */
  const pathToEdge = (v) => {
    if (!Number.isInteger(v) || v < 0 || v >= V) return null;
    if (!Number.isFinite(distance[v])) return null;
    const out = [];
    for (let u = v; u !== -1; u = parent[u]) out.push(u);
    return Int32Array.from(out);
  };

  return { hasEdge: edgeCount > 0, distance, parent, pathToEdge };
}

/**
 * Extend both ends of an open chain out to the surface's cut.
 *
 * The result is still a chain of pairwise-adjacent vertices, so it is a valid
 * flood-fill barrier. It is deliberately *not* closed back on itself: together
 * with the open edge it already encloses a region.
 *
 * @param {EdgeAnchor} anchor
 * @param {Int32Array|number[]} chain the densified path through the user's clicks
 * @returns {{ok: boolean, chain: Int32Array, unreachable: number[]}}
 */
export function anchorChainToEdge(anchor, chain) {
  const stops = Array.from(chain);
  if (stops.length === 0) {
    return { ok: false, chain: new Int32Array(0), unreachable: [] };
  }

  const first = stops[0];
  const last = stops[stops.length - 1];
  const head = anchor.pathToEdge(first);
  const tail = anchor.pathToEdge(last);
  const unreachable = [];
  if (!head) unreachable.push(first);
  if (!tail && last !== first) unreachable.push(last);
  if (unreachable.length) {
    return { ok: false, chain: Int32Array.from(stops), unreachable };
  }

  const out = [];
  const append = (v) => {
    if (out.length && out[out.length - 1] === v) return;
    out.push(v);
  };
  // head runs click -> edge, so walk it backwards and stop before the click
  // itself, which the chain supplies.
  for (let i = head.length - 1; i >= 1; i--) append(head[i]);
  for (const v of stops) append(v);
  for (let i = 1; i < tail.length; i++) append(tail[i]);

  return { ok: true, chain: Int32Array.from(out), unreachable: [] };
}
