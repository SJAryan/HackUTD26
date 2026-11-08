// TL-18 acceptance check: real-time seed, the lead incident's live numbers, and a repeatable
// owner reset that keeps roles. Run against a freshly published database:
//   npm run stdb:reset:local && npm run check:tl18
import { Timestamp } from 'spacetimedb';
import { tables } from '../src/module_bindings';
import { readyAt } from '../spacetimedb/src/rules';
import { connectAs, createInvite, fail, finish, ownerCall, ownerSqlCount, rejects, run, sleep, waitFor } from './lib';

const LEAD = 'tornado-1';
const SECOND = 'freeze-1';
const MIN = 60_000;
const ms = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);

run(async () => {
  const board = [
    tables.myRole, tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorRoutes, tables.coordinatorAssets,
    tables.coordinatorDrivers, tables.coordinatorJobs, tables.coordinatorCheckins, tables.jobMessages,
    tables.coordinatorRounds, tables.coordinatorFollowups, tables.coordinatorFollowupAudit,
    tables.coordinatorProfiles, tables.coordinatorRegistryStats,
  ];
  const coord = await connectAs('lead coordinator', 'coordinator', LEAD, '', board);
  const second = await connectAs('second coordinator', 'coordinator', SECOND, '', board);
  const bridge = await connectAs('bridge', 'bridge', LEAD, '', [tables.myRole, tables.bridgeCheckins, tables.bridgeOutbox]);
  const ana = await connectAs('driver Ana', 'driver', LEAD, 'ana', [tables.myRole, tables.driverJobs]);
  const h17 = await connectAs('resident H17', 'resident', LEAD, 'H17', [
    tables.myRole, tables.residentJobs, tables.myProfile, tables.myAgentRequest, tables.jobMessages,
  ]);
  if (coord.db.coordinatorJobs.count() !== 0n) fail('reset first (npm run stdb:reset:local)');

  const incident = (c: typeof coord) => [...c.db.myIncident.iter()][0];
  const rows = <T>(it: Iterable<T>) => [...it];
  const route = (id: string) => rows(coord.db.coordinatorRoutes.iter()).find(r => r.id === id)!;
  const home = (id: string) => rows(coord.db.coordinatorHouseholds.iter()).find(h => h.id === id)!;

  // 0. Display labels: the IDs stay, the demo shows the lead as the winter freeze.
  const lead = incident(coord), other = incident(second);
  if (lead.kind !== 'freeze' || other.kind !== 'tornado') fail(`labels: ${lead.kind} / ${other.kind}`);
  console.log(`lead ${lead.id} shows "${lead.name}" (${lead.kind}); second ${other.id} shows "${other.name}" (${other.kind})`);

  // 1. The seed is anchored to the publish time, not a fixed 2026 clock.
  const skew = Math.abs(ms(lead.clockAt) - Date.now());
  const frees = [...rows(coord.db.coordinatorDrivers.iter()), ...rows(coord.db.coordinatorAssets.iter())];
  if (skew > 5 * MIN || frees.some(r => ms(r.freeAt) !== ms(lead.clockAt))) fail('seed is not anchored to now');
  console.log(`seed clock ${lead.clockAt.toDate().toISOString()} (${Math.round(skew / 1000)}s from now); all drivers and assets free at the clock`);

  // 2. The live story with C's numbers, computed exactly as the board does at the report time.
  const story = async (eventId: string, jobRequestId: string) => {
    const observedAt = Timestamp.now();
    await bridge.reducers.ingestCheckin({
      eventId, incidentId: LEAD, householdId: 'H17', observedAt,
      text: 'My oxygen concentrator battery shows 30-60 minutes left.', runtimeLowerMin: 30, runtimeUpperMin: 60,
    });
    await waitFor('H17 report', () => home('H17').lastEventId === eventId);
    const at = ms(observedAt);
    const margin = (id: string) => {
      const r = route(id);
      const d = rows(coord.db.coordinatorDrivers.iter()).find(x => x.id === r.driverId)!;
      const a = rows(coord.db.coordinatorAssets.iter()).find(x => x.id === r.assetId)!;
      const ready = readyAt({
        routeId: r.id, driverId: r.driverId, assetId: r.assetId, assetKind: a.kind,
        driverFreeAt: ms(d.freeAt), assetFreeAt: ms(a.freeAt), driverToAssetMin: r.driverToAssetMin,
        pickupMin: r.pickupMin, assetToHomeMin: r.assetToHomeMin, setupMin: r.setupMin, confirmedDelayMin: r.confirmedDelayMin,
      }, at);
      return Math.floor((at + 30 * MIN - ready) / MIN);
    };
    const before = [margin('R4'), margin('R4-ALT')];
    await coord.reducers.confirmRouteReport({ reportId: `${eventId}-detour`, incidentId: LEAD, routeId: 'R4', delayMin: 20 });
    await waitFor('detour', () => route('R4').confirmedDelayMin === 20);
    const after = [margin('R4'), margin('R4-ALT')];
    if (before.join() !== '17,6' || after.join() !== '-3,6') fail(`live margins ${before} -> ${after}`);
    await coord.reducers.reserve({
      jobRequestId, caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: home('H17').version,
    });
    await waitFor('job', () => coord.db.coordinatorJobs.count() === 1n);
    const job = rows(coord.db.coordinatorJobs.iter())[0];
    const etaLead = (ms(job.etaAt) - ms(job.createdAt)) / MIN;
    const liveMargin = (at + 30 * MIN - ms(job.etaAt)) / MIN;
    if (etaLead !== 24 || liveMargin > 6 || liveMargin <= 5) fail(`server ETA ${etaLead} min out, live margin ${liveMargin}`);
    console.log(
      `live: R4 +${before[0]}, R4-ALT +${before[1]}; after the detour R4 ${after[0]}, best R4-ALT +${after[1]}; ` +
        `server ETA = reserve time + ${etaLead} min, margin at reserve ${liveMargin.toFixed(2)} min`
    );
    return job;
  };
  const job = await story('tl18-h17-reply', 'tl18-h17-job');

  // 3. Build up state in every table the reset must clear.
  await h17.reducers.postJobMessage({ jobId: job.id, clientMessageId: 'tl18-m1', text: 'Can you use the side entrance?' });
  await ana.reducers.updateJob({ jobId: job.id, expectedVersion: 1, status: 'arrived' });
  await waitFor('arrived', () => rows(h17.db.residentJobs.iter())[0]?.status === 'arrived');
  await h17.reducers.updateJob({ jobId: job.id, expectedVersion: 2, status: 'delivered' });
  await waitFor('delivered', () => rows(h17.db.residentJobs.iter())[0]?.status === 'delivered');
  await h17.reducers.enrollPreparedness({
    enrollmentId: 'tl18-enroll', medicalNeed: 'home_oxygen', backupDevice: 'oxygen concentrator battery',
    address: '100 Example Lane (synthetic)', preferredContact: 'imessage',
  });
  await h17.reducers.requestAgentContact({ consentId: 'tl18-consent' });
  await coord.reducers.releaseJob({ jobId: job.id, expectedVersion: 3 });
  ownerCall('set_followup_interval', 2);
  await coord.reducers.openCheckinRound({ roundKey: 'tl18-h22', incidentId: LEAD, householdId: 'H22' });
  await waitFor('H22 follow-up', () => coord.db.coordinatorFollowups.count() === 1n, 15_000);
  await second.reducers.confirmRouteReport({ reportId: 'tl18-fz', incidentId: SECOND, routeId: 'FZ-R1', delayMin: 5 });
  await waitFor('second incident change', () => rows(second.db.coordinatorRoutes.iter()).some(r => r.id === 'FZ-R1' && r.confirmedDelayMin === 5));
  createInvite('resident', LEAD, 'H17'); // an unclaimed invite must survive the reset
  await sleep(300);

  const leadTables = ['checkin', 'job', 'job_message', 'outbox', 'checkin_round', 'followup', 'followup_audit',
    'profile', 'agent_contact', 'job_release'];
  const count = (t: string) => ownerSqlCount(`SELECT * FROM ${t} WHERE incident_id = '${LEAD}'`);
  const reports = () => ['R4', 'R4-ALT', 'R7'].reduce((n, r) => n + ownerSqlCount(`SELECT * FROM route_report WHERE route_id = '${r}'`), 0);
  const built = Object.fromEntries([...leadTables.map(t => [t, count(t)]), ['route_report', reports()]]);
  if (Object.values(built).some(n => n === 0)) fail(`setup did not touch every table: ${JSON.stringify(built)}`);
  const keep = () => ({
    member: ownerSqlCount('SELECT * FROM member'), invite: ownerSqlCount('SELECT * FROM invite'),
    config: ownerSqlCount('SELECT * FROM config'),
  });
  const kept = keep();
  console.log(`before reset: ${JSON.stringify(built)}; ${JSON.stringify(kept)}`);

  // 4. Only the owner can reset, and only a seeded incident.
  const notOwner = await rejects('coordinator reset', () => coord.reducers.resetIncident({ incidentId: LEAD }), /forbidden: owner only/);
  const unknown = await rejects('unknown incident', async () => ownerCall('reset_incident', 'nope-1'), /rejected: no seed for incident nope-1/);
  console.log(`refused: ${notOwner} | ${unknown}`);

  // 5. Reset the lead incident.
  const oldClock = ms(lead.clockAt);
  ownerCall('reset_incident', LEAD);
  await waitFor('reseeded', () => incident(coord) !== undefined && ms(incident(coord).clockAt) > oldClock && coord.db.coordinatorJobs.count() === 0n);
  await sleep(300);
  const after = Object.fromEntries([...leadTables.map(t => [t, count(t)]), ['route_report', reports()]]);
  if (Object.values(after).some(n => n !== 0)) fail(`left behind: ${JSON.stringify(after)}`);
  if (ownerSqlCount(`SELECT * FROM agent_decline WHERE incident_id = '${LEAD}'`) !== 0) fail('declines left behind');
  const clock = ms(incident(coord).clockAt);
  const seedOk =
    rows(coord.db.coordinatorHouseholds.iter()).every(h => h.version === 0 && h.runtimeLowerMin === undefined && h.activeJobId === undefined) &&
    [...rows(coord.db.coordinatorDrivers.iter()), ...rows(coord.db.coordinatorAssets.iter())].every(r => r.activeJobId === undefined && ms(r.freeAt) === clock) &&
    rows(coord.db.coordinatorRoutes.iter()).every(r => r.confirmedDelayMin === 0) &&
    coord.db.coordinatorHouseholds.count() === 2n && coord.db.coordinatorRoutes.count() === 3n &&
    rows(coord.db.coordinatorRegistryStats.iter())[0]?.registrations === 0;
  if (!seedOk) fail('lead incident is not back to its seed');
  if (JSON.stringify(keep()) !== JSON.stringify(kept)) fail(`roles changed: ${JSON.stringify(keep())}`);
  const roles = [coord, bridge, ana, h17].map(c => rows(c.db.myRole.iter())[0]?.role).join(',');
  if (roles !== 'coordinator,bridge,driver,resident') fail(`roles after reset: ${roles}`);
  if (!rows(second.db.coordinatorRoutes.iter()).some(r => r.id === 'FZ-R1' && r.confirmedDelayMin === 5)) fail('second incident was touched');
  console.log(`after reset: ${JSON.stringify(after)}; seed restored, clock re-anchored +${Math.round((clock - oldClock) / 1000)}s`);
  console.log(`kept: ${JSON.stringify(keep())}; roles still ${roles}; second incident untouched (FZ-R1 delay 5)`);

  // 6. Repeatable: the same story, with the same event and request IDs, plays again.
  ownerCall('set_followup_interval', 300);
  await story('tl18-h17-reply', 'tl18-h17-job');
  console.log('replayed the same story with the same IDs after the reset');

  console.log('PASS: TL-18 real-time seed and repeatable reset');
  finish(0);
});
