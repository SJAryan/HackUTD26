// TL-03 acceptance: npx tsx --test fixtures/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN, evaluateOptions, type DispatchOption, type HouseholdCase } from '../spacetimedb/src/domain/dispatch';
import * as tornado from './tornado';
import * as freeze from './freeze';

const [h17, h22] = tornado.households;
const now = tornado.clockAt;
const withDetour = tornado.options.map(o =>
  o.routeId === tornado.r4Detour.routeId ? { ...o, confirmedDelayMin: tornado.r4Detour.delayMin } : o
);
const route = (r: ReturnType<typeof evaluateOptions>, id: string) => r.options.find(o => o.routeId === id)!;

test('H17 before the detour: R4 +17..+47, Watch', () => {
  const r = evaluateOptions(h17, tornado.options, now);
  assert.equal(r.best?.routeId, 'R4');
  assert.equal(r.best?.readyAt, now + 13 * MIN);
  assert.deepEqual([r.best?.marginLoMin, r.best?.marginHiMin], [17, 47]);
  assert.equal(route(r, 'R4-ALT').marginLoMin, 6);
  assert.equal(r.lane, 'watch');
});

test('H17 after the confirmed 20-minute detour: R4 -3..+27, best alternate +6..+36, Act now', () => {
  const r = evaluateOptions(h17, withDetour, now);
  assert.deepEqual([route(r, 'R4').marginLoMin, route(r, 'R4').marginHiMin], [-3, 27]);
  assert.equal(r.best?.routeId, 'R4-ALT');
  assert.deepEqual([r.best?.marginLoMin, r.best?.marginHiMin], [6, 36]);
  assert.equal(r.lane, 'act_now');
});

test('lane boundary: +15 is Watch, +14 is Act now', () => {
  // R4 ready at 02:13 against a 28- and 27-minute lower bound.
  for (const [lower, lane] of [[28, 'watch'], [27, 'act_now']] as const) {
    const h = { ...h17, evidence: { ...h17.evidence!, runtimeLowerMin: lower } };
    assert.equal(evaluateOptions(h, tornado.options, now).lane, lane);
  }
});

test('window is anchored to the report time, not evaluation time', () => {
  // Re-evaluating 5 minutes later must not restart the 30-minute clock.
  const r = evaluateOptions(h17, tornado.options, now + 5 * MIN);
  assert.equal(r.best?.readyAt, now + 18 * MIN);
  assert.equal(r.best?.marginLoMin, 12);
  assert.equal(r.lane, 'act_now');
});

test('busy driver delays the ready time', () => {
  const busy = tornado.options.map(o => ({ ...o, driverFreeAt: now + 10 * MIN }));
  assert.equal(evaluateOptions(h17, busy, now).best?.marginLoMin, 7);
});

test('unknown runtime stays unknown', () => {
  const h: HouseholdCase = { householdId: 'H17', need: 'battery', evidence: { observedAt: now } };
  const r = evaluateOptions(h, tornado.options, now);
  assert.equal(r.lane, 'unknown');
  assert.equal(r.best?.marginLoMin, undefined);
});

test('no compatible resource is Act now', () => {
  const r = evaluateOptions({ ...h17, need: 'generator' }, tornado.options, now);
  assert.equal(r.lane, 'act_now');
  assert.equal(r.best, undefined);
  assert.match(r.reason, /no compatible generator/);
});

test('silent household: overdue round without a reply; a reply clears it', () => {
  assert.equal(evaluateOptions(h22, tornado.options, now + 4 * MIN).lane, 'unknown');
  assert.equal(evaluateOptions(h22, tornado.options, now + 5 * MIN).lane, 'silent');
  const replied = { ...h22, round: { ...h22.round!, lastReplyAt: now + 3 * MIN } };
  assert.equal(evaluateOptions(replied, tornado.options, now + 5 * MIN).lane, 'unknown');
  assert.equal(evaluateOptions(replied, tornado.options, now + 5 * MIN).silent, false);
});

test('silent status survives an Act now lane', () => {
  const late = now + 5 * MIN;
  // Overdue, unanswered, with a margin under +15.
  const urgent = { ...h22, evidence: h17.evidence };
  const low = evaluateOptions(urgent, withDetour, late);
  assert.equal(low.lane, 'act_now');
  assert.equal(low.silent, true);
  // Overdue, unanswered, with no compatible resource.
  const none = evaluateOptions({ ...h22, need: 'generator' }, tornado.options, late);
  assert.equal(none.lane, 'act_now');
  assert.equal(none.silent, true);
  // An answered household under the same urgency is not silent.
  assert.equal(evaluateOptions(h17, withDetour, late).silent, false);
});

test('freeze incident runs through the same rules', () => {
  const t = freeze.clockAt + 5 * MIN;
  const [f03, f09, f14] = freeze.households.map(h => evaluateOptions(h, freeze.options, t));
  // Under 30 minutes: lower bound 0, generator ready 06:23, short by 23.
  assert.equal(f03.best?.assetId, 'GEN-02');
  assert.deepEqual([f03.best?.marginLoMin, f03.best?.marginHiMin], [-23, 7]);
  assert.equal(f03.lane, 'act_now');
  assert.match(f03.reason, /short by 23 min/);
  // Two hours or more: no finite upper bound.
  assert.equal(f09.best?.assetId, 'BAT-07');
  assert.deepEqual([f09.best?.marginLoMin, f09.best?.marginHiMin], [92, undefined]);
  assert.equal(f09.lane, 'watch');
  assert.equal(f14.lane, 'silent');
  assert.deepEqual([f03.silent, f09.silent, f14.silent], [false, false, true]);
});

test('fixture IDs are distinct across incidents', () => {
  const ids = (o: DispatchOption[], h: HouseholdCase[]) =>
    [...o.flatMap(x => [x.routeId, x.assetId]), ...h.map(x => x.householdId)];
  const t = new Set(ids(tornado.options, tornado.households));
  assert.ok(ids(freeze.options, freeze.households).every(id => !t.has(id)));
});
