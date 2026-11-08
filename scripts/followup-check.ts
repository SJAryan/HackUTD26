// TL-11 acceptance check (A side) plus TL-05's deferred release.
// A round that falls due without a verified reply goes Silent and gets a follow-up with an
// owner and due time; it keeps the last evidence, stays visible through escalation, can be
// claimed (audited), and a verified reply cancels it. After delivery, releaseJob frees the
// battery and driver. Uses a 2-second interval and restores the default 300 at the end.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl11
import { tables } from '../src/module_bindings';
import { connect, connectAs, fail, finish, ownerCall, rejects, run, sleep, waitFor } from './lib';

const INCIDENT = 'tornado-1';
const INTERVAL_SEC = 2;
const hex = (id: { toHexString(): string }) => id.toHexString().slice(0, 12);

run(async () => {
  const board = [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorJobs, tables.coordinatorAssets,
    tables.coordinatorDrivers, tables.coordinatorRounds, tables.coordinatorFollowups, tables.coordinatorFollowupAudit,
  ];
  const c1 = await connectAs('coordinator 1', 'coordinator', INCIDENT, '', board);
  const c2 = await connectAs('coordinator 2', 'coordinator', INCIDENT, '', board);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole]);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [tables.driverJobs, tables.coordinatorFollowups]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', [tables.residentJobs, tables.coordinatorFollowups]);
  const outsider = await connect('outsider', [tables.coordinatorRounds, tables.coordinatorFollowups, tables.coordinatorFollowupAudit]);
  if (c1.db.coordinatorRounds.count() !== 0n || c1.db.coordinatorJobs.count() !== 0n) fail('reset first (npm run stdb:reset:local)');

  ownerCall('set_followup_interval', INTERVAL_SEC);
  console.log(`owner set the follow-up interval to ${INTERVAL_SEC}s (default 300s)`);
  const incident = [...c1.db.myIncident.iter()][0];
  const checkin = (eventId: string, householdId: string, text: string, lo?: number, hi?: number) =>
    bridge.reducers.ingestCheckin({
      eventId, incidentId: INCIDENT, householdId, observedAt: incident.clockAt, text,
      runtimeLowerMin: lo, runtimeUpperMin: hi,
    });

  // Earlier evidence for H22 (before outreach): it has no runtime. It must stay visible.
  await checkin('tl11-h22-early', 'H22', 'Power is out. Not sure how long the battery lasts.');

  // 1. Coordinator 1 opens rounds for H17 and H22. Retries are no-ops; a second round conflicts.
  for (const h of ['H17', 'H22']) {
    await c1.reducers.openCheckinRound({ roundKey: `tl11-${h}-r1`, incidentId: INCIDENT, householdId: h });
  }
  await c1.reducers.openCheckinRound({ roundKey: 'tl11-H22-r1', incidentId: INCIDENT, householdId: 'H22' });
  const dup = await rejects('second round', () =>
    c1.reducers.openCheckinRound({ roundKey: 'tl11-H22-r2', incidentId: INCIDENT, householdId: 'H22' }), /conflict: H22 already has round/);
  const rounds = () => [...c1.db.coordinatorRounds.iter()];
  const round = (h: string) => rounds().find(r => r.householdId === h)!;
  await waitFor('two rounds', () => rounds().length === 2);
  console.log(`rounds opened for H17 and H22 (retry added nothing); ${dup}`);

  // 2. H17 replies before the due time: its round closes at once, with no follow-up.
  await checkin('tl11-h17-reply', 'H17', 'Battery shows 30-60 minutes left.', 30, 60);
  await waitFor('H17 answered', () => round('H17').status === 'answered');
  console.log(`H17 replied: round ${round('H17').id} answered by ${round('H17').answeredEventId}`);

  // 3. H22 stays silent: the sweep marks it Silent and creates a follow-up owned by coordinator 1.
  const fups = () => [...c1.db.coordinatorFollowups.iter()];
  await waitFor('H22 silent with a follow-up', () => round('H22').status === 'silent' && fups().length === 1, 15_000);
  let f = fups()[0];
  if (!f.owner.isEqual(c1.identity!)) fail('follow-up owner is not the coordinator who opened the round');
  if (f.lastEventId !== 'tl11-h22-early' || f.runtimeLowerMin !== undefined) fail('last evidence not kept');
  if (fups().some(x => x.householdId === 'H17')) fail('answered H17 got a follow-up');
  console.log(
    `H22 silent: follow-up #${f.id} owner coordinator 1 (${hex(f.owner)}), due ${f.dueAt.toDate().toISOString()}, ` +
      `last evidence ${f.lastEventId} (runtime unknown)`
  );

  // 4. Still unanswered past the callback due time: escalates, keeps its owner, stays visible.
  const firstDue = f.dueAt.microsSinceUnixEpoch;
  await waitFor('escalated', () => fups()[0].escalationLevel >= 1, 15_000);
  f = fups()[0];
  if (!f.owner.isEqual(c1.identity!) || f.dueAt.microsSinceUnixEpoch <= firstDue || f.status !== 'open') {
    fail('escalation changed the owner or did not move the due time');
  }
  console.log(`H22 still silent: escalation level ${f.escalationLevel}, owner unchanged, due moved later`);

  // 5. Claiming: stale version conflicts; coordinator 2 claims; outsiders and residents cannot.
  const stale = await rejects('stale claim', () =>
    c2.reducers.claimFollowup({ followupId: f.id, expectedVersion: f.version + 5 }), /conflict: followup \d+ is at version/);
  const outsiderClaim = await rejects('outsider claim', () =>
    outsider.reducers.claimFollowup({ followupId: f.id, expectedVersion: f.version }), /forbidden/);
  await c2.reducers.claimFollowup({ followupId: f.id, expectedVersion: f.version });
  await c2.reducers.claimFollowup({ followupId: f.id, expectedVersion: f.version }); // retry
  await waitFor('claimed by coordinator 2', () => fups()[0].status === 'claimed' && fups()[0].owner.isEqual(c2.identity!));
  console.log(`claim: ${stale} | ${outsiderClaim} | coordinator 2 claimed (retry added nothing)`);

  // 6. A verified reply cancels the obsolete escalation; later sweeps leave it alone.
  await checkin('tl11-h22-reply', 'H22', 'Sorry, I was asleep. About 2 hours left.', 120);
  await waitFor('cancelled', () => fups()[0].status === 'cancelled' && round('H22').status === 'answered');
  const level = fups()[0].escalationLevel;
  await sleep((INTERVAL_SEC + 2) * 1000);
  if (fups()[0].escalationLevel !== level || fups()[0].status !== 'cancelled') fail('a cancelled follow-up escalated');
  const lateClaim = await rejects('claim after cancel', () =>
    c1.reducers.claimFollowup({ followupId: f.id, expectedVersion: fups()[0].version }), /cancelled by a verified reply/);
  console.log(`H22 replied: follow-up cancelled, round answered; no escalation after ${INTERVAL_SEC + 2}s; ${lateClaim}`);

  // 7. Audit trail and privacy.
  const trail = [...c1.db.coordinatorFollowupAudit.iter()].sort((a, b) => Number(a.id - b.id)).map(a => a.action);
  const expected = ['created', 'escalated', 'claimed', 'cancelled'];
  if (trail[0] !== 'created' || !expected.every(x => trail.includes(x)) || trail.at(-1) !== 'cancelled') {
    fail(`unexpected audit trail ${trail.join(', ')}`);
  }
  const leak = outsider.db.coordinatorRounds.count() + outsider.db.coordinatorFollowups.count() +
    outsider.db.coordinatorFollowupAudit.count() + ana.db.coordinatorFollowups.count() + h17.db.coordinatorFollowups.count();
  if (leak !== 0n) fail('rounds or follow-ups visible outside coordinators');
  // Even the owner cannot trigger the sweep by hand; only the schedule can.
  const sweep = await rejects('manual sweep', async () =>
    ownerCall('sweep_followups', { scheduled_id: 0, scheduled_at: { Interval: { __time_duration_micros__: 1_000_000 } } }),
    /^forbidden: runs on schedule only$/);
  console.log(`audit: ${trail.join(' -> ')}; drivers, residents and outsiders see none`);
  console.log(`owner calling the sweep directly: ${sweep}`);

  // 8. TL-05 deferred: release after delivery frees the battery and driver for the next household.
  const h17v = [...c1.db.coordinatorHouseholds.iter()].find(h => h.id === 'H17')!.version;
  await c1.reducers.reserve({
    jobRequestId: 'tl11-h17-job', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: h17v,
  });
  await waitFor('Ana has the job', () => ana.db.driverJobs.count() === 1n);
  const job = () => [...ana.db.driverJobs.iter()][0];
  const early = await rejects('release before delivery', () =>
    c1.reducers.releaseJob({ jobId: job().id, expectedVersion: job().version }), /conflict: job \d+ is assigned, not delivered/);
  await ana.reducers.updateJob({ jobId: job().id, expectedVersion: 1, status: 'arrived' });
  await waitFor('arrived', () => job().status === 'arrived');
  await h17.reducers.updateJob({ jobId: job().id, expectedVersion: 2, status: 'delivered' });
  await waitFor('delivered', () => job().status === 'delivered');
  const staleRelease = await rejects('stale release', () =>
    c1.reducers.releaseJob({ jobId: job().id, expectedVersion: 1 }), /conflict: job \d+ is at version 3/);
  await c1.reducers.releaseJob({ jobId: job().id, expectedVersion: 3 });
  await c1.reducers.releaseJob({ jobId: job().id, expectedVersion: 3 }); // retry
  const freed = () =>
    [...c1.db.coordinatorAssets.iter()].find(a => a.id === 'BAT-01')!.activeJobId === undefined &&
    [...c1.db.coordinatorDrivers.iter()].find(d => d.id === 'ana')!.activeJobId === undefined;
  await waitFor('battery and driver free', freed);
  if (job().status !== 'delivered') fail('release changed the job status');
  console.log(`release: ${early} | ${staleRelease} | after delivery BAT-01 and Ana are free (retry added nothing); job stays delivered`);

  const h22v = [...c1.db.coordinatorHouseholds.iter()].find(h => h.id === 'H22')!.version;
  await c2.reducers.reserve({
    jobRequestId: 'tl11-h22-job', caseId: 'H22', routeId: 'R7', assetId: 'BAT-01', driverId: 'ben', expectedVersion: h22v,
  });
  await waitFor('second job', () => c1.db.coordinatorJobs.count() === 2n);
  console.log('the released BAT-01 is reserved for H22 via R7 (Ben)');

  ownerCall('set_followup_interval', 300);
  console.log('PASS: TL-11 follow-ups and release');
  finish(0);
});
