// Areas that partition the surface, and stay partitioned when one is edited.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency, findBoundaryVertices } from '../src/surface/adjacency.js';
import { resolveParcellation, anchorVertex, resolveArea } from '../src/surface/parcellation.js';
import { makeGrid, at, countMask } from './helpers.js';

const N = 21;

function flatPatch() {
  const grid = makeGrid(N);
  const graph = buildAdjacency(grid.vertices, grid.triangles);
  return {
    grid,
    base: {
      graph,
      positions: grid.vertices,
      openEdge: findBoundaryVertices(grid.triangles, grid.V)
    }
  };
}

/** An area defined by a line across the patch at row `j`, closed on the edge. */
const strip = (id, name, j) => ({
  id,
  name,
  clicks: [at(N, 1, j), at(N, N - 2, j)],
  closure: 'edge',
  regionIndex: 0
});

test('areas resolve in order and never overlap', () => {
  const { base } = flatPatch();
  const { areas, owner, assigned } = resolveParcellation(base, [
    strip(1, 'V1', 2), strip(2, 'V2', 6), strip(3, 'V3', 10)
  ]);

  assert.equal(areas.filter((a) => a.error).length, 0, 'all three resolved');
  assert.equal(countMask(areas[0].mask), 2 * N, 'rows 0-1');
  assert.equal(countMask(areas[1].mask), 4 * N, 'rows 2-5');
  assert.equal(countMask(areas[2].mask), 4 * N, 'rows 6-9');

  // Every assigned vertex belongs to exactly one area.
  for (let v = 0; v < base.graph.V; v++) {
    const owners = areas.filter((a) => a.mask && a.mask[v]).map((a) => a.id);
    assert.ok(owners.length <= 1, `vertex ${v} claimed by ${owners.join(' and ')}`);
    assert.equal(owner[v], owners.length ? owners[0] : -1);
  }
  assert.equal(assigned, 2 * N + 4 * N + 4 * N);
});

test('moving one area\'s border moves the shared boundary, and the neighbour follows', () => {
  const { base } = flatPatch();
  const before = resolveParcellation(base, [
    strip(1, 'V1', 4), strip(2, 'V2', 9)
  ]);
  assert.equal(countMask(before.areas[0].mask), 4 * N, 'V1 is rows 0-3');
  assert.equal(countMask(before.areas[1].mask), 5 * N, 'V2 is rows 4-8');

  // Pull V1's border down two rows. V2 was never redefined — but it grows,
  // because its region was always "between my line and the area below me".
  const after = resolveParcellation(base, [
    strip(1, 'V1', 2), strip(2, 'V2', 9)
  ]);
  assert.equal(countMask(after.areas[0].mask), 2 * N, 'V1 shrank to rows 0-1');
  assert.equal(countMask(after.areas[1].mask), 7 * N, 'V2 grew into rows 2-8');

  // And nothing was left behind: the two still meet exactly.
  const total = countMask(after.areas[0].mask) + countMask(after.areas[1].mask);
  assert.equal(total, 9 * N, 'no unclaimed strip between them');
  for (let v = 0; v < base.graph.V; v++) {
    assert.ok(!(after.areas[0].mask[v] && after.areas[1].mask[v]), `vertex ${v} in both`);
  }
});

test('pushing an area out also pushes its neighbour back', () => {
  const { base } = flatPatch();
  const grown = resolveParcellation(base, [strip(1, 'V1', 6), strip(2, 'V2', 9)]);
  assert.equal(countMask(grown.areas[0].mask), 6 * N, 'V1 now reaches row 5');
  assert.equal(countMask(grown.areas[1].mask), 3 * N, 'V2 is squeezed to rows 6-8');
});

test('order decides who wins the overlap', () => {
  const { base } = flatPatch();
  const first = resolveParcellation(base, [strip(1, 'V1', 6), strip(2, 'V2', 4)]);
  // V1 resolves first and takes rows 0-5. V2's line at row 4 is inside it.
  assert.equal(countMask(first.areas[0].mask), 6 * N);
  assert.ok(first.areas[1].error, 'V2 cannot be resolved beneath V1');
  assert.equal(first.areas[1].mask, null);

  // Swapped, both fit: V2 takes rows 0-3 and V1 the band above it.
  const swapped = resolveParcellation(base, [strip(2, 'V2', 4), strip(1, 'V1', 6)]);
  assert.equal(swapped.areas.filter((a) => a.error).length, 0);
  assert.equal(countMask(swapped.areas[0].mask), 4 * N);
  assert.equal(countMask(swapped.areas[1].mask), 2 * N);
});

test('an area that cannot be resolved claims nothing and does not stop the rest', () => {
  const { base } = flatPatch();
  const { areas, owner } = resolveParcellation(base, [
    strip(1, 'V1', 6),
    strip(2, 'broken', 4),
    strip(3, 'V3', 10)
  ]);
  assert.equal(areas[1].mask, null);
  assert.ok(areas[1].error);
  assert.equal(areas[2].error, null, 'the area after it still resolves');
  assert.equal(countMask(areas[2].mask), 4 * N, 'rows 6-9');
  for (let v = 0; v < base.graph.V; v++) {
    assert.notEqual(owner[v], 2, 'the broken area owns no vertex');
  }
});

test('the anchor is the point furthest inside, so it survives a boundary move', () => {
  const { base, grid } = flatPatch();
  const mask = new Uint8Array(grid.V);
  for (let j = 0; j < 5; j++) for (let i = 0; i < N; i++) mask[at(N, i, j)] = 1;
  const border = [];
  for (let i = 0; i < N; i++) border.push(at(N, i, 5));

  const anchor = anchorVertex(base.graph, mask, border);
  assert.ok(mask[anchor], 'inside the region');
  // Furthest from row 5 within rows 0-4 is row 0.
  assert.equal(Math.floor(anchor / N), 0);
});

test('the anchor keeps an area on the side it was on', () => {
  const { base } = flatPatch();
  // Two clicks near the middle: the smaller side is above, but the area was
  // defined below, and the anchor is what remembers that.
  const line = { id: 1, name: 'A', clicks: [at(N, 1, 12), at(N, N - 2, 12)], closure: 'edge' };

  const bySize = resolveArea(base, new Uint8Array(base.graph.V), { ...line, regionIndex: 0 });
  assert.equal(countMask(bySize.mask), 8 * N, 'smallest side: rows 13-20');

  const byAnchor = resolveArea(base, new Uint8Array(base.graph.V), {
    ...line, regionIndex: 0, anchor: at(N, 10, 4)
  });
  assert.equal(countMask(byAnchor.mask), 12 * N, 'the anchor wins: rows 0-11');
});

test('a loop area is refilled on the side its anchor is on', () => {
  const { base } = flatPatch();
  const square = {
    id: 1,
    name: 'square',
    clicks: [at(N, 4, 4), at(N, 16, 4), at(N, 16, 16), at(N, 4, 16)],
    closure: 'loop',
    anchor: at(N, 10, 10)
  };
  const { areas } = resolveParcellation(base, [square]);
  assert.equal(areas[0].error, null);
  assert.equal(countMask(areas[0].mask), 11 * 11, 'the interior of the square');
  assert.equal(areas[0].mask[at(N, 10, 10)], 1);
  assert.equal(areas[0].mask[at(N, 0, 0)], 0, 'not the outside');
});

test('resolving an empty list is a surface with nothing on it', () => {
  const { base } = flatPatch();
  const { areas, owner, assigned } = resolveParcellation(base, []);
  assert.deepEqual(areas, []);
  assert.equal(assigned, 0);
  assert.ok([...owner].every((o) => o === -1));
});
