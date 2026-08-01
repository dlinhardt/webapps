import test from 'node:test';
import assert from 'node:assert/strict';

import { hatchMask } from '../src/surface/hatch.js';
import { buildAdjacency } from '../src/surface/adjacency.js';
import { makeGrid, at, countMask } from './helpers.js';

test('hatching inks only part of the region', () => {
  const { vertices, V } = makeGrid(40);
  const region = new Uint8Array(V).fill(1);

  const ink = hatchMask(vertices, region, { spacingMm: 2.5, duty: 0.32 });
  const inked = countMask(ink);

  assert.ok(inked > 0, 'something is inked');
  assert.ok(inked < V, 'the region is not filled solid');
  // Roughly the duty cycle; the grid is coarse relative to the stripe period so
  // allow a wide band rather than asserting a precise fraction.
  const fraction = inked / V;
  assert.ok(fraction > 0.1 && fraction < 0.6, `inked fraction ${fraction} is out of range`);
});

test('hatching never marks a vertex outside the region', () => {
  const { vertices, n, V } = makeGrid(30);
  const region = new Uint8Array(V);
  for (let j = 10; j <= 20; j++) for (let i = 10; i <= 20; i++) region[at(n, i, j)] = 1;

  const ink = hatchMask(vertices, region);
  for (let v = 0; v < V; v++) {
    if (ink[v]) assert.equal(region[v], 1, `vertex ${v} inked outside the region`);
  }
});

test('duty sets how much is inked; spacing only sets stripe granularity', () => {
  const { vertices, V } = makeGrid(40);
  const region = new Uint8Array(V).fill(1);

  // Duty is a fraction of each period, so coverage tracks duty and is
  // essentially independent of spacing — wider spacing gives fewer, thicker
  // stripes covering the same area.
  const light = countMask(hatchMask(vertices, region, { spacingMm: 3, duty: 0.2 }));
  const heavy = countMask(hatchMask(vertices, region, { spacingMm: 3, duty: 0.7 }));
  assert.ok(heavy > light * 2, `duty 0.7 (${heavy}) should ink far more than 0.2 (${light})`);

  const tight = countMask(hatchMask(vertices, region, { spacingMm: 2, duty: 0.3 }));
  const wide = countMask(hatchMask(vertices, region, { spacingMm: 8, duty: 0.3 }));
  const drift = Math.abs(wide - tight) / tight;
  assert.ok(drift < 0.25, `coverage should track duty, not spacing (drifted ${drift})`);
});

test('spacing controls the number of distinct stripes', () => {
  // Sample a straight line so stripe runs can be counted directly.
  const V = 800;
  const positions = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) positions[3 * v] = v * 0.1; // 0..80 mm
  const region = new Uint8Array(V).fill(1);

  const runs = (spacingMm) => {
    const ink = hatchMask(positions, region, { spacingMm, duty: 0.4, direction: [1, 0, 0] });
    let count = 0;
    for (let v = 0; v < V; v++) if (ink[v] && !ink[v - 1]) count++;
    return count;
  };

  assert.ok(runs(2) > runs(8), 'tighter spacing produces more stripes');
});


test('hatching handles negative coordinates without a seam', () => {
  // Cortical surfaces straddle the origin, so a naive modulo would flip the
  // stripe phase either side of zero.
  const V = 400;
  const positions = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) positions[3 * v] = -50 + v * 0.25;
  const region = new Uint8Array(V).fill(1);

  const ink = hatchMask(positions, region, { spacingMm: 2, duty: 0.5, direction: [1, 0, 0] });

  // Count stripe transitions; a phase flip at the origin would show up as an
  // irregular run length there. Just assert both halves are inked comparably.
  let negative = 0;
  let positive = 0;
  for (let v = 0; v < V; v++) {
    if (!ink[v]) continue;
    if (positions[3 * v] < 0) negative++; else positive++;
  }
  assert.ok(negative > 0 && positive > 0);
  const ratio = negative / positive;
  assert.ok(ratio > 0.5 && ratio < 2, `stripes are uneven across the origin (ratio ${ratio})`);
});

test('hatching rejects nonsense parameters', () => {
  const { vertices, V } = makeGrid(5);
  const region = new Uint8Array(V).fill(1);
  assert.throws(() => hatchMask(vertices, region, { spacingMm: 0 }), /spacing must be positive/);
  assert.throws(() => hatchMask(vertices, region, { duty: 0 }), /duty must be between/);
  assert.throws(() => hatchMask(vertices, region, { duty: 1 }), /duty must be between/);
  assert.throws(() => hatchMask(vertices, region, { direction: [0, 0, 0] }), /non-zero/);
});

