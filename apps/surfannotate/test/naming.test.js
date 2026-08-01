import test from 'node:test';
import assert from 'node:assert/strict';

import { hemispherePrefix, fileSafe, exportStem } from '../src/io/naming.js';

test('GIfTI anatomical structure decides the hemisphere', () => {
  assert.equal(hemispherePrefix({ anatomicalStructure: 'CORTEXLEFT' }), 'lh');
  assert.equal(hemispherePrefix({ anatomicalStructure: 'CortexRight' }), 'rh');
  // It wins over a filename that says otherwise — the file records it properly.
  assert.equal(
    hemispherePrefix({ anatomicalStructure: 'CORTEXLEFT', filename: 'rh.pial' }),
    'lh'
  );
});

test('FreeSurfer and BIDS filenames are recognised', () => {
  assert.equal(hemispherePrefix({ filename: 'lh.pial' }), 'lh');
  assert.equal(hemispherePrefix({ filename: 'rh.white' }), 'rh');
  assert.equal(hemispherePrefix({ filename: 'lh.sphere.reg.surf.gii' }), 'lh');
  assert.equal(hemispherePrefix({ filename: 'sub-01_hemi-L_pial.surf.gii' }), 'lh');
  assert.equal(hemispherePrefix({ filename: 'sub-01_hemi-R_midthickness.surf.gii' }), 'rh');
  assert.equal(hemispherePrefix({ filename: 'S1200.L.inflated.32k_fs_LR.surf.gii' }), 'lh');
});

test('an unrecognised surface yields no prefix rather than a wrong one', () => {
  assert.equal(hemispherePrefix({ filename: 'brain.mz3' }), '');
  assert.equal(hemispherePrefix({ filename: 'cortex.surf.gii' }), '');
  assert.equal(hemispherePrefix({}), '');
});

test('file names drop characters that are illegal on some platform', () => {
  assert.equal(fileSafe('V1'), 'V1');
  assert.equal(fileSafe('V1 / left*hemi'), 'V1-left-hemi');
  assert.equal(fileSafe('a:b?c"d<e>f|g'), 'a-b-c-d-e-f-g');
  assert.equal(fileSafe('  spaced   out  '), 'spaced-out');
  assert.equal(fileSafe('...'), 'roi', 'an empty result falls back');
  assert.equal(fileSafe(''), 'roi');
  assert.equal(fileSafe('x'.repeat(200)).length, 64, 'names are capped');
});

test('the export stem is hemisphere plus ROI, not the source filename', () => {
  assert.equal(
    exportStem('V1', { filename: 'lh.sphere.reg.surf.gii' }),
    'lh.V1',
    'the surface it was drawn on is not part of the name'
  );
  assert.equal(exportStem('V1', { anatomicalStructure: 'CORTEXRIGHT' }), 'rh.V1');
  assert.equal(exportStem('motor area', { filename: 'lh.pial' }), 'lh.motor-area');
});

test('an unknown hemisphere leaves just the ROI name', () => {
  assert.equal(exportStem('V1', { filename: 'brain.mz3' }), 'V1');
  assert.equal(exportStem('', { filename: 'brain.mz3' }), 'roi');
});

test('a filename carrying both L and R is refused rather than guessed', () => {
  // Picking the first would export a right hemisphere as `lh.<roi>`, silently.
  assert.equal(hemispherePrefix({ filename: 'MSM-L.R.midthickness.32k_fs_LR.surf.gii' }), '');
  assert.equal(hemispherePrefix({ filename: 'S1200_L_to_R.R.midthickness.gii' }), '');
  assert.equal(hemispherePrefix({ filename: 'atlas-L.R.32k.surf.gii' }), '');
  // An unambiguous single letter still resolves.
  assert.equal(hemispherePrefix({ filename: 'S1200.L.inflated.32k_fs_LR.surf.gii' }), 'lh');
  assert.equal(hemispherePrefix({ filename: 'S1200.R.inflated.32k_fs_LR.surf.gii' }), 'rh');
  // And a stronger signal still wins over the ambiguity.
  assert.equal(hemispherePrefix({ filename: 'sub-01_hemi-R_L.to.R.surf.gii' }), 'rh');
});
