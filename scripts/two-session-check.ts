// TL-01 acceptance check: two independent sessions, one seeded row change.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl01
import { DbConnection, tables } from '../src/module_bindings';

const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB = process.env.SPACETIMEDB_DB_NAME ?? 'time-left';
const TEXT = 'My backup shows 30-60 minutes left. Can the driver reach the side entrance?';

const open: DbConnection[] = [];

// Close sockets before exiting; exiting with an open socket aborts Node on Windows.
function finish(code: number): never {
  for (const c of open) c.disconnect();
  setTimeout(() => process.exit(code), 200);
  throw new Error('exiting');
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  return finish(1);
}

function within<T>(ms: number, label: string, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ]);
}

function connect(label: string): Promise<DbConnection> {
  return within(10_000, `${label} connect`, new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect((c, identity) => {
        open.push(c);
        console.log(`${label} connected as ${identity.toHexString().slice(0, 12)}…`);
        c.subscriptionBuilder()
          .onApplied(() => resolve(c))
          .onError((_ctx, err) => reject(err))
          .subscribe([tables.incident, tables.household, tables.checkin]);
      })
      .onConnectError((_ctx, err) => reject(err))
      .build();
    void conn;
  }));
}

const h17 = (c: DbConnection) => [...c.db.household.iter()].find(h => h.id === 'H17');

async function main() {
  const a = await connect('session A');
  const b = await connect('session B');
  if (a.identity!.isEqual(b.identity!)) fail('sessions share an identity');

  const before = h17(b) ?? fail('H17 is not seeded');
  if (before.version !== 0) fail(`H17 is at version ${before.version}; reset first (npm run stdb:reset:local)`);
  const incident = [...b.db.incident.iter()].find(i => i.id === before.incidentId) ?? fail('incident missing');

  // B waits for the change through its subscription; it never polls.
  const seenByB = new Promise<void>(resolve => {
    b.db.household.onUpdate((_ctx, _old, row) => {
      if (row.id === 'H17') resolve();
    });
  });

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
  await within(5_000, 'session B sees H17 update', seenByB);

  const after = h17(b)!;
  console.log(
    `session B sees H17 v${after.version}: runtime ${after.runtimeLowerMin}-${after.runtimeUpperMin} min, ` +
      `observed ${after.lastObservedAt?.toDate().toISOString()}, event ${after.lastEventId}`
  );
  if (after.version !== 1 || after.runtimeLowerMin !== 30 || after.runtimeUpperMin !== 60) {
    fail('session B saw the wrong H17 values');
  }

  // Replay of the same event ID must not change anything.
  await a.reducers.ingestCheckin(checkin);
  await new Promise(r => setTimeout(r, 500));
  const checkins = [...b.db.checkin.iter()].filter(c => c.eventId === checkin.eventId).length;
  if (h17(b)!.version !== 1 || checkins !== 1) fail('replayed event changed state');
  console.log('replay of the same eventId: no new effect (H17 still v1, 1 check-in row)');

  // Meaningful failure: an unknown household is rejected.
  let rejected = true;
  try {
    await a.reducers.ingestCheckin({ ...checkin, eventId: 'tl01-bad', householdId: 'H99' });
    rejected = false;
  } catch (err) {
    console.log(`unknown household rejected: ${(err as Error).message}`);
  }
  if (!rejected) fail('unknown household was accepted');

  console.log('PASS: TL-01 two-session subscription check');
  finish(0);
}

main().catch(err => {
  if (err?.message !== 'exiting') fail(String(err?.message ?? err));
});
