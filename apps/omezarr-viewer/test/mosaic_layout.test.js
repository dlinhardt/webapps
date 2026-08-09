import assert from 'node:assert/strict'
import test from 'node:test'
import {
  layoutTranslatedBlocks,
  spatialTransformMm,
} from '../src/mosaic_layout.ts'

test('composes dataset and multiscale transforms into X/Y/Z millimetres', () => {
  assert.deepEqual(
    spatialTransformMm(
      [
        [
          { type: 'scale', scale: [1, 1, 2, 3, 4] },
          { type: 'translation', translation: [0, 0, 10, 20, 30] },
        ],
        [{ type: 'translation', translation: [0, 0, 1, 2, 3] }],
      ],
      [1, 1, 0.001, 0.001, 0.001],
    ),
    { spacing: [0.004, 0.003, 0.002], translation: [0.033, 0.022, 0.011] },
  )
})

test('places translated stores in one voxel grid', () => {
  const layout = layoutTranslatedBlocks([
    { id: 'left', shape: [4, 3, 2], spacing: [0.5, 1, 2], translation: [10, 20, 30] },
    { id: 'right', shape: [2, 3, 2], spacing: [0.5, 1, 2], translation: [12, 20, 30] },
  ])
  assert.deepEqual(layout.worldOrigin, [10, 20, 30])
  assert.deepEqual(layout.shape, [6, 3, 2])
  assert.deepEqual(layout.blocks.map((block) => block.voxelOrigin), [[0, 0, 0], [4, 0, 0]])
})

test('rejects overlapping translated stores', () => {
  assert.throws(
    () => layoutTranslatedBlocks([
      { id: 'a', shape: [4, 4, 4], spacing: [1, 1, 1], translation: [0, 0, 0] },
      { id: 'b', shape: [4, 4, 4], spacing: [1, 1, 1], translation: [2, 0, 0] },
    ]),
    /overlap/,
  )
})
