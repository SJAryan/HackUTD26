import { useEffect, useState } from 'react';
import { resetFixture } from './store';
import { Coordinator } from './screens/Coordinator';
import { Resident } from './screens/Resident';
import { Driver } from './screens/Driver';

const SCREENS = [
  { hash: '#/coordinator', label: 'Coordinator', note: 'Prioritize households, compare routes, assign a battery.', Screen: Coordinator },
  { hash: '#/resident', label: 'Resident H17', note: 'See who is coming, when, and message the driver.', Screen: Resident },
  { hash: '#/driver', label: 'Driver Ana', note: 'See the assigned stop, reply, and mark arrival.', Screen: Driver },
];

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const current = SCREENS.find((s) => s.hash === hash);

  return (
    <>
      <div className="fixture-banner" role="status">
        <p>
          <strong>Fixture mode.</strong> Synthetic data, not connected to SpacetimeDB. Open each role in its own tab; changes sync in this
          browser only.
        </p>
        <nav aria-label="Roles">
          {SCREENS.map((s) => (
            <a key={s.hash} href={s.hash} aria-current={s === current ? 'page' : undefined}>
              {s.label}
            </a>
          ))}
          <button className="reset" onClick={resetFixture}>
            Reset demo
          </button>
        </nav>
      </div>
      {current ? (
        <current.Screen />
      ) : (
        <main className="home">
          <h1>Time Left</h1>
          <p className="muted">Pick a role. Open the other two in separate tabs to see updates arrive.</p>
          <ul>
            {SCREENS.map((s) => (
              <li key={s.hash}>
                <a href={s.hash}>{s.label}</a>
                <span className="muted">{s.note}</span>
              </li>
            ))}
          </ul>
        </main>
      )}
    </>
  );
}
