// GIfTI writers: .label.gii (parcellation) and .shape.gii (binary mask).
//
// Verified against gifti_clib (gifti_xml.c) and the NITRC DTD:
//   - the attribute is Key, not Index. gifti_xml.c writes Key="%d" and accepts
//     Index only as a legacy alias.
//   - LabelTable RGBA are floats in 0..1, not bytes.
//   - only NIFTI_TYPE_UINT8, NIFTI_TYPE_INT32 and NIFTI_TYPE_FLOAT32 are legal
//     DataArray types in GIfTI at all. Label data must be INT32.
//   - <LabelTable> must precede every <DataArray> (DTD child order).
//   - Encoding and Endian are both required attributes; Endian must describe
//     the bytes actually written.

/**
 * Make a string safe inside CDATA.
 *
 * CDATA has exactly one escape problem: the sequence that ends it. A name
 * containing `]]>` closes the section early and the file stops being XML —
 * three characters, well inside the ROI name field's limit. The fix is the
 * standard one: end the section, emit the `>` as a normal escaped character,
 * and open a new section.
 *
 * @param {string} value
 */
function cdata(value) {
  return String(value).replace(/]]>/g, ']]]]><![CDATA[>');
}

const XML_HEADER =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE GIFTI SYSTEM "http://gifti.projects.nitrc.org/gifti.dtd">\n';

const INTENT_LABEL = 'NIFTI_INTENT_LABEL';   // 1002
const INTENT_SHAPE = 'NIFTI_INTENT_SHAPE';   // 2005

/**
 * @typedef {object} GiftiLabelEntry
 * @property {number} key   value stored per vertex; reserve 0 for "unlabelled"
 * @property {string} name
 * @property {number[]} rgba four floats in 0..1
 */

/**
 * Write a .label.gii holding one Int32 value per vertex.
 *
 * @param {Int32Array} labelPerVertex length V
 * @param {GiftiLabelEntry[]} labelTable
 * @param {object} [options]
 * @param {boolean} [options.gzip] use GZipBase64Binary instead of Base64Binary
 * @param {string} [options.arrayName] value of the array's Name metadata
 * @param {Record<string,string>} [options.metadata] file-level metadata
 * @returns {Promise<string>}
 */
export async function writeGiftiLabel(labelPerVertex, labelTable, options = {}) {
  const { gzip = false, arrayName = 'roi', metadata = {} } = options;
  if (!(labelPerVertex instanceof Int32Array)) {
    throw new Error('label data must be an Int32Array (GIfTI labels are NIFTI_TYPE_INT32)');
  }
  const payload = await encodePayload(labelPerVertex, gzip);

  return XML_HEADER +
    '<GIFTI Version="1.0" NumberOfDataArrays="1">\n' +
    renderMetaData(metadata, 1) +
    renderLabelTable(labelTable) +
    renderDataArray({
      intent: INTENT_LABEL,
      dataType: 'NIFTI_TYPE_INT32',
      dim0: labelPerVertex.length,
      encoding: gzip ? 'GZipBase64Binary' : 'Base64Binary',
      payload,
      name: arrayName
    }) +
    '</GIFTI>\n';
}

/**
 * Write a .shape.gii holding a Float32 mask (1.0 inside, 0.0 outside).
 *
 * .func.gii and .shape.gii are the same format — Workbench's own docs say so.
 * The intent code is the only real difference, and it is a convention about
 * whether the values are structural or functional.
 *
 * @param {Float32Array} valuePerVertex length V
 * @param {object} [options]
 * @param {boolean} [options.gzip]
 * @param {string} [options.arrayName]
 * @param {string} [options.intent] override, e.g. 'NIFTI_INTENT_NONE'
 * @returns {Promise<string>}
 */
export async function writeGiftiShape(valuePerVertex, options = {}) {
  const { gzip = false, arrayName = 'roi', intent = INTENT_SHAPE, metadata = {} } = options;
  if (!(valuePerVertex instanceof Float32Array)) {
    throw new Error('shape data must be a Float32Array');
  }
  const payload = await encodePayload(valuePerVertex, gzip);

  return XML_HEADER +
    '<GIFTI Version="1.0" NumberOfDataArrays="1">\n' +
    renderMetaData(metadata, 1) +
    renderDataArray({
      intent,
      dataType: 'NIFTI_TYPE_FLOAT32',
      dim0: valuePerVertex.length,
      encoding: gzip ? 'GZipBase64Binary' : 'Base64Binary',
      payload,
      name: arrayName
    }) +
    '</GIFTI>\n';
}

/** Build the per-vertex Int32 array an ROI mask maps to. */
export function maskToLabelArray(mask, key = 1) {
  const out = new Int32Array(mask.length);
  for (let v = 0; v < mask.length; v++) if (mask[v]) out[v] = key;
  return out;
}

/** Build the per-vertex Float32 array a binary mask maps to. */
export function maskToFloatArray(mask) {
  const out = new Float32Array(mask.length);
  for (let v = 0; v < mask.length; v++) if (mask[v]) out[v] = 1;
  return out;
}

function renderLabelTable(entries) {
  const rows = entries.map((entry) => {
    const [r, g, b, a] = entry.rgba;
    return `    <Label Key="${entry.key}" Red="${fmt(r)}" Green="${fmt(g)}" ` +
      `Blue="${fmt(b)}" Alpha="${fmt(a)}"><![CDATA[${cdata(entry.name)}]]></Label>`;
  });
  return '  <LabelTable>\n' + rows.join('\n') + '\n  </LabelTable>\n';
}

function renderDataArray({ intent, dataType, dim0, encoding, payload, name }) {
  return '  <DataArray Intent="' + intent + '"\n' +
    '             DataType="' + dataType + '"\n' +
    '             ArrayIndexingOrder="RowMajorOrder"\n' +
    '             Dimensionality="1"\n' +
    '             Dim0="' + dim0 + '"\n' +
    '             Encoding="' + encoding + '"\n' +
    '             Endian="LittleEndian"\n' +
    '             ExternalFileName=""\n' +
    '             ExternalFileOffset="">\n' +
    renderMetaData({ Name: name }, 2) +
    '    <Data>' + payload + '</Data>\n' +
    '  </DataArray>\n';
}

function renderMetaData(entries, depth) {
  const keys = Object.keys(entries);
  if (!keys.length) return '';
  const pad = '  '.repeat(depth);
  const rows = keys.map((key) =>
    `${pad}  <MD><Name><![CDATA[${cdata(key)}]]></Name>` +
    `<Value><![CDATA[${cdata(entries[key])}]]></Value></MD>`
  );
  return `${pad}<MetaData>\n${rows.join('\n')}\n${pad}</MetaData>\n`;
}

/** GIfTI writes %g, so trailing zeros are not expected. */
function fmt(value) {
  return String(Number(value));
}

async function encodePayload(typedArray, gzip) {
  const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  return base64(gzip ? await gzipBytes(bytes) : bytes);
}

/**
 * CompressionStream is the right primitive here — NiiVue itself dropped
 * pako/fflate for it. Present in Node 18+ and every current browser.
 */
async function gzipBytes(bytes) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('gzip requested but CompressionStream is unavailable');
  }
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(compressed);
}

function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
