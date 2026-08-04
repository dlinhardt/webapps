// Closing an ROI against the cut edge of a flat patch, end to end through the
// session — the workflow this exists for is "delineate V1 on an occipital patch
// where one side of the area is the cut itself".

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency, findBoundaryVertices } from '../src/surface/adjacency.js';
import { SurfacePathfinder, validateChain } from '../src/surface/pathfinder.js';
import { RoiSession, CLOSURE_EDGE, CLOSURE_LOOP } from '../src/surface/roiSession.js';
import { makeGrid, makeGridWithHole, makeTetrahedron, at, countMask } from './helpers.js';

const N = 9;

function session(mesh = makeGrid(N)) {
  const graph = buildAdjacency(mesh.vertices, mesh.triangles);
  const finder = new SurfacePathfinder(graph, mesh.vertices);
  const onEdge = findBoundaryVertices(mesh.triangles, graph.V);
  let edgeCount = 0;
  for (let v = 0; v < onEdge.length; v++) if (onEdge[v]) edgeCount++;
  return {
    graph,
    onEdge,
    edgeCount,
    roi: new RoiSession(graph, finder, mesh.vertices, {
      openEdge: edgeCount > 0 ? onEdge : null
    })
  };
}

test('a line across the patch closes against the cut and cuts off a strip', () => {
  const { roi, onEdge, graph } = session();

  // Two clicks only, along the row j = 2, both well inside the patch. On a
  // closed loop this would not even be enough points.
  roi.addClick(at(N, 1, 2));
  roi.addClick(at(N, 7, 2));

  const closed = roi.closeOnEdge();
  assert.equal(closed.ok, true, closed.error || '');
  assert.equal(roi.closure, CLOSURE_EDGE);
  assert.equal(closed.regions, 2, 'the patch is now in two pieces');
  assert.ok(validateChain(graph, roi.chain).ok, 'the barrier is walkable');
  assert.equal(onEdge[roi.chain[0]], 1, 'the border starts on the cut');
  assert.equal(onEdge[roi.chain[roi.chain.length - 1]], 1, 'and ends on it');

  const filled = roi.fill();
  assert.equal(filled.ok, true, filled.error || '');
  // Rows j = 0 and j = 1 are cut off by the line at j = 2: 2 x 9 vertices.
  assert.equal(filled.count, 18);
  assert.equal(countMask(roi.filled), 18);
  // The whole of both rows, and nothing above the line.
  for (let i = 0; i < N; i++) {
    assert.equal(roi.filled[at(N, i, 0)], 1, `(${i},0) is inside`);
    assert.equal(roi.filled[at(N, i, 1)], 1, `(${i},1) is inside`);
    assert.equal(roi.filled[at(N, i, 3)], 0, `(${i},3) is outside`);
  }
});

test('the smaller side is taken, and the other side is one call away', () => {
  const { roi } = session();
  roi.addClick(at(N, 1, 2));
  roi.addClick(at(N, 7, 2));
  roi.closeOnEdge();

  const small = roi.fill();
  assert.equal(small.count, 18, 'the strip below the line, not the rest of the patch');
  assert.equal(roi.regionOrder.length, 2);
  assert.equal(roi.regionIndex, 0);

  const other = roi.nextRegion();
  assert.equal(other.count, 54, 'rows 3..8');
  assert.equal(roi.regionIndex, 1);
  assert.equal(roi.filled[at(N, 4, 6)], 1);
  assert.equal(roi.filled[at(N, 4, 0)], 0);

  const back = roi.nextRegion();
  assert.equal(back.count, 18, 'and it cycles back');
});

test('no fill escapes the barrier, whichever side is taken', () => {
  const { roi, graph } = session();
  roi.addClick(at(N, 1, 2));
  roi.addClick(at(N, 7, 2));
  roi.closeOnEdge();

  const barrier = roi.boundaryMask();
  for (const region of [roi.fill(), roi.nextRegion()]) {
    assert.equal(region.ok, true);
    for (let v = 0; v < graph.V; v++) {
      if (roi.filled[v] && barrier[v]) assert.fail(`vertex ${v} is both border and region`);
    }
  }
  // The two sides plus the border account for the entire patch, with no overlap
  // and nothing left over.
  const first = roi.fill().count;
  const second = roi.nextRegion().count;
  assert.equal(first + second + countMask(barrier), graph.V);
});

test('two clicks are enough, one is not', () => {
  const { roi } = session();
  assert.equal(roi.closeOnEdge().error, 'TOO_FEW_CLICKS');
  roi.addClick(at(N, 1, 2));
  assert.equal(roi.closeOnEdge().error, 'TOO_FEW_CLICKS');
  roi.addClick(at(N, 7, 2));
  assert.equal(roi.closeOnEdge().ok, true);
});

test('a closed surface has no cut to close against', () => {
  const closed = makeTetrahedron();
  const { roi, edgeCount } = session(closed);
  assert.equal(edgeCount, 0);
  assert.equal(roi.hasOpenEdge, false);

  roi.addClick(0);
  roi.addClick(1);
  assert.equal(roi.closeOnEdge().error, 'NO_OPEN_EDGE');
  assert.equal(roi.closed, false);
});

test('a line between two different cuts is refused, because it encloses nothing', () => {
  // An annulus: the line runs from the outer rim to the rim of the hole, which
  // makes the patch a disk but does not divide it — you can walk round the far
  // side of the hole. Silently filling here would hand back the whole patch.
  const holed = makeGridWithHole(N, 3, 5);
  const { roi, onEdge, edgeCount } = session(holed);
  assert.ok(edgeCount > 4 * (N - 1), 'the hole adds a second rim');
  assert.equal(onEdge[at(N, 3, 3)], 1, 'the hole rim is an open edge');

  roi.addClick(at(N, 4, 1));
  roi.addClick(at(N, 4, 2));
  const result = roi.closeOnEdge();

  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_SEPARATION');
  assert.equal(roi.closed, false, 'and nothing is left half-closed');
  assert.equal(roi.chain.length, 0);
});

test('editing the clicks discards an edge closure like any other', () => {
  const { roi } = session();
  roi.addClick(at(N, 1, 2));
  roi.addClick(at(N, 7, 2));
  roi.closeOnEdge();
  roi.fill();
  assert.equal(roi.closure, CLOSURE_EDGE);
  assert.ok(roi.filled);

  roi.undoClick();
  assert.equal(roi.closure, null);
  assert.equal(roi.closed, false);
  assert.equal(roi.filled, null);
  assert.equal(roi.regionOrder.length, 0);
  assert.equal(roi.regionIndex, -1);
});

test('a loop closure still behaves as before and offers no other side', () => {
  const { roi } = session();
  roi.addClick(at(N, 2, 2));
  roi.addClick(at(N, 6, 2));
  roi.addClick(at(N, 6, 6));
  roi.addClick(at(N, 2, 6));

  assert.equal(roi.closePath().ok, true);
  assert.equal(roi.closure, CLOSURE_LOOP);

  // The patch has an open edge, so the app asks for a seed; supply one.
  const filled = roi.fill({ seed: at(N, 4, 4) });
  assert.equal(filled.ok, true);
  assert.equal(filled.count, 9, 'the 3x3 interior of the square');
  assert.equal(roi.regionOrder.length, 0, 'region cycling is for edge closures only');
  assert.equal(roi.nextRegion(), null);
});

test('include-boundary adds the border to an edge region exactly once', () => {
  const { roi } = session();
  roi.addClick(at(N, 1, 2));
  roi.addClick(at(N, 7, 2));
  roi.closeOnEdge();

  const plain = roi.fill();
  const withBorder = roi.fill({ includeBoundary: true });
  assert.equal(withBorder.count, plain.count + roi.chain.length);
  assert.equal(countMask(roi.filled), withBorder.count, 'the count matches the mask');
});
