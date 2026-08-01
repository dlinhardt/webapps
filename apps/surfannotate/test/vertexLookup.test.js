import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVertexIndex } from '../src/surface/vertexLookup.js';
import { makeGrid } from './helpers.js';

/** Reference implementation: the linear scan the grid is meant to replace. */
function bruteForceNearest(vertices, x, y, z) {
  let best = -1;
  let bestSquared = Infinity;
  for (let v = 0; v < vertices.length / 3; v++) {
    const dx = vertices[3 * v] - x;
    const dy = vertices[3 * v + 1] - y;
    const dz = vertices[3 * v + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestSquared) { bestSquared = d2; best = v; }
  }
  return { vertex: best, distance: Math.sqrt(bestSquared) };
}

test('grid lookup agrees with brute force across the volume', () => {
  const { vertices } = makeGrid(12);
  const index = buildVertexIndex(vertices);

  // Deterministic pseudo-random probes, including points well outside the mesh.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let i = 0; i < 500; i++) {
    const x = random() * 18 - 3;
    const y = random() * 18 - 3;
    const z = random() * 6 - 3;

    const expected = bruteForceNearest(vertices, x, y, z);
    const actual = index.nearest(x, y, z);

    // Ties are possible on a regular grid, so compare distance not identity.
    assert.ok(
      Math.abs(actual.distance - expected.distance) < 1e-6,
      `probe ${i} at (${x},${y},${z}): got vertex ${actual.vertex} at ${actual.distance}, ` +
      `expected ${expected.distance}`
    );
  }
});

test('an exact vertex position returns that vertex at zero distance', () => {
  const { vertices } = makeGrid(9);
  const index = buildVertexIndex(vertices);

  for (const v of [0, 13, 40, 80]) {
    const hit = index.nearest(vertices[3 * v], vertices[3 * v + 1], vertices[3 * v + 2]);
    assert.equal(hit.vertex, v);
    assert.ok(hit.distance < 1e-6);
  }
});

test('a far-away probe still resolves, so callers can threshold on distance', () => {
  const { vertices } = makeGrid(6);
  const index = buildVertexIndex(vertices);

  const hit = index.nearest(1000, 1000, 1000);
  assert.ok(hit.vertex >= 0);
  assert.ok(hit.distance > 100, 'distance is what tells the caller this was a miss');
});

test('degenerate meshes are handled', () => {
  assert.throws(() => buildVertexIndex(new Float32Array(0)), /empty mesh/);

  const single = buildVertexIndex(Float32Array.from([1, 2, 3]));
  const hit = single.nearest(0, 0, 0);
  assert.equal(hit.vertex, 0);

  // All vertices coincident: spans collapse to zero and must not divide by zero.
  const coincident = buildVertexIndex(Float32Array.from([5, 5, 5, 5, 5, 5, 5, 5, 5]));
  assert.equal(coincident.nearest(5, 5, 5).distance, 0);
});

test('a flat mesh (zero extent on one axis) indexes correctly', () => {
  // makeGrid is already planar in z; confirm the collapsed axis is not a problem.
  const { vertices } = makeGrid(7);
  const index = buildVertexIndex(vertices);
  const expected = bruteForceNearest(vertices, 3.4, 2.6, 0);
  const actual = index.nearest(3.4, 2.6, 0);
  assert.ok(Math.abs(actual.distance - expected.distance) < 1e-6);
});

test('a strictly planar patch is indexed in bounded time and memory', () => {
  // mris_flatten writes z = 0 for every vertex. Sizing the grid by volume made
  // the cell size vanish and the cell count explode across the two real axes —
  // seconds of allocation at patch scale, or an outright RangeError.
  const V = 40_000;
  const side = Math.ceil(Math.sqrt(V));
  const vertices = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    vertices[3 * v] = (v % side) * 0.7;
    vertices[3 * v + 1] = Math.floor(v / side) * 0.7;
    vertices[3 * v + 2] = 0;
  }

  const started = Date.now();
  const index = buildVertexIndex(vertices);
  assert.ok(Date.now() - started < 2000, 'must not take seconds');
  assert.ok(index.cellSize > 0.01, `cell size collapsed to ${index.cellSize}`);

  // And it still answers correctly: check against a brute-force scan.
  for (const probe of [0, 1234, V - 1, Math.floor(V / 2)]) {
    const x = vertices[3 * probe];
    const y = vertices[3 * probe + 1];
    const found = index.nearest(x + 0.1, y + 0.1, 0);
    assert.equal(found.vertex, probe, `planar lookup missed near vertex ${probe}`);
  }
});

test('degenerate geometry does not blow up the grid', () => {
  // Collinear: two axes have no extent at all.
  const line = new Float32Array(300);
  for (let v = 0; v < 100; v++) line[3 * v] = v * 0.5;
  const lineIndex = buildVertexIndex(line);
  assert.ok(lineIndex.cellSize > 0);
  assert.equal(lineIndex.nearest(9.6, 0, 0).vertex, 19);

  // Every vertex in the same place: no extent on any axis.
  const heap = new Float32Array(300);
  const heapIndex = buildVertexIndex(heap);
  assert.ok(heapIndex.nearest(0, 0, 0).vertex >= 0);
  assert.equal(heapIndex.nearest(0, 0, 0).distance, 0);
});
