// Regenerate lh.realflat.surf.gii — a realistic flat patch, cut out of the real
// lh.pial, renumbered, and flattened, which is the shape mris_flatten produces.
//
//   node test/fixtures/make-real-patch.mjs      (needs lh.pial: fetch-fixtures.mjs)
//
// Where make-flat-patch.mjs gives a regular grid, this one has the irregular
// outline and uneven triangulation of a real patch, and a vertex count in the
// tens of thousands. It exists so the e2e suite has a second, unrelated topology
// to switch between: several tests turn on two surfaces NOT sharing a vertex
// indexing, which two copies of the same grid cannot express.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const buf = readFileSync(join(here, 'lh.pial'));
// FreeSurfer TRIANGLE_FILE: 3-byte magic, comment ending "\n\n", then counts.
let p = 3;
while (!(buf[p] === 0x0a && buf[p + 1] === 0x0a)) p++;
p += 2;
const V = buf.readInt32BE(p); p += 4;
const F = buf.readInt32BE(p); p += 4;
const xyz = new Float32Array(V * 3);
for (let i = 0; i < V * 3; i++) { xyz[i] = buf.readFloatBE(p); p += 4; }
const tri = new Int32Array(F * 3);
for (let i = 0; i < F * 3; i++) { tri[i] = buf.readInt32BE(p); p += 4; }
console.log(`lh.pial: ${V} vertices, ${F} faces`);

// Keep everything within a radius of one seed vertex — a rough occipital patch.
const seed = 60000;
const R = 45;
const sx = xyz[3 * seed], sy = xyz[3 * seed + 1], sz = xyz[3 * seed + 2];
const keep = new Uint8Array(V);
for (let v = 0; v < V; v++) {
  const dx = xyz[3 * v] - sx, dy = xyz[3 * v + 1] - sy, dz = xyz[3 * v + 2] - sz;
  if (dx * dx + dy * dy + dz * dz < R * R) keep[v] = 1;
}
const faces = [];
for (let f = 0; f < F; f++) {
  const a = tri[3 * f], b = tri[3 * f + 1], c = tri[3 * f + 2];
  if (keep[a] && keep[b] && keep[c]) faces.push([a, b, c]);
}
// Renumber to only the vertices the kept faces actually use, as a patch does.
const used = new Map();
for (const f of faces) for (const v of f) if (!used.has(v)) used.set(v, used.size);
const n = used.size;
const pts = new Float32Array(n * 3);
for (const [old, idx] of used) {
  // Flatten: project onto the two dominant axes, third coordinate exactly 0 —
  // this is what makes it a flat patch rather than a curved cut.
  pts[3 * idx] = xyz[3 * old + 1] - sy;
  pts[3 * idx + 1] = xyz[3 * old + 2] - sz;
  pts[3 * idx + 2] = 0;
}
const idx = new Int32Array(faces.length * 3);
faces.forEach((f, i) => { idx[3 * i] = used.get(f[0]); idx[3 * i + 1] = used.get(f[1]); idx[3 * i + 2] = used.get(f[2]); });
console.log(`patch: ${n} vertices, ${faces.length} faces`);

const b64 = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength).toString('base64');
const da = (intent, type, rows, payload) =>
  `  <DataArray Intent="${intent}" DataType="${type}" ArrayIndexingOrder="RowMajorOrder"` +
  ` Dimensionality="2" Dim0="${rows}" Dim1="3" Encoding="Base64Binary" Endian="LittleEndian"` +
  ` ExternalFileName="" ExternalFileOffset="">\n    <Data>${payload}</Data>\n  </DataArray>\n`;

writeFileSync(join(here, 'lh.realflat.surf.gii'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE GIFTI SYSTEM "http://gifti.projects.nitrc.org/gifti.dtd">\n' +
  '<GIFTI Version="1.0" NumberOfDataArrays="2">\n' +
  '  <MetaData><MD><Name>AnatomicalStructurePrimary</Name><Value>CortexLeft</Value></MD></MetaData>\n' +
  da('NIFTI_INTENT_POINTSET', 'NIFTI_TYPE_FLOAT32', n, b64(pts)) +
  da('NIFTI_INTENT_TRIANGLE', 'NIFTI_TYPE_INT32', faces.length, b64(idx)) +
  '</GIFTI>\n');
console.log('wrote lh.realflat.surf.gii');
