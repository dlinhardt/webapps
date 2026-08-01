import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency, findBoundaryVertices } from '../src/surface/adjacency.js';
import { buildEdgeAnchor, anchorChainToEdge } from '../src/surface/edgeAnchor.js';
import { SurfacePathfinder, validateChain } from '../src/surface/pathfinder.js';
import { makeGrid, makeTetrahedron, at } from './helpers.js';

/** A flat patch: a disk with one open edge, like an unfolded cortical patch. */
function patch(n = 9) {
  const grid = makeGrid(n);
  const graph = buildAdjacency(grid.vertices, grid.triangles);
  const onEdge = findBoundaryVertices(grid.triangles, grid.V);
  return { grid, graph, onEdge, anchor: buildEdgeAnchor(graph, onEdge) };
}

test('distance to the cut is measured along the surface', () => {
  const { grid, anchor } = patch(9);
  assert.equal(anchor.hasEdge, true);

  // Grid spacing is 1, so the centre of a 9x9 patch is four steps from the rim.
  assert.equal(anchor.distance[at(9, 4, 4)], 4);
  assert.equal(anchor.distance[at(9, 1, 4)], 1);
  // A vertex already on the rim is at distance zero and has nowhere to walk.
  assert.equal(anchor.distance[at(9, 0, 4)], 0);
  assert.equal(anchor.parent[at(9, 0, 4)], -1);
  assert.equal(grid.V, 81);
});

test('the route to the cut is a walkable chain ending on the edge', () => {
  const { graph, onEdge, anchor } = patch(9);

  const path = anchor.pathToEdge(at(9, 4, 4));
  assert.equal(path[0], at(9, 4, 4), 'starts at the vertex asked for');
  assert.equal(onEdge[path[path.length - 1]], 1, 'ends on the cut');
  assert.equal(path.length, 5, 'four steps, five vertices');
  assert.ok(validateChain(graph, path).ok, 'every step is a mesh edge');

  const already = anchor.pathToEdge(at(9, 0, 0));
  assert.deepEqual(Array.from(already), [at(9, 0, 0)], 'a rim vertex is its own route');
});

test('a closed surface has no cut to anchor against', () => {
  const closed = makeTetrahedron();
  const graph = buildAdjacency(closed.vertices, closed.triangles);
  const onEdge = findBoundaryVertices(closed.triangles, closed.V);

  assert.deepEqual(Array.from(onEdge), [0, 0, 0, 0], 'every edge is shared by two faces');
  const anchor = buildEdgeAnchor(graph, onEdge);
  assert.equal(anchor.hasEdge, false);
  assert.equal(anchor.pathToEdge(0), null, 'nothing to reach');
});

test('anchoring extends both ends of a drawn line out to the cut', () => {
  const { graph, onEdge, anchor } = patch(9);
  const finder = new SurfacePathfinder(graph, makeGrid(9).vertices);

  // A short line across the middle of the patch, nowhere near the rim.
  const drawn = finder.path(at(9, 3, 4), at(9, 5, 4));
  assert.equal(onEdge[drawn[0]], 0);
  assert.equal(onEdge[drawn[drawn.length - 1]], 0);

  const anchored = anchorChainToEdge(anchor, drawn);
  assert.equal(anchored.ok, true);
  assert.ok(validateChain(graph, anchored.chain).ok, 'still a walkable chain');
  assert.equal(onEdge[anchored.chain[0]], 1, 'now starts on the cut');
  assert.equal(onEdge[anchored.chain[anchored.chain.length - 1]], 1, 'and ends on it');
  assert.ok(anchored.chain.length > drawn.length, 'the line got longer, not shorter');

  // The drawn line survives inside the anchored one, in order.
  const text = Array.from(anchored.chain).join(',');
  assert.ok(text.includes(Array.from(drawn).join(',')), 'the user line is preserved verbatim');
});

test('a line already touching the cut is left alone at that end', () => {
  const { graph, anchor } = patch(9);
  const finder = new SurfacePathfinder(graph, makeGrid(9).vertices);

  const drawn = finder.path(at(9, 0, 4), at(9, 2, 4)); // starts on the rim
  const anchored = anchorChainToEdge(anchor, drawn);
  assert.equal(anchored.ok, true);
  assert.equal(anchored.chain[0], at(9, 0, 4), 'no detour added to an end already on the cut');
  assert.ok(validateChain(graph, anchored.chain).ok);
});

test('anchoring reports a vertex from which no cut is reachable', () => {
  // One isolated vertex bolted onto a patch: it is in the graph but in no face.
  const grid = makeGrid(5);
  const vertices = new Float32Array(grid.vertices.length + 3);
  vertices.set(grid.vertices);
  vertices[grid.vertices.length] = 99;
  const graph = buildAdjacency(vertices, grid.triangles);
  const onEdge = findBoundaryVertices(grid.triangles, graph.V);
  const anchor = buildEdgeAnchor(graph, onEdge);

  const orphan = graph.V - 1;
  assert.equal(anchor.pathToEdge(orphan), null);
  const anchored = anchorChainToEdge(anchor, [orphan]);
  assert.equal(anchored.ok, false);
  assert.deepEqual(anchored.unreachable, [orphan]);
});
