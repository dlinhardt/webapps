// Drawing an area against the border of the area drawn before it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency, findBoundaryVertices, isIsolated } from '../src/surface/adjacency.js';
import { excludeVertices, unionMasks } from '../src/surface/exclude.js';
import { SurfacePathfinder, validateChain } from '../src/surface/pathfinder.js';
import { RoiSession, CLOSURE_EDGE } from '../src/surface/roiSession.js';
import { regionComponents } from '../src/surface/fill.js';
import { makeGrid, at, countMask } from './helpers.js';

const N = 11;

/** The grid, plus a square block of it marked as a finished ROI. */
function patchWithArea(a, b) {
  const grid = makeGrid(N);
  const graph = buildAdjacency(grid.vertices, grid.triangles);
  const baseEdge = findBoundaryVertices(grid.triangles, grid.V);
  const area = new Uint8Array(grid.V);
  for (let j = a; j <= b; j++) {
    for (let i = a; i <= b; i++) area[at(N, i, j)] = 1;
  }
  return { grid, graph, baseEdge, area };
}

test('an excluded region is cut out of the graph but keeps its indices', () => {
  const { graph, baseEdge, area } = patchWithArea(4, 6);
  const cut = excludeVertices(graph, area, baseEdge);

  assert.equal(cut.excludedCount, 9, 'the 3x3 block');
  assert.equal(cut.graph.V, graph.V, 'vertex numbering is untouched');
  for (let v = 0; v < graph.V; v++) {
    if (area[v]) assert.ok(isIsolated(cut.graph, v), `vertex ${v} should be cut out`);
  }
  // Nothing outside the region lost a neighbour it should have kept.
  const outside = at(N, 0, 0);
  assert.equal(
    cut.graph.adjOffset[outside + 1] - cut.graph.adjOffset[outside],
    graph.adjOffset[outside + 1] - graph.adjOffset[outside]
  );
});

test('the rim of the excluded region becomes an edge', () => {
  const { graph, baseEdge, area } = patchWithArea(4, 6);
  const cut = excludeVertices(graph, area, baseEdge);

  // Vertices touching the block are now edge vertices...
  assert.equal(cut.openEdge[at(N, 3, 5)], 1);
  assert.equal(cut.openEdge[at(N, 7, 5)], 1);
  // ...the mesh's own cut still is...
  assert.equal(cut.openEdge[at(N, 0, 0)], 1);
  // ...the block itself is not, since a border cannot be anchored inside it...
  assert.equal(cut.openEdge[at(N, 5, 5)], 0);
  // ...and open interior stays open.
  assert.equal(cut.openEdge[at(N, 1, 5)], 0);
});

test('excluding a region turns a closed surface into one with an edge', () => {
  // A torus: every edge is shared by two faces, so there is no open boundary.
  const n = 8;
  const vertices = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const u = (i / n) * 2 * Math.PI;
      const w = (j / n) * 2 * Math.PI;
      vertices[3 * v] = (3 + Math.cos(w)) * Math.cos(u);
      vertices[3 * v + 1] = (3 + Math.cos(w)) * Math.sin(u);
      vertices[3 * v + 2] = Math.sin(w);
    }
  }
  const tris = [];
  const idx = (i, j) => ((j % n) * n) + (i % n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1));
      tris.push(idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
    }
  }
  const triangles = Uint32Array.from(tris);
  const graph = buildAdjacency(vertices, triangles);
  const baseEdge = findBoundaryVertices(triangles, n * n);
  assert.equal(countMask(baseEdge), 0, 'a torus has no open edge');

  const area = new Uint8Array(n * n);
  area[idx(3, 3)] = 1;
  const cut = excludeVertices(graph, area, baseEdge);
  assert.ok(countMask(cut.openEdge) > 0, 'cutting a hole creates one');
});

test('a border can be closed against a finished area, on a surface with no cut', () => {
  const grid = makeGrid(N);
  const graph = buildAdjacency(grid.vertices, grid.triangles);
  const baseEdge = findBoundaryVertices(grid.triangles, grid.V);

  // "V1": the left two columns, already delineated.
  const v1 = new Uint8Array(grid.V);
  for (let j = 0; j < N; j++) { v1[at(N, 0, j)] = 1; v1[at(N, 1, j)] = 1; }

  const cut = excludeVertices(graph, v1, baseEdge);
  const finder = new SurfacePathfinder(cut.graph, grid.vertices);
  const session = new RoiSession(cut.graph, finder, grid.vertices, { openEdge: cut.openEdge });

  // "V2": a line across the patch, whose ends run out to the V1 rim on one side
  // and the patch edge on the other — two clicks, as on a flat patch.
  session.addClick(at(N, 3, 4));
  session.addClick(at(N, 3, 6));
  const closed = session.closeOnEdge();
  assert.equal(closed.ok, true, closed.error || '');
  assert.equal(session.closure, CLOSURE_EDGE);
  assert.ok(validateChain(cut.graph, session.chain).ok);

  const filled = session.fill();
  assert.equal(filled.ok, true, filled.error || '');
  // Whatever region it picked, it must not have swallowed V1.
  for (let v = 0; v < grid.V; v++) {
    if (v1[v]) assert.equal(session.filled[v], 0, `V1 vertex ${v} leaked into V2`);
  }
});

test('a fill cannot cross a finished area', () => {
  const grid = makeGrid(N);
  const graph = buildAdjacency(grid.vertices, grid.triangles);

  // A finished area cutting the grid clean in half.
  const wall = new Uint8Array(grid.V);
  for (let j = 0; j < N; j++) wall[at(N, 5, j)] = 1;

  const before = regionComponents(graph, new Uint8Array(grid.V));
  assert.equal(before.count, 1, 'the intact grid is one piece');

  const cut = excludeVertices(graph, wall, null);
  const after = regionComponents(cut.graph, new Uint8Array(grid.V));
  assert.equal(after.count, 2, 'cutting the area out separates the two halves');
  assert.deepEqual(after.sizes.slice().sort((x, y) => x - y), [55, 55]);
});

test('several finished areas combine into one barrier', () => {
  const V = 16;
  const a = new Uint8Array(V); a[1] = 1; a[2] = 1;
  const b = new Uint8Array(V); b[2] = 1; b[9] = 1;
  const union = unionMasks(V, [a, b]);
  assert.equal(countMask(union), 3, 'overlap is not double-counted');
  assert.equal(union[1], 1);
  assert.equal(union[2], 1);
  assert.equal(union[9], 1);
  assert.equal(union[0], 0);

  assert.equal(countMask(unionMasks(V, [])), 0);
  assert.equal(countMask(unionMasks(V, [null, new Uint8Array(3)])), 0, 'wrong sizes ignored');
});

test('excluding nothing leaves the surface exactly as it was', () => {
  const { graph, baseEdge } = patchWithArea(4, 6);
  const cut = excludeVertices(graph, new Uint8Array(graph.V), baseEdge);
  assert.equal(cut.excludedCount, 0);
  assert.deepEqual(Array.from(cut.graph.adjOffset), Array.from(graph.adjOffset));
  assert.deepEqual(Array.from(cut.graph.adjNeighbor), Array.from(graph.adjNeighbor));
  assert.deepEqual(Array.from(cut.openEdge), Array.from(baseEdge));
});
