// TL-01/TL-05 connection check only. D replaces this screen in TL-04/TL-07.
import { useState } from 'react';
import { tables, reducers } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

const time = (t?: { toDate(): Date }) => (t ? t.toDate().toISOString() : 'unknown');
const range = (lo?: number, hi?: number) =>
  lo === undefined ? 'unknown' : `${lo}–${hi ?? 'open'} min`;

function App() {
  const { isActive: connected } = useSpacetimeDB();
  const [roles] = useTable(tables.myRole);
  const [households, ready] = useTable(tables.coordinatorHouseholds);
  const [checkins] = useTable(tables.coordinatorCheckins);
  const claimInvite = useReducer(reducers.claimInvite);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const role = roles[0];

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Time Left · TL-01 connection check</h1>
      <p>
        Status: <strong>{connected ? 'Connected' : 'Disconnected'}</strong> ·{' '}
        {ready ? 'Live subscription' : 'Waiting for data'} · Synthetic seed data ·{' '}
        Role: <strong>{role ? `${role.role} ${role.subjectId}`.trim() : 'none'}</strong>
      </p>

      {!role && (
        <form
          onSubmit={e => {
            e.preventDefault();
            setError('');
            claimInvite({ code: code.trim() }).catch((err: Error) => setError(err.message));
          }}
        >
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Invite code" />{' '}
          <button type="submit" disabled={!connected || !code.trim()}>
            Claim role
          </button>{' '}
          {error}
        </form>
      )}

      <h2>Households</h2>
      <ul>
        {[...households]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(h => (
            <li key={h.id}>
              {h.label}: v{h.version}, backup {range(h.runtimeLowerMin, h.runtimeUpperMin)}, observed{' '}
              {time(h.lastObservedAt)}
            </li>
          ))}
      </ul>

      <h2>Check-ins ({checkins.length})</h2>
      <ul>
        {checkins.map(c => (
          <li key={c.eventId}>
            {c.householdId} · {time(c.observedAt)} · “{c.text}”
          </li>
        ))}
      </ul>
    </main>
  );
}

export default App;
