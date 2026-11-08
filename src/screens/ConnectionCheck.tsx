// TL-01 connection check (A), kept at #/connection to verify the live database.
import { tables } from '../module_bindings';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';

const time = (t?: { toDate(): Date }) => (t ? t.toDate().toISOString() : 'unknown');
const range = (lo?: number, hi?: number) =>
  lo === undefined ? 'unknown' : `${lo}–${hi ?? 'open'} min`;

export function ConnectionCheck() {
  const { isActive: connected } = useSpacetimeDB();
  const [households, ready] = useTable(tables.household);
  const [checkins] = useTable(tables.checkin);

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Time Left · TL-01 connection check</h1>
      <p>
        Status: <strong>{connected ? 'Connected' : 'Disconnected'}</strong> ·{' '}
        {ready ? 'Live subscription' : 'Waiting for data'} · Synthetic seed data
      </p>

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

