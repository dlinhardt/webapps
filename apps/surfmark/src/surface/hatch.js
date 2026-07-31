// Hatching for filled regions.
//
// A solid fill has to be translucent to avoid hiding the anatomy, and a
// translucent wash over a vivid overlay (gist_rainbow, say) just desaturates it
// into mud — the ROI stops reading as an ROI and the overlay stops reading as
// data. Hatching solves both: the marked vertices are fully opaque and
// high-contrast, while most of the region is left untouched so the overlay
// shows through cleanly between the strokes.
//
// The stripes come from a plane wave through world space rather than anything
// screen-space, because we have no access to NiiVue's mesh shaders. Slicing a
// folded cortical surface with a family of parallel planes gives stripes that
// follow the folding, which reads correctly from any camera angle and needs no
// per-frame work.

/** Default stripe spacing in millimetres. */
const DEFAULT_SPACING_MM = 2.5;
/** Fraction of each stripe period that is inked. */
const DEFAULT_DUTY = 0.32;

/**
 * @param {Float32Array} positions 3*V world-mm coordinates
 * @param {Uint8Array} regionMask length V, 1 inside the region
 * @param {object} [options]
 * @param {number} [options.spacingMm] stripe period, default 2.5
 * @param {number} [options.duty] inked fraction of a period, 0..1, default 0.32
 * @param {[number,number,number]} [options.direction] stripe normal
 * @param {boolean} [options.cross] add a second, perpendicular stripe family
 * @returns {Uint8Array} length V, 1 where the region should be inked
 */
export function hatchMask(positions, regionMask, options = {}) {
  const {
    spacingMm = DEFAULT_SPACING_MM,
    duty = DEFAULT_DUTY,
    direction = [1, 0.6, 0.35],
    cross = false
  } = options;

  if (spacingMm <= 0) throw new Error('hatch spacing must be positive');
  if (duty <= 0 || duty >= 1) throw new Error('hatch duty must be between 0 and 1');

  const primary = normalize(direction);
  // Any vector not parallel to `primary` gives a perpendicular family.
  const secondary = cross ? normalize(cross3(primary, pickOffAxis(primary))) : null;

  const V = regionMask.length;
  const out = new Uint8Array(V);

  for (let v = 0; v < V; v++) {
    if (!regionMask[v]) continue;
    const x = positions[3 * v];
    const y = positions[3 * v + 1];
    const z = positions[3 * v + 2];

    if (inked(x * primary[0] + y * primary[1] + z * primary[2], spacingMm, duty)) {
      out[v] = 1;
      continue;
    }
    if (secondary &&
        inked(x * secondary[0] + y * secondary[1] + z * secondary[2], spacingMm, duty)) {
      out[v] = 1;
    }
  }
  return out;
}

/** Position within one stripe period, guarding against negative coordinates. */
function inked(distance, spacing, duty) {
  const phase = distance / spacing;
  return phase - Math.floor(phase) < duty;
}

/**
 * Vertices adjacent to the boundary but not on it. Painted dark beneath a light
 * boundary, this gives the outline a halo so it stays visible against both
 * light and dark overlays.
 *
 * @param {import('./adjacency.js').SurfaceGraph} graph
 * @param {Int32Array|number[]} chain
 * @returns {Uint8Array} length V
 */
export function haloMask(graph, chain) {
  const { V, adjOffset, adjNeighbor } = graph;
  const onChain = new Uint8Array(V);
  for (const v of chain) onChain[v] = 1;

  const halo = new Uint8Array(V);
  for (const v of chain) {
    for (let e = adjOffset[v]; e < adjOffset[v + 1]; e++) {
      const w = adjNeighbor[e];
      if (!onChain[w]) halo[w] = 1;
    }
  }
  return halo;
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!length) throw new Error('hatch direction must be non-zero');
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/** An axis that is not close to parallel with `v`. */
function pickOffAxis(v) {
  const ax = Math.abs(v[0]);
  const ay = Math.abs(v[1]);
  const az = Math.abs(v[2]);
  if (ax <= ay && ax <= az) return [1, 0, 0];
  return ay <= az ? [0, 1, 0] : [0, 0, 1];
}

export const FILL_STYLES = Object.freeze({
  HATCHED: 'hatched',
  SOLID: 'solid',
  OUTLINE: 'outline'
});
