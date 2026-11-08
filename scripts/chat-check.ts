// TL-06 acceptance check: assignment-scoped two-way messages.
// Both parties see ordered replies without refresh, reconnect restores history, a repeated
// send appears once, and an unrelated household cannot read or write the thread.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl06
import { tables } from '../src/module_bindings';
import { connect, connectAs, fail, finish, rejects, run, sleep, tokenOf, waitFor } from './lib';

const INCIDENT = 'tornado-1';
type Conn = Awaited<ReturnType<typeof connect>>;

run(async () => {
  const thread = [tables.jobMessages];
  const coord = await connectAs('coordinator', 'coordinator', INCIDENT, '', [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorJobs, ...thread,
  ]);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', [tables.residentJobs, ...thread]);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [tables.driverJobs, ...thread]);
  const h22 = await connectAs('resident H22', 'resident', INCIDENT, 'H22', [tables.residentJobs, ...thread]);
  const ben = await connectAs('driver Ben', 'driver', INCIDENT, 'ben', [tables.driverJobs, ...thread]);
  if (coord.db.coordinatorJobs.count() !== 0n) fail('reset first (npm run stdb:reset:local)');

  // Setup through TL-05: H17's 02:00 check-in, then the coordinator assigns Ana via R4-ALT.
  const incident = [...coord.db.myIncident.iter()][0];
  await bridge.reducers.ingestCheckin({
    eventId: 'tl01-h17-0200', incidentId: INCIDENT, householdId: 'H17', observedAt: incident.clockAt,
    text: 'My backup shows 30-60 minutes left. Can the driver reach the side entrance?',
    runtimeLowerMin: 30, runtimeUpperMin: 60,
  });
  await waitFor('H17 v1', () => [...coord.db.coordinatorHouseholds.iter()].some(h => h.id === 'H17' && h.version === 1));
  await coord.reducers.reserve({
    jobRequestId: 'tl06-h17', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 1,
  });
  await waitFor('resident and driver see the job', () => h17.db.residentJobs.count() === 1n && ana.db.driverJobs.count() === 1n);
  const job = () => [...h17.db.residentJobs.iter()][0];
  const jobId = job().id;
  console.log(`job #${jobId}: H17 <- Ana via R4-ALT (setup from TL-05)`);

  const lines = (c: Conn) =>
    [...c.db.jobMessages.iter()]
      .filter(m => m.jobId === jobId)
      .sort((a, b) => a.seq - b.seq)
      .map(m => `${m.seq}. [${m.kind}] ${m.senderLabel}: ${m.text}`);

  // 1. Resident asks; the driver sees it without refreshing. The driver replies.
  const ask = { jobId, clientMessageId: 'h17-msg-1', text: 'Can you use the side entrance?' };
  await h17.reducers.postJobMessage(ask);
  await waitFor('driver sees the question', () => lines(ana).length === 1);
  await ana.reducers.postJobMessage({ jobId, clientMessageId: 'ana-msg-1', text: "Yes, I'll meet you there." });
  await waitFor('resident sees the reply', () => lines(h17).length === 2);
  if (lines(h17).join() !== lines(ana).join()) fail('resident and driver see different threads');
  console.log('both parties see, in order:');
  for (const l of lines(h17)) console.log(`  ${l}`);

  // 2. A repeated send with the same clientMessageId appears once.
  await h17.reducers.postJobMessage(ask);
  await sleep(500);
  if (lines(ana).length !== 2) fail('repeated send created a second message');
  console.log('repeated send of h17-msg-1: still 2 messages');

  // 3. An unrelated household and an unrelated driver can neither read nor write.
  for (const [label, conn] of [['resident H22', h22], ['driver Ben', ben]] as const) {
    const msg = await rejects(`${label} post`, () =>
      conn.reducers.postJobMessage({ jobId, clientMessageId: `${label}-x`, text: 'hello?' }), /forbidden/);
    if (conn.db.jobMessages.count() !== 0n) fail(`${label} can read the thread`);
    console.log(`${label}: ${msg}; sees 0 messages`);
  }

  // 4. Arrival and confirmation are distinct, versioned events.
  const wrongRole = await rejects('resident marks arrived', () =>
    h17.reducers.updateJob({ jobId, expectedVersion: 1, status: 'arrived' }), /forbidden: only the driver/);
  console.log(`resident marks arrived: ${wrongRole}`);
  await ana.reducers.updateJob({ jobId, expectedVersion: 1, status: 'arrived' });
  await waitFor('resident sees arrived', () => job().status === 'arrived' && lines(h17).length === 3);
  const stale = await rejects('stale confirm', () =>
    h17.reducers.updateJob({ jobId, expectedVersion: 1, status: 'delivered' }), /conflict: job \d+ is at version 2/);
  console.log(`confirm with stale version: ${stale}`);
  const replayed = await rejects('delayed ARRIVED', () =>
    ana.reducers.updateJob({ jobId, expectedVersion: 1, status: 'arrived' }), /conflict/);
  console.log(`delayed duplicate ARRIVED: ${replayed}`);
  await h17.reducers.updateJob({ jobId, expectedVersion: 2, status: 'delivered' });
  await waitFor('driver sees delivered', () => lines(ana).length === 4);
  if (job().status !== 'delivered' || job().version !== 3) fail(`job is ${job().status} v${job().version}`);
  console.log(`job #${jobId}: assigned v1 -> arrived v2 (Ana) -> delivered v3 (H17)`);

  // 5. Reconnect as the same resident: the full history comes back in order.
  const before = lines(h17).join('\n');
  const token = tokenOf(h17);
  h17.disconnect();
  const again = await connect('resident H17 again', [tables.residentJobs, ...thread], token);
  if (!again.identity!.isEqual(h17.identity!)) fail('reconnected with a different identity');
  await waitFor('history restored', () => lines(again).length === 4);
  if (lines(again).join('\n') !== before) fail('history differs after reconnect');
  if (lines(coord).join('\n') !== before) fail('coordinator sees a different thread');
  console.log('after reconnect, resident H17 sees:');
  for (const l of lines(again)) console.log(`  ${l}`);

  console.log('PASS: TL-06 job thread');
  finish(0);
});
