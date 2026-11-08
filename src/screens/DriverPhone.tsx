import { useState } from 'react';
import { DELAY, DEMO_ID, NEED_LABEL, fmt } from '../demo/fixture';
import { postMessage, reportDelay, updateJob, useDemo, type JobStatus } from '../demo/store';
import { Icon } from '../ui/icons';

const ACTION: Partial<Record<JobStatus, { next: JobStatus; label: string }>> = {
  reserved: { next: 'en_route', label: 'Start route' },
  en_route: { next: 'arrived', label: 'I have arrived' },
};

export function DriverPhone() {
  const s = useDemo();
  const [draft, setDraft] = useState('');
  const job = s.job;
  const chat = s.messages.filter((m) => m.channel === 'Chat');
  const act = job ? ACTION[job.status] : undefined;

  return (
    <div className="phone-stage">
      <div className="phone driver" aria-label="Driver phone, Ana">
        <div className="phone-bar">
          <span>{fmt(s.clock)}</span>
          <span className="sim">Driver app, Ana</span>
        </div>

        <div className="driver-body">
          {!job && (
            <section className="job idle">
              <h2>Standing by</h2>
              <p className="sub">BAT-01 loaded. Near route R4.</p>
              {s.outage && !s.delayReported && (
                <button className="btn btn-secondary btn-block" onClick={reportDelay}>
                  <Icon name="route" size={15} />
                  Report: {DELAY.text}
                </button>
              )}
              {s.delayReported && (
                <p className={`result ${s.delayConfirmed ? 'result-committed' : 'result-duplicate'}`} role="status">
                  <Icon name={s.delayConfirmed ? 'checkCircle' : 'clock'} size={15} />
                  {s.delayConfirmed ? 'Reported. Dispatch confirmed the delay.' : 'Reported. Waiting for dispatch to confirm.'}
                </p>
              )}
            </section>
          )}

          {job && (
            <section className="job">
              <h2>{DEMO_ID}, {s.registration ? NEED_LABEL[s.registration.need] : ''}</h2>
              <dl className="facts">
                <div><dt>Job</dt><dd>{job.jobId}</dd></div>
                <div><dt>Address</dt><dd>{s.registration?.address}</dd></div>
                {s.registration?.confirmed?.some((c) => c.id === 'step_free_access') && <div><dt>Access</dt><dd>Step-free access</dd></div>}
                <div><dt>Carry</dt><dd>{job.assetId}</dd></div>
                <div><dt>Route</dt><dd>{job.routeId}{job.routeId !== DELAY.routeId && s.delayConfirmed ? `, avoids ${DELAY.routeId}` : ''}</dd></div>
                <div><dt>Arrive by</dt><dd className="num">{fmt(job.eta)}</dd></div>
              </dl>
              {act && (
                <button className="btn btn-primary btn-block" onClick={() => updateJob(job.jobId, job.version, act.next)}>
                  {act.label}
                </button>
              )}
              {job.status === 'arrived' && <p className="callout">Waiting for the resident to confirm receipt.</p>}
              {job.status === 'received' && <p className="result result-committed"><Icon name="checkCircle" size={15} /> Delivered and confirmed.</p>}
            </section>
          )}

          {job && (
            <section className="thread small" aria-live="polite">
              {chat.length === 0 && <p className="thread-empty">Messages with the resident appear here.</p>}
              {chat.map((m) => (
                <div key={m.id} className={`bubble ${m.from === 'driver' ? 'me' : 'them'}`}>
                  {m.text}
                  <time>{fmt(m.at)}</time>
                </div>
              ))}
            </section>
          )}
        </div>

        {job && (
          <form
            className="compose"
            onSubmit={(e) => {
              e.preventDefault();
              postMessage('driver', draft);
              setDraft('');
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the resident" aria-label="Message the resident" />
            <button className="icon-btn" disabled={!draft.trim()} aria-label="Send"><Icon name="send" /></button>
          </form>
        )}
      </div>
    </div>
  );
}
