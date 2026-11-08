import { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { LANE_LABEL, signed, type Lane } from '../demo/fixture';
import { Icon } from '../ui/icons';
import { LanePill } from '../screens/Board';
import { Thread } from './LivePhone';
import type { CheckinRound, Followup } from '../module_bindings/types';
import { POLL, errorText, evaluateHousehold, hhmm, ms, newId, titleCase, type LiveCase } from './model';

const RANK: Record<Lane, number> = { act: 0, watch: 1, unknown: 2, silent: 3, dispatched: 4, registered: 5 };
const DELAY_MIN = 20; // the reported detour in the demo story; the server replaces, never adds

export function useNow(every = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

const marginText = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${signed(m)} min`);

export function LiveBoard() {
  const now = useNow();
  const [households, ready] = useTable(tables.coordinatorHouseholds);
  const [routes] = useTable(tables.coordinatorRoutes);
  const [drivers] = useTable(tables.coordinatorDrivers);
  const [assets] = useTable(tables.coordinatorAssets);
  const [jobs] = useTable(tables.coordinatorJobs);
  const [checkins] = useTable(tables.coordinatorCheckins);
  const [rounds] = useTable(tables.coordinatorRounds);
  const [followups] = useTable(tables.coordinatorFollowups);
  const [incidents] = useTable(tables.myIncident);
  const incident = incidents[0];
  const [stats] = useTable(tables.coordinatorRegistryStats);
  const registry = stats.find((r) => r.incidentId === incident?.id);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      households
        .map((h) => ({ h, c: evaluateHousehold(h, routes, drivers, assets, currentRound(rounds, h.id), now) }))
        .sort((a, b) => RANK[a.c.lane] - RANK[b.c.lane] || (a.c.best?.margin ?? 999) - (b.c.best?.margin ?? 999) || a.h.id.localeCompare(b.h.id)),
    [households, routes, drivers, assets, rounds, now],
  );
  const counts = (l: Lane) => rows.filter((r) => r.c.lane === l).length;
  const open = rows.find((r) => r.h.id === selected) ?? null;

  // The same one motion moment as the fixture: a row flashes when its lane changes.
  const lanes = useRef(new Map<string, Lane>());
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    for (const { h, c } of rows) {
      const before = lanes.current.get(h.id);
      if (before && before !== c.lane) {
        setFlash(h.id);
        setTimeout(() => setFlash(null), 1600);
      }
      lanes.current.set(h.id, c.lane);
    }
  }, [rows]);

  return (
    <div className={`board ${open ? 'has-drawer' : ''}`}>
      <div className="board-main">
        <section className="notice live-notice">
          <Icon name="bolt" size={20} />
          <div>
            <h2>{incident ? incident.name : 'Live incident'}</h2>
            <p>Live data from SpacetimeDB. Margins use the real clock and the dispatch rules on the server.</p>
            {/* Counted separately on the server; the coordinator never sees who asked for an agent. */}
            {registry && <p className="sub">{registry.registrations} registered before the outage. {registry.agentOptIns} asked for a State Farm agent after help arrived.</p>}
          </div>
        </section>

        <section className="kpis" aria-label="Households by lane">
          {(['act', 'watch', 'unknown', 'silent'] as Lane[]).map((l) => (
            <div key={l} className={`kpi kpi-${l}`}>
              <span className="kpi-label">{LANE_LABEL[l]}</span>
              <b>{counts(l)}</b>
              <span className="kpi-sub">{l === 'act' ? 'Under 15 min' : l === 'watch' ? '15 min or more' : l === 'unknown' ? 'Runtime unknown' : 'Check-in overdue'}</span>
            </div>
          ))}
          <div className="kpi kpi-res">
            <span className="kpi-label"><Icon name="battery" size={15} /> Free now</span>
            <dl>
              <div><dt>Assets</dt><dd>{assets.filter((a) => a.activeJobId === undefined).length} of {assets.length}</dd></div>
              <div><dt>Drivers</dt><dd>{drivers.filter((d) => d.activeJobId === undefined).length} of {drivers.length}</dd></div>
              <div><dt>Jobs</dt><dd>{jobs.length}</dd></div>
            </dl>
          </div>
        </section>

        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Household</th>
                <th>Last report</th>
                <th>Best option</th>
                <th className="num">Margin</th>
                <th>Lane</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, c }) => {
                const last = latestCheckin(checkins, h.id);
                const job = jobs.find((j) => j.id === h.activeJobId);
                return (
                  <tr key={h.id} className={`${h.id === selected ? 'sel' : ''} ${flash === h.id ? 'flash' : ''}`} onClick={() => setSelected(h.id)}>
                    <td>
                      <button className="row-open" onClick={() => setSelected(h.id)}><b>{h.id}</b></button>
                      <span className="sub">{titleCase(h.need)}</span>
                    </td>
                    <td className="report">{last ? `“${last.text}”` : 'No check-in yet'}</td>
                    <td>{job ? `${job.assetId}, ${titleCase(job.driverId)}, ${job.status}` : c.best ? `${c.best.route.assetId}, ${titleCase(c.best.route.driverId)}, ${c.best.route.id}` : c.lane === 'act' ? 'No free option' : '—'}</td>
                    <td className={`num margin ${c.best?.margin != null && c.best.margin < 15 && !job ? 'tight' : ''}`}>{job ? '—' : marginText(c.best?.margin)}</td>
                    <td><LanePill lane={c.lane} /></td>
                  </tr>
                );
              })}
              {ready && rows.length === 0 && (
                <tr><td colSpan={5} className="empty">This incident has no households in your view.</td></tr>
              )}
              {!ready && (
                <tr><td colSpan={5} className="empty">Loading live data…</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <CallbackQueue followups={followups} now={now} onOpen={setSelected} />
      </div>

      {open && <LiveDrawer key={open.h.id} h={open.h} c={open.c} round={currentRound(rounds, open.h.id)} followup={currentFollowup(followups, rounds, open.h.id)} incidentId={incident?.id ?? ''} now={now} onClose={() => setSelected(null)} />}
    </div>
  );
}

type Checkin = { householdId: string; observedAt: { toDate(): Date }; text: string };
function latestCheckin<T extends Checkin>(checkins: readonly T[], id: string) {
  return [...checkins].filter((c) => c.householdId === id).sort((a, b) => b.observedAt.toDate().getTime() - a.observedAt.toDate().getTime())[0];
}

type HouseholdRow = Parameters<typeof evaluateHousehold>[0] & { label: string };

type DrawerProps = { h: HouseholdRow; c: LiveCase; round?: CheckinRound; followup?: Followup; incidentId: string; now: number; onClose: () => void };
function LiveDrawer({ h, c, round, followup, incidentId, now, onClose }: DrawerProps) {
  const [checkins] = useTable(tables.coordinatorCheckins);
  const [jobs] = useTable(tables.coordinatorJobs);
  const reserve = useReducer(reducers.reserve);
  const confirm = useReducer(reducers.confirmRouteReport);
  const ingest = useReducer(reducers.ingestCheckin);
  const release = useReducer(reducers.releaseJob);
  const [drivers] = useTable(tables.coordinatorDrivers);
  const [assets] = useTable(tables.coordinatorAssets);
  const [releaseState, setReleaseState] = useState<{ kind: 'idle' | 'sending' | 'error'; text?: string }>({ kind: 'idle' });
  const [replyErr, setReplyErr] = useState<string | null>(null);
  const [replySending, setReplySending] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'error'; text?: string }>({ kind: 'idle' });
  const [delayErr, setDelayErr] = useState<string | null>(null);
  // Stable per household and route, so a retried click is a duplicate, never a second job.
  const requestIds = useRef(new Map<string, string>());

  const last = latestCheckin(checkins, h.id);
  const job = jobs.find((j) => j.id === h.activeJobId);
  const chosen = c.options.find((o) => o.route.id === (routeId ?? c.best?.route.id)) ?? null;

  const doReserve = () => {
    if (!chosen || state.kind === 'sending') return;
    const key = chosen.route.id;
    if (!requestIds.current.has(key)) requestIds.current.set(key, newId());
    setState({ kind: 'sending' });
    reserve({
      jobRequestId: requestIds.current.get(key)!,
      caseId: h.id,
      routeId: chosen.route.id,
      assetId: chosen.route.assetId,
      driverId: chosen.route.driverId,
      expectedVersion: h.version,
    })
      // Success shows nothing here: the committed job arrives through coordinator_jobs.
      .then(() => setState({ kind: 'idle' }))
      .catch((e: unknown) => setState({ kind: 'error', text: errorText(e) }));
  };

  // A reply the resident gave on the automated call. Photon replies arrive the same way through B's bridge.
  // One event per answer until it lands: a retry after a failed or lost reply reuses the same
  // eventId and observedAt, so the server's dedupe sees the same check-in. Success clears it.
  const pendingReplies = useRef(new Map<string, { eventId: string; observedAt: Timestamp }>());
  const recordReply = (p: (typeof POLL)[number]) => {
    if (replySending) return;
    setReplyErr(null);
    setReplySending(p.text);
    const key = `${h.id}:${p.text}`;
    if (!pendingReplies.current.has(key)) pendingReplies.current.set(key, { eventId: `call-${h.id}-${newId()}`, observedAt: Timestamp.now() });
    const ev = pendingReplies.current.get(key)!;
    ingest({
      eventId: ev.eventId,
      incidentId,
      householdId: h.id,
      observedAt: ev.observedAt,
      text: p.text,
      runtimeLowerMin: p.lo,
      runtimeUpperMin: p.hi,
    })
      .then(() => pendingReplies.current.delete(key))
      .catch((e: unknown) => setReplyErr(errorText(e)))
      .finally(() => setReplySending(null));
  };

  // One report ID per report, reused only when retrying that same report, so a later
  // report on the same route is never mistaken for a duplicate.
  const pendingReports = useRef(new Map<string, string>());
  const confirmDelay = (rid: string) => {
    setDelayErr(null);
    if (!pendingReports.current.has(rid)) pendingReports.current.set(rid, `rep-${rid}-${newId()}`);
    confirm({ reportId: pendingReports.current.get(rid)!, incidentId, routeId: rid, delayMin: DELAY_MIN })
      .then(() => pendingReports.current.delete(rid))
      .catch((e: unknown) => setDelayErr(errorText(e)));
  };

  const scale = c.window ? [Math.min(c.window[0], ...c.options.map((o) => o.ready)) - 10 * 60_000, Math.max(c.window[1] ?? c.window[0], ...c.options.map((o) => o.ready)) + 10 * 60_000] : null;
  const pos = (t: number) => (scale ? `${Math.min(100, Math.max(0, ((t - scale[0]) / (scale[1] - scale[0])) * 100))}%` : '0%');

  return (
    <aside className="drawer" aria-label={`${h.id} details`}>
      <header className="drawer-head">
        <div>
          <h2>{h.id} <span className="tag">Live</span></h2>
          <p className="sub">{h.label}, version {h.version}</p>
        </div>
        <LanePill lane={c.lane} />
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
      </header>
      {!job && <p className="drawer-reason">{titleCase(c.reason)}.{c.silent && c.lane !== 'silent' ? ' The check-in round is also overdue.' : ''}</p>}

      <section className="block">
        <h3>Latest report</h3>
        {last ? (
          <blockquote className="reply">
            <Icon name="message" size={15} />
            <span>
              <b>“{last.text}”</b>
              <span className="sub">
                Observed {hhmm(ms(last.observedAt))}.{' '}
                {c.window ? `Backup runs out ${hhmm(c.window[0])} to ${c.window[1] === null ? 'later' : hhmm(c.window[1])}.` : 'Runtime unknown, so no margin yet.'}
              </span>
            </span>
          </blockquote>
        ) : (
          <p className="sub">No check-in yet, so the runtime is unknown.</p>
        )}
        {!job && (
          <div className="record">
            <span className="sub">Record a reply taken by phone</span>
            <div className="record-row">
              {POLL.map((p) => (
                <button key={p.text} className="btn btn-secondary btn-sm" onClick={() => recordReply(p)} disabled={!!replySending}>
                  {replySending === p.text ? 'Saving…' : p.text}
                </button>
              ))}
            </div>
            {replyErr && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {replyErr}</p>}
          </div>
        )}
      </section>

      {!job && <Outreach h={h} round={round} followup={followup} incidentId={incidentId} now={now} />}

      {!job && c.options.length > 0 && (
        <section className="block">
          <h3>Options</h3>
          <p className="sub">Margin is when backup runs out minus when help can be there.</p>
          <div className="routes" role="radiogroup" aria-label="Route">
            {c.options.map((o) => (
              <label key={o.route.id} className={`route ${o === chosen ? 'on' : ''} ${o.margin !== null && o.margin < 0 ? 'late' : ''}`}>
                <input type="radio" name="route" checked={o === chosen} onChange={() => setRouteId(o.route.id)} disabled={state.kind === 'sending' || o.blocked !== null} />
                <span className="route-head">
                  <b>{o.route.id}</b>
                  <span className="sub">
                    {o.route.assetId}, {titleCase(o.route.driverId)}, ready {hhmm(o.ready)}
                    {o.route.confirmedDelayMin ? `, +${o.route.confirmedDelayMin} min confirmed` : ''}
                    {o.blocked ? `, ${o.blocked}` : ''}
                  </span>
                  <span className={`route-margin ${o.margin !== null && o.margin < 15 ? 'tight' : ''}`}>
                    {o.margin !== null && o.margin < 0 && <Icon name="alert" size={13} />}
                    {marginText(o.margin)}
                  </span>
                </span>
                {c.window && (
                  <span className="track" aria-hidden="true">
                    <span className="band" style={{ left: pos(c.window[0]), right: `calc(100% - ${pos(c.window[1] ?? scale![1])})` }} />
                    <span className="ready" style={{ left: pos(o.ready) }} />
                  </span>
                )}
                {!o.route.confirmedDelayMin && (
                  <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); confirmDelay(o.route.id); }}>
                    Confirm a reported +{DELAY_MIN} min delay on {o.route.id}
                  </button>
                )}
              </label>
            ))}
          </div>
          {delayErr && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {delayErr}</p>}
          {chosen && chosen.margin !== null && chosen.margin < 0 && <p className="warn-text"><Icon name="alert" size={14} /> {chosen.route.id} arrives after backup may run out.</p>}
          <button className="btn btn-primary btn-block" onClick={doReserve} disabled={!chosen || chosen.blocked !== null || state.kind === 'sending'}>
            {state.kind === 'sending' ? 'Reserving…' : chosen ? `Reserve ${chosen.route.assetId} and send ${titleCase(chosen.route.driverId)} on ${chosen.route.id}` : 'No free option'}
          </button>
          {state.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {state.text}</p>}
        </section>
      )}

      {job && (
        <section className="block">
          <p className="result result-committed" role="status">
            <Icon name="checkCircle" size={16} /> Committed as job {String(job.id)}. {job.assetId} and {titleCase(job.driverId)} on {job.routeId}, arriving about {hhmm(ms(job.etaAt))}.
          </p>
          <ol className="steps steps-3">
            {['assigned', 'arrived', 'delivered'].map((st, i, all) => {
              const at = all.indexOf(job.status);
              return (
                <li key={st} className={i <= at ? 'done' : i === at + 1 ? 'next' : ''}>
                  <span className="dot">{i <= at && <Icon name="check" size={11} />}</span>
                  {titleCase(st)}
                </li>
              );
            })}
          </ol>
          {job.status === 'delivered' && (() => {
            // Delivery alone keeps the battery and driver on this job; the coordinator returns
            // them to the pool (A's releaseJob). The household stays Dispatched: help arrived.
            const held = drivers.some((d) => d.activeJobId === job.id) || assets.some((a) => a.activeJobId === job.id);
            if (!held) return <p className="sub"><Icon name="checkCircle" size={14} /> {job.assetId} and {titleCase(job.driverId)} are free for the next household.</p>;
            const doRelease = () => {
              if (releaseState.kind === 'sending') return;
              setReleaseState({ kind: 'sending' });
              release({ jobId: job.id, expectedVersion: job.version })
                .then(() => setReleaseState({ kind: 'idle' }))
                .catch((e: unknown) => setReleaseState({ kind: 'error', text: errorText(e) }));
            };
            return (
              <>
                <button className="btn btn-quiet btn-block" onClick={doRelease} disabled={releaseState.kind === 'sending'}>
                  {releaseState.kind === 'sending' ? 'Releasing…' : `Release ${job.assetId} and ${titleCase(job.driverId)} for the next household`}
                </button>
                {releaseState.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {releaseState.text}</p>}
              </>
            );
          })()}
          <h3>Thread</h3>
          <div className="drawer-thread">
            <Thread jobId={job.id} me="coordinator" canSend={false} />
          </div>
        </section>
      )}
    </aside>
  );
}

// ---- TL-11 outreach rounds and callbacks (A's openCheckinRound / claimFollowup) ----

// The household's open or silent round. A reply closes it on the server (answered).
function currentRound(rounds: readonly CheckinRound[], householdId: string) {
  return rounds.find((r) => r.householdId === householdId && (r.status === 'open' || r.status === 'silent'));
}
// The callback for that round, while it still needs someone.
function currentFollowup(followups: readonly Followup[], rounds: readonly CheckinRound[], householdId: string) {
  const r = currentRound(rounds, householdId);
  return r && followups.find((f) => f.roundId === r.id && f.status !== 'cancelled');
}

const short = (hex: string) => hex.slice(0, 6);
function useOwner() {
  const { identity } = useSpacetimeDB();
  const me = identity?.toHexString();
  return (owner: { toHexString(): string }) => (owner.toHexString() === me ? 'You' : `Coordinator ${short(owner.toHexString())}`);
}
const dueText = (due: number, now: number) => {
  const s = Math.round((due - now) / 1000);
  return s > 0 ? `due ${hhmm(due)}, in ${s < 90 ? `${s} s` : `${Math.round(s / 60)} min`}` : `overdue since ${hhmm(due)}`;
};

type Status = { kind: 'idle' | 'sending' | 'error'; text?: string };

function Outreach({ h, round, followup, incidentId, now }: { h: HouseholdRow; round?: CheckinRound; followup?: Followup; incidentId: string; now: number }) {
  const open = useReducer(reducers.openCheckinRound);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // One round per click, reused on retry; the server ignores a repeated roundKey.
  const roundKey = useRef<string | null>(null);

  const start = () => {
    if (status.kind === 'sending') return;
    roundKey.current ??= `round-${h.id}-${newId()}`;
    setStatus({ kind: 'sending' });
    open({ roundKey: roundKey.current, incidentId, householdId: h.id })
      .then(() => { roundKey.current = null; setStatus({ kind: 'idle' }); })
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorText(e) }));
  };

  return (
    <section className="block">
      <h3>Check-in round</h3>
      {!round && (
        <>
          <p className="sub">Start a round when you reach out to {h.id}. If no reply comes before it is due, the household moves to Silent and you own the callback.</p>
          <button className="btn btn-secondary" onClick={start} disabled={status.kind === 'sending'}>
            {status.kind === 'sending' ? 'Starting…' : `Start a check-in round for ${h.id}`}
          </button>
        </>
      )}
      {round && round.status === 'open' && (
        <p className="sub">Round {String(round.id)} opened {hhmm(ms(round.openedAt))}, {dueText(ms(round.dueAt), now)}. A reply closes it.</p>
      )}
      {round && round.status === 'silent' && !followup && <p className="sub">Round {String(round.id)} is overdue without a reply.</p>}
      {followup && <Callback f={followup} now={now} />}
      {status.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {status.text}</p>}
    </section>
  );
}

// One callback: owner, due time, escalation level, last evidence and its audit trail.
function Callback({ f, now }: { f: Followup; now: number }) {
  const owner = useOwner();
  const [audit] = useTable(tables.coordinatorFollowupAudit);
  const trail = audit.filter((a) => a.followupId === f.id).sort((a, b) => ms(a.at) - ms(b.at));
  return (
    <div className="callback">
      <p>
        <b>Silent.</b> Callback owner: {owner(f.owner)}{f.status === 'claimed' ? ' (claimed)' : ''}. {titleCase(dueText(ms(f.dueAt), now))}.
        {f.escalationLevel > 0 && ` Escalation level ${f.escalationLevel}.`}
      </p>
      <p className="sub">
        {f.lastObservedAt
          ? `Last evidence ${hhmm(ms(f.lastObservedAt))}: ${f.runtimeLowerMin === undefined ? 'runtime unknown' : `${f.runtimeLowerMin}${f.runtimeUpperMin === undefined ? '+' : ` to ${f.runtimeUpperMin}`} min of backup`}.`
          : 'No evidence before the round. Runtime unknown.'}
      </p>
      <ClaimButton f={f} />
      {trail.length > 0 && (
        <ol className="audit">
          {trail.map((a) => (
            <li key={String(a.id)}><span>{hhmm(ms(a.at))}</span> {titleCase(a.action)}: {a.note}. Owner: {owner(a.owner)}.</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ClaimButton({ f }: { f: Followup }) {
  const claim = useReducer(reducers.claimFollowup);
  const { identity } = useSpacetimeDB();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const mine = f.status === 'claimed' && f.owner.toHexString() === identity?.toHexString();
  if (mine) return null;
  const go = () => {
    if (status.kind === 'sending') return;
    setStatus({ kind: 'sending' });
    // The version on screen: if someone else claimed first, the server answers conflict:.
    claim({ followupId: f.id, expectedVersion: f.version })
      .then(() => setStatus({ kind: 'idle' }))
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorText(e) }));
  };
  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); go(); }} disabled={status.kind === 'sending'}>
        {status.kind === 'sending' ? 'Claiming…' : `Claim the callback for ${f.householdId}`}
      </button>
      {status.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {status.text}</p>}
    </>
  );
}

function CallbackQueue({ followups, now, onOpen }: { followups: readonly Followup[]; now: number; onOpen: (id: string) => void }) {
  const owner = useOwner();
  const live = [...followups].filter((f) => f.status !== 'cancelled').sort((a, b) => ms(a.dueAt) - ms(b.dueAt));
  return (
    <section className="panel queue" aria-label="Callback queue">
      <header className="queue-head">
        <h2>Callbacks</h2>
        <span className="sub">{live.length === 0 ? 'No silent households need a callback.' : `${live.length} silent household${live.length === 1 ? '' : 's'} to call back`}</span>
      </header>
      {live.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Household</th><th>Owner</th><th>Due</th><th className="num">Level</th><th /></tr>
          </thead>
          <tbody>
            {live.map((f) => (
              <tr key={String(f.id)} onClick={() => onOpen(f.householdId)}>
                <td><button className="row-open" onClick={() => onOpen(f.householdId)}><b>{f.householdId}</b></button></td>
                <td>{owner(f.owner)}{f.status === 'claimed' ? ', claimed' : ''}</td>
                <td>{dueText(ms(f.dueAt), now)}</td>
                <td className="num">{f.escalationLevel}</td>
                <td><ClaimButton f={f} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
