import type { Shape3 } from './logical_volume'

export interface ExportGridLevel {
  level: number
  shape: Shape3
  spacing: Shape3
  worldOrigin: Shape3
}

export interface NiftiExportGeometry extends ExportGridLevel {
  origin: Shape3
}

export interface WorldBounds {
  min: Shape3
  max: Shape3
}

export type NiftiVersion = 1 | 2

export interface NiftiHeaderOptions {
  shape: Shape3
  spacing: Shape3
  affineOrigin: Shape3
  datatypeCode: number
  numBitsPerVoxel: number
  calMin: number
  calMax: number
  description?: string
  version?: NiftiVersion
}

export const NIFTI1_HEADER_BYTES = 352
export const NIFTI2_HEADER_BYTES = 544
export const NIFTI1_MAX_DIMENSION = 32_767

const axisMap = <T>(fn: (axis: number) => T): [T, T, T] => [
  fn(0),
  fn(1),
  fn(2),
]

export function worldBoundsForGeometry(
  geometry: NiftiExportGeometry,
): WorldBounds {
  return {
    min: axisMap(
      (axis) =>
        geometry.worldOrigin[axis] +
        geometry.origin[axis] * geometry.spacing[axis],
    ),
    max: axisMap(
      (axis) =>
        geometry.worldOrigin[axis] +
        (geometry.origin[axis] + geometry.shape[axis]) *
          geometry.spacing[axis],
    ),
  }
}

/** Map one physical crop onto a pyramid level, enclosing the complete crop. */
export function geometryForWorldBounds(
  bounds: WorldBounds,
  level: ExportGridLevel,
): NiftiExportGeometry {
  const epsilon = 1e-7
  const origin = axisMap((axis) => {
    const voxel =
      (bounds.min[axis] - level.worldOrigin[axis]) / level.spacing[axis]
    return Math.max(0, Math.min(level.shape[axis] - 1, Math.floor(voxel + epsilon)))
  })
  const end = axisMap((axis) => {
    const voxel =
      (bounds.max[axis] - level.worldOrigin[axis]) / level.spacing[axis]
    return Math.max(origin[axis] + 1, Math.min(level.shape[axis], Math.ceil(voxel - epsilon)))
  })
  return {
    ...level,
    origin,
    shape: axisMap((axis) => end[axis] - origin[axis]),
  }
}

export function niftiVersionForShape(shape: Shape3): NiftiVersion {
  return shape.some((size) => size > NIFTI1_MAX_DIMENSION) ? 2 : 1
}

export function niftiHeaderBytes(version: NiftiVersion): number {
  return version === 2 ? NIFTI2_HEADER_BYTES : NIFTI1_HEADER_BYTES
}

export function niftiImageBytes(
  shape: Shape3,
  numBitsPerVoxel: number,
): number {
  const bytes =
    shape[0] * shape[1] * shape[2] * Math.ceil(numBitsPerVoxel / 8)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('The NIfTI image size exceeds safe browser file addressing')
  }
  return bytes
}

export function niftiFileBytes(
  shape: Shape3,
  numBitsPerVoxel: number,
): number {
  const version = niftiVersionForShape(shape)
  return niftiHeaderBytes(version) + niftiImageBytes(shape, numBitsPerVoxel)
}

export function formatApproxBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `approximately ${value.toFixed(digits)} ${units[unit]}`
}

function writeText(
  output: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  output.set(new TextEncoder().encode(value).subarray(0, length), offset)
}

function writeNifti1Header(options: NiftiHeaderOptions): Uint8Array {
  if (options.shape.some((size) => size > NIFTI1_MAX_DIMENSION)) {
    throw new Error('NIfTI-1 cannot store a dimension larger than 32767 voxels')
  }
  const output = new Uint8Array(NIFTI1_HEADER_BYTES)
  const view = new DataView(output.buffer)
  const littleEndian = true
  view.setInt32(0, 348, littleEndian)
  view.setUint8(39, 0)
  const dims = [3, ...options.shape, 1, 1, 1, 1]
  for (let index = 0; index < 8; index++) {
    view.setInt16(40 + index * 2, dims[index] ?? 1, littleEndian)
  }
  view.setInt16(70, options.datatypeCode, littleEndian)
  view.setInt16(72, options.numBitsPerVoxel, littleEndian)
  const pixDims = [1, ...options.spacing, 1, 1, 1, 1]
  for (let index = 0; index < 8; index++) {
    view.setFloat32(76 + index * 4, pixDims[index] ?? 1, littleEndian)
  }
  view.setFloat32(108, NIFTI1_HEADER_BYTES, littleEndian)
  view.setFloat32(112, 1, littleEndian)
  view.setFloat32(116, 0, littleEndian)
  view.setUint8(123, 10)
  view.setFloat32(124, options.calMax, littleEndian)
  view.setFloat32(128, options.calMin, littleEndian)
  writeText(output, 148, 80, options.description ?? 'ZARRo OME-Zarr export')
  view.setInt16(252, 0, littleEndian)
  view.setInt16(254, 1, littleEndian)
  view.setFloat32(268, options.affineOrigin[0], littleEndian)
  view.setFloat32(272, options.affineOrigin[1], littleEndian)
  view.setFloat32(276, options.affineOrigin[2], littleEndian)
  const affine = [
    [options.spacing[0], 0, 0, options.affineOrigin[0]],
    [0, options.spacing[1], 0, options.affineOrigin[1]],
    [0, 0, options.spacing[2], options.affineOrigin[2]],
  ]
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      view.setFloat32(
        280 + (row * 4 + column) * 4,
        affine[row]?.[column] ?? 0,
        littleEndian,
      )
    }
  }
  writeText(output, 344, 4, 'n+1\0')
  return output
}

function writeNifti2Header(options: NiftiHeaderOptions): Uint8Array {
  const output = new Uint8Array(NIFTI2_HEADER_BYTES)
  const view = new DataView(output.buffer)
  const littleEndian = true
  view.setInt32(0, 540, littleEndian)
  output.set([0x6e, 0x2b, 0x32, 0, 0x0d, 0x0a, 0x1a, 0x0a], 4)
  view.setInt16(12, options.datatypeCode, littleEndian)
  view.setInt16(14, options.numBitsPerVoxel, littleEndian)
  const dims = [3, ...options.shape, 1, 1, 1, 1]
  for (let index = 0; index < 8; index++) {
    view.setBigInt64(16 + index * 8, BigInt(dims[index] ?? 1), littleEndian)
  }
  const pixDims = [1, ...options.spacing, 1, 1, 1, 1]
  for (let index = 0; index < 8; index++) {
    view.setFloat64(104 + index * 8, pixDims[index] ?? 1, littleEndian)
  }
  view.setBigInt64(168, BigInt(NIFTI2_HEADER_BYTES), littleEndian)
  view.setFloat64(176, 1, littleEndian)
  view.setFloat64(184, 0, littleEndian)
  view.setFloat64(192, options.calMax, littleEndian)
  view.setFloat64(200, options.calMin, littleEndian)
  writeText(output, 240, 80, options.description ?? 'ZARRo OME-Zarr export')
  view.setInt32(344, 0, littleEndian)
  view.setInt32(348, 1, littleEndian)
  view.setFloat64(376, options.affineOrigin[0], littleEndian)
  view.setFloat64(384, options.affineOrigin[1], littleEndian)
  view.setFloat64(392, options.affineOrigin[2], littleEndian)
  const affine = [
    [options.spacing[0], 0, 0, options.affineOrigin[0]],
    [0, options.spacing[1], 0, options.affineOrigin[1]],
    [0, 0, options.spacing[2], options.affineOrigin[2]],
  ]
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      view.setFloat64(
        400 + (row * 4 + column) * 8,
        affine[row]?.[column] ?? 0,
        littleEndian,
      )
    }
  }
  view.setInt32(500, 10, littleEndian)
  return output
}

export function createNiftiHeader(options: NiftiHeaderOptions): Uint8Array {
  const version = options.version ?? niftiVersionForShape(options.shape)
  return version === 2
    ? writeNifti2Header(options)
    : writeNifti1Header(options)
}
