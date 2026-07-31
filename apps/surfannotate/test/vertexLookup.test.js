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
