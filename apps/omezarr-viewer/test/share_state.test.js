import assert from 'node:assert/strict'
import test from 'node:test'
import { readShareState, writeShareState } from '../src/share_state.ts'

const state = {
  layout: 3,
  azimuth: 120.5,
  elevation: 22,
  scale: 1.75,
  crosshair: [0.2, 0.4, 0.6],
  pan2D: [1.25, -2.5, 3.75, 2],
  renderPan: [0.1, -0.2],
  colormap: 'viridis',
  windowLevel: 500,
  windowWidth: 900,
  scrollZoomSpeed: 5,
  detailBudgetGiB: 8,
  showCrosshair: false,
  showScaleBar: true,
  showStats: true,
}

test('round-trips viewer settings through a share URL', () => {
  const url = writeShareState(
    new URL('https://webapps.neurodesk.org/omezarr-viewer/?url=https://example.test/a'),
    state,
  )
  assert.equal(url.searchParams.get('url'), 'https://example.test/a')
  assert.equal(url.searchParams.get('scrollZoomSpeed'), '5')
  assert.equal(url.searchParams.get('detailBudget'), '8')
  assert.deepEqual(readShareState(url.searchParams, state), state)
})

test('ignores invalid shared camera and detail budget values', () => {
  const params = new URLSearchParams('layout=99&zoom=nope&pan=1,2&detailBudget=99')
  assert.deepEqual(readShareState(params, state), state)
})
