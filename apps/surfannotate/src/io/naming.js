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
  if (/(^|[._-])L([._-]|$)/.test(name)) return 'lh';
  if (/(^|[._-])R([._-]|$)/.test(name)) return 'rh';
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
