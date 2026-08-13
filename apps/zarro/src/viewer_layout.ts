import {
  MULTIPLANAR_TYPE,
  SHOW_RENDER,
  SLICE_TYPE,
} from '@niivue/niivue'

export const LAYOUT_PRESET = {
  AXIAL_FOCUS: 30,
  EQUAL_SLICES: 31,
  EQUAL_SLICES_RENDER: 32,
  EQUAL_SLICES_VERTICAL: 33,
} as const

const VERTICAL_REFORMAT_CROP_FRACTION = 0.4

export interface ViewerLayoutConfig {
  sliceType: number
  showRender: number
  multiplanarType: number
  isEqualSize: boolean
  customLayout: Array<{
    sliceType: number
    position: [number, number, number, number]
    squareCropFraction?: number
  }> | null
}

export function layoutDetailZoom(
  selected: number,
  zoom: number,
  physicalExtents: readonly [number, number, number],
): number {
  if (selected !== LAYOUT_PRESET.EQUAL_SLICES_VERTICAL) return zoom
  if (
    !physicalExtents.every(
      (extent) => Number.isFinite(extent) && extent > 0,
    )
  ) {
    return zoom
  }

  const [x, y, z] = physicalExtents
  const axialFieldOfView = Math.min(x, y)
  const reformatFieldOfView = Math.min(
    Math.min(x, z) * VERTICAL_REFORMAT_CROP_FRACTION,
    Math.min(y, z) * VERTICAL_REFORMAT_CROP_FRACTION,
  )
  const magnification = Math.max(1, axialFieldOfView / reformatFieldOfView)
  return zoom * magnification
}

export function layoutDetailBounds<T>(
  selected: number,
  bounds: readonly T[],
): T[] {
  // The vertical layout magnifies the two cropped reformats by roughly 30x.
  // Reserving the full axial overview at that same level would exhaust the
  // brick budget and force every panel back to a coarse global level.
  if (selected === LAYOUT_PRESET.EQUAL_SLICES_VERTICAL && bounds.length === 3) {
    return bounds.slice(1)
  }
  return [...bounds]
}

export function viewerLayoutConfig(selected: number): ViewerLayoutConfig {
  if (selected === LAYOUT_PRESET.AXIAL_FOCUS) {
    return {
      sliceType: SLICE_TYPE.MULTIPLANAR,
      showRender: SHOW_RENDER.NEVER,
      multiplanarType: MULTIPLANAR_TYPE.AUTO,
      isEqualSize: false,
      customLayout: [
        { sliceType: SLICE_TYPE.AXIAL, position: [0, 0, 1, 2 / 3] },
        { sliceType: SLICE_TYPE.SAGITTAL, position: [0, 2 / 3, 0.5, 1 / 3] },
        { sliceType: SLICE_TYPE.CORONAL, position: [0.5, 2 / 3, 0.5, 1 / 3] },
      ],
    }
  }
  if (selected === LAYOUT_PRESET.EQUAL_SLICES) {
    return {
      sliceType: SLICE_TYPE.MULTIPLANAR,
      showRender: SHOW_RENDER.NEVER,
      multiplanarType: MULTIPLANAR_TYPE.ROW,
      isEqualSize: true,
      customLayout: null,
    }
  }
  if (selected === LAYOUT_PRESET.EQUAL_SLICES_VERTICAL) {
    return {
      sliceType: SLICE_TYPE.MULTIPLANAR,
      showRender: SHOW_RENDER.NEVER,
      multiplanarType: MULTIPLANAR_TYPE.COLUMN,
      isEqualSize: false,
      customLayout: [
        {
          sliceType: SLICE_TYPE.AXIAL,
          position: [0, 0, 1, 1 / 3],
          squareCropFraction: 1,
        },
        {
          sliceType: SLICE_TYPE.CORONAL,
          position: [0, 1 / 3, 1, 1 / 3],
          squareCropFraction: VERTICAL_REFORMAT_CROP_FRACTION,
        },
        {
          sliceType: SLICE_TYPE.SAGITTAL,
          position: [0, 2 / 3, 1, 1 / 3],
          squareCropFraction: VERTICAL_REFORMAT_CROP_FRACTION,
        },
      ],
    }
  }
  if (selected === LAYOUT_PRESET.EQUAL_SLICES_RENDER) {
    return {
      sliceType: SLICE_TYPE.MULTIPLANAR,
      showRender: SHOW_RENDER.ALWAYS,
      multiplanarType: MULTIPLANAR_TYPE.GRID,
      isEqualSize: true,
      customLayout: null,
    }
  }
  return {
    sliceType: selected,
    showRender: SHOW_RENDER.AUTO,
    multiplanarType: MULTIPLANAR_TYPE.AUTO,
    isEqualSize: false,
    customLayout: null,
  }
}
