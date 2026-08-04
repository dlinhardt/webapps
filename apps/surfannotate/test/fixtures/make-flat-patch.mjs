// Regenerate lh.flat.surf.gii — a stand-in for an unfolded cortical patch.
//
// The real thing (FreeSurfer `mris_flatten`, or a Workbench flat surface) is a
// cut, unfolded sheet: topologically a disk, with an open edge where the cortex
// was sliced. A flat grid has exactly those properties and is a few kilobytes
// rather than a few megabytes, which is what the edge-closure tests need.
//
//   node test/fixtures/make-flat-patch.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const N = 41; // 1,681 vertices — enough to be a real mesh, small enough to commit
const SPACING = 2; // mm

const vertices = new Float32Array(N * N * 3);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const v = j * N + i;
    // Centred on the origin, in the y-z plane so it faces the default camera.
    vertices[3 * v] = 0;
    vertices[3 * v + 1] = (i - (N - 1) / 2) * SPACING;
    vertices[3 * v + 2] = (j - (N - 1) / 2) * SPACING;
  }
}

const triangles = new Int32Array((N - 1) * (N - 1) * 6);
let t = 0;
for (let j = 0; j < N - 1; j++) {
  for (let i = 0; i < N - 1; i++) {
    const v = j * N + i;
    // Wound so the face normals point along -x. A sheet is one-sided: NiiVue
    // does not cull back faces but does shade them by the flipped normal, so
    // from behind the patch renders almost black. -x is the side NiiVue's
    // default render view (azimuth 110) looks from, which is also where a left
    // hemisphere faces.
    triangles[t++] = v; triangles[t++] = v + N; triangles[t++] = v + 1;
    triangles[t++] = v + 1; triangles[t++] = v + N; triangles[t++] = v + N + 1;
  }
}

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
  .toString('base64');

const dataArray = (intent, dataType, rows, cols, payload) =>
  `  <DataArray Intent="${intent}"\n` +
  `             DataType="${dataType}"\n` +
  '             ArrayIndexingOrder="RowMajorOrder"\n' +
  '             Dimensionality="2"\n' +
  `             Dim0="${rows}"\n` +
  `             Dim1="${cols}"\n` +
  '             Encoding="Base64Binary"\n' +
  '             Endian="LittleEndian"\n' +
  '             ExternalFileName=""\n' +
  '             ExternalFileOffset="">\n' +
  `    <Data>${payload}</Data>\n` +
  '  </DataArray>\n';

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE GIFTI SYSTEM "http://gifti.projects.nitrc.org/gifti.dtd">\n' +
  '<GIFTI Version="1.0" NumberOfDataArrays="2">\n' +
  '  <MetaData>\n' +
  '    <MD><Name>AnatomicalStructurePrimary</Name><Value>CortexLeft</Value></MD>\n' +
  '    <MD><Name>GeometricType</Name><Value>Flat</Value></MD>\n' +
  '  </MetaData>\n' +
  dataArray('NIFTI_INTENT_POINTSET', 'NIFTI_TYPE_FLOAT32', N * N, 3, b64(vertices)) +
  dataArray('NIFTI_INTENT_TRIANGLE', 'NIFTI_TYPE_INT32', triangles.length / 3, 3,
    b64(triangles)) +
  '</GIFTI>\n';

const out = join(dirname(fileURLToPath(import.meta.url)), 'lh.flat.surf.gii');
writeFileSync(out, xml);
console.log(`wrote ${out}: ${N * N} vertices, ${triangles.length / 3} faces`);
