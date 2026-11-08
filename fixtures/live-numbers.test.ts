// TL-18 (C): the agreed numbers on a real-time seed. A's seed anchors clocks and freeAt to the
// reset time, so these tests shift the fixture to arbitrary times of day and let time pass.
// Run: npx tsx --test fixtures/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN, evaluateOptions, type DispatchOption, type HouseholdCase } from '../spacetimedb/src/domain/dispatch';
import * as tornado from './tornado';

// Move the whole fixture so the reset (and H17's report) happen at `at`.
function anchoredAt(at: number) {
  const d = at - tornado.clockAt;
  const h17: HouseholdCase = { ...tornado.households[0], evidence: { ...tornado.households[0].evidence!, observedAt: at } };
  const options = tornado.options.map(o => ({ ...o, driverFreeAt: o.driverFreeAt + d, assetFreeAt: o.assetFreeAt + d }));
  const detour = options.map(o => (o.routeId === 'R4' ? { ...o, confirmedDelayMin: 20 } : o));
  return { h17, options, detour };
}

const summary = (h: HouseholdCase, options: DispatchOption[], now: number) => {
  const r = evaluateOptions(h, options, now);
  return { lane: r.lane, best: r.best?.routeId, margins: Object.fromEntries(r.options.map(o => [o.routeId, o.marginLoMin])) };
};

test('agreed numbers at report time, at any time of day', () => {
  const day = Date.UTC(2026, 10, 8, 0, 0, 0);
  for (const at of [day, day + 90 * MIN, day + 7 * 60 * MIN + 13_456, day + 23 * 60 * MIN + 59 * MIN]) {
    const { h17, options, detour } = anchoredAt(at);
    assert.deepEqual(summary(h17, options, at), { lane: 'watch', best: 'R4', margins: { R4: 17, 'R4-ALT': 6 } });
    assert.deepEqual(summary(h17, detour, at), { lane: 'act_now', best: 'R4-ALT', margins: { 'R4-ALT': 6, R4: -3 } });
  }
});

// Margins are whole minutes, rounded down (conservative), and shrink while the case waits:
// the driver cannot leave before now. This is what the live board shows after the report.
test('live timeline while H17 waits unassigned', () => {
  const at = Date.UTC(2026, 10, 8, 15, 0, 0);
  const { h17, options, detour } = anchoredAt(at);
  const r4 = (seconds: number) => summary(h17, options, at + seconds * 1000);
  assert.deepEqual([r4(0).margins.R4, r4(1).margins.R4, r4(60).margins.R4, r4(61).margins.R4], [17, 16, 16, 15]);
  // Watch lasts exactly two minutes, then H17 is Act now even without the detour.
  assert.equal(r4(120).lane, 'watch');
  assert.equal(r4(121).lane, 'act_now');
  // After the detour the alternate is still the best choice, one minute less per minute waited.
  const late = summary(h17, detour, at + 90 * 1000);
  assert.deepEqual([late.best, late.margins['R4-ALT'], late.margins.R4], ['R4-ALT', 4, -5]);
});
