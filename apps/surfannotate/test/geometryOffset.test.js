import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { niivueTranslation } from '../src/io/geometryOffset.js';

test('a FreeSurfer surface yields its footer cras', (t) => {
  if (!existsSync('test/fixtures/lh.pial')) {
    t.diagnostic('skipped — fixture not present');
    return;
  }
  const translation = niivueTranslation(readFileSync('test/fixtures/lh.pial').buffer);
  // The fixture's footer reads `cras = -1.9991 0.0000 -1.9991`, and NiiVue
  // applies it even though the same footer says `valid = 0` — so this must too,
  // or the correction would not cancel.
  assert.ok(Math.abs(translation[0] - -1.9991) < 1e-3, `x was ${translation[0]}`);
  assert.equal(translation[1], 0);
  assert.ok(Math.abs(translation[2] - -1.9991) < 1e-3, `z was ${translation[2]}`);
});

test('a GIfTI without volume geometry yields no translation', (t) => {
  if (!existsSync('test/fixtures/lh.flat.surf.gii')) {
    t.diagnostic('skipped — fixture not present');
    return;
  }
  const bytes = readFileSync('test/fixtures/lh.flat.surf.gii');
  assert.deepEqual(niivueTranslation(bytes), [0, 0, 0]);
});

test('GIfTI VolGeomC_* is read only from CDATA, as NiiVue reads it', () => {
  const withCdata = new TextEncoder().encode(
    '<?xml version="1.0"?><GIFTI><MetaData>' +
    '<MD><Name><![CDATA[VolGeomC_R]]></Name><Value><![CDATA[-1.5]]></Value></MD>' +
    '<MD><Name><![CDATA[VolGeomC_A]]></Name><Value><![CDATA[2.25]]></Value></MD>' +
    '<MD><Name><![CDATA[VolGeomC_S]]></Name><Value><![CDATA[-3]]></Value></MD>' +
    '</MetaData></GIFTI>'
  );
  assert.deepEqual(niivueTranslation(withCdata), [-1.5, 2.25, -3]);

  // NiiVue requires CDATA, so a bare value is ignored — and must be here too,
  // or we would subtract something that was never added.
  const bare = new TextEncoder().encode(
    '<?xml version="1.0"?><GIFTI><MetaData>' +
    '<MD><Name>VolGeomC_R</Name><Value>-1.5</Value></MD>' +
    '</MetaData></GIFTI>'
  );
  assert.deepEqual(niivueTranslation(bare), [0, 0, 0]);
});

test('a file already in scanner space is left alone', () => {
  // mris_convert --to-scanner says so, and NiiVue then applies nothing.
  const scanner = new TextEncoder().encode(
    '<?xml version="1.0"?><GIFTI>' +
    '<CoordinateSystemTransformMatrix><DataSpace><![CDATA[NIFTI_XFORM_SCANNER_ANAT]]>' +
    '</DataSpace></CoordinateSystemTransformMatrix><MetaData>' +
    '<MD><Name><![CDATA[VolGeomC_R]]></Name><Value><![CDATA[-1.5]]></Value></MD>' +
    '</MetaData></GIFTI>'
  );
  assert.deepEqual(niivueTranslation(scanner), [0, 0, 0]);
});

test('anything unrecognised translates by nothing', () => {
  assert.deepEqual(niivueTranslation(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), [0, 0, 0]);
  assert.deepEqual(niivueTranslation(new Uint8Array(0)), [0, 0, 0]);
});
