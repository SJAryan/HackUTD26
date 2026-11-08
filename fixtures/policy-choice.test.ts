// TL-15 (D): what each answer on the resident's policy screen keeps and what the coordinator sees.
// npx tsx --test fixtures/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestNeeds } from '../spacetimedb/src/domain/suggest';
import { keptNeeds, needLine, needsDescription } from '../src/screens/policyChoice';
import { policySignals } from './policy-signals';

const h17 = suggestNeeds(policySignals.find(s => s.householdId === 'H17')!);
const f03 = suggestNeeds(policySignals.find(s => s.householdId === 'F03')!);

test('confirm keeps the suggested need, shown as self-confirmed', () => {
  const kept = keptNeeds(h17, { powered_equipment: 'confirm' });
  assert.deepEqual(kept, [{ id: 'powered_equipment', dispatchNeed: 'battery' }]);
  assert.equal(needLine('Home oxygen', kept), 'Home oxygen, self-confirmed via preparedness profile');
});

test('correct with different equipment keeps the need, marked corrected', () => {
  const kept = keptNeeds(h17, { powered_equipment: 'different' });
  assert.deepEqual(kept, [{ id: 'powered_equipment', dispatchNeed: 'battery', corrected: true }]);
  assert.equal(needLine('Home oxygen', kept), 'Powered equipment, battery backup, corrected by the resident via preparedness profile');
});

test('"does not apply", skip and no answer keep nothing and add no note', () => {
  for (const choices of [{ powered_equipment: 'not_mine' as const }, { powered_equipment: 'skip' as const }, {}]) {
    assert.deepEqual(keptNeeds(h17, choices), []);
    assert.equal(needLine('Home oxygen', keptNeeds(h17, choices)), 'Home oxygen');
  }
});

test('step-free access: confirm keeps a driver note with no dispatch need; it cannot be "different"', () => {
  assert.deepEqual(keptNeeds(f03, { step_free_access: 'confirm' }), [{ id: 'step_free_access' }]);
  assert.deepEqual(keptNeeds(f03, { step_free_access: 'different' }), []);
  assert.equal(needLine('Generator', keptNeeds(f03, { step_free_access: 'confirm' })), 'Generator');
});

test('kept needs never carry the policy sources', () => {
  for (const k of keptNeeds(h17, { powered_equipment: 'confirm' })) assert.deepEqual(Object.keys(k).sort(), ['dispatchNeed', 'id']);
});

test('a correction is blocked until the resident describes their own equipment', () => {
  const prefill = 'Oxygen concentrator, one backup tank';
  const corrected = keptNeeds(h17, { powered_equipment: 'different' });
  assert.equal(needsDescription(corrected, prefill, prefill), true, 'untouched prefill');
  assert.equal(needsDescription(corrected, '', prefill), true, 'cleared field');
  assert.equal(needsDescription(corrected, '   ', prefill), true, 'only spaces');
  assert.equal(needsDescription(corrected, 'CPAP', prefill), false, 'CPAP succeeds');
  // Confirm, skip and "does not apply" never require a new description.
  for (const c of ['confirm', 'skip', 'not_mine'] as const) {
    assert.equal(needsDescription(keptNeeds(h17, { powered_equipment: c }), prefill, prefill), false, c);
  }
});
