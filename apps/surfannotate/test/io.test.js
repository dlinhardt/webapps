import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import {
  writeFreeSurferLabel, readFreeSurferLabel, sanitizeHeaderField, labelToValues
} from '../src/io/freesurferLabel.js';
import {
  writeGiftiLabel, writeGiftiShape, maskToLabelArray, maskToFloatArray
} from '../src/io/gifti.js';
import {
  writePointsJson, writePointsCsv, readPointsJson, hashTriangles,
  checkMeshIdentity, POINTS_FORMAT
} from '../src/io/points.js';

/** Buffer.from() hands back a slice of a shared pool, so honour byteOffset. */
function decodeBase64(text, ArrayType) {
  const buffer = Buffer.from(text, 'base64');
  return new ArrayType(
    buffer.buffer, buffer.byteOffset, buffer.length / ArrayType.BYTES_PER_ELEMENT
  );
}

const COORDS = Float32Array.from([
  -1.5, 2.25, 3, // vertex 0
  10, -20, 30,   // vertex 1
  0, 0, 0,       // vertex 2
  4.4444, 5.5555, 6.6666 // vertex 3
]);

test('.label writes the documented header, count and five columns', () => {
  const text = writeFreeSurferLabel(Int32Array.from([1, 3]), COORDS, {
    name: 'V1', subject: 'bert'
  });
  const lines = text.trimEnd().split('\n');

  assert.equal(lines[0], '#!ascii label V1 , from subject bert vox2ras=TkReg');
  assert.equal(lines[1], '2');
  assert.equal(lines.length, 4);

  const columns = lines[2].split(/\s+/);
  assert.equal(columns.length, 5);
  assert.equal(columns[0], '1', 'column 0 is the vertex index');
  assert.equal(columns[1], '10.000');
  assert.equal(columns[4], '0.0000000000');

  // Rounding, not truncation, on the last row.
  assert.deepEqual(lines[3].split(/\s+/).slice(1, 4), ['4.444', '5.556', '6.667']);
});

test('.label header survives a name containing commas or newlines', () => {
  // The header is one line delimited by a comma, so a user-typed ROI name like
  // "V1, left" would otherwise make the file unreadable by its own parser.
  const text = writeFreeSurferLabel(Int32Array.from([1]), COORDS, {
    name: 'V1, left\nhemisphere', subject: 'sub,01'
  });
  const lines = text.trimEnd().split('\n');
  assert.equal(lines.length, 3, 'header + count + one entry, so the name did not add a line');
  assert.equal(lines[0], '#!ascii label V1 left hemisphere , from subject sub 01 vox2ras=TkReg');
  assert.equal(readFreeSurferLabel(text).name, 'V1 left hemisphere');

  assert.equal(sanitizeHeaderField('  a,b\r\nc  '), 'a b c');
});

test('.label round-trips through the reader', () => {
  const vertices = Int32Array.from([0, 2, 3]);
  const stat = Float32Array.from([0.5, -1.25, 0]);
  const parsed = readFreeSurferLabel(
    writeFreeSurferLabel(vertices, COORDS, { name: 'roi', subject: 's1', stat })
  );

  assert.equal(parsed.name, 'roi');
  assert.deepEqual(Array.from(parsed.vertices), [0, 2, 3]);
  assert.ok(Math.abs(parsed.stat[1] + 1.25) < 1e-6);
  assert.ok(Math.abs(parsed.coords[0] + 1.5) < 1e-3);
});

test('.label reader rejects malformed files', () => {
  assert.throws(() => readFreeSurferLabel('garbage\n1\n'), /missing "#!ascii label"/);
  assert.throws(
    () => readFreeSurferLabel('#!ascii label x , from subject y vox2ras=TkReg\nnope\n'),
    /must be the entry count/
  );
  assert.throws(
    () => readFreeSurferLabel('#!ascii label x , from subject y vox2ras=TkReg\n2\n0 1 2 3 4\n'),
    /declares 2 entries but contains 1/
  );
});

test('an empty label is still a valid file', () => {
  const parsed = readFreeSurferLabel(writeFreeSurferLabel(Int32Array.of(), COORDS));
  assert.equal(parsed.vertices.length, 0);
});

test('.label.gii puts LabelTable before DataArray and uses Key with 0..1 colours', async () => {
  const mask = Uint8Array.from([0, 1, 1, 0]);
  const xml = await writeGiftiLabel(maskToLabelArray(mask, 1), [
    { key: 0, name: '???', rgba: [0, 0, 0, 0] },
    { key: 1, name: 'V1', rgba: [1, 0.2, 0.2, 1] }
  ]);

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<!DOCTYPE GIFTI SYSTEM "http://gifti.projects.nitrc.org/gifti.dtd">'));
  assert.ok(xml.includes('<GIFTI Version="1.0" NumberOfDataArrays="1">'));

  assert.ok(xml.indexOf('<LabelTable>') < xml.indexOf('<DataArray'),
    'the DTD requires LabelTable before any DataArray');
  assert.ok(xml.includes('<Label Key="1" Red="1" Green="0.2" Blue="0.2" Alpha="1">'),
    'Key, not Index; colours are floats');
  assert.ok(xml.includes('<![CDATA[V1]]>'));

  assert.ok(xml.includes('Intent="NIFTI_INTENT_LABEL"'));
  assert.ok(xml.includes('DataType="NIFTI_TYPE_INT32"'));
  assert.ok(xml.includes('Dim0="4"'));
  assert.ok(xml.includes('Encoding="Base64Binary"'));
  assert.ok(xml.includes('Endian="LittleEndian"'));
  assert.ok(xml.includes('ExternalFileName=""'));
});

test('.label.gii payload decodes back to the per-vertex values', async () => {
  const labels = Int32Array.from([0, 7, 7, 0, 7]);
  const xml = await writeGiftiLabel(labels, [{ key: 7, name: 'roi', rgba: [1, 0, 0, 1] }]);
  const encoded = /<Data>([^<]*)<\/Data>/.exec(xml)[1];
  const decoded = decodeBase64(encoded, Int32Array);

  assert.deepEqual(Array.from(decoded), Array.from(labels));
});

test('.label.gii compressed encoding is a zlib stream, as the spec requires', async () => {
  const labels = Int32Array.from([1, 1, 0, 0, 1, 1]);
  const xml = await writeGiftiLabel(labels, [{ key: 1, name: 'roi', rgba: [1, 1, 1, 1] }], {
    gzip: true
  });

  assert.ok(xml.includes('Encoding="GZipBase64Binary"'));
  const encoded = /<Data>([^<]*)<\/Data>/.exec(xml)[1];
  const bytes = Buffer.from(encoded, 'base64');
  // GIfTI 1.0 s5.0 says ZLIB, and gifti_clib uses compress2()/uncompress(): a
  // zlib stream (0x78 ..), not a gzip container (0x1f 0x8b). This assertion used
  // to gunzip, which agreed with the writer and so caught nothing — nibabel and
  // wb_command would both have refused the file.
  assert.equal(bytes[0], 0x78, 'must be a zlib stream, not gzip');
  const raw = inflateSync(bytes);
  assert.deepEqual(Array.from(new Int32Array(raw.buffer, raw.byteOffset, labels.length)),
    Array.from(labels));
});

test('.label.gii refuses non-Int32 data', async () => {
  await assert.rejects(
    () => writeGiftiLabel(Float32Array.from([1, 0]), []),
    /NIFTI_TYPE_INT32/
  );
});

test('.shape.gii writes a Float32 mask with no LabelTable', async () => {
  const xml = await writeGiftiShape(maskToFloatArray(Uint8Array.from([0, 1, 1])));

  assert.ok(!xml.includes('<LabelTable>'), 'a metric file carries no label table');
  assert.ok(xml.includes('Intent="NIFTI_INTENT_SHAPE"'));
  assert.ok(xml.includes('DataType="NIFTI_TYPE_FLOAT32"'));

  const encoded = /<Data>([^<]*)<\/Data>/.exec(xml)[1];
  assert.deepEqual(Array.from(decodeBase64(encoded, Float32Array)), [0, 1, 1]);
});

test('point export carries mesh identity and rounded coordinates', () => {
  const mesh = { structure: 'CortexLeft', numVertices: 4, numTriangles: 2 };
  const json = JSON.parse(writePointsJson(
    [{ vertex: 3, name: 'MT', color: '#ff0000' }, { vertex: 0 }],
    COORDS, mesh, { created: '2026-07-31T00:00:00Z' }
  ));

  assert.equal(json.format, POINTS_FORMAT);
  assert.equal(json.created, '2026-07-31T00:00:00Z');
  assert.equal(json.mesh.numVertices, 4);
  assert.equal(json.coordinateSpace, 'tkreg-ras-white');
  assert.deepEqual(json.points[0], {
    vertex: 3, name: 'MT', xyz: [4.444, 5.556, 6.667], color: '#ff0000'
  });
  assert.equal(json.points[1].name, undefined, 'unnamed points stay unnamed');
});

test('point CSV escapes separators in names', () => {
  const csv = writePointsCsv([{ vertex: 1, name: 'a,b "quoted"' }], COORDS);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'vertex,name,x,y,z');
  assert.equal(lines[1], '1,"a,b ""quoted""",10,-20,30');
});

test('point JSON round-trips and rejects a foreign format', () => {
  const mesh = { numVertices: 4, numTriangles: 2 };
  const text = writePointsJson([{ vertex: 2, name: 'p' }], COORDS, mesh);
  assert.equal(readPointsJson(text).points[0].vertex, 2);
  assert.throws(() => readPointsJson('{"format":"other/1","points":[]}'), /unsupported point file/);
});

test('mesh identity compares topology, not geometry', async () => {
  const triangles = Uint32Array.from([0, 1, 2, 1, 2, 3]);
  const hash = await hashTriangles(triangles);
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await hashTriangles(Uint32Array.from([0, 1, 2, 1, 2, 3])), hash,
    'same topology hashes the same');

  const base = { numVertices: 4, numTriangles: 2, triangleHash: hash };
  assert.equal(checkMeshIdentity(base, { ...base }).ok, true);

  const wrongCount = checkMeshIdentity(base, { ...base, numVertices: 5 });
  assert.equal(wrongCount.ok, false);
  assert.match(wrongCount.reason, /vertex count differs/);

  const wrongTopology = checkMeshIdentity(base, { ...base, triangleHash: 'sha256:' + '0'.repeat(64) });
  assert.equal(wrongTopology.ok, false);
  assert.match(wrongTopology.reason, /different topology/);
});

test('a .label expands into one value per vertex', () => {
  const indices = Int32Array.from([2, 5, 9]);
  const positions = new Float32Array(30);
  for (let v = 0; v < 10; v++) positions[3 * v] = v;
  const text = writeFreeSurferLabel(indices, positions, { name: 'V1', subject: 'lh' });

  const { values, count, hasStat } = labelToValues(text, 10);
  assert.equal(count, 3);
  assert.equal(hasStat, false, 'a plain region has no statistic');
  assert.deepEqual(Array.from(values), [0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
    'a mask, not a field of zeros');
});

test('a .label with a statistic keeps the statistic', () => {
  const text = '#!ascii label V1 , from subject lh vox2ras=TkReg\n2\n' +
    '3  1.0 2.0 3.0 0.75\n7  4.0 5.0 6.0 -0.25\n';
  const { values, hasStat } = labelToValues(text, 8);
  assert.equal(hasStat, true);
  assert.equal(values[3], 0.75);
  assert.equal(values[7], -0.25);
  assert.equal(values[0], 0);
});

test('a .label from another mesh is refused rather than silently truncated', () => {
  const text = '#!ascii label V1 , from subject lh vox2ras=TkReg\n1\n' +
    '900  1.0 2.0 3.0 0.0\n';
  assert.throws(() => labelToValues(text, 10), /different mesh/);
});

test('a name containing the CDATA terminator still yields valid XML', () => {
  // `]]>` closes the section early: three characters, well inside the ROI name
  // field's 64-character limit, and the file stops being XML.
  return writeGiftiLabel(Int32Array.from([0, 2]), [
    { key: 0, name: '???', rgba: [0, 0, 0, 0] },
    { key: 2, name: 'a]]>b', rgba: [0.9, 0.2, 0.2, 1] }
  ], { arrayName: 'a]]>b', metadata: { Note: 'x]]>y' } }).then((xml) => {
    assert.ok(!/]]>[^<]/.test(xml.replace(/]]]]><!\[CDATA\[>/g, '')),
      'no bare CDATA terminator survives');
    assert.ok(xml.includes(']]]]><![CDATA[>'), 'it is split, not dropped');
    // The name still reads back as itself once the split is undone.
    assert.ok(xml.replace(/]]]]><!\[CDATA\[>/g, ']]>').includes('a]]>b'));
  });
});
