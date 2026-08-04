// Naming for exported files.
//
// A label belongs to a hemisphere, not to the particular surface it happened to
// be drawn on: an ROI traced on lh.sphere.reg applies just as well to lh.white
// and lh.pial, which share a vertex indexing. So the file is named
// `lh.<roi>.label`, matching FreeSurfer's own convention, rather than dragging
// the whole source filename along as `lh.sphere.reg.surf.<roi>.label`.

/** Characters that are illegal or awkward in a file name on some platform. */
const UNSAFE = /[\\/:*?"<>|]+/g;

/**
 * Work out which hemisphere a surface belongs to.
 *
 * GIfTI records this properly in `AnatomicalStructurePrimary`, so prefer that.
 * FreeSurfer encodes it in the filename prefix, and BIDS in a `hemi-` entity.
 *
 * @param {object} [options]
 * @param {string} [options.anatomicalStructure] e.g. NiiVue's 'CORTEXLEFT'
 * @param {string} [options.filename] e.g. 'lh.pial' or 'sub-01_hemi-L_pial.surf.gii'
 * @returns {'lh'|'rh'|''} empty when the hemisphere cannot be determined
 */
export function hemispherePrefix({ anatomicalStructure = '', filename = '' } = {}) {
  const structure = String(anatomicalStructure).toUpperCase();
  if (structure.includes('LEFT')) return 'lh';
  if (structure.includes('RIGHT')) return 'rh';

  const name = String(filename);
  if (/^lh[._-]/i.test(name)) return 'lh';
  if (/^rh[._-]/i.test(name)) return 'rh';
  if (/(^|[._-])hemi-?L([._-]|$)/i.test(name)) return 'lh';
  if (/(^|[._-])hemi-?R([._-]|$)/i.test(name)) return 'rh';
  if (/(^|[._-])(left|lh)([._-]|$)/i.test(name)) return 'lh';
  if (/(^|[._-])(right|rh)([._-]|$)/i.test(name)) return 'rh';
  // HCP-style `S1200.L.inflated.32k_fs_LR.surf.gii`. Case-sensitive and
  // separator-delimited, so `fs_LR` and stray lowercase letters do not match.
  //
  // A bare letter is the weakest signal here, so it only counts when it is
  // unambiguous. `MSM-L.R.midthickness.gii` carries both, and picking the first
  // would export a RIGHT hemisphere as `lh.<roi>` with nothing to warn you —
  // exactly the silent left/right flip this function exists to prevent.
  const bareL = /(^|[._-])L([._-]|$)/.test(name);
  const bareR = /(^|[._-])R([._-]|$)/.test(name);
  if (bareL && !bareR) return 'lh';
  if (bareR && !bareL) return 'rh';
  return '';
}

/**
 * Make a user-supplied name safe to hand to a download attribute.
 * @param {string} value
 * @param {string} [fallback]
 */
export function fileSafe(value, fallback = 'roi') {
  const cleaned = String(value)
    .replace(UNSAFE, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

/**
 * The stem shared by every file exported for one ROI: `lh.V1`, or just `V1`
 * when the hemisphere is unknown.
 *
 * @param {string} roiName
 * @param {object} [meshInfo] passed through to hemispherePrefix
 * @returns {string}
 */
export function exportStem(roiName, meshInfo = {}) {
  const roi = fileSafe(roiName);
  const hemisphere = hemispherePrefix(meshInfo);
  return hemisphere ? `${hemisphere}.${roi}` : roi;
}

/** What kind of surface a file holds, as far as its name admits. */
export const ANATOMICAL = 'anatomical';
export const INFLATED = 'inflated';
export const SPHERE = 'sphere';
export const FLAT = 'flat';
export const UNKNOWN_KIND = 'unknown';

const KIND_PATTERNS = [
  [FLAT, /(^|[._-])(flat|patch)([._-]|$)/i],
  [SPHERE, /(^|[._-])sphere([._-]|$)/i],
  [INFLATED, /(^|[._-])inflated([._-]|$)/i],
  [ANATOMICAL, /(^|[._-])(pial|white|smoothwm|orig|midthickness|graymid|mid)([._-]|$)/i]
];

/**
 * Whether a surface's vertex coordinates mean anything anatomically.
 *
 * A `.label` records x/y/z as well as the vertex index, and those coordinates
 * are only meaningful if they came from a surface that sits in the subject's
 * anatomy. Draw on `lh.inflated`, `lh.sphere` or a flat patch and the numbers
 * describe the inflated, spherical or flattened shape instead — wrong by tens of
 * millimetres, with nothing in the file to say so. freeview sidesteps this by
 * substituting the white surface when the displayed one is inflated; this app
 * does not, so it has to tell the user instead.
 *
 * Order matters: `lh.sphere.reg` is spherical, and `lh.white.flat.patch` is
 * flat, so the more specific patterns are tested first.
 *
 * @param {string} filename
 * @returns {'anatomical'|'inflated'|'sphere'|'flat'|'unknown'}
 */
export function surfaceKind(filename) {
  const name = String(filename || '');
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(name)) return kind;
  }
  return UNKNOWN_KIND;
}

/**
 * True when a surface's coordinates can be trusted in a label file.
 *
 * `unknown` counts as trustworthy: an unrecognised name is more often a
 * differently-named anatomical surface than a flattened one, and warning about
 * every file nobody named conventionally would train the warning away.
 * A geometrically flat surface is caught regardless of what it is called.
 *
 * @param {string} filename
 * @param {boolean} [isPlanar] set when the geometry has no thickness
 */
export function hasAnatomicalCoordinates(filename, isPlanar = false) {
  if (isPlanar) return false;
  const kind = surfaceKind(filename);
  return kind === ANATOMICAL || kind === UNKNOWN_KIND;
}
