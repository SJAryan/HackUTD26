import { useState, type ReactNode } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import { Icon } from '../ui/icons';
import { errorText } from './model';

const ROLE_LABEL: Record<string, string> = { coordinator: 'Coordinator', driver: 'Driver', resident: 'Resident', bridge: 'Bridge' };

export function useMyRole() {
  const [rows, ready] = useTable(tables.myRole);
  return { role: rows[0], ready };
}

export const roleText = (r?: { role: string; subjectId: string }) =>
  r ? `${ROLE_LABEL[r.role] ?? r.role}${r.subjectId ? ` ${r.subjectId}` : ''}` : 'No role';

// Each browser identity holds one role. A view only returns rows for the matching role,
// so a screen renders its children only when this window has claimed that role.
export function RoleGate({ want, children }: { want: 'coordinator' | 'driver' | 'resident'; children: ReactNode }) {
  const { isActive } = useSpacetimeDB();
  const { role, ready } = useMyRole();
  const claim = useReducer(reducers.claimInvite);
  const [code, setCode] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'error'; text?: string }>({ kind: 'idle' });

  if (!isActive) {
    return (
      <section className="gate">
        <Icon name="phoneOff" size={22} />
        <h2>Not connected to the live database</h2>
        <p>Check the network, or switch back to fixture data in the top bar.</p>
      </section>
    );
  }
  if (!ready) return <section className="gate"><p className="sub">Loading this window's role…</p></section>;
  if (role?.role === want) return <>{children}</>;

  if (role) {
    return (
      <section className="gate">
        <Icon name="person" size={22} />
        <h2>This window is signed in as {roleText(role)}</h2>
        <p>Each window holds one role. Open a private window for the {ROLE_LABEL[want].toLowerCase()} and claim its invite code there.</p>
      </section>
    );
  }

  return (
    <form
      className="gate"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim();
        if (!c || state.kind === 'sending') return;
        setState({ kind: 'sending' });
        claim({ code: c })
          .then(() => {
            setCode('');
            setState({ kind: 'idle' });
          })
          .catch((err: unknown) => setState({ kind: 'error', text: errorText(err) }));
      }}
    >
      <Icon name="person" size={22} />
      <h2>Claim the {ROLE_LABEL[want].toLowerCase()} role for this window</h2>
      <p>Paste the invite code A gave you. Codes work once and stay with this browser, so use a separate private window for each role.</p>
      <label className="field">
        <span>Invite code</span>
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      {state.kind === 'error' && <p className="result result-conflict" role="alert"><Icon name="alert" size={15} /> {state.text}</p>}
      <button className="btn btn-primary" disabled={!code.trim() || state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Claiming…' : 'Claim role'}
      </button>
    </form>
  );
}
