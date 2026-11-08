// TL-12 stale-ETA check (A side): bridge_outbox only shows intents for a job's current version
// while it is assigned, so the bridge can never send an ETA for a job that has moved on.
// Also reports (without failing) the known gap: a detour confirmed after reserve does not
// refresh the ETA intent. Run against a freshly reset database:
//   npm run stdb:reset:local && npm run check:tl12
import { tables } from '../src/module_bindings';
import { connectAs, fail, finish, ownerCall, run, sleep, waitFor } from './lib';

const INCIDENT = 'tornado-1';

run(async () => {
  const coord = await connectAs('coordinator', 'coordinator', INCIDENT, '', [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorJobs,
  ]);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole, tables.bridgeOutbox]);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [tables.driverJobs]);
  const ben = await connectAs('driver Ben', 'driver', INCIDENT, 'ben', [tables.driverJobs]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', [tables.residentJobs]);

  const intents = () => [...bridge.db.bridgeOutbox.iter()];
  const summary = () => intents().map(r => `${r.key}`).sort().join(', ') || '(none)';
  await waitFor('seed', () => coord.db.coordinatorHouseholds.count() > 0n);
  if (coord.db.coordinatorJobs.count() !== 0n || intents().length !== 0) fail('reset first (npm run stdb:reset:local)');

  // 1. Reserve: exactly the two v1 intents for the new job.
  await coord.reducers.reserve({
    jobRequestId: 'tl12-h17-job', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 0,
  });
  await waitFor('two v1 intents', () => intents().length === 2);
  const jobId = intents()[0].jobId;
  if (!intents().every(r => r.jobId === jobId && r.jobVersion === 1)) fail(`unexpected intents ${summary()}`);
  const eta = intents().find(r => r.purpose === 'eta')!;
  if (eta.recipient !== 'household:H17') fail(`ETA addressed to ${eta.recipient}`);
  console.log(`assigned v1: bridge sees ${summary()}`);

  // 2. Replaying the same reserve adds nothing.
  await coord.reducers.reserve({
    jobRequestId: 'tl12-h17-job', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 0,
  });
  await sleep(300);
  if (intents().length !== 2) fail(`replayed reserve changed the outbox: ${summary()}`);
  console.log('replayed reserve: still the same 2 intents');

  // 3. Known gap: a detour confirmed after reserve leaves the v1 ETA visible (not refreshed).
  await coord.reducers.confirmRouteReport({ reportId: 'tl12-detour', incidentId: INCIDENT, routeId: 'R4-ALT', delayMin: 20 });
  await sleep(300);
  const afterDetour = intents().some(r => r.key === eta.key);
  console.log(`KNOWN GAP: after a 20-min detour on R4-ALT the v1 ETA is ${afterDetour ? 'still visible (not recomputed)' : 'gone'}`);

  // 4. The driver arrives (v2): every v1 intent drops out, and nothing new is queued for v2.
  await ana.reducers.updateJob({ jobId, expectedVersion: 1, status: 'arrived' });
  await waitFor('v1 intents gone after arrived', () => intents().length === 0);
  console.log(`arrived v2: bridge sees ${summary()}`);

  // 5. Delivered (v3), released, then a second job: only the new job's current intents show.
  await waitFor('H17 sees arrived', () => [...h17.db.residentJobs.iter()][0]?.status === 'arrived');
  await h17.reducers.updateJob({ jobId, expectedVersion: 2, status: 'delivered' });
  await sleep(300);
  if (intents().length !== 0) fail(`delivered job has intents: ${summary()}`);
  await coord.reducers.releaseJob({ jobId, expectedVersion: 3 });
  await sleep(300);
  if (intents().length !== 0) fail(`released job has intents: ${summary()}`);
  await coord.reducers.reserve({
    jobRequestId: 'tl12-h22-job', caseId: 'H22', routeId: 'R7', assetId: 'BAT-01', driverId: 'ben', expectedVersion: 0,
  }).catch(err => fail(`second reserve: ${(err as Error).message}`));
  await waitFor('second job intents', () => intents().length === 2);
  if (intents().some(r => r.jobId === jobId)) fail(`old job intents came back: ${summary()}`);
  console.log(`delivered v3: none; second job: bridge sees ${summary()}`);
  await waitFor('Ben has the second job', () => [...ben.db.driverJobs.iter()].some(j => j.householdId === 'H22'));

  // 6. Reset clears the outbox.
  ownerCall('reset_incident', INCIDENT);
  await waitFor('outbox empty after reset', () => intents().length === 0);
  console.log('resetIncident: bridge sees (none)');

  console.log('PASS: TL-12 no stale ETA intents');
  finish(0);
});
