// TL-15 acceptance: npx tsx --test fixtures/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestNeeds, confirmedNeed } from '../spacetimedb/src/domain/suggest';
import { evaluateOptions } from '../spacetimedb/src/domain/dispatch';
import { policySignals } from './policy-signals';
import * as tornado from './tornado';

const byId = Object.fromEntries(policySignals.map(s => [s.householdId, suggestNeeds(s)]));
const [h17] = tornado.households;

test('life policy note plus disability policy: powered equipment, high confidence', () => {
  assert.deepEqual(
    byId.H17.map(s => [s.id, s.dispatchNeed, s.confidence, s.sources]),
    [['powered_equipment', 'battery', 'high', ['life policy note', 'disability policy']]]
  );
});

test('home and car modifications: step-free access, medium confidence, not a dispatch need', () => {
  assert.deepEqual(
    byId.F03.map(s => [s.id, s.dispatchNeed, s.confidence, s.sources]),
    [['step_free_access', undefined, 'medium', ['home modification: Front ramp', 'car modification: Hand controls']]]
  );
});

test('no suggestion without signals, or from a disability policy alone', () => {
  assert.deepEqual(byId.F09, []);
  assert.deepEqual(byId.H22, []);
});

test('suggestions carry no diagnosis or copied life policy text', () => {
  const shown = JSON.stringify(byId.H17);
  assert.ok(!shown.includes('Uses home oxygen concentrator'));
  assert.ok(!/oxygen/i.test(shown));
});

test('a confirmed need flows into evaluateOptions and changes nothing else', () => {
  const need = confirmedNeed({ choice: 'confirm', suggestion: byId.H17[0] });
  assert.equal(need, 'battery');
  const confirmed = evaluateOptions({ ...h17, need: need! }, tornado.options, tornado.clockAt);
  assert.deepEqual(confirmed, evaluateOptions(h17, tornado.options, tornado.clockAt));
});

test('skip stores no need and assistance is identical; a correction replaces the need', () => {
  assert.equal(confirmedNeed({ choice: 'skip' }), undefined);
  // H17 skipped, but reports a battery need during the incident: same result as confirming.
  const skipped = evaluateOptions(h17, tornado.options, tornado.clockAt);
  const confirmed = evaluateOptions({ ...h17, need: 'battery' }, tornado.options, tornado.clockAt);
  assert.deepEqual(skipped, confirmed);
  assert.equal(confirmedNeed({ choice: 'correct', dispatchNeed: 'generator' }), 'generator');
});
