// TL-15 acceptance check (A side): storing a need the resident confirmed from a policy suggestion.
// Confirm stores one row (even on retry), Skip stores nothing, the server derives the dispatch need,
// coordinators see "self-confirmed via preparedness profile" and never the sources, only the resident
// and coordinators can read it, confirming changes nothing dispatch reads, and resetIncident clears it.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl15
import { Timestamp } from 'spacetimedb';
import { tables } from '../src/module_bindings';
import { readyAt } from '../spacetimedb/src/rules';
import { connect, connectAs, fail, finish, ownerCall, ownerSqlCount, rejects, run, sleep, waitFor } from './lib';

const INCIDENT = 'tornado-1';
const MIN = 60_000;
const ms = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);

run(async () => {
  const mine = [tables.myRole, tables.myConfirmedNeed];
  const coord = await connectAs('coordinator', 'coordinator', INCIDENT, '', [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorRoutes, tables.coordinatorAssets,
    tables.coordinatorDrivers, tables.coordinatorJobs, tables.coordinatorConfirmedNeeds,
  ]);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole]);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [...mine, tables.coordinatorConfirmedNeeds]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', mine);
  const h22 = await connectAs('resident H22', 'resident', INCIDENT, 'H22', [...mine, tables.coordinatorConfirmedNeeds]);
  const outsider = await connect('outsider', [...mine, tables.coordinatorConfirmedNeeds]);

  const rows = () => [...coord.db.coordinatorConfirmedNeeds.iter()];
  const home = (id: string) => [...coord.db.coordinatorHouseholds.iter()].find(h => h.id === id)!;
  const stored = () => ownerSqlCount('SELECT household_id FROM confirmed_need');
  await waitFor('seed', () => home('H17') !== undefined && home('H22') !== undefined);
  if (coord.db.coordinatorJobs.count() !== 0n || stored() !== 0) fail('reset first (npm run stdb:reset:local)');
  const seedRows = { H17: { ...home('H17') }, H22: { ...home('H22') } };

  // 1. H17 confirms the suggested powered equipment. A retry with the same ID stores nothing new.
  await h17.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-h17-confirm', needId: 'powered_equipment' });
  await h17.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-h17-confirm', needId: 'powered_equipment' });
  await waitFor('H17 sees its confirmation', () => h17.db.myConfirmedNeed.count() === 1n);
  await waitFor('coordinator sees it', () => rows().length === 1);
  await sleep(300);
  if (stored() !== 1) fail('expected exactly one confirmed_need row after a retry');
  const row = rows()[0];
  if (row.householdId !== 'H17' || row.needId !== 'powered_equipment' || row.dispatchNeed !== 'battery' ||
      row.label !== 'self-confirmed via preparedness profile') {
    fail(`unexpected coordinator row ${JSON.stringify({ ...row, confirmedAt: undefined })}`);
  }
  console.log(`H17 confirms (and retries): one row; coordinator sees ${row.needId}, dispatch need ${row.dispatchNeed}, "${row.label}"`);

  // 2. Rejected calls store nothing.
  const second = await rejects('second confirmation', () =>
    h17.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-h17-again', needId: 'step_free_access' }),
    /^conflict: H17 already confirmed powered_equipment$/);
  const unknown = await rejects('unknown need', () =>
    h22.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-h22-bad', needId: 'toString' }), /^unknown needId toString$/);
  const reused = await rejects('reused confirmationId', () =>
    h22.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-h17-confirm', needId: 'powered_equipment' }),
    /^conflict: confirmationId already used$/);
  const driver = await rejects('driver confirm', () =>
    ana.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-ana', needId: 'powered_equipment' }), /^forbidden/);
  const noRole = await rejects('no-role confirm', () =>
    outsider.reducers.confirmSuggestedNeed({ confirmationId: 'tl15-x', needId: 'powered_equipment' }), /^forbidden/);
  if (stored() !== 1) fail('a rejected call stored a row');
  console.log(`rejected: ${second} | ${unknown} | ${reused} | ${driver} | ${noRole}`);

  // 3. Privacy: another resident, a driver and a session without a role read nothing.
  await sleep(300);
  const seen = (c: typeof h22) => c.db.myConfirmedNeed.count() + c.db.coordinatorConfirmedNeeds.count();
  if (seen(h22) + seen(ana) + seen(outsider) !== 0n) fail('a confirmed need is visible outside H17 and coordinators');
  const fields = Object.keys(row).join();
  if (/source|signal|policy|confidence/i.test(fields)) fail(`coordinator view carries policy data: ${fields}`);
  console.log(`privacy: H22, Ana and a no-role session see 0 rows; coordinator fields are ${fields} (no sources)`);

  // 4. Skip: H22 sends nothing and has no row.
  if (h22.db.myConfirmedNeed.count() !== 0n || ownerSqlCount("SELECT household_id FROM confirmed_need WHERE household_id = 'H22'") !== 0) {
    fail('skipped H22 has a stored need');
  }
  console.log('H22 skips: nothing sent, no row');

  // 5. Equal assistance: household rows are untouched and H17's numbers are the agreed ones.
  for (const id of ['H17', 'H22'] as const) {
    const now = home(id), was = seedRows[id];
    if (now.need !== was.need || now.version !== was.version || Object.keys(now).join() !== Object.keys(was).join()) {
      fail(`${id} household row changed after a confirmation`);
    }
  }
  const observedAt = Timestamp.now();
  await bridge.reducers.ingestCheckin({
    eventId: 'tl15-h17-report', incidentId: INCIDENT, householdId: 'H17', observedAt,
    text: 'My oxygen concentrator battery shows 30-60 minutes left.', runtimeLowerMin: 30, runtimeUpperMin: 60,
  });
  await waitFor('H17 report', () => home('H17').lastEventId === 'tl15-h17-report');
  const at = ms(observedAt);
  const margin = (routeId: string) => {
    const r = [...coord.db.coordinatorRoutes.iter()].find(x => x.id === routeId)!;
    const d = [...coord.db.coordinatorDrivers.iter()].find(x => x.id === r.driverId)!;
    const a = [...coord.db.coordinatorAssets.iter()].find(x => x.id === r.assetId)!;
    const ready = readyAt({
      routeId: r.id, driverId: r.driverId, assetId: r.assetId, assetKind: a.kind,
      driverFreeAt: ms(d.freeAt), assetFreeAt: ms(a.freeAt), driverToAssetMin: r.driverToAssetMin,
      pickupMin: r.pickupMin, assetToHomeMin: r.assetToHomeMin, setupMin: r.setupMin, confirmedDelayMin: r.confirmedDelayMin,
    }, at);
    return Math.floor((at + 30 * MIN - ready) / MIN);
  };
  const numbers = [margin('R4'), margin('R4-ALT')].join();
  if (numbers !== '17,6') fail(`R4/R4-ALT after a confirmation: ${numbers}, expected 17,6`);
  if (home('H17').need !== home('H22').need) fail('confirmed and skipped households have different dispatch needs');
  console.log(`equal assistance: household rows unchanged (both need ${home('H17').need}); R4 +17, R4-ALT +6 as in TL-18`);

  // 6. The demo reset clears confirmations for that incident.
  ownerCall('reset_incident', INCIDENT);
  await waitFor('H17 confirmation cleared', () => h17.db.myConfirmedNeed.count() === 0n && rows().length === 0);
  if (stored() !== 0) fail('resetIncident left confirmed_need rows');
  console.log('resetIncident: confirmed_need cleared for the incident');

  console.log('PASS: TL-15 confirmed need storage');
  finish(0);
});
