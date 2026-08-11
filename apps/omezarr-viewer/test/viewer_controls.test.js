import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detailLevelForZoom,
  rangeBoundsForWindow,
  wheelZoomValue,
  windowFromLevelWidth,
  windowLevelWidth,
  zoomForDetailLevel,
  zoomLevelControlDisplay,
} from '../src/viewer_controls.ts'

test('min and max round-trip through window level and width', () => {
  const levelWidth = windowLevelWidth({ min: 40, max: 100 })
  assert.deepEqual(levelWidth, { level: 70, width: 60 })
  assert.deepEqual(windowFromLevelWidth(levelWidth.level, levelWidth.width), {
    min: 40,
    max: 100,
  })
})

test('scroll zoom speed scales a wheel gesture', () => {
  const normal = wheelZoomValue(1, -100, 0, 800, 1)
  const faster = wheelZoomValue(1, -100, 0, 800, 2)
  assert.ok(normal > 1)
  assert.ok(faster > normal)
})

test('scroll zoom can cross 10x to reach finer Zarr levels', () => {
  assert.ok(wheelZoomValue(10, -120, 0, 800, 4) > 10)
  assert.equal(wheelZoomValue(0.11, 120, 0, 800, 4), 0.1)
  assert.equal(detailLevelForZoom(6, 16, 7), 2)
  assert.equal(detailLevelForZoom(6, 32, 7), 1)
  assert.equal(detailLevelForZoom(6, 64, 7), 0)
})

test('zoom controls round-trip directly through OME-Zarr levels', () => {
  for (let level = 0; level <= 6; level++) {
    const zoom = zoomForDetailLevel(level, 7)
    assert.equal(detailLevelForZoom(6, zoom, 7), level)
  }
  assert.equal(zoomForDetailLevel(6, 7), 1)
  assert.equal(zoomForDetailLevel(1, 7), 32)
  assert.equal(zoomForDetailLevel(0, 7), 64)
  assert.deepEqual(zoomLevelControlDisplay(1, null, 7), {
    value: 1,
    label: 'L1',
    canApply: false,
  })
  assert.deepEqual(zoomLevelControlDisplay(1, 0, 7), {
    value: 0,
    label: 'L0 · finest · pending',
    canApply: true,
  })
})

test('range bounds expand to preserve the exact level and width window', () => {
  assert.deepEqual(rangeBoundsForWindow({ min: -40, max: 60 }, 0, 255), {
    min: -40,
    max: 255,
  })
})
