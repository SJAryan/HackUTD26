import { useState } from 'react';
import { POLL_ANSWERS, fmt } from '../demo/fixture';
import { answerCall, answerPoll, pollOpen, postMessage, updateJob, useDemo } from '../demo/store';
import { Icon } from '../ui/icons';

// Simulated resident phone. Live iMessage polls and calls come from Photon (B).
export function ResidentPhone() {
  const s = useDemo();
  const [draft, setDraft] = useState('');
  const thread = s.messages;
  const onCall = s.call === 'answered' && !s.answer;
  const name = s.registration?.name.split(' ')[0] ?? 'Resident';

  return (
    <div className="phone-stage">
      <div className="phone" aria-label="Resident phone, simulated">
        <div className="phone-bar">
          <span>{fmt(s.clock)}</span>
          <span className="sim">Simulated iMessage</span>
        </div>

        {s.call === 'ringing' && (
          <div className="call" role="dialog" aria-label="Incoming call">
            <Icon name="phone" size={28} />
            <h2>Before Zero</h2>
            <p>Automated outage check-in</p>
            <div className="call-actions">
              <button className="btn btn-quiet" onClick={() => answerCall(false)}>Decline</button>
              <button className="btn btn-accept" onClick={() => answerCall(true)}>Answer</button>
            </div>
          </div>
        )}

        {onCall && (
          <div className="call" role="dialog" aria-label="Call in progress">
            <h2>How much oxygen backup is left?</h2>
            <p>Before Zero call in progress. Press the key that matches.</p>
            <div className="keypad">
              {POLL_ANSWERS.map((a, i) => (
                <button key={a} onClick={() => answerPoll(a, 'Call')}>
                  <b>{i + 1}</b>
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        <header className="thread-head">
          <span className="avatar">BZ</span>
          <b>Before Zero</b>
        </header>

        <div className="thread" aria-live="polite">
          {!s.registration && <p className="thread-empty">Register on the website first.</p>}
          {s.registration && thread.length === 0 && <p className="thread-empty">No messages yet. {name} is registered.</p>}
          {thread.map((m) => (
            <div key={m.id} className={`bubble ${m.from === 'resident' ? 'me' : 'them'}`}>
              {m.from === 'driver' && <span className="who">Ana, driver</span>}
              {m.text}
              <time>{m.channel === 'Call' ? 'by call' : fmt(m.at)}</time>
            </div>
          ))}
          {pollOpen(s) && !onCall && (
            <div className="poll" role="group" aria-label="Reply to the check-in">
              {POLL_ANSWERS.map((a) => (
                <button key={a} onClick={() => answerPoll(a, 'iMessage')}>{a}</button>
              ))}
            </div>
          )}
          {s.job?.status === 'arrived' && (
            <button className="btn btn-accept btn-block" onClick={() => updateJob(s.job!.jobId, s.job!.version, 'received')}>
              I received the battery
            </button>
          )}
          {s.job?.status === 'received' && <p className="thread-empty">Received. Thank you for confirming.</p>}
        </div>

        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            postMessage('resident', draft);
            setDraft('');
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={s.job ? 'Message Ana' : 'Replies open once help is on the way'} disabled={!s.job} aria-label="Message the driver" />
          <button className="icon-btn" disabled={!s.job || !draft.trim()} aria-label="Send"><Icon name="send" /></button>
        </form>
      </div>
    </div>
  );
}
