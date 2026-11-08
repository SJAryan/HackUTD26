import { useEffect, useRef, useState } from 'react';
import { DELAY, DEMO_ID, NEED_LABEL, fmt, signed, type Household, type Option } from '../demo/fixture';
import { confirmDelay, h17Case, placeCall, reserve, useDemo, type Event, type JobStatus, type Result } from '../demo/store';
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

  // Follow the rules' best option until the coordinator picks one.
  const chosen = routeId ?? c?.best?.routeId ?? null;
  useEffect(() => setRouteId(null), [s.delayConfirmed]);
  useEffect(() => {
    if (!s.job) setResult(null);
  }, [s.job]);

  if (row.id !== DEMO_ID) return <Fixture row={row} onClose={onClose} />;

  const reg = s.registration!;
  const option = c?.options.find((o) => o.routeId === chosen);
  const doReserve = () => {
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
          <h2>{DEMO_ID} <span className="tag">Synthetic</span></h2>
          <p className="sub">{reg.name}, {reg.age}, {reg.address}</p>
        </div>
        <LanePill lane={row.lane} />
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
      </header>

      <dl className="facts">
        <div><dt>Need</dt><dd>{NEED_LABEL[reg.need]}</dd></div>
        <div><dt>Equipment</dt><dd>{reg.equipment}</dd></div>
        <div><dt>Contact</dt><dd>{reg.contact}</dd></div>
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

      {c?.window && !s.job && (
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

      {result && result.kind !== 'committed' && (
        <p className={`result result-${result.kind}`} role="status"><Icon name="alert" size={15} /> {result.text}</p>
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
