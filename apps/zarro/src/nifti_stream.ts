import type { Shape3 } from './logical_volume'

export type NiftiStreamPhase = 'fetching' | 'writing'

export interface NiftiStreamTile {
  index: number
  total: number
  origin: Shape3
  shape: Shape3
  sliceIndex: number
  sliceCount: number
}

export interface NiftiStreamProgress {
  phase: NiftiStreamPhase
  tileIndex: number
  totalTiles: number
  sliceIndex: number
  sliceCount: number
  completedBytes: number
  totalBytes: number
}

interface StreamNiftiTilesOptions {
  shape: Shape3
  bytesPerVoxel: number
  headerBytes: number
  signal: AbortSignal
  fetchTile(tile: NiftiStreamTile): Promise<Uint8Array>
  write(position: number, data: Uint8Array): Promise<void>
  onProgress?(progress: NiftiStreamProgress): void
  targetTileBytes?: number
}

const DEFAULT_TARGET_TILE_BYTES = 16 * 1024 * 1024

function axisMap(fn: (axis: number) => number): Shape3 {
  return [fn(0), fn(1), fn(2)]
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The export was cancelled', 'AbortError')
}

export function niftiTileShape(
  shape: Shape3,
  bytesPerVoxel: number,
  targetTileBytes = DEFAULT_TARGET_TILE_BYTES,
): Shape3 {
  const tileX = Math.min(
    shape[0],
    Math.max(1, Math.floor(targetTileBytes / bytesPerVoxel)),
  )
  const tileY = Math.min(
    shape[1],
    Math.max(1, Math.floor(targetTileBytes / (tileX * bytesPerVoxel))),
  )
  const tileZ = Math.min(
    shape[2],
    Math.max(
      1,
      Math.floor(targetTileBytes / (tileX * tileY * bytesPerVoxel)),
    ),
  )
  return [tileX, tileY, tileZ]
}

export function niftiTileCount(shape: Shape3, tileShape: Shape3): number {
  return axisMap((axis) => Math.ceil(shape[axis] / tileShape[axis])).reduce(
    (total, count) => total * count,
    1,
  )
}

export async function streamNiftiTiles({
  shape,
  bytesPerVoxel,
  headerBytes,
  signal,
  fetchTile,
  write,
  onProgress,
  targetTileBytes = DEFAULT_TARGET_TILE_BYTES,
}: StreamNiftiTilesOptions): Promise<void> {
  const tileShape = niftiTileShape(shape, bytesPerVoxel, targetTileBytes)
  const totalTiles = niftiTileCount(shape, tileShape)
  const totalBytes = shape[0] * shape[1] * shape[2] * bytesPerVoxel
  let completedBytes = 0
  let tileIndex = 0

  const report = (
    phase: NiftiStreamPhase,
    sliceIndex: number,
  ): void => {
    onProgress?.({
      phase,
      tileIndex,
      totalTiles,
      sliceIndex,
      sliceCount: shape[2],
      completedBytes,
      totalBytes,
    })
  }

  for (let z = 0; z < shape[2]; z += tileShape[2]) {
    const depth = Math.min(tileShape[2], shape[2] - z)
    for (let y = 0; y < shape[1]; y += tileShape[1]) {
      const height = Math.min(tileShape[1], shape[1] - y)
      for (let x = 0; x < shape[0]; x += tileShape[0]) {
        throwIfAborted(signal)
        const width = Math.min(tileShape[0], shape[0] - x)
        tileIndex++
        const tile: NiftiStreamTile = {
          index: tileIndex,
          total: totalTiles,
          origin: [x, y, z],
          shape: [width, height, depth],
          sliceIndex: z + 1,
          sliceCount: shape[2],
        }
        report('fetching', z + 1)
        const bytes = await fetchTile(tile)
        throwIfAborted(signal)
        const expectedBytes = width * height * depth * bytesPerVoxel
        if (bytes.byteLength !== expectedBytes) {
          throw new Error(
            `NIfTI tile ${tileIndex} returned ${bytes.byteLength}B, expected ${expectedBytes}B`,
          )
        }

        report('writing', z + 1)
        if (width === shape[0]) {
          const slabBytes = width * height * bytesPerVoxel
          for (let localZ = 0; localZ < depth; localZ++) {
            throwIfAborted(signal)
            const sourceOffset = localZ * slabBytes
            const voxelOffset =
              ((z + localZ) * shape[1] + y) * shape[0]
            const data = bytes.subarray(sourceOffset, sourceOffset + slabBytes)
            await write(headerBytes + voxelOffset * bytesPerVoxel, data)
            completedBytes += data.byteLength
            report('writing', z + localZ + 1)
          }
          continue
        }

        const rowBytes = width * bytesPerVoxel
        for (let localZ = 0; localZ < depth; localZ++) {
          for (let localY = 0; localY < height; localY++) {
            throwIfAborted(signal)
            const sourceOffset = (localZ * height + localY) * rowBytes
            const voxelOffset =
              ((z + localZ) * shape[1] + y + localY) * shape[0] + x
            const data = bytes.subarray(sourceOffset, sourceOffset + rowBytes)
            await write(headerBytes + voxelOffset * bytesPerVoxel, data)
            completedBytes += data.byteLength
            report('writing', z + localZ + 1)
          }
        }
      }
    }
  }
}
