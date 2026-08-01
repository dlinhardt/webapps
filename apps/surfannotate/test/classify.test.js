import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

import { classifyFile, SNIFF_BYTES, SURFACE, OVERLAY, UNKNOWN } from '../src/io/classify.js';

/** First bytes of a file, the way the app hands them to the classifier. */
function head(bytes) {
  return Uint8Array.from(bytes);
}

const freeSurferSurface = head([0xff, 0xff, 0xfe, 0x63, 0x72, 0x65]);
const freeSurferCurv = head([0xff, 0xff, 0xff, 0x00, 0x02, 0x80]);

test('unambiguous extensions decide without reading the file', () => {
  assert.equal(classifyFile('S1200.L.midthickness.32k_fs_LR.surf.gii'), SURFACE);
  assert.equal(classifyFile('sub-01_hemi-L_thickness.shape.gii'), OVERLAY);
  assert.equal(classifyFile('lh.V1.label.gii'), OVERLAY);
  assert.equal(classifyFile('brain.mz3'), SURFACE);
  assert.equal(classifyFile('cortex.ply'), SURFACE);
  assert.equal(classifyFile('lh.curv'), OVERLAY);
  assert.equal(classifyFile('lh.thickness'), OVERLAY);
  assert.equal(classifyFile('lh.aparc.annot'), OVERLAY);
  assert.equal(classifyFile('stats.dscalar.nii'), OVERLAY);
});

test('an extension beats a contradicting magic number', () => {
  // A .surf.gii is geometry whatever the first bytes look like: the extension
  // is the stronger signal, and sniffing only exists for files without one.
  assert.equal(classifyFile('lh.pial.surf.gii', freeSurferCurv), SURFACE);
});

test('FreeSurfer magic numbers are read when the name says nothing', () => {
  assert.equal(classifyFile('lh.something', freeSurferSurface), SURFACE);
  assert.equal(classifyFile('lh.something', freeSurferCurv), OVERLAY);
});

test('extensionless FreeSurfer surfaces are recognised', () => {
  // Both by magic number...
  assert.equal(classifyFile('lh.pial', freeSurferSurface), SURFACE);
  // ...and by name alone, when the bytes are unavailable.
  assert.equal(classifyFile('lh.pial'), SURFACE);
  assert.equal(classifyFile('rh.white'), SURFACE);
  assert.equal(classifyFile('lh.inflated'), SURFACE);
  assert.equal(classifyFile('lh.sphere.reg'), SURFACE);
  assert.equal(classifyFile('lh.occip.patch.flat'), SURFACE);
});

test('GIfTI is classified from the intent codes inside it', () => {
  const surface = new TextEncoder().encode(
    '<?xml version="1.0"?><GIFTI Version="1.0"><DataArray Intent="NIFTI_INTENT_POINTSET"'
  );
  const overlay = new TextEncoder().encode(
    '<?xml version="1.0"?><GIFTI Version="1.0"><DataArray Intent="NIFTI_INTENT_SHAPE"'
  );
  assert.equal(classifyFile('mystery.gii', surface), SURFACE);
  assert.equal(classifyFile('mystery.gii', overlay), OVERLAY);
});

test('MZ3 is classified from its attribute bitfield', () => {
  // bit 1 = vertices present, bit 3 = scalars present.
  const withVertices = head([0x4d, 0x5a, 0b0011, 0x00, 0, 0, 0, 0]);
  const scalarsOnly = head([0x4d, 0x5a, 0b1000, 0x00, 0, 0, 0, 0]);
  assert.equal(classifyFile('mesh', withVertices), SURFACE);
  assert.equal(classifyFile('values', scalarsOnly), OVERLAY);
});

test('an unrecognised file is reported as unknown rather than guessed', () => {
  assert.equal(classifyFile('notes.txt', head([0x68, 0x65, 0x6c, 0x6c, 0x6f])), UNKNOWN);
  assert.equal(classifyFile('mystery'), UNKNOWN);
  // Gzip hides the content, so the name is all there is — and it says nothing.
  assert.equal(classifyFile('mystery.gz', head([0x1f, 0x8b, 0x08, 0x00])), UNKNOWN);
});

test('the real fixtures classify correctly', (t) => {
  const files = [
    ['test/fixtures/lh.pial', SURFACE],
    ['test/fixtures/lh.curv', OVERLAY],
    ['test/fixtures/lh.flat.surf.gii', SURFACE]
  ];
  for (const [path, expected] of files) {
    if (!existsSync(path)) {
      t.diagnostic(`skipped ${path} — fixture not present`);
      continue;
    }
    const bytes = readFileSync(path).subarray(0, SNIFF_BYTES);
    assert.equal(classifyFile(path.split('/').pop(), bytes), expected, path);
  }
});
