// TL-14 acceptance check (A side): a silent check-in round queues one voice call intent for the
// bridge, the bridge records the outcome, and the follow-up (and its owner) is unchanged.
// A recorded call or a verified reply removes the intent; escalations never queue another;
// coordinators see the outcome; resetIncident clears it. Uses a 2-second interval and restores 300.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl14
import { tables } from '../src/module_bindings';
import { connect, connectAs, fail, finish, ownerCall, rejects, run, sleep, waitFor } from './lib';

const INCIDENT = 'tornado-1';
const INTERVAL_SEC = 2;
const KEY = 'round:tl14-H17-r1:household:H17:call';

run(async () => {
  const coord = await connectAs('coordinator', 'coordinator', INCIDENT, '', [
    tables.myIncident, tables.coordinatorRounds, tables.coordinatorFollowups, tables.coordinatorFollowupAudit,
    tables.coordinatorCallAttempts, tables.coordinatorJobs,
  ]);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole, tables.bridgeOutbox]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', [tables.coordinatorCallAttempts]);
  const outsider = await connect('outsider', [tables.bridgeOutbox, tables.coordinatorCallAttempts]);
  if (coord.db.coordinatorRounds.count() !== 0n || coord.db.coordinatorJobs.count() !== 0n) fail('reset first (npm run stdb:reset:local)');

  ownerCall('set_followup_interval', INTERVAL_SEC);
  const intents = () => [...bridge.db.bridgeOutbox.iter()];
  const fups = () => [...coord.db.coordinatorFollowups.iter()];
  const fup = (h: string) => fups().find(f => f.householdId === h)!;
  const round = (h: string) => [...coord.db.coordinatorRounds.iter()].find(r => r.householdId === h)!;
  const attempts = () => [...coord.db.coordinatorCallAttempts.iter()];

  // 1. H17's round goes silent: exactly one call intent, addressed to the household.
  await coord.reducers.openCheckinRound({ roundKey: 'tl14-H17-r1', incidentId: INCIDENT, householdId: 'H17' });
  await waitFor('H17 silent with a follow-up', () => round('H17')?.status === 'silent' && !!fup('H17'), 15_000);
  await waitFor('call intent', () => intents().length === 1);
  const call = intents()[0];
  if (call.key !== KEY || call.purpose !== 'call' || call.recipient !== 'household:H17' || call.jobId !== 0n) {
    fail(`unexpected intent ${call.key} ${call.purpose} ${call.recipient} job ${call.jobId}`);
  }
  if (outsider.db.bridgeOutbox.count() !== 0n) fail('a no-role session sees the call intent');
  const before = fup('H17');
  console.log(`H17 silent: bridge sees ${call.key} (purpose ${call.purpose}, ${call.recipient})`);

  // 2. Rejections store nothing.
  const coordCall = await rejects('coordinator records a call', () =>
    coord.reducers.recordCallAttempt({ key: KEY, outcome: 'no-answer' }), /^forbidden/);
  const badOutcome = await rejects('bad outcome', () =>
    bridge.reducers.recordCallAttempt({ key: KEY, outcome: 'voicemail' }), /^rejected: outcome must be/);
  const unknown = await rejects('unknown key', () =>
    bridge.reducers.recordCallAttempt({ key: 'round:nope:household:H17:call', outcome: 'busy' }), /^unknown call intent/);
  if (attempts().length !== 0) fail('a rejected call stored an attempt');
  console.log(`rejected: ${coordCall} | ${badOutcome} | ${unknown}`);

  // 3. The bridge records no-answer (a retry adds nothing; a different outcome conflicts).
  await bridge.reducers.recordCallAttempt({ key: KEY, outcome: 'no-answer' });
  await bridge.reducers.recordCallAttempt({ key: KEY, outcome: 'no-answer' });
  const changed = await rejects('different outcome', () =>
    bridge.reducers.recordCallAttempt({ key: KEY, outcome: 'answered' }), /^conflict: .* already recorded no-answer$/);
  await waitFor('coordinator sees the attempt', () => attempts().length === 1);
  await waitFor('intent gone after the call', () => intents().length === 0);
  const a = attempts()[0];
  if (a.followupId !== before.id || a.outcome !== 'no-answer' || a.householdId !== 'H17') fail(`unexpected attempt ${a.key} ${a.outcome}`);
  const after = fup('H17');
  if (!after.owner.isEqual(before.owner) || after.status !== before.status || after.version !== before.version) {
    fail('recording a call changed the follow-up');
  }
  const trail = [...coord.db.coordinatorFollowupAudit.iter()].filter(x => x.followupId === before.id).map(x => x.action);
  if (!trail.includes('call')) fail(`no call entry in the audit trail: ${trail.join()}`);
  if (h17.db.coordinatorCallAttempts.count() + outsider.db.coordinatorCallAttempts.count() !== 0n) fail('call attempts visible outside coordinators');
  console.log(`bridge recorded no-answer (retry no-op; ${changed}); follow-up #${after.id} still ${after.status}, same owner; audit ${trail.join(' -> ')}`);

  // 4. Escalation never queues another call.
  await waitFor('escalated', () => fup('H17').escalationLevel >= 1, 15_000);
  await sleep(500);
  if (intents().length !== 0) fail('escalation queued another call');
  console.log(`escalation level ${fup('H17').escalationLevel}: no new call intent`);

  // 5. A verified reply before the call removes the intent without an attempt.
  await coord.reducers.openCheckinRound({ roundKey: 'tl14-H22-r1', incidentId: INCIDENT, householdId: 'H22' });
  await waitFor('H22 call intent', () => intents().some(r => r.recipient === 'household:H22'), 15_000);
  const incident = [...coord.db.myIncident.iter()][0];
  await bridge.reducers.ingestCheckin({
    eventId: 'tl14-h22-reply', incidentId: INCIDENT, householdId: 'H22', observedAt: incident.clockAt,
    text: 'Sorry, missed it. About 2 hours left.', runtimeLowerMin: 120,
  });
  await waitFor('H22 intent gone after a reply', () => intents().length === 0 && round('H22').status === 'answered');
  console.log('H22 replied before the call: intent gone, no attempt recorded');

  // 6. Reset clears attempts and intents; restore the default interval.
  ownerCall('reset_incident', INCIDENT);
  await waitFor('attempts cleared', () => attempts().length === 0 && intents().length === 0);
  ownerCall('set_followup_interval', 300);
  console.log('resetIncident: call attempts cleared; interval back to 300s');

  console.log('PASS: TL-14 call intent and attempt');
  finish(0);
});
