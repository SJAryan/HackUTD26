// LIVE MODE for TL-09 (#35): preparedness registration and the optional State Farm agent
// contact, on A's enrollPreparedness / requestAgentContact / skipAgentContact reducers.
// Every receipt shown here comes from a committed row (myProfile, myAgentRequest,
// myAgentDecline), so it survives a reload and never claims something the server refused.
import { useRef, useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { Icon } from '../ui/icons';
import { errorText, hhmm, ms, newId } from './model';
import { useMyRole } from './RoleGate';
import { PolicyCheck } from '../screens/PolicyCheck';

type Status = { kind: 'idle' | 'sending' | 'error'; text?: string };

// The needs A's reducer accepts. Only home oxygen has a working check-in and dispatch flow.
const NEEDS = [
  { id: 'home_oxygen', label: 'Home oxygen', ready: true },
  { id: 'dialysis', label: 'Home dialysis', ready: false },
  { id: 'no_heat', label: 'No heat', ready: false },
];
const CONTACTS = [
  { id: 'imessage', label: 'iMessage' },
  { id: 'phone_call', label: 'Phone call' },
];
const label = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;

// Synthetic demo resident. Real people never appear in this app's data.
const DEFAULTS = {
  medicalNeed: 'home_oxygen',
  backupDevice: 'Oxygen concentrator, one backup tank',
  address: '418 Larkspur Ln (synthetic)',
  preferredContact: 'imessage',
};

export function LiveRegister({ go }: { go: (route: string) => void }) {
  const [profiles] = useTable(tables.myProfile);
  const enroll = useReducer(reducers.enrollPreparedness);
  const [f, setF] = useState(DEFAULTS);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Stable until the profile lands, so a retried submit is a no-op on the server.
  const enrollmentId = useRef(newId());
  const profile = profiles[0];
  const { role } = useMyRole();

  if (profile) {
    return (
      <div className="site">
        <section className="site-card done">
          <Icon name="checkCircle" size={28} />
          <h1>Your preparedness profile is ready</h1>
          <p>
            If the power goes out at {profile.address}, Before Zero contacts you by {label(CONTACTS, profile.preferredContact)}. Your answer tells the response team how much time you have.
          </p>
          <p className="sub">
            Household {profile.householdId}, {label(NEEDS, profile.medicalNeed).toLowerCase()}. Registered at {hhmm(ms(profile.enrolledAt))}. Synthetic demo resident.
          </p>
          <div className="row-actions">
            <button className="btn btn-quiet" onClick={() => go('resident')}>Open the resident phone</button>
          </div>
        </section>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    setStatus({ kind: 'sending' });
    enroll({ enrollmentId: enrollmentId.current, ...f, backupDevice: f.backupDevice.trim(), address: f.address.trim() })
      // Success shows the profile from myProfile, not from this promise.
      .then(() => setStatus({ kind: 'idle' }))
      .catch((err: unknown) => setStatus({ kind: 'error', text: errorText(err) }));
  };

  return (
    <div className="site">
      <section className="site-intro">
        <h1>Register a household that depends on power</h1>
        <p>
          Oxygen, home dialysis or no way to stay warm. Tell us once, before the next storm. Your preparedness profile is free, and you don't need to be anyone's customer.
        </p>
        <ul className="gives">
          <li><Icon name="message" size={16} />A check-in the moment your power goes out, by the contact you choose.</li>
          <li><Icon name="clock" size={16} />Help sent in order of who runs out first, based on what you tell us.</li>
          <li><Icon name="truck" size={16} />A driver's name and arrival time, and a way to message them.</li>
        </ul>
      </section>

      <form className="site-card form" onSubmit={submit}>
        <p className="fixture-note">Prefilled with a synthetic resident. Your invite links this browser to its household.</p>
        {/* Live mode saves only the need chosen below; A's enrollPreparedness has no field for the confirmation yet. */}
        {role?.subjectId && <PolicyCheck householdId={role.subjectId} onChange={(kept) => kept.some((k) => k.dispatchNeed) && setF((x) => ({ ...x, medicalNeed: 'home_oxygen' }))} />}
        <fieldset className="field">
          <legend>What depends on power</legend>
          <div className="choices">
            {NEEDS.map((n) => (
              <label key={n.id} className={`choice ${f.medicalNeed === n.id ? 'on' : ''} ${n.ready ? '' : 'off'}`}>
                <input type="radio" name="need" checked={f.medicalNeed === n.id} disabled={!n.ready} onChange={() => setF({ ...f, medicalNeed: n.id })} />
                {n.label}
              </label>
            ))}
          </div>
          <small>Dialysis and no-heat check-ins are not in this demo yet. Only home oxygen runs end to end.</small>
        </fieldset>
        <label className="field">
          <span>Equipment and backup</span>
          <input value={f.backupDevice} onChange={(e) => setF({ ...f, backupDevice: e.target.value })} required maxLength={200} />
        </label>
        <label className="field">
          <span>Street address</span>
          <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required maxLength={200} autoComplete="off" />
          <small>Only the response team uses this.</small>
        </label>
        <fieldset className="field">
          <legend>How to reach you in an outage</legend>
          <div className="choices">
            {CONTACTS.map((c) => (
              <label key={c.id} className={`choice ${f.preferredContact === c.id ? 'on' : ''}`}>
                <input type="radio" name="contact" checked={f.preferredContact === c.id} onChange={() => setF({ ...f, preferredContact: c.id })} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        {status.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {status.text}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={status.kind === 'sending'}>
          {status.kind === 'sending' ? 'Joining…' : 'Join the registry'}
        </button>
      </form>
    </div>
  );
}

// Shown on the resident phone after delivery. Help never depended on it: the server never
// reads profiles or leads when dispatching.
export function LiveAgentOffer() {
  const [profiles] = useTable(tables.myProfile);
  const [requests] = useTable(tables.myAgentRequest);
  const [declines] = useTable(tables.myAgentDecline);
  const request = useReducer(reducers.requestAgentContact);
  const skip = useReducer(reducers.skipAgentContact);
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // One consent per click, reused on retry, so a lost response can never create two leads.
  const consentId = useRef(newId());

  const profile = profiles[0];
  const lead = requests[0];
  const declined = declines[0];

  if (lead) {
    return (
      <section className="offer done" aria-live="polite">
        <p className="offer-title"><Icon name="checkCircle" size={16} /> Request saved, L-{String(lead.id)}</p>
        <p>A State Farm agent may contact you by {label(CONTACTS, lead.preferredContact)} about coverage.</p>
        <p className="offer-fine">Demo receipt. No one will actually call, and this is not a quote or a policy.</p>
      </section>
    );
  }
  if (declined) return <p className="thread-empty">Skipped. Nothing else was saved.</p>;
  // The offer is for registered residents; anyone else simply doesn't see it.
  if (!profile) return null;

  const run = (call: () => Promise<void>) => {
    if (status.kind === 'sending') return;
    setStatus({ kind: 'sending' });
    call()
      .then(() => setStatus({ kind: 'idle' }))
      .catch((err: unknown) => setStatus({ kind: 'error', text: errorText(err) }));
  };

  return (
    <section className="offer" aria-label="Optional agent contact">
      <p className="offer-title">Battery received. You're all set.</p>
      <p>Optional: would you like a State Farm agent to contact you about coverage? Your help today did not depend on this, and nothing changes if you skip.</p>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={status.kind === 'sending'} />
        <span>I agree that a State Farm agent may contact me by {label(CONTACTS, profile.preferredContact)} about coverage.</span>
      </label>
      {status.kind === 'error' && <p className="offer-fine" role="alert">{status.text}</p>}
      <div className="offer-actions">
        <button className="btn btn-quiet" onClick={() => run(() => skip())} disabled={status.kind === 'sending'}>Skip</button>
        <button className="btn btn-primary" onClick={() => run(() => request({ consentId: consentId.current }))} disabled={!agree || status.kind === 'sending'}>
          {status.kind === 'sending' ? 'Saving…' : 'Ask an agent'}
        </button>
      </div>
    </section>
  );
}
