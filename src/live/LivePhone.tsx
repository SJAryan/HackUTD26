import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { Icon } from '../ui/icons';
import { LiveAgentOffer } from './LiveConsent';
import { errorText, hhmm, ms, newId, titleCase } from './model';

type Pending = { cid: string; text: string; state: 'sending' | 'failed'; error?: string };
type Me = 'driver' | 'resident' | 'coordinator';

// Job thread from job_messages, ordered by seq. A send shows "Sending" until its row arrives
// through the subscription, then counts as sent. A failed send keeps its clientMessageId so a
// retry can never post twice.
export function Thread({ jobId, me, canSend, suggestion }: { jobId: bigint; me: Me; canSend: boolean; suggestion?: string }) {
  const [all] = useTable(tables.jobMessages);
  const post = useReducer(reducers.postJobMessage);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);

  const msgs = all.filter((m) => m.jobId === jobId).sort((a, b) => a.seq - b.seq);
  const seen = new Set(msgs.map((m) => m.clientMessageId));
  const waiting = pending.filter((p) => !seen.has(p.cid));
  const lastMine = [...msgs].reverse().find((m) => m.kind === 'text' && m.senderRole === me);

  const send = (text: string, cid = newId()) => {
    const t = text.trim();
    if (!t) return;
    setPending((p) => [...p.filter((x) => x.cid !== cid), { cid, text: t, state: 'sending' }]);
    post({ jobId, clientMessageId: cid, text: t }).catch((e: unknown) =>
      setPending((p) => p.map((x) => (x.cid === cid ? { ...x, state: 'failed', error: errorText(e) } : x))),
    );
  };

  return (
    <>
      <div className="thread" aria-live="polite">
        {msgs.length === 0 && waiting.length === 0 && <p className="thread-empty">No messages yet.</p>}
        {msgs.map((m) =>
          m.kind === 'text' ? (
            <div key={String(m.id)} className={`bubble ${m.senderRole === me ? 'me' : 'them'}`}>
              {m.senderRole !== me && <span className="who">{m.senderLabel}</span>}
              {m.text}
              <time>{hhmm(ms(m.sentAt))}{m === lastMine ? ', sent' : ''}</time>
            </div>
          ) : (
            <p key={String(m.id)} className="thread-event">
              <Icon name="checkCircle" size={13} /> {m.text.replace(/^\[[a-z]+\]\s*/, '')}, {hhmm(ms(m.sentAt))}
            </p>
          ),
        )}
        {waiting.map((p) => (
          <div key={p.cid} className={`bubble me ${p.state === 'failed' ? 'failed' : 'sending'}`}>
            {p.text}
            {p.state === 'sending' ? (
              <time>Sending…</time>
            ) : (
              <time>
                Not sent: {p.error}{' '}
                <button className="link-btn" onClick={() => send(p.text, p.cid)}>Retry</button>
              </time>
            )}
          </div>
        ))}
        {canSend && suggestion && !msgs.some((m) => m.text === suggestion) && !waiting.length && (
          <div className="poll">
            <button onClick={() => send(suggestion)}>{suggestion}</button>
          </div>
        )}
      </div>
      {canSend && (
        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
            setDraft('');
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message" aria-label="Message" maxLength={1000} />
          <button className="icon-btn" disabled={!draft.trim()} aria-label="Send"><Icon name="send" /></button>
        </form>
      )}
    </>
  );
}

const NEXT: Record<'driver' | 'resident', { from: string; to: string; label: string }> = {
  driver: { from: 'assigned', to: 'arrived', label: 'I have arrived' },
  resident: { from: 'arrived', to: 'delivered', label: 'I received the battery' },
};

export function LivePhone({ as }: { as: 'driver' | 'resident' }) {
  const [driverJobs] = useTable(tables.driverJobs);
  const [residentJobs] = useTable(tables.residentJobs);
  const [stops] = useTable(tables.driverStops);
  const update = useReducer(reducers.updateJob);
  const [status, setStatus] = useState<{ kind: 'idle' | 'sending' | 'error'; text?: string }>({ kind: 'idle' });

  const jobs = as === 'driver' ? driverJobs : residentJobs;
  const job = [...jobs].sort((a, b) => Number(b.id - a.id))[0];
  const step = NEXT[as];
  const driver = job ? titleCase(job.driverId) : '';
  // TL-20: A's driver_stops has a row only while this driver's job is active (until release).
  const stop = as === 'driver' && job ? stops.find((s) => s.jobId === job.id) : undefined;

  const advance = () => {
    if (!job || status.kind === 'sending') return;
    setStatus({ kind: 'sending' });
    update({ jobId: job.id, expectedVersion: job.version, status: step.to })
      .then(() => setStatus({ kind: 'idle' }))
      .catch((e: unknown) => setStatus({ kind: 'error', text: errorText(e) }));
  };

  return (
    <div className="phone-stage">
      <div className={`phone ${as === 'driver' ? 'driver' : ''}`} aria-label={as === 'driver' ? 'Driver phone, live' : 'Resident phone, live'}>
        <div className="phone-bar">
          <span>{hhmm(Date.now())}</span>
          <span className="sim sim-live">Live</span>
        </div>

        {!job && (
          <div className="driver-body">
            <section className="job idle">
              <h2>{as === 'driver' ? 'Standing by' : 'Waiting for dispatch'}</h2>
              <p className="sub">
                {as === 'driver' ? 'Your next job appears here the moment a coordinator reserves it.' : 'When help is assigned, the driver, arrival time and a chat with them appear here.'}
              </p>
            </section>
          </div>
        )}

        {job && (
          <>
            <section className="live-job">
              <h2>
                {as === 'driver'
                  ? job.status === 'delivered' ? `Job ${String(job.id)} done: ${job.assetId} delivered to ${job.householdId}` : `${job.householdId}: deliver ${job.assetId}`
                  : job.status === 'delivered' ? `${driver} brought ${job.assetId}` : `${driver} is bringing ${job.assetId}`}
              </h2>
              <p className="sub">
                {job.status !== 'delivered'
                  ? `Arriving about ${hhmm(ms(job.etaAt))} on ${job.routeId}. Job ${String(job.id)}, ${job.status}.`
                  : as === 'driver'
                    ? 'The resident confirmed delivery. Your next job appears here as soon as a coordinator assigns it.'
                    : `Delivered and confirmed. Job ${String(job.id)}.`}
              </p>
              {stop && job.status !== 'delivered' && (
                stop.onFile ? (
                  <dl className="stop">
                    <div><dt><Icon name="route" size={14} /> Address</dt><dd>{stop.address}</dd></div>
                    <div><dt><Icon name="battery" size={14} /> Equipment</dt><dd>{stop.backupDevice}</dd></div>
                  </dl>
                ) : (
                  <p className="stop stop-missing"><Icon name="phone" size={14} /> No address on file; call the coordinator.</p>
                )
              )}
              {job.status === step.from && (
                <button className={`btn btn-block ${as === 'driver' ? 'btn-primary' : 'btn-accept'}`} onClick={advance} disabled={status.kind === 'sending'}>
                  {status.kind === 'sending' ? 'Saving…' : step.label}
                </button>
              )}
              {status.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {status.text}</p>}
            </section>
            {as === 'resident' && job.status === 'delivered' && (
              <div className="live-offer">
                <LiveAgentOffer />
              </div>
            )}
            <Thread
              jobId={job.id}
              me={as}
              canSend={job.status !== 'delivered'}
              suggestion={as === 'resident' ? 'Can you use the side entrance?' : 'Yes, I’ll meet you there.'}
            />
          </>
        )}
      </div>
    </div>
  );
}
