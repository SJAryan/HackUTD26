// TL-20 acceptance check: the assigned driver sees where to go. After reserve, Ana sees H17's
// synthetic address and backup device; Ben, a resident and a session without a role see nothing;
// the stop never carries the medical need or contact details; it disappears after release; and a
// household without a profile shows onFile false (the phone says to call the coordinator).
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl20
import { tables } from '../src/module_bindings';
import { connect, connectAs, fail, finish, run, sleep, waitFor } from './lib';

const INCIDENT = 'tornado-1';

run(async () => {
  const coord = await connectAs('coordinator', 'coordinator', INCIDENT, '', [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorJobs, tables.driverStops,
  ]);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole]);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [tables.driverJobs, tables.driverStops]);
  const ben = await connectAs('driver Ben', 'driver', INCIDENT, 'ben', [tables.driverJobs, tables.driverStops]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', [tables.residentJobs, tables.driverStops]);
  const outsider = await connect('outsider', [tables.driverStops]);

  const home = (id: string) => [...coord.db.coordinatorHouseholds.iter()].find(h => h.id === id);
  await waitFor('seed', () => home('H17') !== undefined && home('H22') !== undefined);
  if (coord.db.coordinatorJobs.count() !== 0n) fail('reset first (npm run stdb:reset:local)');
  const incident = [...coord.db.myIncident.iter()][0];

  // 1. H17 registered (synthetic); a report, then the coordinator reserves Ana on R4-ALT.
  const address = '418 Larkspur Ln (synthetic)';
  await h17.reducers.enrollPreparedness({
    enrollmentId: 'tl20-h17-enroll', medicalNeed: 'home_oxygen', backupDevice: 'Oxygen concentrator, one backup tank',
    address, preferredContact: 'imessage',
  });
  await bridge.reducers.ingestCheckin({
    eventId: 'tl20-h17-report', incidentId: INCIDENT, householdId: 'H17', observedAt: incident.clockAt,
    text: 'My oxygen concentrator battery shows 30-60 minutes left.', runtimeLowerMin: 30, runtimeUpperMin: 60,
  });
  await waitFor('H17 v1', () => home('H17')?.version === 1);
  if (ana.db.driverStops.count() !== 0n) fail('Ana sees a stop before any job');
  await coord.reducers.reserve({
    jobRequestId: 'tl20-h17-job', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 1,
  });
  await waitFor('Ana sees the stop', () => ana.db.driverStops.count() === 1n);
  const stop = [...ana.db.driverStops.iter()][0];
  const job = [...ana.db.driverJobs.iter()][0];
  if (stop.jobId !== job.id || stop.householdId !== 'H17' || !stop.onFile || stop.address !== address ||
      stop.backupDevice !== 'Oxygen concentrator, one backup tank') {
    fail(`unexpected stop ${JSON.stringify({ ...stop, jobId: String(stop.jobId) })}`);
  }
  const fields = Object.keys(stop).sort().join();
  if (fields !== 'address,backupDevice,householdId,jobId,onFile') fail(`stop carries extra fields: ${fields}`);
  console.log(`reserve: Ana sees job #${stop.jobId} at "${stop.address}" (${stop.backupDevice}); fields ${fields}`);

  // 2. Nobody else sees it.
  await sleep(300);
  const others = { ben: ben.db.driverStops.count(), resident: h17.db.driverStops.count(), coordinator: coord.db.driverStops.count(), noRole: outsider.db.driverStops.count() };
  if (Object.values(others).some(n => n !== 0n)) fail(`stop visible outside Ana: ${JSON.stringify(others, (_, v) => String(v))}`);
  console.log('privacy: Ben, the resident, the coordinator and a no-role session see 0 stops');

  // 3. It stays through arrival and delivery, and goes away on release.
  await ana.reducers.updateJob({ jobId: job.id, expectedVersion: 1, status: 'arrived' });
  await waitFor('H17 sees arrived', () => [...h17.db.residentJobs.iter()][0]?.status === 'arrived');
  await h17.reducers.updateJob({ jobId: job.id, expectedVersion: 2, status: 'delivered' });
  await waitFor('Ana sees delivered', () => [...ana.db.driverJobs.iter()][0]?.status === 'delivered');
  if (ana.db.driverStops.count() !== 1n) fail('stop disappeared before release');
  await coord.reducers.releaseJob({ jobId: job.id, expectedVersion: 3 });
  await waitFor('stop gone after release', () => ana.db.driverStops.count() === 0n);
  if (ana.db.driverJobs.count() !== 1n) fail('release removed the job itself from driver_jobs');
  console.log('release: Ana keeps the delivered job in driver_jobs, but the address is gone');

  // 4. A household without a profile: H22 has none, so Ben is told to call the coordinator.
  await bridge.reducers.ingestCheckin({
    eventId: 'tl20-h22-report', incidentId: INCIDENT, householdId: 'H22', observedAt: incident.clockAt,
    text: 'Battery shows about an hour left.', runtimeLowerMin: 60, runtimeUpperMin: 120,
  });
  await waitFor('H22 v1', () => home('H22')?.version === 1);
  await coord.reducers.reserve({
    jobRequestId: 'tl20-h22-job', caseId: 'H22', routeId: 'R7', assetId: 'BAT-01', driverId: 'ben', expectedVersion: 1,
  });
  await waitFor('Ben sees the stop', () => ben.db.driverStops.count() === 1n);
  const none = [...ben.db.driverStops.iter()][0];
  if (none.householdId !== 'H22' || none.onFile || none.address !== '' || none.backupDevice !== '') {
    fail(`unexpected no-profile stop ${JSON.stringify({ ...none, jobId: String(none.jobId) })}`);
  }
  if (ana.db.driverStops.count() !== 0n) fail("Ana sees Ben's stop");
  console.log('no profile: Ben sees H22 with onFile false and no address; Ana sees nothing');

  console.log('PASS: TL-20 driver stops');
  finish(0);
});
