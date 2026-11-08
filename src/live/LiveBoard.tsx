import { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'spacetimedb';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { LANE_LABEL, signed, type Lane } from '../demo/fixture';
import { Icon } from '../ui/icons';
import { LanePill } from '../screens/Board';
import { Thread } from './LivePhone';
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
  const [incidents] = useTable(tables.myIncident);
  const incident = incidents[0];
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      households
        .map((h) => ({ h, c: evaluateHousehold(h, routes, drivers, assets, now) }))
        .sort((a, b) => RANK[a.c.lane] - RANK[b.c.lane] || (a.c.best?.margin ?? 999) - (b.c.best?.margin ?? 999) || a.h.id.localeCompare(b.h.id)),
    [households, routes, drivers, assets, now],
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
          </div>
        </section>

        <section className="kpis" aria-label="Households by lane">
          {(['act', 'watch', 'unknown', 'silent'] as Lane[]).map((l) => (
            <div key={l} className={`kpi kpi-${l}`}>
              <span className="kpi-label">{LANE_LABEL[l]}</span>
              <b>{counts(l)}</b>
              <span className="kpi-sub">{l === 'act' ? 'Under 15 min' : l === 'watch' ? '15 min or more' : l === 'unknown' ? 'Runtime unknown' : 'No check-in yet'}</span>
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
                    <td>{job ? `${job.assetId}, ${titleCase(job.driverId)}, ${job.status}` : c.best ? `${c.best.route.assetId}, ${titleCase(c.best.route.driverId)}, ${c.best.route.id}` : '—'}</td>
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
      </div>

      {open && <LiveDrawer key={open.h.id} h={open.h} c={open.c} incidentId={incident?.id ?? ''} onClose={() => setSelected(null)} />}
    </div>
  );
}

type Checkin = { householdId: string; observedAt: { toDate(): Date }; text: string };
function latestCheckin<T extends Checkin>(checkins: readonly T[], id: string) {
  return [...checkins].filter((c) => c.householdId === id).sort((a, b) => b.observedAt.toDate().getTime() - a.observedAt.toDate().getTime())[0];
}

type HouseholdRow = Parameters<typeof evaluateHousehold>[0] & { label: string };

function LiveDrawer({ h, c, incidentId, onClose }: { h: HouseholdRow; c: LiveCase; incidentId: string; onClose: () => void }) {
  const [checkins] = useTable(tables.coordinatorCheckins);
  const [jobs] = useTable(tables.coordinatorJobs);
  const reserve = useReducer(reducers.reserve);
  const confirm = useReducer(reducers.confirmRouteReport);
  const ingest = useReducer(reducers.ingestCheckin);
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
  const recordReply = (p: (typeof POLL)[number]) => {
    if (replySending) return;
    setReplyErr(null);
    setReplySending(p.text);
    ingest({
      eventId: `call-${h.id}-${newId()}`,
      incidentId,
      householdId: h.id,
      observedAt: Timestamp.now(),
      text: p.text,
      runtimeLowerMin: p.lo,
      runtimeUpperMin: p.hi,
    })
      .catch((e: unknown) => setReplyErr(errorText(e)))
      .finally(() => setReplySending(null));
  };

  const confirmDelay = (rid: string) => {
    setDelayErr(null);
    confirm({ reportId: `rep-${rid}-${DELAY_MIN}`, incidentId, routeId: rid, delayMin: DELAY_MIN }).catch((e: unknown) => setDelayErr(errorText(e)));
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
          <p className="sub">No check-in yet. This household stays in Silent until it replies.</p>
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

      {!job && c.options.length > 0 && (
        <section className="block">
          <h3>Options</h3>
          <p className="sub">Margin is when backup runs out minus when help can be there.</p>
          <div className="routes" role="radiogroup" aria-label="Route">
            {c.options.map((o) => (
              <label key={o.route.id} className={`route ${o === chosen ? 'on' : ''} ${o.margin !== null && o.margin < 0 ? 'late' : ''}`}>
                <input type="radio" name="route" checked={o === chosen} onChange={() => setRouteId(o.route.id)} disabled={state.kind === 'sending' || o.busy} />
                <span className="route-head">
                  <b>{o.route.id}</b>
                  <span className="sub">
                    {o.route.assetId}, {titleCase(o.route.driverId)}, ready {hhmm(o.ready)}
                    {o.route.confirmedDelayMin ? `, +${o.route.confirmedDelayMin} min confirmed` : ''}
                    {o.busy ? ', busy' : ''}
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
          <button className="btn btn-primary btn-block" onClick={doReserve} disabled={!chosen || chosen.busy || state.kind === 'sending'}>
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
          <h3>Thread</h3>
          <div className="drawer-thread">
            <Thread jobId={job.id} me="coordinator" canSend={false} />
          </div>
        </section>
      )}
    </aside>
  );
}
