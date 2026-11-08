import { DEMO_DRIVER, findCase, fmtTime } from '../fixture';
import { updateJob, useFixture } from '../store';
import { Thread } from '../Thread';

export function Driver() {
  const s = useFixture();
  const job = s.jobs.filter((j) => j.driverId === DEMO_DRIVER).at(-1);

  if (!job) {
    return (
      <main className="phone">
        <header>
          <p className="muted">Driver Ana</p>
          <h1>No stop assigned</h1>
        </header>
        <p className="muted">Your next assignment appears here as soon as a coordinator commits it.</p>
      </main>
    );
  }

  const { incident, c } = findCase(job.caseId);
  return (
    <main className="phone">
      <header>
        <p className="muted">Driver Ana</p>
        <h1>Household {c.householdId}</h1>
      </header>
      <section className="status">
        <p className="eta">Ready by {fmtTime(job.readyAt)}</p>
        <p>{c.address}</p>
        <p>
          Bring {incident.assets[job.assetId]} via {job.routeId}. {c.need}.
        </p>
        {job.status === 'assigned' && <button onClick={() => updateJob(job.jobId, job.version, 'arrived')}>Mark arrived</button>}
        {job.status === 'arrived' && <p className="muted">Waiting for the resident to confirm they received it.</p>}
        {job.status === 'received' && <p className="confirmed">Resident confirmed receipt.</p>}
      </section>
      <Thread jobId={job.jobId} me="driver" placeholder="Yes, I'll meet you there." />
    </main>
  );
}
