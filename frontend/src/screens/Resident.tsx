import { DEMO_RESIDENT_CASE, findCase, fmtTime } from '../fixture';
import { updateJob, useFixture } from '../store';
import { Thread } from '../Thread';

export function Resident() {
  const s = useFixture();
  const { incident, c } = findCase(DEMO_RESIDENT_CASE);
  const job = s.jobs.find((j) => j.caseId === c.caseId);
  const driver = job ? incident.drivers[job.driverId] : '';
  const heading = !job
    ? 'We got your report'
    : { assigned: `${driver} is on the way`, arrived: `${driver} has arrived`, received: 'Delivery confirmed' }[job.status];

  return (
    <main className="phone">
      <header>
        <p className="muted">Household {c.householdId}</p>
        <h1>{heading}</h1>
      </header>

      {!job && c.evidence && (
        <section className="status">
          <p>
            You told us at {fmtTime(c.evidence.observedAt)}: “{c.evidence.text}”
          </p>
          <p className="muted">A coordinator is matching a battery and a driver. You can reply here once someone is assigned.</p>
        </section>
      )}

      {job && (
        <>
          <section className="status">
            <p className="eta">Ready by {fmtTime(job.readyAt)}</p>
            <p>
              {incident.drivers[job.driverId]} is bringing {incident.assets[job.assetId]}.
            </p>
            {job.status === 'arrived' && (
              <>
                <p className="confirmed">{incident.drivers[job.driverId]} has arrived.</p>
                <button onClick={() => updateJob(job.jobId, job.version, 'received')}>I received the battery</button>
              </>
            )}
          </section>
          <Thread jobId={job.jobId} me="resident" placeholder="Can you use the side entrance?" />
        </>
      )}
    </main>
  );
}
