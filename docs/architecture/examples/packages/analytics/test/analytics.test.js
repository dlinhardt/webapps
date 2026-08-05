import assert from 'node:assert/strict';
import test from 'node:test';
import * as analytics from '../src/index.js';

test('exports no custom-event API', () => {
  assert.deepEqual(Object.keys(analytics).sort(), ['initAnalytics', 'isTrackingAllowed']);
});

test('blocks Do Not Track and Global Privacy Control', () => {
  assert.equal(analytics.isTrackingAllowed({ doNotTrack: '1' }), false);
  assert.equal(analytics.isTrackingAllowed({ doNotTrack: 'yes' }), false);
  assert.equal(analytics.isTrackingAllowed({ globalPrivacyControl: true }), false);
});
