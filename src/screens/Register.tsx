import { useState, type FormEvent } from 'react';
import { DEMO_ID, NEED_LABEL, type Need } from '../demo/fixture';
import { register, useDemo, type Registration } from '../demo/store';
import { Icon } from '../ui/icons';

// Synthetic demo resident. Real people never appear in this app's data.
const DEFAULTS: Registration = {
  name: 'Alma Reyes',
  age: '81',
  phone: '(555) 010-0117',
  address: '418 Larkspur Ln',
  need: 'oxygen',
  equipment: 'Oxygen concentrator, one backup tank',
  contact: 'iMessage, then a phone call',
};

export function Register({ go }: { go: (route: string) => void }) {
  const s = useDemo();
  const [f, setF] = useState<Registration>(s.registration ?? DEFAULTS);
  const [consent, setConsent] = useState(true);
  const set = (k: keyof Registration) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!consent) return;
    register(f);
  };

  if (s.registration) {
    return (
      <div className="site">
        <section className="site-card done">
          <Icon name="checkCircle" size={28} />
          <h1>You are on the registry</h1>
          <p>
            If the power goes out at {s.registration.address}, Before Zero texts you first, then calls. Your answer tells the response team how much time you have.
          </p>
          <p className="sub">Household {DEMO_ID}. Synthetic demo resident.</p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => go('board')}>Open the coordinator board</button>
            <button className="btn btn-quiet" onClick={() => go('resident')}>Open the resident phone</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="site">
      <section className="site-intro">
        <h1>Register a household that depends on power</h1>
        <p>
          Oxygen, home dialysis or no way to stay warm. Tell us once, before the next storm. During an outage we check in with you and send help in order of who runs out first.
        </p>
      </section>

      <form className="site-card form" onSubmit={submit}>
        <p className="fixture-note">Prefilled with a synthetic resident for the demo.</p>
        <div className="field-row">
          <label className="field">
            <span>Full name</span>
            <input value={f.name} onChange={set('name')} required autoComplete="off" />
          </label>
          <label className="field field-sm">
            <span>Age</span>
            <input value={f.age} onChange={set('age')} inputMode="numeric" required />
          </label>
        </div>
        <label className="field">
          <span>Mobile number</span>
          <input value={f.phone} onChange={set('phone')} required autoComplete="off" />
          <small>We text this number first. Demo numbers use the 555 range.</small>
        </label>
        <label className="field">
          <span>Street address</span>
          <input value={f.address} onChange={set('address')} required autoComplete="off" />
        </label>
        <fieldset className="field">
          <legend>What depends on power</legend>
          <div className="choices">
            {(Object.keys(NEED_LABEL) as Need[]).map((n) => (
              <label key={n} className={`choice ${f.need === n ? 'on' : ''}`}>
                <input type="radio" name="need" checked={f.need === n} onChange={() => setF({ ...f, need: n })} />
                {NEED_LABEL[n]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Equipment and backup</span>
          <input value={f.equipment} onChange={set('equipment')} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Contact me by iMessage, then by phone, during an outage. I can stop at any time.</span>
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={!consent}>Join the registry</button>
      </form>
    </div>
  );
}
