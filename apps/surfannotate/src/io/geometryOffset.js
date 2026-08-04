// The translation NiiVue silently applies when it loads a surface.
//
// A FreeSurfer surface stores tkreg ("surface") RAS. NiiVue adds the volume
// geometry's centre — `cras` in the binary footer, `VolGeomC_R/A/S` in GIfTI —
// which converts those coordinates to scanner RAS so meshes line up with
// volumes. That is right for rendering and wrong for a `.label`, whose header
// declares `vox2ras=TkReg` and whose readers take the coordinates at their word:
// FreeSurfer's `labelGetSurfaceRasCoords` uses them verbatim for TkReg and
// converts them for scanner. Writing scanner coordinates under a TkReg header
// is silently wrong in `mri_label2vol` and `mri_label2label --regmethod coords`,
// while everything keyed on the vertex index looks fine.
//
// So the export subtracts this back out. Computing it means mirroring NiiVue's
// own rules exactly, quirks included — in particular it applies `cras` whether
// or not the footer's `valid` flag is set, so this must too, or the correction
// would not cancel.

/** Zero translation, for surfaces that carry no volume geometry. */
const NONE = Object.freeze([0, 0, 0]);

/**
 * @param {ArrayBuffer|Uint8Array} buffer the surface file as loaded
 * @returns {number[]} the [x, y, z] NiiVue added to every vertex
 */
export function niivueTranslation(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 8) return [...NONE];
  // FreeSurfer TRIANGLE_FILE. Its footer is plain text at the very end, so it
  // can be found without walking the vertex and face blocks.
  if (bytes[0] === 0xff && bytes[1] === 0xff && bytes[2] === 0xfe) {
    return freeSurferCras(bytes);
  }
  if (bytes[0] === 0x3c) return giftiVolGeom(bytes); // '<'
  return [...NONE];
}

/** `cras = x y z` from the binary footer. */
function freeSurferCras(bytes) {
  // The footer is a few hundred bytes of ASCII; decoding the tail is enough and
  // avoids materialising a multi-megabyte string.
  const tail = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const translation = [...NONE];
  for (const line of tail.split('\n')) {
    // NiiVue matches on the line prefix alone and ignores `valid`, so an
    // invalid volume geometry is still applied — and must still be undone.
    if (!line.trimStart().startsWith('cras')) continue;
    const value = line.split('=')[1];
    if (!value) continue;
    const parts = value.trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      translation[0] = parts[0];
      translation[1] = parts[1];
      translation[2] = parts[2];
    }
  }
  return translation;
}

/** `VolGeomC_R/A/S` metadata, unless the file says it is already scanner space. */
function giftiVolGeom(bytes) {
  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  // mris_convert --to-scanner writes scanner coordinates and says so; NiiVue
  // then applies nothing.
  if (text.includes('NIFTI_XFORM_SCANNER_ANAT')) return [...NONE];

  const translation = [...NONE];
  for (const [index, key] of [[0, 'VolGeomC_R'], [1, 'VolGeomC_A'], [2, 'VolGeomC_S']]) {
    // NiiVue only reads these from a CDATA value, so a plain <Value> is left
    // alone by it and must be left alone here.
    const match = new RegExp(`${key}[\\s\\S]{0,200}?<Value><!\\[CDATA\\[([^\\]]*)\\]\\]>`)
      .exec(text);
    const value = match ? Number.parseFloat(match[1]) : NaN;
    if (Number.isFinite(value)) translation[index] = value;
  }
  return translation;
}
