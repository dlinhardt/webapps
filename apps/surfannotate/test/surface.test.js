import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency, findBoundaryVertices, isIsolated } from '../src/surface/adjacency.js';
import { SurfacePathfinder, buildChain, validateChain } from '../src/surface/pathfinder.js';
import { fillClosedRegion, maskToIndices } from '../src/surface/fill.js';
import { makeGrid, at, squareCorners, squareBarrier, countMask } from './helpers.js';

test('adjacency lists each neighbour once, sorted, with edge lengths', () => {
  const { vertices, triangles } = makeGrid(5);
  const graph = buildAdjacency(vertices, triangles);

  assert.equal(graph.V, 25);

  // Interior vertex (2,2) has 6 neighbours in this triangulation: the four
  // axis-aligned ones plus the two along the shared diagonal.
  const centre = at(5, 2, 2);
  const neighbours = Array.from(
    graph.adjNeighbor.subarray(graph.adjOffset[centre], graph.adjOffset[centre + 1])
  );
  assert.equal(neighbours.length, 6);
  assert.deepEqual(neighbours, [...neighbours].sort((a, b) => a - b), 'neighbours are sorted');
  assert.equal(new Set(neighbours).size, 6, 'no duplicates');
  assert.ok(!neighbours.includes(centre), 'no self-loop');

  // Axis-aligned edges are unit length; the diagonal is sqrt(2).
  for (let e = graph.adjOffset[centre]; e < graph.adjOffset[centre + 1]; e++) {
    const w = graph.adjWeight[e];
    assert.ok(Math.abs(w - 1) < 1e-6 || Math.abs(w - Math.SQRT2) < 1e-6, `unexpected edge length ${w}`);
  }
});

test('adjacency accepts alternate geometry for edge weights', () => {
  const { vertices, triangles } = makeGrid(4);
  const scaled = vertices.map((value) => value * 10);
  const graph = buildAdjacency(vertices, triangles, scaled);

  const v = at(4, 1, 1);
  const first = graph.adjWeight[graph.adjOffset[v]];
  assert.ok(Math.abs(first - 10) < 1e-5 || Math.abs(first - 10 * Math.SQRT2) < 1e-5);
});

test('adjacency rejects malformed input', () => {
  const { vertices, triangles } = makeGrid(3);
  assert.throws(() => buildAdjacency(new Float32Array(4), triangles), /length 3\*V/);
  assert.throws(() => buildAdjacency(vertices, new Uint32Array(4)), /length 3\*F/);
  assert.throws(() => buildAdjacency(vertices, Uint32Array.of(0, 1, 99)), /outside 0\.\./);
});

test('a flat grid reports its perimeter as boundary vertices', () => {
  const { triangles, V } = makeGrid(5);
  const boundary = findBoundaryVertices(triangles, V);
  assert.equal(countMask(boundary), 16, '5x5 grid perimeter');
  assert.equal(boundary[at(5, 0, 0)], 1);
  assert.equal(boundary[at(5, 2, 2)], 0, 'interior vertex is not on a boundary');
});

test('pathfinder returns a shortest, pairwise-adjacent path', () => {
  const { vertices, triangles, n } = makeGrid(9);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);

  const path = finder.path(at(n, 0, 0), at(n, 4, 0));
  assert.ok(path, 'path exists');
  assert.equal(path[0], at(n, 0, 0));
  assert.equal(path[path.length - 1], at(n, 4, 0));
  assert.equal(path.length, 5, 'straight run along one row');
  assert.equal(validateChain(graph, path).ok, true);
});

test('pathfinder prefers the cheaper diagonal route when one exists', () => {
  const { vertices, triangles, n } = makeGrid(9);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);

  // Each cell is split along its anti-diagonal, so (i+1,j)-(i,j+1) is an edge
  // but (i,j)-(i+1,j+1) is not. Three sqrt(2) steps down the anti-diagonal beat
  // six unit steps.
  const along = finder.path(at(n, 3, 0), at(n, 0, 3));
  assert.equal(along.length, 4);
  assert.equal(validateChain(graph, along).ok, true);

  // The other diagonal has no shortcut, so it costs the full Manhattan walk.
  const across = finder.path(at(n, 0, 0), at(n, 3, 3));
  assert.equal(across.length, 7);
  assert.equal(validateChain(graph, across).ok, true);
});

test('pathfinder handles the degenerate and disconnected cases', () => {
  const { vertices, triangles } = makeGrid(4);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);

  assert.deepEqual(Array.from(finder.path(5, 5)), [5]);
  assert.throws(() => finder.path(0, 999), /endpoints must be in/);

  // Two disjoint triangles: no path between components.
  const split = buildAdjacency(
    Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 0, 6, 5, 0, 5, 6, 0]),
    Uint32Array.from([0, 1, 2, 3, 4, 5])
  );
  const splitFinder = new SurfacePathfinder(split, Float32Array.from(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 0, 6, 5, 0, 5, 6, 0]
  ));
  assert.equal(splitFinder.path(0, 4), null);
});

test('repeated searches do not leak state between calls', () => {
  const { vertices, triangles, n } = makeGrid(7);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);

  const first = Array.from(finder.path(at(n, 0, 0), at(n, 6, 6)));
  for (let i = 0; i < 5; i++) finder.path(at(n, 3, 0), at(n, 0, 3));
  const again = Array.from(finder.path(at(n, 0, 0), at(n, 6, 6)));
  assert.deepEqual(again, first, 'generation stamps reset the search cleanly');
});

test('buildChain densifies clicks into an adjacent chain and closes the loop', () => {
  const { vertices, triangles, n } = makeGrid(21);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);

  const { chain, gaps } = buildChain(finder, squareCorners(n, 5, 15), { closed: true });
  assert.equal(gaps.length, 0);
  assert.equal(validateChain(graph, chain).ok, true, 'every step is a mesh edge');
  assert.equal(chain[0], at(n, 5, 5));
  assert.equal(chain[chain.length - 1], at(n, 5, 5), 'chain returns to the first click');
});

test('buildChain reuses cached segments', () => {
  const { vertices, triangles, n } = makeGrid(9);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);
  const cache = new Map();

  const clicks = [at(n, 0, 0), at(n, 4, 0), at(n, 4, 4)];
  const first = buildChain(finder, clicks, { cache });
  assert.equal(cache.size, 2);
  const second = buildChain(finder, clicks, { cache });
  assert.deepEqual(Array.from(second.chain), Array.from(first.chain));
});

test('validateChain flags a broken link', () => {
  const { vertices, triangles, n } = makeGrid(9);
  const graph = buildAdjacency(vertices, triangles);

  const broken = Int32Array.from([at(n, 0, 0), at(n, 5, 5)]);
  const result = validateChain(graph, broken);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 0);
});

test('auto fill selects the interior of a closed square', () => {
  const { vertices, triangles, n, V } = makeGrid(21);
  const graph = buildAdjacency(vertices, triangles);
  const barrier = squareBarrier(n, 5, 15);

  const result = fillClosedRegion(graph, barrier, { vertices });
  assert.equal(result.error, null);
  assert.equal(result.count, 81, 'the 9x9 block strictly inside the perimeter');
  assert.equal(result.components, 1);
  assert.equal(result.inside[at(n, 10, 10)], 1, 'centre is inside');
  assert.equal(result.inside[at(n, 0, 0)], 0, 'corner is outside');
  assert.equal(result.inside[at(n, 5, 5)], 0, 'boundary excluded by default');
  assert.ok(result.count < V);
});

test('includeBoundary adds the barrier vertices to the region', () => {
  const { vertices, triangles, n } = makeGrid(21);
  const graph = buildAdjacency(vertices, triangles);
  const barrier = squareBarrier(n, 5, 15);

  const result = fillClosedRegion(graph, barrier, { vertices, includeBoundary: true });
  assert.equal(result.error, null);
  assert.equal(result.count, 81 + 40, 'interior plus the 40-vertex perimeter');
  assert.equal(result.inside[at(n, 5, 5)], 1);
});

test('seeded fill matches auto fill and rejects a seed on the boundary', () => {
  const { vertices, triangles, n } = makeGrid(21);
  const graph = buildAdjacency(vertices, triangles);
  const barrier = squareBarrier(n, 5, 15);

  const seeded = fillClosedRegion(graph, barrier, { seed: at(n, 10, 10) });
  assert.equal(seeded.error, null);
  assert.equal(seeded.count, 81);

  const onBoundary = fillClosedRegion(graph, barrier, { seed: at(n, 5, 5) });
  assert.equal(onBoundary.error, 'SEED_ON_BOUNDARY');
});

test('a gap in the boundary is reported rather than silently filling the mesh', () => {
  const { vertices, triangles, n } = makeGrid(21);
  const graph = buildAdjacency(vertices, triangles);
  const barrier = squareBarrier(n, 5, 15);
  barrier[at(n, 10, 5)] = 0; // punch a hole in the perimeter

  const seeded = fillClosedRegion(graph, barrier, { seed: at(n, 10, 10) });
  assert.equal(seeded.error, 'FILL_ESCAPED');
  assert.equal(seeded.inside, null);

  const auto = fillClosedRegion(graph, barrier, { vertices });
  assert.ok(auto.error === 'AMBIGUOUS_REGION' || auto.error === 'EMPTY_REGION',
    `expected a refusal, got ${auto.error}`);
});

test('an empty boundary is refused', () => {
  const { vertices, triangles, V } = makeGrid(9);
  const graph = buildAdjacency(vertices, triangles);
  const result = fillClosedRegion(graph, new Uint8Array(V), { vertices });
  assert.equal(result.error, 'EMPTY_BOUNDARY');
});

test('a boundary that pinches itself yields several interior components', () => {
  const { vertices, triangles, n } = makeGrid(21);
  const graph = buildAdjacency(vertices, triangles);

  // Two squares meeting along a shared edge column: a figure-eight.
  const barrier = squareBarrier(n, 2, 10);
  const right = squareBarrier(n, 10, 18);
  for (let i = 0; i < barrier.length; i++) if (right[i]) barrier[i] = 1;

  const result = fillClosedRegion(graph, barrier, { vertices });
  assert.equal(result.error, null);
  assert.equal(result.components, 2, 'both lobes are captured, and counted');
});

test('maskToIndices returns ascending vertex indices', () => {
  const mask = Uint8Array.from([0, 1, 0, 1, 1]);
  assert.deepEqual(Array.from(maskToIndices(mask)), [1, 3, 4]);
});

test('isolated vertices never enter a region', () => {
  const vertices = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9]);
  const triangles = Uint32Array.from([0, 1, 2]);
  const graph = buildAdjacency(vertices, triangles);
  assert.equal(isIsolated(graph, 3), true);

  const barrier = Uint8Array.from([1, 1, 0, 0]);
  const result = fillClosedRegion(graph, barrier, { vertices });
  if (result.inside) assert.equal(result.inside[3], 0);
});
