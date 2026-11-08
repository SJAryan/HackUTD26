import { schema, table, t, SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';

// TL-01 scaffold. Tables are public so two sessions can prove a subscription
// round trip; TL-05 moves case data to private tables with scoped views.
// All seed data is synthetic.

const incident = table(
  { name: 'incident', public: true },
  {
    id: t.string().primaryKey(),
    kind: t.string(), // 'tornado' | 'freeze'
    name: t.string(),
    clockAt: t.timestamp(), // fixed incident clock for replay
  }
);

const household = table(
  { name: 'household', public: true },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    label: t.string(),
    version: t.u32(), // bumped on every committed change
    // Latest reported backup runtime. Unknown stays unknown (none).
    runtimeLowerMin: t.option(t.u32()),
    runtimeUpperMin: t.option(t.u32()),
    lastObservedAt: t.option(t.timestamp()),
    lastEventId: t.option(t.string()),
  }
);

const asset = table(
  { name: 'asset', public: true },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    kind: t.string(), // 'battery'
    status: t.string(), // 'available'
  }
);

const driver = table(
  { name: 'driver', public: true },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    name: t.string(),
    status: t.string(), // 'available'
  }
);

const checkin = table(
  { name: 'checkin', public: true },
  {
    eventId: t.string().primaryKey(), // stable request/event ID; duplicates are no-ops
    incidentId: t.string(),
    householdId: t.string().index('btree'),
    observedAt: t.timestamp(),
    receivedAt: t.timestamp(),
    text: t.string(),
    runtimeLowerMin: t.option(t.u32()),
    runtimeUpperMin: t.option(t.u32()),
  }
);

const spacetimedb = schema({ incident, household, asset, driver, checkin });
export default spacetimedb;

// Tornado incident clock: 2026-11-08 02:00 America/Chicago (CST) = 08:00 UTC.
const TORNADO_CLOCK = new Timestamp(BigInt(Date.UTC(2026, 10, 8, 8, 0, 0)) * 1000n);

export const init = spacetimedb.init(ctx => {
  const incidentId = 'tornado-1';
  ctx.db.incident.insert({
    id: incidentId,
    kind: 'tornado',
    name: 'Tornado outage (synthetic)',
    clockAt: TORNADO_CLOCK,
  });
  for (const [id, label] of [
    ['H17', 'Household H17 (synthetic)'],
    ['H22', 'Household H22 (synthetic, silent)'],
  ]) {
    ctx.db.household.insert({
      id,
      incidentId,
      label,
      version: 0,
      runtimeLowerMin: undefined,
      runtimeUpperMin: undefined,
      lastObservedAt: undefined,
      lastEventId: undefined,
    });
  }
  ctx.db.asset.insert({ id: 'BAT-01', incidentId, kind: 'battery', status: 'available' });
  ctx.db.driver.insert({ id: 'ana', incidentId, name: 'Ana', status: 'available' });
});

// B -> A contract (TL-08 will restrict this to the bridge identity).
export const ingestCheckin = spacetimedb.reducer(
  {
    eventId: t.string(),
    incidentId: t.string(),
    householdId: t.string(),
    observedAt: t.timestamp(),
    text: t.string(),
    runtimeLowerMin: t.option(t.u32()),
    runtimeUpperMin: t.option(t.u32()),
  },
  (ctx, args) => {
    if (ctx.db.checkin.eventId.find(args.eventId)) return; // replay: no new effect

    const home = ctx.db.household.id.find(args.householdId);
    if (!home || home.incidentId !== args.incidentId) {
      throw new SenderError(`unknown household ${args.householdId} in ${args.incidentId}`);
    }
    if (
      args.runtimeLowerMin !== undefined &&
      args.runtimeUpperMin !== undefined &&
      args.runtimeLowerMin > args.runtimeUpperMin
    ) {
      throw new SenderError('runtimeLowerMin exceeds runtimeUpperMin');
    }

    ctx.db.checkin.insert({
      eventId: args.eventId,
      incidentId: args.incidentId,
      householdId: args.householdId,
      observedAt: args.observedAt,
      receivedAt: ctx.timestamp,
      text: args.text,
      runtimeLowerMin: args.runtimeLowerMin,
      runtimeUpperMin: args.runtimeUpperMin,
    });

    // An older report stays in the timeline but does not replace newer evidence.
    const newer =
      !home.lastObservedAt ||
      args.observedAt.microsSinceUnixEpoch > home.lastObservedAt.microsSinceUnixEpoch;
    if (newer) {
      ctx.db.household.id.update({
        ...home,
        version: home.version + 1,
        runtimeLowerMin: args.runtimeLowerMin,
        runtimeUpperMin: args.runtimeUpperMin,
        lastObservedAt: args.observedAt,
        lastEventId: args.eventId,
      });
    }
  }
);
