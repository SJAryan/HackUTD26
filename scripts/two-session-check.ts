// TL-01 acceptance check: two independent sessions, one seeded row change.
// Since TL-05 the tables are private, so session A is the bridge role and session B a
// coordinator reading its view.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl01
import { tables } from '../src/module_bindings';
import { connect, connectAs, fail, finish, rejects, run, sleep, waitFor } from './lib';

const TEXT = 'My backup shows 30-60 minutes left. Can the driver reach the side entrance?';

run(async () => {
  const queries = [tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorCheckins, tables.bridgeCheckins];
  const a = await connectAs('session A', 'bridge', 'tornado-1', '', queries);
  const b = await connectAs('session B', 'coordinator', 'tornado-1', '', queries);
  if (a.identity!.isEqual(b.identity!)) fail('sessions share an identity');

  const h17 = () => [...b.db.coordinatorHouseholds.iter()].find(h => h.id === 'H17');
  const before = h17() ?? fail('H17 is not visible to the coordinator');
  if (before.version !== 0) fail(`H17 is at version ${before.version}; reset first (npm run stdb:reset:local)`);
  const incident = [...b.db.myIncident.iter()][0] ?? fail('incident missing');

  const checkin = {
    eventId: 'tl01-h17-0200',
    incidentId: incident.id,
    householdId: 'H17',
    observedAt: incident.clockAt, // 02:00 on the fixed incident clock
    text: TEXT,
    runtimeLowerMin: 30,
    runtimeUpperMin: 60,
  };
  console.log(`session A calls ingestCheckin(${checkin.eventId}) for H17: "30-60 minutes"`);
  await a.reducers.ingestCheckin(checkin);
  // B's cache changes only through its subscription; it never queries the server.
  await waitFor('session B sees H17 update', () => h17()?.version === 1);

  const after = h17()!;
  console.log(
    `session B sees H17 v${after.version}: runtime ${after.runtimeLowerMin}-${after.runtimeUpperMin} min, ` +
      `observed ${after.lastObservedAt?.toDate().toISOString()}, event ${after.lastEventId}`
  );
  if (after.version !== 1 || after.runtimeLowerMin !== 30 || after.runtimeUpperMin !== 60) {
    fail('session B saw the wrong H17 values');
  }

  // The bridge confirms its own write through bridge_checkins; it cannot read households.
  const receipts = () => [...a.db.bridgeCheckins.iter()].filter(c => c.eventId === checkin.eventId);
  await waitFor('bridge sees its receipt', () => receipts().length === 1);
  const r = receipts()[0];
  if (r.householdId !== 'H17' || r.runtimeLowerMin !== 30 || r.runtimeUpperMin !== 60) fail('wrong receipt');
  if (a.db.coordinatorHouseholds.count() !== 0n || b.db.bridgeCheckins.count() !== 0n) {
    fail('bridge and coordinator views leak across roles');
  }
  console.log(
    `session A (bridge) sees receipt ${r.eventId}: ${r.householdId} ${r.runtimeLowerMin}-${r.runtimeUpperMin} min, ` +
      `received ${r.receivedAt.toDate().toISOString()}; it sees 0 households, the coordinator sees 0 receipts`
  );

  // Replay of the same event ID must not change anything.
  await a.reducers.ingestCheckin(checkin);
  await sleep(500);
  const checkins = [...b.db.coordinatorCheckins.iter()].filter(c => c.eventId === checkin.eventId).length;
  if (h17()!.version !== 1 || checkins !== 1 || receipts().length !== 1) fail('replayed event changed state');
  console.log('replay of the same eventId: no new effect (H17 still v1, 1 check-in row, 1 receipt)');

  const msg = await rejects('unknown household', () =>
    a.reducers.ingestCheckin({ ...checkin, eventId: 'tl01-bad', householdId: 'H99' }), /unknown household/);
  console.log(`unknown household rejected: ${msg}`);

  const outsider = await connect('outsider', queries);
  const denied = await rejects('outsider check-in', () =>
    outsider.reducers.ingestCheckin({ ...checkin, eventId: 'tl01-outsider' }), /forbidden/);
  if (outsider.db.coordinatorHouseholds.count() + outsider.db.bridgeCheckins.count() !== 0n) {
    fail('outsider can read households or receipts');
  }
  console.log(`session without a role: ${denied}; sees 0 households and 0 receipts`);

  console.log('PASS: TL-01 two-session subscription check');
  finish(0);
});
