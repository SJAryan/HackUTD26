// TL-15 acceptance: npx tsx --test fixtures/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestNeeds, confirmedNeed, type PolicySignals } from '../spacetimedb/src/domain/suggest';
import { evaluateOptions } from '../spacetimedb/src/domain/dispatch';
import { policySignals } from './policy-signals';
import * as tornado from './tornado';

const byId = Object.fromEntries(policySignals.map(s => [s.householdId, suggestNeeds(s)]));
const [h17] = tornado.households;
const none: PolicySignals = { householdId: 'X', lifePolicyEquipment: [], disabilityPolicy: false, homeMods: [], autoMods: [] };

test('listed equipment plus disability policy: powered equipment, high confidence', () => {
  assert.deepEqual(
    byId.H17.map(s => [s.id, s.dispatchNeed, s.confidence, s.sources]),
    [['powered_equipment', 'battery', 'high', ['life policy: listed equipment', 'disability policy']]]
  );
});

test('home and car modifications: step-free access, medium confidence, not a dispatch need', () => {
  assert.deepEqual(
    byId.F03.map(s => [s.id, s.dispatchNeed, s.confidence, s.sources]),
    [['step_free_access', undefined, 'medium', ['home modification: ramp', 'car modification: hand_controls']]]
  );
});

test('no suggestion without signals, or from a disability policy alone', () => {
  assert.deepEqual(byId.F09, []);
  assert.deepEqual(byId.H22, []);
});

test('free text and unknown codes never produce a suggestion', () => {
  // Review repros: "trampoline" contains "ramp"; a negated note mentions oxygen.
  const raw = {
    ...none,
    disabilityPolicy: true,
    lifePolicyEquipment: ['Does not use home oxygen'],
    homeMods: ['Backyard trampoline installed', 'trampoline'],
    autoMods: ['roof rack'],
  } as unknown as PolicySignals;
  assert.deepEqual(suggestNeeds(raw), []);
});

test('suggestions carry no diagnosis', () => {
  assert.ok(!/oxygen/i.test(JSON.stringify(byId.H17)));
});

test('confirming step-free access keeps it; skip stores nothing', () => {
  assert.deepEqual(confirmedNeed({ choice: 'confirm', suggestion: byId.F03[0] }), { id: 'step_free_access' });
  assert.equal(confirmedNeed({ choice: 'skip' }), undefined);
  const corrected = { id: 'powered_equipment', dispatchNeed: 'generator' } as const;
  assert.deepEqual(confirmedNeed({ choice: 'correct', need: corrected }), corrected);
});

test('a confirmed need flows into evaluateOptions and changes nothing else', () => {
  const need = confirmedNeed({ choice: 'confirm', suggestion: byId.H17[0] });
  assert.deepEqual(need, { id: 'powered_equipment', dispatchNeed: 'battery' });
  const confirmed = evaluateOptions({ ...h17, need: need!.dispatchNeed! }, tornado.options, tornado.clockAt);
  assert.deepEqual(confirmed, evaluateOptions(h17, tornado.options, tornado.clockAt));
});

test('a skipped household gets identical assistance', () => {
  // H17 skipped, but reports a battery need during the incident: same result as confirming.
  const skipped = evaluateOptions(h17, tornado.options, tornado.clockAt);
  const confirmed = evaluateOptions({ ...h17, need: 'battery' }, tornado.options, tornado.clockAt);
  assert.deepEqual(skipped, confirmed);
});
