// TL-05 acceptance check: two authenticated coordinators race for the last battery for
// different households. Expect one success, one conflict, one job, and notifications only
// for the winner. Run against a freshly reset database:
//   npm run stdb:reset:local && npm run check:tl05
import { tables } from '../src/module_bindings';
import { connect, connectAs, createInvite, fail, finish, ownerSqlCount, rejects, run, sleep, waitFor } from './lib';

const MIN = 60_000;
const INCIDENT = 'tornado-1';
const ms = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);
const hhmm = (millis: number) =>
  new Date(millis).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });

run(async () => {
  const board = [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorRoutes,
    tables.coordinatorAssets, tables.coordinatorDrivers, tables.coordinatorJobs,
  ];
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.bridgeOutbox]);
  const c1 = await connectAs('coordinator 1', 'coordinator', INCIDENT, '', board);
  const c2 = await connectAs('coordinator 2', 'coordinator', INCIDENT, '', board);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [tables.driverJobs]);
  const ben = await connectAs('driver Ben', 'driver', INCIDENT, 'ben', [tables.driverJobs]);
  const outsider = await connect('outsider', [...board, tables.driverJobs, tables.bridgeOutbox]);

  const home = (c: typeof c1, id: string) => [...c.db.coordinatorHouseholds.iter()].find(h => h.id === id)!;
  const route = (c: typeof c1, id: string) => [...c.db.coordinatorRoutes.iter()].find(r => r.id === id)!;
  const jobs = (c: typeof c1) => [...c.db.coordinatorJobs.iter()];
  if (home(c1, 'H17').version !== 0 || jobs(c1).length !== 0) fail('reset first (npm run stdb:reset:local)');
  const clock = ms([...c1.db.myIncident.iter()][0].clockAt);

  // 1. Check-in at 02:00: H17 reports 30-60 minutes (H17 -> v1).
  await bridge.reducers.ingestCheckin({
    eventId: 'tl01-h17-0200', incidentId: INCIDENT, householdId: 'H17',
    observedAt: [...c1.db.myIncident.iter()][0].clockAt,
    text: 'My backup shows 30-60 minutes left. Can the driver reach the side entrance?',
    runtimeLowerMin: 30, runtimeUpperMin: 60,
  });
  await waitFor('coordinators see H17 v1', () => home(c1, 'H17').version === 1 && home(c2, 'H17').version === 1);

  // 2. Stale case version is an explicit conflict with no job.
  const stale = await rejects('stale version', () => c2.reducers.reserve({
    jobRequestId: 'tl05-stale', caseId: 'H17', routeId: 'R4', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 0,
  }), /conflict: H17 is at version 1/);
  console.log(`stale expectedVersion: ${stale}`);

  // 3. Confirmed 20-minute detour on R4, reported twice: applied once, never 40.
  for (let i = 0; i < 2; i++) {
    await c1.reducers.confirmRouteReport({ reportId: 'tl05-r4-detour', incidentId: INCIDENT, routeId: 'R4', delayMin: 20 });
  }
  await waitFor('coordinator 2 sees R4 delay', () => route(c2, 'R4').confirmedDelayMin === 20);
  console.log('R4 detour confirmed twice with the same reportId: confirmedDelayMin = 20');

  // 4. A session without a role cannot reserve or read anything.
  const denied = await rejects('outsider reserve', () => outsider.reducers.reserve({
    jobRequestId: 'tl05-outsider', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 1,
  }), /forbidden/);
  const leaked = outsider.db.coordinatorHouseholds.count() + outsider.db.driverJobs.count() + outsider.db.bridgeOutbox.count();
  if (leaked !== 0n) fail(`outsider can read ${leaked} rows`);
  console.log(`session without a role: ${denied}; sees 0 rows`);

  // 4b. Cross-incident requests are rejected and write nothing.
  const fz = await connectAs('freeze coordinator', 'coordinator', 'freeze-1', '', board);
  const fzAsset = (id: string) => [...fz.db.coordinatorAssets.iter()].find(a => a.id === id);
  if (!fzAsset('BAT-07') || [...c1.db.coordinatorAssets.iter()].some(a => a.id === 'BAT-07')) {
    fail('coordinator views are not scoped to their incident');
  }
  const crossAsset = await rejects('cross-incident asset', () => c1.reducers.reserve({
    jobRequestId: 'tl05-cross-asset', caseId: 'H17', routeId: 'R4', assetId: 'BAT-07', driverId: 'ana', expectedVersion: 1,
  }), /^rejected: asset BAT-07 belongs to freeze-1, not tornado-1$/);
  const crossRoute = await rejects('cross-incident route', () => c1.reducers.reserve({
    jobRequestId: 'tl05-cross-route', caseId: 'H17', routeId: 'FZ-R2', assetId: 'BAT-07', driverId: 'leo', expectedVersion: 1,
  }), /^rejected: route FZ-R2 belongs to freeze-1, not tornado-1$/);
  const crossInviteDriver = await rejects('cross-incident driver invite', async () =>
    createInvite('driver', 'tornado-1', 'leo'), /^rejected: driver leo belongs to freeze-1, not tornado-1$/);
  const crossInviteResident = await rejects('cross-incident resident invite', async () =>
    createInvite('resident', 'tornado-1', 'F09'), /^rejected: household F09 belongs to freeze-1, not tornado-1$/);
  await sleep(300);
  const sideEffects = {
    jobs: ownerSqlCount('SELECT id FROM job'),
    outbox: ownerSqlCount('SELECT key FROM outbox'),
    invites: ownerSqlCount("SELECT code FROM invite WHERE subject_id = 'leo' OR subject_id = 'F09'"),
    reserved: [c1, fz].flatMap(c => [...c.db.coordinatorAssets.iter(), ...c.db.coordinatorDrivers.iter()])
      .filter(row => row.activeJobId !== undefined).length,
  };
  if (Object.values(sideEffects).some(n => n !== 0)) fail(`cross-incident side effects: ${JSON.stringify(sideEffects)}`);
  if (home(c1, 'H17').version !== 1 || fzAsset('BAT-07')!.activeJobId !== undefined) fail('cross-incident attempt changed state');
  console.log('cross-incident requests:');
  for (const m of [crossAsset, crossRoute, crossInviteDriver, crossInviteResident]) console.log(`  ${m}`);
  console.log(`  side effects: ${JSON.stringify(sideEffects)}; H17 still v1, BAT-07 free`);

  // 5. The race: both coordinators want BAT-01, for different households and drivers.
  const attempts = [
    { who: 'coordinator 1', conn: c1, args: { jobRequestId: 'tl05-c1-h17', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 1 } },
    { who: 'coordinator 2', conn: c2, args: { jobRequestId: 'tl05-c2-h22', caseId: 'H22', routeId: 'R7', assetId: 'BAT-01', driverId: 'ben', expectedVersion: 0 } },
  ];
  if (process.env.RACE_REVERSE) attempts.reverse(); // send coordinator 2's call first
  console.log('race: coordinator 1 reserves BAT-01 for H17 via R4-ALT; coordinator 2 reserves BAT-01 for H22 via R7');
  const results = await Promise.allSettled(attempts.map(a => a.conn.reducers.reserve(a.args)));
  const won = results.flatMap((r, i) => (r.status === 'fulfilled' ? [attempts[i]] : []));
  const lost = results.flatMap((r, i) => (r.status === 'rejected' ? [{ ...attempts[i], error: (r.reason as Error).message }] : []));
  if (won.length !== 1 || lost.length !== 1) fail(`expected 1 success and 1 conflict, got ${won.length} and ${lost.length}`);
  const [winner, loser] = [won[0], lost[0]];
  if (!/conflict: BAT-01 is reserved/.test(loser.error)) fail(`loser got "${loser.error}"`);
  console.log(`  ${winner.who}: committed`);
  console.log(`  ${loser.who}: ${loser.error}`);

  // 6. Exactly one job, holding all three entities; the loser left nothing behind.
  await waitFor('both coordinators see the job', () => jobs(c1).length === 1 && jobs(c2).length === 1);
  await sleep(300);
  const job = jobs(c1)[0];
  if (jobs(c1).length !== 1 || job.requestId !== winner.args.jobRequestId) fail('wrong job set');
  const lh = home(c1, loser.args.caseId);
  if (lh.activeJobId !== undefined || lh.version !== loser.args.expectedVersion) fail('loser household changed');
  const loserDriver = [...c1.db.coordinatorDrivers.iter()].find(d => d.id === loser.args.driverId)!;
  if (loserDriver.activeJobId !== undefined) fail('loser driver was reserved');
  const battery = [...c1.db.coordinatorAssets.iter()].find(a => a.id === 'BAT-01')!;
  if (battery.activeJobId !== job.id) fail('battery not held by the job');
  console.log(`one job: #${job.id} ${job.householdId} ${job.routeId} ${job.assetId} ${job.driverId} v${job.version}`);

  // ETA comes from the dispatch rules: R4-ALT ready 24 min, R7 19 min after max(now, clock).
  const legMin = job.routeId === 'R4-ALT' ? 24 : 19;
  const expectedEta = Math.max(ms(job.createdAt), clock) + legMin * MIN;
  if (ms(job.etaAt) !== expectedEta) fail(`ETA ${hhmm(ms(job.etaAt))}, expected ${hhmm(expectedEta)}`);
  console.log(`ETA ${hhmm(ms(job.etaAt))} (${job.routeId}, ${legMin} min from ${hhmm(Math.max(ms(job.createdAt), clock))})`);

  // 7. Notification intents: two, both for the winning job; none from the losing attempt.
  await waitFor('bridge sees 2 intents', () => bridge.db.bridgeOutbox.count() === 2n);
  const intents = [...bridge.db.bridgeOutbox.iter()];
  if (intents.some(i => i.jobId !== job.id)) fail('an intent belongs to another job');
  for (const i of intents.sort((a, b) => a.key.localeCompare(b.key))) console.log(`intent ${i.key}: "${i.body}"`);

  // 8. Only the assigned driver sees the job.
  const [mine, other] = job.driverId === 'ana' ? [ana, ben] : [ben, ana];
  await waitFor('assigned driver sees the job', () => mine.db.driverJobs.count() === 1n);
  if (other.db.driverJobs.count() !== 0n) fail('the other driver can see the job');
  console.log(`driver ${job.driverId} sees 1 job; the other driver sees 0`);

  // 9. Replaying the winning jobRequestId is a no-op.
  await winner.conn.reducers.reserve(winner.args);
  await sleep(500);
  if (jobs(c1).length !== 1 || bridge.db.bridgeOutbox.count() !== 2n) fail('replay created state');
  console.log('replay of the winning jobRequestId: no new job, no new intents');

  console.log('PASS: TL-05 last-battery race');
  finish(0);
});
