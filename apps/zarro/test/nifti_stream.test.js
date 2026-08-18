import assert from 'node:assert/strict'
import test from 'node:test'
import {
  niftiTileCount,
  niftiTileShape,
  streamNiftiTiles,
} from '../src/nifti_stream.ts'

test('plans bounded tiles for the observed 5.79 GiB export', () => {
  const shape = [5235, 2321, 256]
  const tileShape = niftiTileShape(shape, 2)
  assert.deepEqual(tileShape, [5235, 1602, 1])
  assert.equal(niftiTileCount(shape, tileShape), 512)
})

test('reports byte progress and coalesces full-width rows', async () => {
  const writes = []
  const progress = []
  await streamNiftiTiles({
    shape: [10, 7, 2],
    bytesPerVoxel: 2,
    headerBytes: 352,
    targetTileBytes: 80,
    signal: new AbortController().signal,
    fetchTile: async ({ shape }) =>
      new Uint8Array(shape[0] * shape[1] * shape[2] * 2),
    write: async (position, data) => {
      writes.push({ position, bytes: data.byteLength })
    },
    onProgress: (next) => progress.push(next),
  })

  assert.equal(writes.length, 4)
  assert.deepEqual(writes.map(({ bytes }) => bytes), [80, 60, 80, 60])
  assert.deepEqual(writes.map(({ position }) => position), [352, 432, 492, 572])
  assert.equal(progress.at(-1).completedBytes, 280)
  assert.equal(progress.at(-1).totalBytes, 280)
  assert.equal(progress.at(-1).tileIndex, 4)
  assert.equal(progress.at(-1).totalTiles, 4)
})

test('stops between writes when the user cancels', async () => {
  const controller = new AbortController()
  let writes = 0
  await assert.rejects(
    streamNiftiTiles({
      shape: [10, 7, 2],
      bytesPerVoxel: 2,
      headerBytes: 352,
      targetTileBytes: 80,
      signal: controller.signal,
      fetchTile: async ({ shape }) =>
        new Uint8Array(shape[0] * shape[1] * shape[2] * 2),
      write: async () => {
        writes++
      },
      onProgress: ({ phase, completedBytes }) => {
        if (phase === 'writing' && completedBytes > 0) controller.abort()
      },
    }),
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.equal(writes, 1)
})
