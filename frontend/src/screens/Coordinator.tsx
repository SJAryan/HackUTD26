import { useState } from 'react';
import { Case, Incident, Lane, RouteOption, fmtMargin, fmtTime, incidents } from '../fixture';
import { Job, Result, confirmRouteReport, reserve, useFixture } from '../store';

// Silent and Unknown cases also sit in the Callbacks panel with an owner.
const LANE_ORDER: Lane[] = ['Act now', 'Watch', 'Unknown', 'Silent'];
const minutes = (iso: string) => new Date(iso).getTime() / 60000;

type CaseView = { c: Case; lane: Lane; options: RouteOption[]; job?: Job };

function bestOption(options: RouteOption[]) {
  return options.filter((o) => o.compatible).sort((a, b) => b.marginLo - a.marginLo)[0];
}

function marginRange(o: RouteOption) {
  return o.marginHi === null ? `${fmtMargin(o.marginLo)} min or more` : `${fmtMargin(o.marginLo)} to ${fmtMargin(o.marginHi)} min`;
}

export function Coordinator() {
  const s = useFixture();
  const [incidentId, setIncidentId] = useState(incidents[0].incidentId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const incident = incidents.find((i) => i.incidentId === incidentId)!;
  const reportConfirmed = !!incident.routeReport && s.confirmedReports.includes(incident.routeReport.reportId);

  const views: CaseView[] = incident.cases
    .map((c) => {
      const after = reportConfirmed ? c.afterReport : undefined;
      return { c, lane: after?.lane ?? c.lane, options: after?.options ?? c.options, job: s.jobs.find((j) => j.caseId === c.caseId) };
    })
    .sort((a, b) => Number(!!a.job) - Number(!!b.job) || LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane));
  const selected = views.find((v) => v.c.caseId === selectedId) ?? views[0];
  const callbacks = views.filter((v) => v.c.callback);

  return (
    <main className="coordinator">
      <header className="board-head">
        <div>
          <h1>Dispatch board</h1>
          <p className="muted">
            Incident clock {fmtTime(incident.clock)} (fixed). {incident.numbersSource}.
          </p>
        </div>
        <label className="incident-picker">
          Incident
          <select
            value={incidentId}
            onChange={(e) => {
              setIncidentId(e.target.value);
              setSelectedId(null);
            }}
          >
            {incidents.map((i) => (
              <option key={i.incidentId} value={i.incidentId}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="board">
        <nav className="queue" aria-label="Households by priority">
          <h2>Households</h2>
          <ul>
            {views.map((v) => {
              const best = bestOption(v.options);
              return (
                <li key={v.c.caseId}>
                  <button
                    className={v === selected ? 'queue-item current' : 'queue-item'}
                    aria-current={v === selected}
                    onClick={() => setSelectedId(v.c.caseId)}
                  >
                    <span className="queue-title">{v.c.householdId}</span>
                    {v.job ? <span className="lane lane-assigned">Assigned</span> : <LaneChip lane={v.lane} />}
                    <span className="queue-sub">
                      {v.job
                        ? `${incident.drivers[v.job.driverId]} via ${v.job.routeId}`
                        : best
                          ? `Best margin ${fmtMargin(best.marginLo)} min`
                          : v.c.callback
                            ? `Callback due ${fmtTime(v.c.callback.dueAt)}`
                            : 'No compatible resource'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <CaseDetail
          key={selected.c.caseId}
          incident={incident}
          view={selected}
          reportConfirmed={reportConfirmed}
          onAssigned={() => setSelectedId(selected.c.caseId)}
        />

        <aside className="side">
          {incident.routeReport && (
            <section className="panel">
              <h2>Route report</h2>
              <p>
                <strong>{incident.routeReport.from}:</strong> “{incident.routeReport.text}”
              </p>
              {reportConfirmed ? (
                <p className="confirmed">Confirmed. Margins on {incident.routeReport.routeId} now include the delay.</p>
              ) : (
                <button className="secondary" onClick={() => confirmRouteReport(incident.routeReport!.reportId)}>
                  Confirm {incident.routeReport.delayMinutes}-minute delay on {incident.routeReport.routeId}
                </button>
              )}
            </section>
          )}
          <section className="panel">
            <h2>Callbacks</h2>
            {callbacks.length === 0 ? (
              <p className="muted">No open callbacks.</p>
            ) : (
              <ul className="callbacks">
                {callbacks.map((v) => (
                  <li key={v.c.caseId}>
                    <strong>{v.c.householdId}</strong> <LaneChip lane={v.lane} />
                    <p>{v.c.callback!.reason}</p>
                    <p className="muted">
                      Owner {v.c.callback!.owner}, due {fmtTime(v.c.callback!.dueAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function LaneChip({ lane }: { lane: Lane }) {
  return <span className={`lane lane-${lane.replace(' ', '-').toLowerCase()}`}>{lane}</span>;
}

function CaseDetail({
  incident,
  view,
  reportConfirmed,
  onAssigned,
}: {
  incident: Incident;
  view: CaseView;
  reportConfirmed: boolean;
  onAssigned: () => void;
}) {
  const { c, lane, options, job } = view;
  const [result, setResult] = useState<Result | null>(null);
  const best = bestOption(options);

  function assign(o: RouteOption) {
    onAssigned(); // keep this household on screen after it sorts below open cases
    setResult(
      reserve({
        jobRequestId: crypto.randomUUID(),
        caseId: c.caseId,
        routeId: o.routeId,
        assetId: o.assetId,
        driverId: o.driverId,
        readyAt: o.readyAt,
        expectedVersion: reportConfirmed ? 2 : 1,
      }),
    );
  }

  return (
    <section className="detail" aria-label={`Household ${c.householdId}`}>
      <div className="detail-head">
        <h2>Household {c.householdId}</h2>
        {job ? <span className="lane lane-assigned">Assigned</span> : <LaneChip lane={lane} />}
      </div>
      <p className="muted">
        {c.address}. {c.need}.
      </p>

      {c.evidence ? (
        <blockquote className="evidence">
          <p>“{c.evidence.text}”</p>
          <footer>
            {c.evidence.source} at {fmtTime(c.evidence.observedAt)}
            {c.windowLo && c.windowHi && (
              <>
                . Backup runs out between {fmtTime(c.windowLo)} and {fmtTime(c.windowHi)}.
              </>
            )}
          </footer>
        </blockquote>
      ) : (
        <p className="evidence-missing">No reply from this household yet. The callback owner follows up.</p>
      )}

      {options.length > 0 && c.evidence && c.windowLo && (
        <RouteTimeline c={c} options={options} best={best} assignable={!job} onAssign={assign} incident={incident} />
      )}
      {c.evidence && !c.windowLo && <p className="evidence-missing">No usable time window yet. The callback owner asks for one.</p>}

      {job && (
        <p className="job-line">
          Job {job.jobId} committed. {incident.drivers[job.driverId]} brings {incident.assets[job.assetId]} via {job.routeId}, ready by{' '}
          {fmtTime(job.readyAt)}. Status: {job.status}.
        </p>
      )}
      {result && result.status !== 'committed' && (
        <p className="error" role="alert">
          {result.status === 'duplicate' ? 'Already assigned.' : result.reason}
        </p>
      )}
    </section>
  );
}

function RouteTimeline({
  incident,
  c,
  options,
  best,
  assignable,
  onAssign,
}: {
  incident: Incident;
  c: Case;
  options: RouteOption[];
  best?: RouteOption;
  assignable: boolean;
  onAssign: (o: RouteOption) => void;
}) {
  const start = minutes(c.evidence!.observedAt);
  const lo = minutes(c.windowLo!);
  const hi = c.windowHi ? minutes(c.windowHi) : lo + 30;
  const latest = Math.max(hi, ...[...c.options, ...(c.afterReport?.options ?? [])].map((o) => minutes(o.readyAt)));
  const end = latest + 5;
  const pct = (m: number) => `${((m - start) / (end - start)) * 100}%`;
  const original = (routeId: string) => c.options.find((o) => o.routeId === routeId);

  return (
    <div className="routes">
      <div className="route axis-row" aria-hidden="true">
        <span />
        <div className="axis">
          <span style={{ left: pct(start) }}>{fmtTime(c.evidence!.observedAt)}</span>
          <span style={{ left: pct(lo) }}>{fmtTime(c.windowLo!)}</span>
          {c.windowHi && <span style={{ left: pct(hi) }}>{fmtTime(c.windowHi)}</span>}
        </div>
      </div>
      <ul>
        {options.map((o) => {
          const was = original(o.routeId);
          const changed = was && was.marginLo !== o.marginLo;
          const isBest = o === best;
          return (
            <li key={o.routeId} className={isBest ? 'route best' : 'route'}>
              <div className="route-name">
                <strong>
                  {o.routeId}, {incident.drivers[o.driverId]}
                </strong>
                <span className="muted">{o.reason}</span>
              </div>
              <div className="track" role="img" aria-label={`${o.routeId} ready at ${fmtTime(o.readyAt)}. Margin ${marginRange(o)}.`}>
                <div className="window" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
                <div className={o.marginLo < 0 ? 'bar late' : 'bar'} style={{ width: pct(minutes(o.readyAt)) }} />
                <span className="ready" style={{ left: pct(minutes(o.readyAt)) }}>
                  {fmtTime(o.readyAt)}
                </span>
              </div>
              <div className={o.marginLo < 0 ? 'margin late' : 'margin'}>
                <span className="margin-lo">{fmtMargin(o.marginLo)}</span>
                <span className="margin-unit">{marginRange(o)}</span>
                {changed && <span className="was">was {fmtMargin(was.marginLo)}</span>}
              </div>
              <button className={isBest ? '' : 'secondary'} disabled={!assignable || !o.compatible} onClick={() => onAssign(o)}>
                Assign {o.routeId}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="legend muted">Shaded: when the household's backup runs out. Margin counts from the low estimate.</p>
    </div>
  );
}
