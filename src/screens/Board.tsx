import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_ID, LANE_LABEL, NEED_LABEL, RESOURCES, fmt, signed, type Household, type Lane } from '../demo/fixture';
import { agentOptIns, householdRows, startOutage, useDemo } from '../demo/store';
import { Icon, type IconName } from '../ui/icons';
import { HouseholdDrawer } from './HouseholdDrawer';

const RANK: Record<Lane, number> = { act: 0, watch: 1, unknown: 2, silent: 3, dispatched: 4, registered: 5 };
const LANE_ICON: Record<Lane, IconName> = { act: 'alert', watch: 'eye', unknown: 'question', silent: 'phoneOff', dispatched: 'checkCircle', registered: 'form' };
const FILTERS: (Lane | 'all')[] = ['all', 'act', 'watch', 'unknown', 'silent', 'dispatched'];
const PAGE = 25;

export function LanePill({ lane }: { lane: Lane }) {
  return (
    <span className={`pill pill-${lane}`}>
      <Icon name={LANE_ICON[lane]} size={13} />
      {LANE_LABEL[lane]}
    </span>
  );
}

function sortRows(rows: Household[]) {
  return [...rows].sort(
    (a, b) => RANK[a.lane] - RANK[b.lane] || (a.margin ?? 999) - (b.margin ?? 999) || (a.id === DEMO_ID ? -1 : b.id === DEMO_ID ? 1 : 0),
  );
}

const marginText = (m: number | null) => (m === null ? '—' : `${signed(m)} min`);

export function Board() {
  const s = useDemo();
  const rows = useMemo(() => sortRows(householdRows(s)), [s]);
  const [filter, setFilter] = useState<Lane | 'all'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(s.registration && window.matchMedia('(min-width: 1181px)').matches ? DEMO_ID : null);

  // One motion moment: H17's row flashes when the rules move it to a new lane.
  const h17Lane = rows.find((r) => r.id === DEMO_ID)?.lane;
  const prevLane = useRef(h17Lane);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const changed = prevLane.current && h17Lane && prevLane.current !== h17Lane;
    prevLane.current = h17Lane;
    if (!changed) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [h17Lane]);

  const counts = useMemo(() => {
    const c = { all: rows.length } as Record<Lane | 'all', number>;
    for (const l of Object.keys(RANK) as Lane[]) c[l] = 0;
    rows.forEach((r) => c[r.lane]++);
    return c;
  }, [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter(
    (r) => (filter === 'all' || r.lane === filter) && (!q || `${r.id} ${r.name} ${r.street} ${NEED_LABEL[r.need]}`.toLowerCase().includes(q)),
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = visible.slice(at * PAGE, at * PAGE + PAGE);
  const open = rows.find((r) => r.id === selected) ?? null;

  const pick = (f: Lane | 'all') => {
    setFilter(f);
    setPage(0);
  };

  const batteriesFree = RESOURCES.batteries - RESOURCES.batteriesOut - (s.job ? 1 : 0);
  const driversFree = RESOURCES.drivers - RESOURCES.driversBusy - (s.job && s.job.status !== 'received' ? 1 : 0);

  return (
    <div className={`board ${open ? 'has-drawer' : ''}`}>
      <div className="board-main">
        {!s.outage && (
          <section className="notice">
            <Icon name="bolt" size={20} />
            <div>
              <h2>No active incident</h2>
              <p>
                {counts.all} households are registered{s.registration ? `, including ${DEMO_ID}` : ''}. When an outage starts, each one gets an iMessage check-in.
              </p>
            </div>
            <button className="btn btn-primary" onClick={startOutage}>
              Start outage at 02:30
            </button>
          </section>
        )}

        <section className="kpis" aria-label="Households by lane">
          {(['act', 'watch', 'unknown', 'silent'] as Lane[]).map((l) => (
            <button key={l} className={`kpi kpi-${l} ${filter === l ? 'on' : ''} ${flash && h17Lane === l ? 'pulse' : ''}`} onClick={() => pick(filter === l ? 'all' : l)} aria-pressed={filter === l}>
              <span className="kpi-label">
                <Icon name={LANE_ICON[l]} size={15} />
                {LANE_LABEL[l]}
              </span>
              <b>{counts[l]}</b>
              <span className="kpi-sub">
                {l === 'act' ? 'Under 15 min' : l === 'watch' ? '15 min or more' : l === 'unknown' ? 'Follow-up set' : 'Callback set'}
              </span>
            </button>
          ))}
          <div className="kpi kpi-res">
            <span className="kpi-label">
              <Icon name="battery" size={15} />
              Free now
            </span>
            <dl>
              <div><dt>Batteries</dt><dd>{batteriesFree} of {RESOURCES.batteries}</dd></div>
              <div><dt>Generators</dt><dd>{RESOURCES.generators - RESOURCES.generatorsOut} of {RESOURCES.generators}</dd></div>
              <div><dt>Drivers</dt><dd>{driversFree} of {RESOURCES.drivers}</dd></div>
            </dl>
          </div>
        </section>

        <p className="programs" aria-label="Programs, counted separately">
          <span><b>{counts.all}</b> registered for preparedness</span>
          <span><b>{agentOptIns(s)}</b> asked for agent contact after help</span>
          <span className="sub">Opt-ins are counted apart from registrations. Help never depends on them.</span>
        </p>

        <section className="panel">
          <div className="toolbar">
            <div className="tabs" role="group" aria-label="Filter by lane">
              {FILTERS.map((f) => (
                <button key={f} aria-pressed={filter === f} className={`${filter === f ? 'on' : ''} ${flash && h17Lane === f ? 'pulse' : ''}`} onClick={() => pick(f)}>
                  {f === 'all' ? 'All' : LANE_LABEL[f]}
                  <span className="count">{counts[f]}</span>
                </button>
              ))}
            </div>
            <label className="search">
              <Icon name="search" size={15} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search household, street or need"
                aria-label="Search households"
              />
            </label>
          </div>

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
              {shown.map((r) => (
                <tr key={r.id} className={`${r.id === selected ? 'sel' : ''} ${r.id === DEMO_ID && flash ? 'flash' : ''}`} onClick={() => setSelected(r.id)}>
                  <td>
                    <button className="row-open" onClick={() => setSelected(r.id)}>
                      <b>{r.id}</b>
                      {r.id === DEMO_ID && <span className="tag">Demo</span>}
                    </button>
                    <span className="sub">{NEED_LABEL[r.need]}</span>
                  </td>
                  <td className="report">{r.report}</td>
                  <td>
                    {r.best}
                    {r.owner && <span className="sub">{r.owner}{r.dueAt ? ` by ${fmt(r.dueAt)}` : ''}</span>}
                  </td>
                  <td className={`num margin ${r.margin !== null && r.margin < 15 ? 'tight' : ''}`}>{marginText(r.margin)}</td>
                  <td><LanePill lane={r.lane} /></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">No households match. Clear the search or pick another lane.</td>
                </tr>
              )}
            </tbody>
          </table>

          <ul className="cards" aria-label="Households">
            {shown.map((r) => (
              <li key={r.id}>
                <button className={`card ${r.id === selected ? 'sel' : ''} ${r.id === DEMO_ID && flash ? 'flash' : ''}`} onClick={() => setSelected(r.id)}>
                  <span className="card-top">
                    <b>{r.id}</b>
                    <LanePill lane={r.lane} />
                    <span className={`margin ${r.margin !== null && r.margin < 15 ? 'tight' : ''}`}>{r.margin === null ? '' : marginText(r.margin)}</span>
                  </span>
                  <span className="sub">{NEED_LABEL[r.need]}, {r.report}</span>
                  <span className="sub">{r.best}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="empty">No households match.</li>}
          </ul>

          <div className="pager">
            <span>{visible.length === 0 ? 'No results' : `${at * PAGE + 1} to ${Math.min(visible.length, at * PAGE + PAGE)} of ${visible.length}`}</span>
            <button className="btn btn-quiet" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
            <button className="btn btn-quiet" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
          </div>
        </section>
      </div>

      {open && <HouseholdDrawer row={open} onClose={() => setSelected(null)} />}
    </div>
  );
}
