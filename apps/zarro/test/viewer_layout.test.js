import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MULTIPLANAR_TYPE,
  SHOW_RENDER,
  SLICE_TYPE,
} from '@niivue/niivue'
import {
  LAYOUT_PRESET,
  layoutDetailZoom,
  viewerLayoutConfig,
} from '../src/viewer_layout.ts'

test('equal slices uses three horizontal thirds without a render tile', () => {
  const layout = viewerLayoutConfig(LAYOUT_PRESET.EQUAL_SLICES)

  assert.equal(layout.sliceType, SLICE_TYPE.MULTIPLANAR)
  assert.equal(layout.showRender, SHOW_RENDER.NEVER)
  assert.equal(layout.multiplanarType, MULTIPLANAR_TYPE.ROW)
  assert.equal(layout.isEqualSize, true)
  assert.equal(layout.customLayout, null)
})

test('vertical equal slices request detail for the magnified thin axis', () => {
  assert.equal(
    layoutDetailZoom(LAYOUT_PRESET.EQUAL_SLICES_VERTICAL, 1, [58, 58, 5]),
    4,
  )
  assert.equal(
    layoutDetailZoom(LAYOUT_PRESET.EQUAL_SLICES, 1, [58, 58, 5]),
    1,
  )
})

test('vertical equal slices fills three equal display tiles', () => {
  const layout = viewerLayoutConfig(LAYOUT_PRESET.EQUAL_SLICES_VERTICAL)

  assert.equal(layout.sliceType, SLICE_TYPE.MULTIPLANAR)
  assert.equal(layout.showRender, SHOW_RENDER.NEVER)
  assert.equal(layout.multiplanarType, MULTIPLANAR_TYPE.COLUMN)
  assert.equal(layout.isEqualSize, false)
  assert.deepEqual(layout.customLayout, [
    {
      sliceType: SLICE_TYPE.AXIAL,
      position: [0, 0, 1, 1 / 3],
      squareCropFraction: 1,
    },
    {
      sliceType: SLICE_TYPE.CORONAL,
      position: [0, 1 / 3, 1, 1 / 3],
      squareCropFraction: 0.4,
    },
    {
      sliceType: SLICE_TYPE.SAGITTAL,
      position: [0, 2 / 3, 1, 1 / 3],
      squareCropFraction: 0.4,
    },
  ])
})
