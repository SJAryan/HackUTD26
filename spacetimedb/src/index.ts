import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { readyAt } from './rules';
import type { ConfirmedNeed, NeedSuggestion } from './domain/suggest';

// TL-05: private state, role-scoped views and atomic dispatch. All seed data is synthetic.
// Tables are private; clients read through the views at the bottom of this file.

const config = table(
  { name: 'config' },
  {
    id: t.u32().primaryKey(), // always 0
    owner: t.identity(), // publisher; the only identity that can create invites
  }
);

// Single-use role invites. Codes are created at runtime by the owner and never committed.
const invite = table(
  { name: 'invite' },
  {
    code: t.string().primaryKey(),
    role: t.string(), // 'coordinator' | 'driver' | 'resident' | 'bridge'
    incidentId: t.string(),
    subjectId: t.string(), // driverId for drivers, householdId for residents, '' otherwise
  }
);

const member = table(
  { name: 'member' },
  {
    identity: t.identity().primaryKey(),
    role: t.string(),
    incidentId: t.string(),
    subjectId: t.string(),
  }
);

const incident = table(
  { name: 'incident' },
  {
    id: t.string().primaryKey(),
    kind: t.string(), // 'tornado' | 'freeze'
    name: t.string(),
    clockAt: t.timestamp(), // fixed incident clock for replay
  }
);

const household = table(
  { name: 'household' },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    label: t.string(),
    need: t.string(), // resource kind, e.g. 'battery'
    version: t.u32(), // bumped on every committed change; reserve checks it
    // Latest reported backup runtime. Unknown stays unknown (none).
    runtimeLowerMin: t.option(t.u32()),
    runtimeUpperMin: t.option(t.u32()),
    lastObservedAt: t.option(t.timestamp()),
    lastEventId: t.option(t.string()),
    activeJobId: t.option(t.u64()),
  }
);

const asset = table(
  { name: 'asset' },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    kind: t.string(),
    freeAt: t.timestamp(),
    activeJobId: t.option(t.u64()), // held until a return or release event
  }
);

const driver = table(
  { name: 'driver' },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    name: t.string(),
    freeAt: t.timestamp(),
    activeJobId: t.option(t.u64()),
  }
);

// Travel legs for one driver + asset + household combination (C's DispatchOption).
const route = table(
  { name: 'route' },
  {
    id: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    householdId: t.string(),
    driverId: t.string(),
    assetId: t.string(),
    driverToAssetMin: t.u32(),
    pickupMin: t.u32(),
    assetToHomeMin: t.u32(),
    setupMin: t.u32(),
    confirmedDelayMin: t.u32(), // set only by a coordinator-confirmed report
  }
);

const routeReport = table(
  { name: 'route_report' },
  {
    reportId: t.string().primaryKey(), // duplicates are no-ops
    routeId: t.string(),
    delayMin: t.u32(),
    confirmedBy: t.identity(),
    confirmedAt: t.timestamp(),
  }
);

const checkin = table(
  { name: 'checkin' },
  {
    eventId: t.string().primaryKey(), // stable request/event ID; duplicates are no-ops
    incidentId: t.string().index('btree'),
    householdId: t.string(),
    observedAt: t.timestamp(),
    receivedAt: t.timestamp(),
    text: t.string(),
    runtimeLowerMin: t.option(t.u32()),
    runtimeUpperMin: t.option(t.u32()),
  }
);

const job = table(
  { name: 'job' },
  {
    id: t.u64().primaryKey().autoInc(),
    requestId: t.string().unique(), // jobRequestId from the client; a replay is a no-op
    incidentId: t.string().index('btree'),
    householdId: t.string().index('btree'),
    routeId: t.string(),
    driverId: t.string().index('btree'),
    assetId: t.string(),
    version: t.u32(), // bumped on every status change; updateJob checks it
    status: t.string(), // 'assigned' -> 'arrived' (driver) -> 'delivered' (resident)
    etaAt: t.timestamp(), // ready-at from the dispatch rules at commit time
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

// Post-commit notification intents. B's worker sends them (TL-08).
const outbox = table(
  { name: 'outbox' },
  {
    key: t.string().primaryKey(), // job:<id>:v<version>:<recipient>:<purpose>
    incidentId: t.string().index('btree'),
    jobId: t.u64(),
    jobVersion: t.u32(),
    recipient: t.string(), // 'household:H17' | 'driver:ana'
    purpose: t.string(), // 'eta' | 'assignment'
    body: t.string(),
    status: t.string(), // 'pending'
    createdAt: t.timestamp(),
  }
);

// The job thread: chat text plus arrival/confirmation events, in one ordered timeline.
const jobMessage = table(
  { name: 'job_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    // `${jobId}:${sender identity}:${clientMessageId}`; a repeated send is a no-op.
    dedupeKey: t.string().unique(),
    incidentId: t.string().index('btree'),
    jobId: t.u64().index('btree'),
    seq: t.u32(), // 1, 2, 3... per job; order by this, not by id
    kind: t.string(), // 'text' | 'arrived' | 'delivered'
    senderRole: t.string(), // 'resident' | 'driver'
    senderLabel: t.string(), // driver name or household ID, for display
    senderIdentity: t.identity(),
    clientMessageId: t.string(),
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

// TL-09: free preparedness profile, one per household, created before the incident.
// Synthetic details only in the demo. Dispatch never reads this table.
const profile = table(
  { name: 'profile' },
  {
    householdId: t.string().primaryKey(),
    enrollmentId: t.string().unique(), // stable request ID; a retry is a no-op
    incidentId: t.string().index('btree'),
    identity: t.identity(), // the resident session that enrolled
    medicalNeed: t.string(), // 'home_oxygen' | 'dialysis' | 'no_heat'
    backupDevice: t.string(), // e.g. 'oxygen concentrator battery'
    address: t.string(),
    preferredContact: t.string(), // 'imessage' | 'phone_call'
    enrolledAt: t.timestamp(),
  }
);

// TL-09: a consented request for a State Farm agent to follow up about coverage.
// A prototype lead, not a sale. One per household; dispatch never reads this table.
const agentContact = table(
  { name: 'agent_contact' },
  {
    id: t.u64().primaryKey().autoInc(), // shown to the resident as lead L-<id>
    consentId: t.string().unique(), // stable per consent click; a retry is a no-op
    householdId: t.string().unique(),
    incidentId: t.string().index('btree'),
    identity: t.identity(),
    jobId: t.u64(), // the delivered job the offer followed
    preferredContact: t.string(), // copied from the profile at consent time
    consentedAt: t.timestamp(),
  }
);

// TL-09: a resident's "Skip" on the agent offer. Final: after it, no lead can be created.
// Kept apart from agent_contact so skips never change opt-in counts.
const agentDecline = table(
  { name: 'agent_decline' },
  {
    householdId: t.string().primaryKey(),
    incidentId: t.string().index('btree'),
    identity: t.identity(),
    declinedAt: t.timestamp(),
  }
);

// TL-15: a need the resident confirmed (or corrected) from a policy-based suggestion.
// Stores only the need, never the policy signals, sources or confidence behind it.
// Skip stores nothing. Dispatch never reads this table; household.need is unchanged.
const confirmedNeed = table(
  { name: 'confirmed_need' },
  {
    householdId: t.string().primaryKey(),
    confirmationId: t.string().unique(), // stable per confirm click; a retry is a no-op
    incidentId: t.string().index('btree'),
    needId: t.string(), // NeedSuggestion['id']: 'powered_equipment' | 'step_free_access'
    dispatchNeed: t.option(t.string()), // resource kind; none for step-free access
    confirmedAt: t.timestamp(),
  }
);

// ---- TL-11: check-in rounds, silent follow-ups and callback ownership ----

// One outreach round per household at a time. Silent when due without a verified reply.
const checkinRound = table(
  { name: 'checkin_round' },
  {
    id: t.u64().primaryKey().autoInc(),
    roundKey: t.string().unique(), // stable request ID; a retry is a no-op
    incidentId: t.string().index('btree'),
    householdId: t.string().index('btree'),
    status: t.string().index('btree'), // 'open' -> 'answered' | 'silent' -> 'answered'
    openedBy: t.identity(), // the coordinator who started outreach; default callback owner
    openedAt: t.timestamp(),
    dueAt: t.timestamp(),
    answeredEventId: t.option(t.string()),
    closedAt: t.option(t.timestamp()),
  }
);

// A callback task for a silent household. It always has a responsible owner.
const followup = table(
  { name: 'followup' },
  {
    id: t.u64().primaryKey().autoInc(),
    roundId: t.u64().unique(),
    incidentId: t.string().index('btree'),
    householdId: t.string(),
    status: t.string().index('btree'), // 'open' | 'claimed' | 'cancelled'
    owner: t.identity(),
    dueAt: t.timestamp(),
    escalationLevel: t.u32(), // bumped each time the callback passes its due time unanswered
    version: t.u32(), // claimFollowup checks it
    // Last evidence at the time the household went silent; unknown stays unknown.
    lastEventId: t.option(t.string()),
    lastObservedAt: t.option(t.timestamp()),
    runtimeLowerMin: t.option(t.u32()),
    runtimeUpperMin: t.option(t.u32()),
    createdAt: t.timestamp(),
  }
);

const followupAudit = table(
  { name: 'followup_audit' },
  {
    id: t.u64().primaryKey().autoInc(),
    followupId: t.u64().index('btree'),
    incidentId: t.string().index('btree'),
    action: t.string(), // 'created' | 'escalated' | 'claimed' | 'cancelled'
    actor: t.option(t.identity()), // none for the scheduled sweep
    owner: t.identity(), // owner after the action
    note: t.string(),
    at: t.timestamp(),
  }
);

// Demo-configurable follow-up interval (seconds). Rounds and callbacks fall due after it.
const followupConfig = table(
  { name: 'followup_config' },
  {
    id: t.u32().primaryKey(), // always 0
    intervalSec: t.u32(),
  }
);

const followupTimer = table(
  { name: 'followup_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// TL-05 deferred: a delivered job's battery and driver are released for new work.
const jobRelease = table(
  { name: 'job_release' },
  {
    jobId: t.u64().primaryKey(),
    incidentId: t.string().index('btree'),
    releasedBy: t.identity(),
    releasedAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  config, invite, member, incident, household, asset, driver,
  route, routeReport, checkin, job, outbox, jobMessage, profile, agentContact, agentDecline,
  checkinRound, followup, followupAudit, followupConfig, followupTimer, jobRelease, confirmedNeed,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const ms = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch / 1000n);
const ts = (millis: number) => new Timestamp(BigInt(millis) * 1000n);
const hhmm = (ts: Timestamp) =>
  ts.toDate().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });

function requireRole(ctx: Ctx, roles: string[], incidentId: string) {
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me || !roles.includes(me.role) || me.incidentId !== incidentId) {
    throw new SenderError(`forbidden: requires ${roles.join(' or ')} for ${incidentId}`);
  }
  return me;
}

// ---- Seed (TL-18) ----
// Incident IDs are internal and match C's and B's fixtures. The demo shows `kind` and `name`:
//   tornado-1 is the LEAD incident, displayed as the winter freeze (H17 story, H22 silent).
//   freeze-1 is the SECOND incident, displayed as a tornado (F03/F09/F14).
// Every seed is anchored to the time it runs (publish, or resetIncident): the incident clock and
// every driver's and asset's freeAt are "now", so the server's ctx.timestamp ETAs and the
// board's live margins agree. A report at the clock gives C's numbers: R4 +17, R4-ALT +6, and
// R4 -3 after a confirmed 20-minute detour.

const LEAD_INCIDENT = 'tornado-1';
const SECOND_INCIDENT = 'freeze-1';

function seedLeadIncident(ctx: Ctx) {
  const incidentId = LEAD_INCIDENT;
  const clock = ctx.timestamp;
  ctx.db.incident.insert({ id: incidentId, kind: 'freeze', name: 'Winter freeze outage (synthetic)', clockAt: clock });
  for (const [id, label] of [
    ['H17', 'Household H17 (synthetic)'],
    ['H22', 'Household H22 (synthetic, silent)'],
  ]) {
    ctx.db.household.insert({
      id, incidentId, label, need: 'battery', version: 0,
      runtimeLowerMin: undefined, runtimeUpperMin: undefined,
      lastObservedAt: undefined, lastEventId: undefined, activeJobId: undefined,
    });
  }
  ctx.db.asset.insert({ id: 'BAT-01', incidentId, kind: 'battery', freeAt: clock, activeJobId: undefined });
  for (const [id, name] of [['ana', 'Ana'], ['ben', 'Ben']]) {
    ctx.db.driver.insert({ id, incidentId, name, freeAt: clock, activeJobId: undefined });
  }
  const leg = { incidentId, assetId: 'BAT-01', pickupMin: 2, setupMin: 2, confirmedDelayMin: 0 };
  // Ready clock+13 (R4) and clock+24 (R4-ALT), as in C's fixture; R7 clock+19 (A's race seed for H22).
  ctx.db.route.insert({ ...leg, id: 'R4', householdId: 'H17', driverId: 'ana', driverToAssetMin: 5, assetToHomeMin: 4 });
  ctx.db.route.insert({ ...leg, id: 'R4-ALT', householdId: 'H17', driverId: 'ana', driverToAssetMin: 5, assetToHomeMin: 15 });
  ctx.db.route.insert({ ...leg, id: 'R7', householdId: 'H22', driverId: 'ben', driverToAssetMin: 6, assetToHomeMin: 9 });
}

function seedSecondIncident(ctx: Ctx) {
  // IDs and travel values from C's TL-03 freeze fixture (PR #20); displayed as the tornado.
  const freezeId = SECOND_INCIDENT;
  const freezeClock = ctx.timestamp;
  ctx.db.incident.insert({ id: freezeId, kind: 'tornado', name: 'Tornado outage (synthetic)', clockAt: freezeClock });
  for (const [id, need] of [['F03', 'generator'], ['F09', 'battery'], ['F14', 'battery']]) {
    ctx.db.household.insert({
      id, incidentId: freezeId, label: `Household ${id} (synthetic)`, need, version: 0,
      runtimeLowerMin: undefined, runtimeUpperMin: undefined,
      lastObservedAt: undefined, lastEventId: undefined, activeJobId: undefined,
    });
  }
  ctx.db.asset.insert({ id: 'GEN-02', incidentId: freezeId, kind: 'generator', freeAt: freezeClock, activeJobId: undefined });
  ctx.db.asset.insert({ id: 'BAT-07', incidentId: freezeId, kind: 'battery', freeAt: freezeClock, activeJobId: undefined });
  ctx.db.driver.insert({ id: 'leo', incidentId: freezeId, name: 'Leo', freeAt: freezeClock, activeJobId: undefined });
  // FZ-R1 ready clock+18 (F03, generator); FZ-R2 ready clock+23 (F09, battery).
  ctx.db.route.insert({
    id: 'FZ-R1', incidentId: freezeId, householdId: 'F03', driverId: 'leo', assetId: 'GEN-02',
    driverToAssetMin: 6, pickupMin: 3, assetToHomeMin: 7, setupMin: 2, confirmedDelayMin: 0,
  });
  ctx.db.route.insert({
    id: 'FZ-R2', incidentId: freezeId, householdId: 'F09', driverId: 'leo', assetId: 'BAT-07',
    driverToAssetMin: 10, pickupMin: 2, assetToHomeMin: 8, setupMin: 3, confirmedDelayMin: 0,
  });
}

const SEEDS: Record<string, (ctx: Ctx) => void> = {
  [LEAD_INCIDENT]: seedLeadIncident,
  [SECOND_INCIDENT]: seedSecondIncident,
};

export const init = spacetimedb.init(ctx => {
  ctx.db.config.insert({ id: 0, owner: ctx.sender });
  seedLeadIncident(ctx);
  seedSecondIncident(ctx);
  // TL-11: follow-up interval (default 5 minutes) and the repeating sweep.
  scheduleSweep(ctx, DEFAULT_FOLLOWUP_SEC);
});

// Owner only: put one incident back to its seed, re-anchored to now. Clears everything that
// incident accumulated during a demo. Never touches member, invite or config, so claimed roles
// (whose subject IDs the seed recreates) keep working. Other incidents are untouched.
export const resetIncident = spacetimedb.reducer({ incidentId: t.string() }, (ctx, { incidentId }) => {
  const cfg = ctx.db.config.id.find(0);
  if (!cfg || !cfg.owner.isEqual(ctx.sender)) throw new SenderError('forbidden: owner only');
  const seed = SEEDS[incidentId];
  if (!seed) throw new SenderError(`rejected: no seed for incident ${incidentId}`);
  const db = ctx.db;

  const routeIds = new Set([...db.route.incidentId.filter(incidentId)].map(r => r.id));
  for (const r of [...db.routeReport.iter()]) if (routeIds.has(r.routeId)) db.routeReport.reportId.delete(r.reportId);
  for (const r of [...db.checkin.incidentId.filter(incidentId)]) db.checkin.eventId.delete(r.eventId);
  for (const r of [...db.jobMessage.incidentId.filter(incidentId)]) db.jobMessage.id.delete(r.id);
  for (const r of [...db.outbox.incidentId.filter(incidentId)]) db.outbox.key.delete(r.key);
  for (const r of [...db.jobRelease.incidentId.filter(incidentId)]) db.jobRelease.jobId.delete(r.jobId);
  for (const r of [...db.job.incidentId.filter(incidentId)]) db.job.id.delete(r.id);
  for (const r of [...db.followupAudit.incidentId.filter(incidentId)]) db.followupAudit.id.delete(r.id);
  for (const r of [...db.followup.incidentId.filter(incidentId)]) db.followup.id.delete(r.id);
  for (const r of [...db.checkinRound.incidentId.filter(incidentId)]) db.checkinRound.id.delete(r.id);
  for (const r of [...db.profile.incidentId.filter(incidentId)]) db.profile.householdId.delete(r.householdId);
  for (const r of [...db.agentContact.incidentId.filter(incidentId)]) db.agentContact.id.delete(r.id);
  for (const r of [...db.agentDecline.incidentId.filter(incidentId)]) db.agentDecline.householdId.delete(r.householdId);
  for (const r of [...db.confirmedNeed.incidentId.filter(incidentId)]) db.confirmedNeed.householdId.delete(r.householdId);
  // Seeded entities: removed and recreated from the seed, so activeJobIds, versions, runtimes,
  // confirmed delays and freeAt all return to seed values anchored to now.
  for (const r of routeIds) db.route.id.delete(r);
  for (const r of [...db.household.incidentId.filter(incidentId)]) db.household.id.delete(r.id);
  for (const r of [...db.asset.incidentId.filter(incidentId)]) db.asset.id.delete(r.id);
  for (const r of [...db.driver.incidentId.filter(incidentId)]) db.driver.id.delete(r.id);
  db.incident.id.delete(incidentId);
  seed(ctx);
});

// ---- Roles ----

export const createInvite = spacetimedb.reducer(
  { code: t.string(), role: t.string(), incidentId: t.string(), subjectId: t.string() },
  (ctx, args) => {
    const cfg = ctx.db.config.id.find(0);
    if (!cfg || !cfg.owner.isEqual(ctx.sender)) throw new SenderError('forbidden: owner only');
    if (!['coordinator', 'driver', 'resident', 'bridge'].includes(args.role)) {
      throw new SenderError(`unknown role ${args.role}`);
    }
    if (!ctx.db.incident.id.find(args.incidentId)) throw new SenderError(`unknown incident ${args.incidentId}`);
    // A driver or resident subject must exist in the invite's incident.
    const subject =
      args.role === 'driver' ? ctx.db.driver.id.find(args.subjectId)
      : args.role === 'resident' ? ctx.db.household.id.find(args.subjectId)
      : undefined;
    if ((args.role === 'driver' || args.role === 'resident') && subject?.incidentId !== args.incidentId) {
      const kind = args.role === 'driver' ? 'driver' : 'household';
      throw new SenderError(
        subject
          ? `rejected: ${kind} ${args.subjectId} belongs to ${subject.incidentId}, not ${args.incidentId}`
          : `unknown ${kind} ${args.subjectId}`
      );
    }
    if (ctx.db.invite.code.find(args.code)) throw new SenderError('invite code already exists');
    ctx.db.invite.insert(args);
  }
);

export const claimInvite = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const inv = ctx.db.invite.code.find(code);
  if (!inv) throw new SenderError('invalid or used invite code');
  if (ctx.db.member.identity.find(ctx.sender)) throw new SenderError('this session already has a role');
  ctx.db.member.insert({ identity: ctx.sender, role: inv.role, incidentId: inv.incidentId, subjectId: inv.subjectId });
  ctx.db.invite.code.delete(code);
});

// ---- Check-ins (B -> A) ----

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
    requireRole(ctx, ['bridge', 'coordinator'], args.incidentId);
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

    // TL-11: a verified reply closes the household's round and cancels obsolete escalation.
    answerRounds(ctx, args.householdId, args.eventId);
  }
);

// ---- Route confirmation (coordinator only) ----

export const confirmRouteReport = spacetimedb.reducer(
  { reportId: t.string(), incidentId: t.string(), routeId: t.string(), delayMin: t.u32() },
  (ctx, args) => {
    requireRole(ctx, ['coordinator'], args.incidentId);
    if (ctx.db.routeReport.reportId.find(args.reportId)) return; // duplicate report: no new effect
    const r = ctx.db.route.id.find(args.routeId);
    if (!r || r.incidentId !== args.incidentId) throw new SenderError(`unknown route ${args.routeId}`);
    ctx.db.routeReport.insert({
      reportId: args.reportId, routeId: args.routeId, delayMin: args.delayMin,
      confirmedBy: ctx.sender, confirmedAt: ctx.timestamp,
    });
    // The confirmed delay replaces the previous one; it never accumulates.
    ctx.db.route.id.update({ ...r, confirmedDelayMin: args.delayMin });
  }
);

// ---- Atomic dispatch (D -> A) ----

export const reserve = spacetimedb.reducer(
  {
    jobRequestId: t.string(),
    caseId: t.string(), // household ID
    routeId: t.string(),
    assetId: t.string(),
    driverId: t.string(),
    expectedVersion: t.u32(), // household.version the coordinator was looking at
  },
  (ctx, args) => {
    const existing = ctx.db.job.requestId.find(args.jobRequestId);
    if (existing) {
      requireRole(ctx, ['coordinator'], existing.incidentId);
      return; // duplicate: already committed
    }

    const home = ctx.db.household.id.find(args.caseId);
    if (!home) throw new SenderError(`unknown household ${args.caseId}`);
    requireRole(ctx, ['coordinator'], home.incidentId);

    const r = ctx.db.route.id.find(args.routeId);
    const a = ctx.db.asset.id.find(args.assetId);
    const d = ctx.db.driver.id.find(args.driverId);
    if (!r) throw new SenderError(`unknown route ${args.routeId}`);
    if (!a || !d) throw new SenderError('unknown asset or driver');
    // Route, asset and driver must all belong to the household's incident.
    for (const [kind, row] of [['route', r], ['asset', a], ['driver', d]] as const) {
      if (row.incidentId !== home.incidentId) {
        throw new SenderError(`rejected: ${kind} ${row.id} belongs to ${row.incidentId}, not ${home.incidentId}`);
      }
    }
    if (r.householdId !== home.id || r.assetId !== a.id || r.driverId !== d.id) {
      throw new SenderError(`route ${args.routeId} does not join ${args.caseId}, ${args.assetId} and ${args.driverId}`);
    }
    if (a.kind !== home.need) throw new SenderError(`incompatible: ${a.id} is ${a.kind}, ${home.id} needs ${home.need}`);

    // Every check runs before any write, so a losing attempt has no side effects.
    if (home.version !== args.expectedVersion) {
      throw new SenderError(`conflict: ${home.id} is at version ${home.version}, expected ${args.expectedVersion}`);
    }
    if (home.activeJobId !== undefined) throw new SenderError(`conflict: ${home.id} already has job ${home.activeJobId}`);
    if (a.activeJobId !== undefined) throw new SenderError(`conflict: ${a.id} is reserved by job ${a.activeJobId}`);
    if (d.activeJobId !== undefined) throw new SenderError(`conflict: ${d.name} is assigned to job ${d.activeJobId}`);

    const eta = ts(readyAt(
      {
        routeId: r.id, driverId: d.id, assetId: a.id, assetKind: a.kind,
        driverFreeAt: ms(d.freeAt), assetFreeAt: ms(a.freeAt),
        driverToAssetMin: r.driverToAssetMin, pickupMin: r.pickupMin,
        assetToHomeMin: r.assetToHomeMin, setupMin: r.setupMin, confirmedDelayMin: r.confirmedDelayMin,
      },
      ms(ctx.timestamp)
    ));

    const j = ctx.db.job.insert({
      id: 0n, requestId: args.jobRequestId, incidentId: home.incidentId, householdId: home.id,
      routeId: r.id, driverId: d.id, assetId: a.id, version: 1, status: 'assigned',
      etaAt: eta, createdBy: ctx.sender, createdAt: ctx.timestamp,
    });
    ctx.db.household.id.update({ ...home, version: home.version + 1, activeJobId: j.id });
    ctx.db.asset.id.update({ ...a, activeJobId: j.id });
    ctx.db.driver.id.update({ ...d, activeJobId: j.id });

    const intent = (recipient: string, purpose: string, body: string) =>
      ctx.db.outbox.insert({
        key: `job:${j.id}:v${j.version}:${recipient}:${purpose}`,
        incidentId: home.incidentId, jobId: j.id, jobVersion: j.version,
        recipient, purpose, body, status: 'pending', createdAt: ctx.timestamp,
      });
    intent(`household:${home.id}`, 'eta', `${d.name} is bringing a ${a.kind}. Estimated ready by ${hhmm(eta)}.`);
    intent(`driver:${d.id}`, 'assignment', `New stop: ${home.id} via ${r.id} with ${a.id}. Ready by ${hhmm(eta)}.`);
  }
);

// ---- Job thread (D -> A): only the job's resident and assigned driver can write ----

type JobRow = NonNullable<ReturnType<Ctx['db']['job']['id']['find']>>;

function participant(ctx: Ctx, j: JobRow) {
  const me = ctx.db.member.identity.find(ctx.sender);
  if (me && me.incidentId === j.incidentId) {
    if (me.role === 'resident' && me.subjectId === j.householdId) {
      return { role: 'resident', label: j.householdId };
    }
    if (me.role === 'driver' && me.subjectId === j.driverId) {
      return { role: 'driver', label: ctx.db.driver.id.find(j.driverId)?.name ?? j.driverId };
    }
  }
  throw new SenderError(`forbidden: not a participant in job ${j.id}`);
}

function appendToThread(
  ctx: Ctx, j: JobRow, who: { role: string; label: string },
  kind: string, clientMessageId: string, text: string
) {
  const dedupeKey = `${j.id}:${ctx.sender.toHexString()}:${clientMessageId}`;
  if (ctx.db.jobMessage.dedupeKey.find(dedupeKey)) return; // repeated send: no new row
  const seq = [...ctx.db.jobMessage.jobId.filter(j.id)].length + 1; // reducers run one at a time
  ctx.db.jobMessage.insert({
    id: 0n, dedupeKey, incidentId: j.incidentId, jobId: j.id, seq, kind,
    senderRole: who.role, senderLabel: who.label, senderIdentity: ctx.sender,
    clientMessageId, text, sentAt: ctx.timestamp,
  });
}

export const postJobMessage = spacetimedb.reducer(
  { jobId: t.u64(), clientMessageId: t.string(), text: t.string() },
  (ctx, args) => {
    const j = ctx.db.job.id.find(args.jobId);
    if (!j) throw new SenderError(`unknown job ${args.jobId}`);
    const who = participant(ctx, j);
    const text = args.text.trim();
    if (!text || text.length > 1000) throw new SenderError('message must be 1-1000 characters');
    if (!args.clientMessageId) throw new SenderError('clientMessageId is required');
    appendToThread(ctx, j, who, 'text', args.clientMessageId, text);
  }
);

// Allowed status changes: who may make them and from which status.
const TRANSITIONS: Record<string, { role: string; from: string }> = {
  arrived: { role: 'driver', from: 'assigned' },
  delivered: { role: 'resident', from: 'arrived' },
};

export const updateJob = spacetimedb.reducer(
  { jobId: t.u64(), expectedVersion: t.u32(), status: t.string() },
  (ctx, args) => {
    const j = ctx.db.job.id.find(args.jobId);
    if (!j) throw new SenderError(`unknown job ${args.jobId}`);
    const who = participant(ctx, j);
    const rule = TRANSITIONS[args.status];
    if (!rule) throw new SenderError(`unknown status ${args.status}`);
    if (who.role !== rule.role) throw new SenderError(`forbidden: only the ${rule.role} can mark ${args.status}`);
    if (j.version !== args.expectedVersion) {
      throw new SenderError(`conflict: job ${j.id} is at version ${j.version}, expected ${args.expectedVersion}`);
    }
    if (j.status !== rule.from) {
      throw new SenderError(`conflict: job ${j.id} is ${j.status}, not ${rule.from}`);
    }
    const next = ctx.db.job.id.update({ ...j, version: j.version + 1, status: args.status });
    const text = args.status === 'arrived' ? `${who.label} arrived` : `${who.label} confirmed delivery`;
    appendToThread(ctx, next, who, args.status, `status:${args.status}:v${next.version}`, text);
  }
);

// ---- Preparedness and voluntary agent contact (TL-09; D -> A; the household's resident) ----

function requireResident(ctx: Ctx) {
  const me = ctx.db.member.identity.find(ctx.sender);
  if (me?.role !== 'resident') throw new SenderError('forbidden: requires a resident session');
  return me;
}

const MEDICAL_NEEDS = ['home_oxygen', 'dialysis', 'no_heat'];
const CONTACT_METHODS = ['imessage', 'phone_call'];

export const enrollPreparedness = spacetimedb.reducer(
  {
    enrollmentId: t.string(),
    medicalNeed: t.string(),
    backupDevice: t.string(),
    address: t.string(),
    preferredContact: t.string(),
  },
  (ctx, args) => {
    const me = requireResident(ctx);
    const existing = ctx.db.profile.enrollmentId.find(args.enrollmentId);
    if (existing) {
      if (existing.householdId === me.subjectId) return; // retry: no new profile
      throw new SenderError('conflict: enrollmentId already used');
    }
    const enrolled = ctx.db.profile.householdId.find(me.subjectId);
    if (enrolled) throw new SenderError(`conflict: ${me.subjectId} already has a preparedness profile`);
    if (!MEDICAL_NEEDS.includes(args.medicalNeed)) throw new SenderError(`unknown medicalNeed ${args.medicalNeed}`);
    if (!CONTACT_METHODS.includes(args.preferredContact)) {
      throw new SenderError(`unknown preferredContact ${args.preferredContact}`);
    }
    const backupDevice = args.backupDevice.trim();
    const address = args.address.trim();
    if (!backupDevice || backupDevice.length > 200 || !address || address.length > 200) {
      throw new SenderError('backupDevice and address must be 1-200 characters');
    }
    ctx.db.profile.insert({
      householdId: me.subjectId, enrollmentId: args.enrollmentId, incidentId: me.incidentId,
      identity: ctx.sender, medicalNeed: args.medicalNeed, backupDevice, address,
      preferredContact: args.preferredContact, enrolledAt: ctx.timestamp,
    });
  }
);

// Offered only after delivery, so it can never change who gets help or how fast.
// After skipAgentContact, the household's answer is final and no lead can be created.
export const requestAgentContact = spacetimedb.reducer({ consentId: t.string() }, (ctx, { consentId }) => {
  const me = requireResident(ctx);
  if (!consentId) throw new SenderError('consentId is required');
  const same = ctx.db.agentContact.consentId.find(consentId);
  if (same) {
    if (same.householdId === me.subjectId) return; // retry: no new lead
    throw new SenderError('conflict: consentId already used');
  }
  const lead = ctx.db.agentContact.householdId.find(me.subjectId);
  if (lead) throw new SenderError(`conflict: ${me.subjectId} already has request L-${lead.id}`);
  if (ctx.db.agentDecline.householdId.find(me.subjectId)) {
    throw new SenderError('conflict: the resident skipped. Nothing was saved.');
  }
  const p = ctx.db.profile.householdId.find(me.subjectId);
  if (!p) throw new SenderError(`rejected: ${me.subjectId} has no preparedness profile`);
  const delivered = [...ctx.db.job.householdId.filter(me.subjectId)].find(j => j.status === 'delivered');
  if (!delivered) throw new SenderError('conflict: agent contact is offered only after help is delivered');
  ctx.db.agentContact.insert({
    id: 0n, consentId, householdId: me.subjectId, incidentId: me.incidentId, identity: ctx.sender,
    jobId: delivered.id, preferredContact: p.preferredContact, consentedAt: ctx.timestamp,
  });
});

// The resident declines the agent offer. Records the decline only; never creates a lead.
export const skipAgentContact = spacetimedb.reducer(ctx => {
  const me = requireResident(ctx);
  if (ctx.db.agentDecline.householdId.find(me.subjectId)) return; // retry: no-op
  const lead = ctx.db.agentContact.householdId.find(me.subjectId);
  if (lead) throw new SenderError(`conflict: ${me.subjectId} already has request L-${lead.id}`);
  ctx.db.agentDecline.insert({
    householdId: me.subjectId, incidentId: me.incidentId, identity: ctx.sender, declinedAt: ctx.timestamp,
  });
});

// TL-15: the dispatch need for each of C's suggestion IDs (domain/suggest.ts). The server
// derives it, so a client can never choose a resource kind.
const CONFIRMABLE_NEEDS: Record<NeedSuggestion['id'], Pick<ConfirmedNeed, 'dispatchNeed'>> = {
  powered_equipment: { dispatchNeed: 'battery' },
  step_free_access: {},
};
const isConfirmable = (id: string): id is NeedSuggestion['id'] =>
  Object.prototype.hasOwnProperty.call(CONFIRMABLE_NEEDS, id);

// Confirm and Correct both send the kept needId. Skip sends nothing, so nothing is stored.
export const confirmSuggestedNeed = spacetimedb.reducer(
  { confirmationId: t.string(), needId: t.string() },
  (ctx, { confirmationId, needId }) => {
    const me = requireResident(ctx);
    if (!confirmationId) throw new SenderError('confirmationId is required');
    const same = ctx.db.confirmedNeed.confirmationId.find(confirmationId);
    if (same) {
      if (same.householdId === me.subjectId) return; // retry: nothing new
      throw new SenderError('conflict: confirmationId already used');
    }
    if (!isConfirmable(needId)) throw new SenderError(`unknown needId ${needId}`);
    const done = ctx.db.confirmedNeed.householdId.find(me.subjectId);
    if (done) throw new SenderError(`conflict: ${me.subjectId} already confirmed ${done.needId}`);
    ctx.db.confirmedNeed.insert({
      householdId: me.subjectId, confirmationId, incidentId: me.incidentId, needId,
      dispatchNeed: CONFIRMABLE_NEEDS[needId].dispatchNeed, confirmedAt: ctx.timestamp,
    });
  }
);

// ---- TL-11: rounds, silent follow-ups, callback ownership; TL-05 release ----

const DEFAULT_FOLLOWUP_SEC = 300; // 5 minutes
const MICROS_PER_SEC = 1_000_000n;
const plusSec = (at: Timestamp, seconds: number) =>
  new Timestamp(at.microsSinceUnixEpoch + BigInt(seconds) * MICROS_PER_SEC);
const followupSec = (ctx: Ctx) => ctx.db.followupConfig.id.find(0)?.intervalSec ?? DEFAULT_FOLLOWUP_SEC;

type RoundRow = NonNullable<ReturnType<Ctx['db']['checkinRound']['id']['find']>>;
type FollowupRow = NonNullable<ReturnType<Ctx['db']['followup']['id']['find']>>;

// Stores the interval and (re)starts one repeating sweep. The sweep runs about five times per
// interval (every 1-60 s), so a round goes silent shortly after it falls due.
function scheduleSweep(ctx: Ctx, seconds: number) {
  const cfg = ctx.db.followupConfig.id.find(0);
  if (cfg) ctx.db.followupConfig.id.update({ ...cfg, intervalSec: seconds });
  else ctx.db.followupConfig.insert({ id: 0, intervalSec: seconds });
  for (const timer of [...ctx.db.followupTimer.iter()]) ctx.db.followupTimer.scheduledId.delete(timer.scheduledId);
  const every = Math.min(60, Math.max(1, Math.floor(seconds / 5)));
  ctx.db.followupTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(every) * MICROS_PER_SEC) });
}

function audit(ctx: Ctx, f: FollowupRow, action: string, note: string, actor?: typeof ctx.sender) {
  ctx.db.followupAudit.insert({
    id: 0n, followupId: f.id, incidentId: f.incidentId, action, actor, owner: f.owner, note, at: ctx.timestamp,
  });
}

// Closes a round on a verified reply and cancels its follow-up, if one is still active.
function closeRound(ctx: Ctx, r: RoundRow, eventId: string, actor?: typeof ctx.sender) {
  ctx.db.checkinRound.id.update({ ...r, status: 'answered', answeredEventId: eventId, closedAt: ctx.timestamp });
  const f = ctx.db.followup.roundId.find(r.id);
  if (f && (f.status === 'open' || f.status === 'claimed')) {
    const next = ctx.db.followup.id.update({ ...f, status: 'cancelled', version: f.version + 1 });
    audit(ctx, next, 'cancelled', `verified reply ${eventId}`, actor);
  }
}

// Called by ingestCheckin after it records a new check-in (sent by the bridge or a coordinator).
function answerRounds(ctx: Ctx, householdId: string, eventId: string) {
  for (const r of [...ctx.db.checkinRound.householdId.filter(householdId)]) {
    if (r.status === 'open' || r.status === 'silent') closeRound(ctx, r, eventId, ctx.sender);
  }
}

// Coordinator starts outreach for one household. The opener is the default callback owner.
export const openCheckinRound = spacetimedb.reducer(
  { roundKey: t.string(), incidentId: t.string(), householdId: t.string() },
  (ctx, args) => {
    requireRole(ctx, ['coordinator'], args.incidentId);
    const same = ctx.db.checkinRound.roundKey.find(args.roundKey);
    if (same) {
      if (same.householdId === args.householdId) return; // retry: no new round
      throw new SenderError('conflict: roundKey already used');
    }
    const home = ctx.db.household.id.find(args.householdId);
    if (!home || home.incidentId !== args.incidentId) {
      throw new SenderError(`unknown household ${args.householdId} in ${args.incidentId}`);
    }
    const active = [...ctx.db.checkinRound.householdId.filter(home.id)]
      .find(r => r.status === 'open' || r.status === 'silent');
    if (active) throw new SenderError(`conflict: ${home.id} already has round ${active.id} (${active.status})`);
    ctx.db.checkinRound.insert({
      id: 0n, roundKey: args.roundKey, incidentId: home.incidentId, householdId: home.id, status: 'open',
      openedBy: ctx.sender, openedAt: ctx.timestamp, dueAt: plusSec(ctx.timestamp, followupSec(ctx)),
      answeredEventId: undefined, closedAt: undefined,
    });
  }
);

// Runs on the schedule only. Every action rechecks the row's current state first.
export const sweepFollowups = spacetimedb.reducer(
  { onSchedule: followupTimer },
  { timer: followupTimer.rowType },
  ctx => {
    if (!ctx.senderAuth.isInternal) throw new SenderError('forbidden: runs on schedule only');
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const interval = followupSec(ctx);

    for (const r of [...ctx.db.checkinRound.status.filter('open')]) {
      // A verified reply received since the round opened answers it.
      const reply = [...ctx.db.checkin.incidentId.filter(r.incidentId)].find(
        c => c.householdId === r.householdId && c.receivedAt.microsSinceUnixEpoch >= r.openedAt.microsSinceUnixEpoch
      );
      if (reply) {
        closeRound(ctx, r, reply.eventId);
        continue;
      }
      if (now < r.dueAt.microsSinceUnixEpoch) continue;
      ctx.db.checkinRound.id.update({ ...r, status: 'silent' });
      if (ctx.db.followup.roundId.find(r.id)) continue;
      const home = ctx.db.household.id.find(r.householdId);
      const f = ctx.db.followup.insert({
        id: 0n, roundId: r.id, incidentId: r.incidentId, householdId: r.householdId, status: 'open',
        owner: r.openedBy, dueAt: plusSec(ctx.timestamp, interval), escalationLevel: 0, version: 1,
        lastEventId: home?.lastEventId, lastObservedAt: home?.lastObservedAt,
        runtimeLowerMin: home?.runtimeLowerMin, runtimeUpperMin: home?.runtimeUpperMin,
        createdAt: ctx.timestamp,
      });
      audit(ctx, f, 'created', `round ${r.id} overdue without a verified reply`);
    }

    for (const status of ['open', 'claimed']) {
      for (const f of [...ctx.db.followup.status.filter(status)]) {
        if (now < f.dueAt.microsSinceUnixEpoch) continue;
        const r = ctx.db.checkinRound.id.find(f.roundId);
        if (r?.status === 'answered') {
          const next = ctx.db.followup.id.update({ ...f, status: 'cancelled', version: f.version + 1 });
          audit(ctx, next, 'cancelled', `round ${r.id} already answered`);
          continue;
        }
        // Still unanswered: keep the owner, push the callback out one interval and record it.
        const next = ctx.db.followup.id.update({
          ...f, escalationLevel: f.escalationLevel + 1, dueAt: plusSec(ctx.timestamp, interval),
        });
        audit(ctx, next, 'escalated', `callback overdue; level ${next.escalationLevel}`);
      }
    }
  }
);

// A coordinator takes ownership of a callback. Audited; expectedVersion guards a stale screen.
export const claimFollowup = spacetimedb.reducer(
  { followupId: t.u64(), expectedVersion: t.u32() },
  (ctx, args) => {
    const f = ctx.db.followup.id.find(args.followupId);
    if (!f) throw new SenderError(`unknown followup ${args.followupId}`);
    requireRole(ctx, ['coordinator'], f.incidentId);
    if (f.status === 'claimed' && f.owner.isEqual(ctx.sender)) return; // retry: already yours
    if (f.status === 'cancelled') throw new SenderError(`conflict: followup ${f.id} was cancelled by a verified reply`);
    if (f.version !== args.expectedVersion) {
      throw new SenderError(`conflict: followup ${f.id} is at version ${f.version}, expected ${args.expectedVersion}`);
    }
    const previous = f.owner.toHexString().slice(0, 12);
    const next = ctx.db.followup.id.update({ ...f, status: 'claimed', owner: ctx.sender, version: f.version + 1 });
    audit(ctx, next, 'claimed', `owner was ${previous}`, ctx.sender);
  }
);

// Owner only: demo knob. New rounds and callbacks use the new interval; existing due times stay.
export const setFollowupInterval = spacetimedb.reducer({ seconds: t.u32() }, (ctx, { seconds }) => {
  const cfg = ctx.db.config.id.find(0);
  if (!cfg || !cfg.owner.isEqual(ctx.sender)) throw new SenderError('forbidden: owner only');
  if (seconds < 1 || seconds > 3600) throw new SenderError('seconds must be 1-3600');
  scheduleSweep(ctx, seconds);
});

// TL-05 deferred: after delivery, free the battery and driver for new work. The job keeps its
// 'delivered' status, so the agent-contact offer still applies.
export const releaseJob = spacetimedb.reducer(
  { jobId: t.u64(), expectedVersion: t.u32() },
  (ctx, args) => {
    const j = ctx.db.job.id.find(args.jobId);
    if (!j) throw new SenderError(`unknown job ${args.jobId}`);
    requireRole(ctx, ['coordinator'], j.incidentId);
    if (ctx.db.jobRelease.jobId.find(j.id)) return; // retry: already released
    if (j.version !== args.expectedVersion) {
      throw new SenderError(`conflict: job ${j.id} is at version ${j.version}, expected ${args.expectedVersion}`);
    }
    if (j.status !== 'delivered') throw new SenderError(`conflict: job ${j.id} is ${j.status}, not delivered`);
    const a = ctx.db.asset.id.find(j.assetId);
    if (a && a.activeJobId === j.id) ctx.db.asset.id.update({ ...a, activeJobId: undefined, freeAt: ctx.timestamp });
    const d = ctx.db.driver.id.find(j.driverId);
    if (d && d.activeJobId === j.id) ctx.db.driver.id.update({ ...d, activeJobId: undefined, freeAt: ctx.timestamp });
    ctx.db.jobRelease.insert({ jobId: j.id, incidentId: j.incidentId, releasedBy: ctx.sender, releasedAt: ctx.timestamp });
  }
);

// ---- Views: each client sees only what its role allows ----

export const myRole = spacetimedb.view(
  { name: 'my_role', public: true },
  t.option(member.rowType),
  ctx => ctx.db.member.identity.find(ctx.sender) ?? undefined
);

export const myIncident = spacetimedb.view(
  { name: 'my_incident', public: true },
  t.option(incident.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me ? ctx.db.incident.id.find(me.incidentId) ?? undefined : undefined;
  }
);

export const coordinatorHouseholds = spacetimedb.view(
  { name: 'coordinator_households', public: true },
  t.array(household.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.household.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorCheckins = spacetimedb.view(
  { name: 'coordinator_checkins', public: true },
  t.array(checkin.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.checkin.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorAssets = spacetimedb.view(
  { name: 'coordinator_assets', public: true },
  t.array(asset.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.asset.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorDrivers = spacetimedb.view(
  { name: 'coordinator_drivers', public: true },
  t.array(driver.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.driver.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorRoutes = spacetimedb.view(
  { name: 'coordinator_routes', public: true },
  t.array(route.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.route.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorJobs = spacetimedb.view(
  { name: 'coordinator_jobs', public: true },
  t.array(job.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.job.incidentId.filter(me.incidentId)] : [];
  }
);

// A driver sees only the jobs assigned to them.
export const driverJobs = spacetimedb.view(
  { name: 'driver_jobs', public: true },
  t.array(job.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'driver' ? [...ctx.db.job.driverId.filter(me.subjectId)] : [];
  }
);

// Check-in receipts for B's bridge: the check-ins recorded for its incident, so the bridge
// can confirm an ingestCheckin landed (and with which runtime) without reading households.
export const bridgeCheckins = spacetimedb.view(
  { name: 'bridge_checkins', public: true },
  t.array(checkin.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'bridge' ? [...ctx.db.checkin.incidentId.filter(me.incidentId)] : [];
  }
);

// TL-09: a resident sees their own profile and their own lead receipt.
export const myProfile = spacetimedb.view(
  { name: 'my_profile', public: true },
  t.option(profile.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'resident' ? ctx.db.profile.householdId.find(me.subjectId) ?? undefined : undefined;
  }
);

export const myAgentRequest = spacetimedb.view(
  { name: 'my_agent_request', public: true },
  t.option(agentContact.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'resident' ? ctx.db.agentContact.householdId.find(me.subjectId) ?? undefined : undefined;
  }
);

// Lets the resident's screen show "Skipped" after a reload instead of offering again.
export const myAgentDecline = spacetimedb.view(
  { name: 'my_agent_decline', public: true },
  t.option(agentDecline.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'resident' ? ctx.db.agentDecline.householdId.find(me.subjectId) ?? undefined : undefined;
  }
);

// TL-09: coordinators see who is registered, and only counts of agent opt-ins (never the leads).
export const coordinatorProfiles = spacetimedb.view(
  { name: 'coordinator_profiles', public: true },
  t.array(profile.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.profile.incidentId.filter(me.incidentId)] : [];
  }
);

const RegistryStats = t.row('RegistryStats', {
  incidentId: t.string().primaryKey(),
  registrations: t.u32(), // preparedness profiles
  agentOptIns: t.u32(), // distinct households that asked for an agent; counted separately
});

export const coordinatorRegistryStats = spacetimedb.view(
  { name: 'coordinator_registry_stats', public: true },
  t.array(RegistryStats),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (me?.role !== 'coordinator') return [];
    return [{
      incidentId: me.incidentId,
      registrations: [...ctx.db.profile.incidentId.filter(me.incidentId)].length,
      agentOptIns: [...ctx.db.agentContact.incidentId.filter(me.incidentId)].length,
    }];
  }
);

// TL-15: the resident's own confirmation, so the screen shows "Confirmed" after a reload.
export const myConfirmedNeed = spacetimedb.view(
  { name: 'my_confirmed_need', public: true },
  t.option(confirmedNeed.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'resident' ? ctx.db.confirmedNeed.householdId.find(me.subjectId) ?? undefined : undefined;
  }
);

const ConfirmedNeedRow = t.row('ConfirmedNeedRow', {
  householdId: t.string().primaryKey(),
  needId: t.string(),
  dispatchNeed: t.option(t.string()),
  label: t.string(), // always 'self-confirmed via preparedness profile'
  confirmedAt: t.timestamp(),
});

// TL-15: coordinators see which households confirmed which need. Never sources or policy data.
export const coordinatorConfirmedNeeds = spacetimedb.view(
  { name: 'coordinator_confirmed_needs', public: true },
  t.array(ConfirmedNeedRow),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (me?.role !== 'coordinator') return [];
    return [...ctx.db.confirmedNeed.incidentId.filter(me.incidentId)].map(c => ({
      householdId: c.householdId, needId: c.needId, dispatchNeed: c.dispatchNeed,
      label: 'self-confirmed via preparedness profile', confirmedAt: c.confirmedAt,
    }));
  }
);

// A resident sees only their own household's jobs.
export const residentJobs = spacetimedb.view(
  { name: 'resident_jobs', public: true },
  t.array(job.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'resident' ? [...ctx.db.job.householdId.filter(me.subjectId)] : [];
  }
);

// Threads for the jobs this session takes part in; a coordinator sees its incident's threads.
export const jobMessages = spacetimedb.view(
  { name: 'job_messages', public: true },
  t.array(jobMessage.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (!me) return [];
    if (me.role === 'coordinator') return [...ctx.db.jobMessage.incidentId.filter(me.incidentId)];
    const jobs =
      me.role === 'driver' ? [...ctx.db.job.driverId.filter(me.subjectId)]
      : me.role === 'resident' ? [...ctx.db.job.householdId.filter(me.subjectId)]
      : [];
    return jobs.flatMap(j => [...ctx.db.jobMessage.jobId.filter(j.id)]);
  }
);

// B's worker reads committed intents for its incident, only while their job is still current:
// once updateJob moves a job on (arrived/delivered bumps its version), its old intents drop out,
// so the bridge can never send a stale ETA.
export const bridgeOutbox = spacetimedb.view(
  { name: 'bridge_outbox', public: true },
  t.array(outbox.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    if (me?.role !== 'bridge') return [];
    return [...ctx.db.outbox.incidentId.filter(me.incidentId)].filter(row => {
      const job = ctx.db.job.id.find(row.jobId);
      return job?.status === 'assigned' && job.version === row.jobVersion;
    });
  }
);

// TL-11: coordinators see their incident's rounds, follow-ups (with owner and due time) and
// the audit trail of every create, escalate, claim and cancel.
export const coordinatorRounds = spacetimedb.view(
  { name: 'coordinator_rounds', public: true },
  t.array(checkinRound.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.checkinRound.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorFollowups = spacetimedb.view(
  { name: 'coordinator_followups', public: true },
  t.array(followup.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.followup.incidentId.filter(me.incidentId)] : [];
  }
);

export const coordinatorFollowupAudit = spacetimedb.view(
  { name: 'coordinator_followup_audit', public: true },
  t.array(followupAudit.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'coordinator' ? [...ctx.db.followupAudit.incidentId.filter(me.incidentId)] : [];
  }
);
