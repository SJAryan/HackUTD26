// TL-21 (C): ~200 synthetic registered households for the lead incident.
// Run: npx tsx --test fixtures/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIX, BATTERIES, generateScale, laneCounts } from '../spacetimedb/src/domain/scale';
import * as tornado from './tornado';

const at = Date.UTC(2026, 10, 8, 15, 0, 0);
const scale = generateScale(at);

// The counts A's seed and D's board reconcile against, for the 198 generated rows at reset time.
// With A's H17 (Watch at its report) and H22, the lead incident has 200 households.
const EXPECTED = { act_now: 85, watch: 73, unknown: 20, silent: 20 };

test('198 generated households in the agreed mix, unique IDs that miss the locked seed', () => {
  assert.equal(scale.households.length, 198);
  for (const [answer, n] of Object.entries(MIX)) {
    assert.equal(scale.households.filter(h => h.answer === answer).length, n, answer);
  }
  const ids = [...scale.households.map(h => h.householdId), ...scale.routes.map(r => r.routeId),
    ...scale.assets.map(a => a.id), ...scale.drivers.map(d => d.id)];
  assert.equal(new Set(ids).size, ids.length);
  const locked = new Set(['H17', 'H22', 'BAT-01', 'ana', 'ben', ...tornado.options.map(o => o.routeId), 'R7']);
  assert.ok(ids.every(id => !locked.has(id)));
});

test('lane counts at reset time', () => {
  assert.deepEqual(laneCounts(scale, at), EXPECTED);
});

test('deterministic, and the same counts at any reset time', () => {
  assert.deepEqual(generateScale(at), scale);
  for (const later of [at + 37 * 60_000, Date.UTC(2026, 10, 9, 2, 30, 0)]) {
    assert.deepEqual(laneCounts(generateScale(later), later), EXPECTED);
  }
});

test('fewer batteries than battery needs, and generator needs have no compatible resource', () => {
  const batteryNeeds = scale.households.filter(h => h.need === 'battery').length;
  assert.ok(BATTERIES < batteryNeeds);
  assert.ok(scale.assets.every(a => a.kind === 'battery'));
  assert.equal(scale.households.filter(h => h.need === 'generator').length, MIX.no_compatible);
});

test('synthetic only: labelled rows, no contact or address fields', () => {
  for (const h of scale.households) {
    assert.match(h.label, /^Household H\d{3} \(synthetic\)$/);
    assert.deepEqual(Object.keys(h).sort(), ['answer', 'householdId', 'label', 'need', h.round ? 'round' : 'evidence'].sort());
  }
  assert.ok(scale.drivers.every(d => /^Driver \d{2} \(synthetic\)$/.test(d.name)));
});
