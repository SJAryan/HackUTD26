import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { readyAt } from './rules';

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

const spacetimedb = schema({
  config, invite, member, incident, household, asset, driver,
  route, routeReport, checkin, job, outbox, jobMessage, profile, agentContact,
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

// Tornado incident clock: 2026-11-08 02:00 America/Chicago (CST) = 08:00 UTC.
// Values for H17, R4 and R4-ALT match C's TL-03 tornado fixture.
const TORNADO_CLOCK = Date.UTC(2026, 10, 8, 8, 0, 0);
// Freeze incident clock: 2026-01-20 06:00 America/Chicago (CST) = 12:00 UTC.
const FREEZE_CLOCK = Date.UTC(2026, 0, 20, 12, 0, 0);

export const init = spacetimedb.init(ctx => {
  ctx.db.config.insert({ id: 0, owner: ctx.sender });

  const incidentId = 'tornado-1';
  const clock = ts(TORNADO_CLOCK);
  ctx.db.incident.insert({ id: incidentId, kind: 'tornado', name: 'Tornado outage (synthetic)', clockAt: clock });
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
  // R4 ready 02:13; R4-ALT ready 02:24 (C's fixture). R7 ready 02:19 (A's race seed for H22).
  ctx.db.route.insert({ ...leg, id: 'R4', householdId: 'H17', driverId: 'ana', driverToAssetMin: 5, assetToHomeMin: 4 });
  ctx.db.route.insert({ ...leg, id: 'R4-ALT', householdId: 'H17', driverId: 'ana', driverToAssetMin: 5, assetToHomeMin: 15 });
  ctx.db.route.insert({ ...leg, id: 'R7', householdId: 'H22', driverId: 'ben', driverToAssetMin: 6, assetToHomeMin: 9 });

  // Freeze incident, IDs and travel values from C's TL-03 freeze fixture (PR #20).
  const freezeId = 'freeze-1';
  const freezeClock = ts(FREEZE_CLOCK);
  ctx.db.incident.insert({ id: freezeId, kind: 'freeze', name: 'Winter freeze outage (synthetic)', clockAt: freezeClock });
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
  // FZ-R1 ready 06:18 (F03, generator); FZ-R2 ready 06:23 (F09, battery).
  ctx.db.route.insert({
    id: 'FZ-R1', incidentId: freezeId, householdId: 'F03', driverId: 'leo', assetId: 'GEN-02',
    driverToAssetMin: 6, pickupMin: 3, assetToHomeMin: 7, setupMin: 2, confirmedDelayMin: 0,
  });
  ctx.db.route.insert({
    id: 'FZ-R2', incidentId: freezeId, householdId: 'F09', driverId: 'leo', assetId: 'BAT-07',
    driverToAssetMin: 10, pickupMin: 2, assetToHomeMin: 8, setupMin: 3, confirmedDelayMin: 0,
  });
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
// "Skip" is a client action and calls nothing.
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
  const p = ctx.db.profile.householdId.find(me.subjectId);
  if (!p) throw new SenderError(`rejected: ${me.subjectId} has no preparedness profile`);
  const delivered = [...ctx.db.job.householdId.filter(me.subjectId)].find(j => j.status === 'delivered');
  if (!delivered) throw new SenderError('conflict: agent contact is offered only after help is delivered');
  ctx.db.agentContact.insert({
    id: 0n, consentId, householdId: me.subjectId, incidentId: me.incidentId, identity: ctx.sender,
    jobId: delivered.id, preferredContact: p.preferredContact, consentedAt: ctx.timestamp,
  });
});

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

// B's worker reads committed intents for its incident.
export const bridgeOutbox = spacetimedb.view(
  { name: 'bridge_outbox', public: true },
  t.array(outbox.rowType),
  ctx => {
    const me = ctx.db.member.identity.find(ctx.sender);
    return me?.role === 'bridge' ? [...ctx.db.outbox.incidentId.filter(me.incidentId)] : [];
  }
);
