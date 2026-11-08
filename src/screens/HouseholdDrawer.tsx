import { useEffect, useRef, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { DELAY, DEMO_ID, NEED_LABEL, fmt, signed, type Household, type Option } from '../demo/fixture';
import { liveError, liveSuccess } from '../demo/liveReserve';
import { confirmDelay, h17Case, placeCall, reserve, useDemo, type Event, type JobStatus, type Result } from '../demo/store';
import { reducers, tables } from '../module_bindings';
import { Icon, type IconName } from '../ui/icons';
import { LanePill } from './Board';

const EVENT_ICON: Record<Event['kind'], IconName> = {
  registry: 'form',
  outreach: 'message',
  reply: 'phone',
  report: 'route',
  decision: 'bolt',
  dispatch: 'truck',
  delivery: 'checkCircle',
  consent: 'person',
};
const STEPS: { status: JobStatus; label: string }[] = [
  { status: 'reserved', label: 'Reserved' },
  { status: 'en_route', label: 'On the way' },
  { status: 'arrived', label: 'Arrived' },
  { status: 'received', label: 'Received' },
];

// Window and ready time on one shared scale, 02:40 to 03:45.
const SCALE = [160, 225];
const pos = (m: number) => `${Math.min(100, Math.max(0, ((m - SCALE[0]) / (SCALE[1] - SCALE[0])) * 100))}%`;

function RouteRow({ o, window, chosen, onChoose, disabled }: { o: Option; window: [number, number | null]; chosen: boolean; onChoose: () => void; disabled: boolean }) {
  const late = o.lo < 0;
  return (
    <label className={`route ${chosen ? 'on' : ''} ${late ? 'late' : ''}`}>
      <input type="radio" name="route" checked={chosen} onChange={onChoose} disabled={disabled} />
      <span className="route-head">
        <b>{o.routeId}</b>
        <span className="sub">{o.assetId}, {o.driverId}, ready {fmt(o.readyAt)}</span>
        <span className={`route-margin ${o.lo < 15 ? 'tight' : ''}`}>
          {late && <Icon name="alert" size={13} />}
          {signed(o.lo)} min
        </span>
      </span>
      <span className="track" aria-hidden="true">
        <span className="band" style={{ left: pos(window[0]), right: `calc(100% - ${pos(window[1] ?? SCALE[1])})` }} />
        <span className="ready" style={{ left: pos(o.readyAt) }} />
      </span>
    </label>
  );
}

function Fixture({ row, onClose }: { row: Household; onClose: () => void }) {
  return (
    <aside className="drawer" aria-label={`${row.id} details`}>
      <header className="drawer-head">
        <div>
          <h2>{row.id}</h2>
          <p className="sub">{row.name}, {row.street}</p>
        </div>
        <LanePill lane={row.lane} />
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
      </header>
      <dl className="facts">
        <div><dt>Need</dt><dd>{NEED_LABEL[row.need]}</dd></div>
        <div><dt>Last report</dt><dd>{row.report}</dd></div>
        <div><dt>Best option</dt><dd>{row.best}</dd></div>
        <div><dt>Margin</dt><dd className="num">{row.margin === null ? '—' : `${signed(row.margin)} min`}</dd></div>
        {row.owner && <div><dt>Owner</dt><dd>{row.owner}{row.dueAt ? `, due ${fmt(row.dueAt)}` : ''}</dd></div>}
      </dl>
      <p className="fixture-note">Fixture household. Actions in this demo run on {DEMO_ID}.</p>
    </aside>
  );
}

export function HouseholdDrawer({ row, onClose }: { row: Household; onClose: () => void }) {
  const s = useDemo();
  const c = h17Case(s);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const requestId = useRef(`req-${Math.random().toString(36).slice(2, 8)}`);

  // TL-07 (B): live only when this session is a coordinator for H17's own incident.
  // Without that role every view below is empty and the drawer runs D's fixture flow unchanged.
  const [roles] = useTable(tables.myRole);
  const [liveHomes] = useTable(tables.coordinatorHouseholds);
  const [liveRouteRows] = useTable(tables.coordinatorRoutes);
  const [liveJobs] = useTable(tables.coordinatorJobs);
  const reserveLive = useReducer(reducers.reserve);
  const jobsRef = useRef(liveJobs);
  jobsRef.current = liveJobs;
  const role = roles[0];
  const liveHome = liveHomes.find((h) => h.id === DEMO_ID);
  const live = role?.role === 'coordinator' && !!liveHome && liveHome.incidentId === role.incidentId;
  const liveRoutes = liveRouteRows.filter((r) => r.householdId === DEMO_ID).sort((a, b) => a.id.localeCompare(b.id));

  // Follow the rules' best option until the coordinator picks one.
  const chosen = routeId ?? c?.best?.routeId ?? null;
  useEffect(() => setRouteId(null), [s.delayConfirmed]);
  useEffect(() => {
    if (!s.job) setResult(null);
  }, [s.job]);

  if (row.id !== DEMO_ID) return <Fixture row={row} onClose={onClose} />;

  const reg = s.registration!;
  const option = c?.options.find((o) => o.routeId === chosen);
  // Live IDs (route, asset, driver) come from coordinator_routes, not the fixture.
  const liveRoute = liveRoutes.find((r) => r.id === chosen) ?? (routeId ? undefined : liveRoutes[0]);
  const doReserveLive = async () => {
    if (!liveRoute || !liveHome || pending) return;
    const rid = requestId.current; // stable per drawer: a retry or second click is a duplicate
    const existedBefore = jobsRef.current.some((j) => j.requestId === rid);
    setPending(true);
    setResult(null);
    try {
      await reserveLive({
        jobRequestId: rid, caseId: DEMO_ID, routeId: liveRoute.id, assetId: liveRoute.assetId,
        driverId: liveRoute.driverId, expectedVersion: liveHome.version,
      });
      // The coordinator_jobs update can trail the reducer reply by a moment.
      let job = jobsRef.current.find((j) => j.requestId === rid);
      for (let i = 0; i < 20 && !job; i++) {
        await new Promise((r) => setTimeout(r, 100));
        job = jobsRef.current.find((j) => j.requestId === rid);
      }
      setResult(liveSuccess(existedBefore, job, liveRoute.assetId, liveRoute.driverId, liveRoute.id));
    } catch (err) {
      setResult(liveError(err));
    } finally {
      setPending(false);
    }
  };
  const doReserve = () => {
    if (live) return void doReserveLive();
    if (!option || pending) return;
    setPending(true);
    setResult(null);
    // The confirmation appears only once the reserve result comes back.
    setTimeout(() => {
      setResult(reserve(requestId.current, DEMO_ID, option.routeId, option.assetId, option.driverId, s.caseVersion));
      setPending(false);
    }, 500);
  };
  const stepIndex = s.job ? STEPS.findIndex((x) => x.status === s.job!.status) : -1;

  return (
    <aside className="drawer" aria-label={`${DEMO_ID} details`}>
      <header className="drawer-head">
        <div>
          <h2>
            {DEMO_ID} <span className="tag">Synthetic</span>
            <span
              className="tag"
              title={live ? 'Reserve calls the SpacetimeDB reserve reducer' : 'Reserve runs on the local fixture'}
              style={live ? { background: 'var(--green-wash)', borderColor: '#bfe3cc', color: 'var(--green)' } : undefined}
            >
              {live ? 'Live' : 'Fixture'}
            </span>
          </h2>
          <p className="sub">{reg.name}, {reg.age}, {reg.address}</p>
        </div>
        <LanePill lane={row.lane} />
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
      </header>

      <dl className="facts">
        <div><dt>Need</dt><dd>{NEED_LABEL[reg.need]}</dd></div>
        <div><dt>Equipment</dt><dd>{reg.equipment}</dd></div>
        <div><dt>Contact</dt><dd>{reg.contact}</dd></div>
        {s.job?.status === 'received' && (
          <div><dt>Agent contact</dt><dd>{s.agentRequest ? `Requested, ${s.agentRequest.leadId}` : s.agentSkipped ? 'Skipped' : 'Offered, no answer yet'}</dd></div>
        )}
      </dl>

      {!s.outage && <p className="callout">Registered. Nothing to do until an outage reaches this street.</p>}

      {s.outage && !s.answer && (
        <section className="block">
          <h3>Waiting for a reply</h3>
          <p className="sub">
            iMessage check-in sent at {fmt(s.pollSentAt ?? 151)}.
            {s.call === 'ringing' ? ' The call is ringing now.' : s.call === 'missed' ? ' The resident declined the call.' : ' If there is no reply, an automated call goes out at 02:36 (8 seconds in this demo).'}
          </p>
          {(s.call === 'none' || s.call === 'missed') && (
            <button className="btn btn-secondary" onClick={() => placeCall('manual')}>
              <Icon name="phone" size={15} /> {s.call === 'missed' ? 'Call again' : 'Call now'}
            </button>
          )}
        </section>
      )}

      {s.answer && (
        <section className="block">
          <h3>Latest reply</h3>
          <blockquote className="reply">
            <Icon name={s.answeredVia === 'Call' ? 'phone' : 'message'} size={15} />
            <span>
              <b>“{s.answer}”</b>
              <span className="sub">
                {s.answeredVia} at {fmt(s.answeredAt!)}.{' '}
                {c?.window ? `Backup runs out ${fmt(c.window[0])} to ${c.window[1] === null ? 'later' : fmt(c.window[1])}.` : 'Margin unknown, follow-up owned by Maya.'}
              </span>
            </span>
          </blockquote>
        </section>
      )}

      {s.delayReported && !s.delayConfirmed && (
        <section className="callout callout-warn">
          <Icon name="route" size={16} />
          <div>
            <b>{DELAY.from} reported a road problem</b>
            <p>“{DELAY.text}” The margin changes only after you confirm it.</p>
            <button className="btn btn-secondary" onClick={confirmDelay}>Confirm +{DELAY.minutes} min on {DELAY.routeId}</button>
          </div>
        </section>
      )}

      {live && liveRoutes.length > 0 && (
        <section className="block">
          <h3>Options</h3>
          <p className="sub">Live routes for {DEMO_ID}, case version {liveHome!.version}.</p>
          <div className="routes" role="radiogroup" aria-label="Route">
            {liveRoutes.map((r) => (
              <label key={r.id} className={`route ${r.id === liveRoute?.id ? 'on' : ''}`}>
                <input type="radio" name="route" checked={r.id === liveRoute?.id} onChange={() => setRouteId(r.id)} disabled={pending} />
                <span className="route-head">
                  <b>{r.id}</b>
                  <span className="sub">{r.assetId}, {r.driverId}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-block" onClick={doReserve} disabled={!liveRoute || pending}>
            {pending ? 'Reserving…' : `Reserve ${liveRoute?.assetId} and send ${liveRoute?.driverId} on ${liveRoute?.id}`}
          </button>
        </section>
      )}

      {!live && c?.window && !s.job && (
        <section className="block">
          <h3>Options</h3>
          <p className="sub">Margin is when backup runs out minus when help can be there.</p>
          <div className="routes" role="radiogroup" aria-label="Route">
            {c.options.map((o) => (
              <RouteRow key={o.routeId} o={o} window={c.window!} chosen={o.routeId === chosen} onChoose={() => setRouteId(o.routeId)} disabled={pending} />
            ))}
            <div className="scale" aria-hidden="true"><span>02:40</span><span>03:00</span><span>03:20</span><span>03:40</span></div>
          </div>
          {option && option.lo < 0 && <p className="warn-text"><Icon name="alert" size={14} /> {option.routeId} arrives after backup may run out.</p>}
          <button className="btn btn-primary btn-block" onClick={doReserve} disabled={!option || pending}>
            {pending ? 'Reserving…' : `Reserve ${option?.assetId} and send ${option?.driverId} on ${option?.routeId}`}
          </button>
        </section>
      )}

      {result && (live || result.kind !== 'committed') && (
        <p className={`result result-${result.kind}`} role="status">
          <Icon name={result.kind === 'committed' ? 'checkCircle' : 'alert'} size={15} /> {result.text}
        </p>
      )}

      {s.job && (
        <section className="block">
          <p className="result result-committed" role="status">
            <Icon name="checkCircle" size={16} /> Committed. {s.job.assetId} and {s.job.driverId} on {s.job.routeId}, arriving about {fmt(s.job.eta)}.
          </p>
          <ol className="steps">
            {STEPS.map((x, i) => (
              <li key={x.status} className={i <= stepIndex ? 'done' : i === stepIndex + 1 ? 'next' : ''}>
                <span className="dot">{i <= stepIndex && <Icon name="check" size={11} />}</span>
                {x.label}
              </li>
            ))}
          </ol>
        </section>
      )}

      {s.events.length > 0 && (
        <section className="block">
          <h3>Timeline</h3>
          <ol className="timeline">
            {s.events.map((e, i) => (
              <li key={i} className={`t-${e.kind}`}>
                <time>{fmt(e.at)}</time>
                <span className="t-icon"><Icon name={e.kind === 'reply' && e.who.includes('iMessage') ? 'message' : EVENT_ICON[e.kind]} size={13} /></span>
                <span className="t-body">
                  <b>{e.who}</b> {e.text}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}
