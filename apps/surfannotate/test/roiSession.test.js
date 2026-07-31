import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency } from '../src/surface/adjacency.js';
import { SurfacePathfinder } from '../src/surface/pathfinder.js';
import { RoiSession, MODE_ROI, MODE_POINTS } from '../src/surface/roiSession.js';
import { makeGrid, at } from './helpers.js';

function makeSession(n = 21) {
  const { vertices, triangles } = makeGrid(n);
  const graph = buildAdjacency(vertices, triangles);
  const finder = new SurfacePathfinder(graph, vertices);
  return { session: new RoiSession(graph, finder, vertices), graph, n, vertices };
}

test('clicks are recorded without tracing anything', () => {
  const { session, n } = makeSession();

  session.addClick(at(n, 5, 5));
  session.addClick(at(n, 15, 5));
  session.addClick(at(n, 15, 15));

  assert.equal(session.clicks.length, 3);
  assert.equal(session.chain.length, 0, 'no path is built until the ROI is closed');
  assert.equal(session.closed, false);
});

test('closing traces every segment and joins the last click to the first', () => {
  const { session, graph, n } = makeSession();
  for (const [i, j] of [[5, 5], [15, 5], [15, 15], [5, 15]]) session.addClick(at(n, i, j));

  const result = session.closePath();
  assert.equal(result.ok, true);
  assert.equal(result.gaps.length, 0);
  assert.ok(result.chainLength > 4);
  assert.equal(session.closed, true);
  assert.equal(session.chain[0], at(n, 5, 5));
  assert.equal(session.chain[session.chain.length - 1], at(n, 5, 5));

  // Every step must be a mesh edge, or the fill will leak.
  for (let i = 0; i < session.chain.length - 1; i++) {
    const a = session.chain[i];
    const b = session.chain[i + 1];
    let adjacent = false;
    for (let e = graph.adjOffset[a]; e < graph.adjOffset[a + 1]; e++) {
      if (graph.adjNeighbor[e] === b) { adjacent = true; break; }
    }
    assert.ok(adjacent, `chain step ${i} (${a} -> ${b}) is not a mesh edge`);
  }
});

test('fewer than three clicks cannot close', () => {
  const { session, n } = makeSession();
  session.addClick(at(n, 5, 5));
  session.addClick(at(n, 10, 5));

  const result = session.closePath();
  assert.equal(result.ok, false);
  assert.equal(session.closed, false);
  assert.equal(session.chain.length, 0);
});

test('editing the clicks reopens the ROI and discards the trace and fill', () => {
  const { session, n, vertices } = makeSession();
  for (const [i, j] of [[5, 5], [15, 5], [15, 15], [5, 15]]) session.addClick(at(n, i, j));
  session.closePath();
  const filled = session.fill({ vertices });
  assert.equal(filled.ok, true);
  assert.ok(session.chain.length > 0);

  session.addClick(at(n, 8, 18));
  assert.equal(session.closed, false);
  assert.equal(session.chain.length, 0, 'the old trace is gone');
  assert.equal(session.filled, null, 'the old fill is gone');

  session.undoClick();
  assert.equal(session.clicks.length, 4);
  assert.equal(session.chain.length, 0, 'undo does not silently re-trace');
  assert.equal(session.closed, false);
});

test('filling before closing is refused', () => {
  const { session, n, vertices } = makeSession();
  for (const [i, j] of [[5, 5], [15, 5], [15, 15]]) session.addClick(at(n, i, j));

  const result = session.fill({ vertices });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NOT_CLOSED');
});

test('a closed square fills to its interior', () => {
  const { session, n, vertices } = makeSession();
  for (const [i, j] of [[5, 5], [15, 5], [15, 15], [5, 15]]) session.addClick(at(n, i, j));
  session.closePath();

  const result = session.fill({ vertices });
  assert.equal(result.ok, true);
  assert.equal(result.count, 81, 'the 9x9 block inside the perimeter');
  assert.equal(session.filled[at(n, 10, 10)], 1);
  assert.equal(session.filled[at(n, 0, 0)], 0);
});

test('consecutive duplicate clicks are ignored', () => {
  const { session, n } = makeSession();
  session.addClick(at(n, 5, 5));
  assert.equal(session.addClick(at(n, 5, 5)), false);
  assert.equal(session.clicks.length, 1);
});

test('clearing resets everything', () => {
  const { session, n, vertices } = makeSession();
  for (const [i, j] of [[5, 5], [15, 5], [15, 15], [5, 15]]) session.addClick(at(n, i, j));
  session.closePath();
  session.fill({ vertices });

  session.clearRoi();
  assert.equal(session.clicks.length, 0);
  assert.equal(session.chain.length, 0);
  assert.equal(session.filled, null);
  assert.equal(session.closed, false);
});

test('landmarks toggle independently of the ROI', () => {
  const { session } = makeSession();
  session.setMode(MODE_POINTS);
  assert.equal(session.mode, MODE_POINTS);

  session.togglePoint(10, 'V1');
  session.togglePoint(20);
  assert.equal(session.points.length, 2);
  assert.equal(session.points[0].name, 'V1');

  assert.equal(session.togglePoint(10).added, false);
  assert.equal(session.points.length, 1);

  session.setMode(MODE_ROI);
  session.clearPoints();
  assert.equal(session.points.length, 0);
  assert.throws(() => session.setMode('nonsense'), /unknown mode/);
});
