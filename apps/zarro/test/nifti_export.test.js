import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createNiftiHeader,
  formatApproxBytes,
  geometryForWorldBounds,
  niftiFileBytes,
  niftiVersionForShape,
  worldBoundsForGeometry,
} from '../src/nifti_export.ts'

test('maps the same physical crop onto a different pyramid level', () => {
  const bounds = worldBoundsForGeometry({
    level: 2,
    shape: [10, 8, 4],
    spacing: [4, 4, 4],
    worldOrigin: [10, 20, 30],
    origin: [5, 2, 1],
  })
  assert.deepEqual(bounds, { min: [30, 28, 34], max: [70, 60, 50] })
  assert.deepEqual(
    geometryForWorldBounds(bounds, {
      level: 0,
      shape: [100, 80, 40],
      spacing: [1, 1, 1],
      worldOrigin: [10, 20, 30],
    }),
    {
      level: 0,
      shape: [40, 32, 16],
      spacing: [1, 1, 1],
      worldOrigin: [10, 20, 30],
      origin: [20, 8, 4],
    },
  )
})

test('reports an approximate complete NIfTI file size', () => {
  assert.equal(niftiFileBytes([16, 8, 4], 16), 1376)
  assert.equal(formatApproxBytes(1376), 'approximately 1.34 KiB')
})

test('writes a NIfTI-1 header with dimensions and physical origin', () => {
  const header = createNiftiHeader({
    shape: [16, 8, 4],
    spacing: [0.5, 1, 2],
    affineOrigin: [10, 20, 30],
    datatypeCode: 512,
    numBitsPerVoxel: 16,
    calMin: 0,
    calMax: 65535,
  })
  const view = new DataView(header.buffer)
  assert.equal(header.byteLength, 352)
  assert.equal(view.getInt32(0, true), 348)
  assert.deepEqual([1, 2, 3].map((axis) => view.getInt16(40 + axis * 2, true)), [16, 8, 4])
  assert.deepEqual(
    [292, 308, 324].map((offset) => view.getFloat32(offset, true)),
    [10, 20, 30],
  )
})

test('uses NIfTI-2 when a dimension exceeds the NIfTI-1 limit', () => {
  assert.equal(niftiVersionForShape([32767, 2, 1]), 1)
  assert.equal(niftiVersionForShape([32768, 2, 1]), 2)
  const header = createNiftiHeader({
    shape: [41840, 2, 1],
    spacing: [1, 1, 1],
    affineOrigin: [0, 0, 0],
    datatypeCode: 2,
    numBitsPerVoxel: 8,
    calMin: 0,
    calMax: 255,
  })
  const view = new DataView(header.buffer)
  assert.equal(header.byteLength, 544)
  assert.equal(view.getInt32(0, true), 540)
  assert.equal(view.getBigInt64(24, true), 41840n)
})
