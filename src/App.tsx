import { useEffect, useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import { INCIDENT, fmt } from './demo/fixture';
import { AUTO_CALL_MS, placeCall, reset, useDemo } from './demo/store';
import { Icon, type IconName } from './ui/icons';
import { Board } from './screens/Board';
import { Register } from './screens/Register';
import { ResidentPhone } from './screens/ResidentPhone';
import { DriverPhone } from './screens/DriverPhone';
import { ConnectionCheck } from './screens/ConnectionCheck';
import './styles.css';

type Route = 'board' | 'register' | 'resident' | 'driver' | 'connection';
const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: 'board', label: 'Board', icon: 'board' },
  { route: 'register', label: 'Registration site', icon: 'form' },
  { route: 'resident', label: 'Resident phone', icon: 'message' },
  { route: 'driver', label: 'Driver phone', icon: 'truck' },
];
const TITLE: Record<Route, string> = {
  board: `${INCIDENT.name}, ${INCIDENT.area}`,
  register: 'Registration site',
  resident: 'Resident phone',
  driver: 'Driver phone',
  connection: 'Connection check',
};

const read = (): Route => {
  const r = window.location.hash.replace('#/', '') as Route;
  return r in TITLE ? r : 'board';
};

function useRoute() {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r: string) => (window.location.hash = `#/${r}`)] as const;
}

function Steps() {
  const s = useDemo();
  const steps = [
    { label: 'Resident registers', done: !!s.registration },
    { label: 'Outage starts', done: s.outage },
    { label: 'iMessage and call go out', done: s.outage && (s.call !== 'none' || !!s.answer) },
    { label: 'Resident reports backup left', done: !!s.answer },
    { label: 'Driver sent', done: !!s.job },
    { label: 'Battery received', done: s.job?.status === 'received' },
  ];
  const next = steps.findIndex((x) => !x.done);
  return (
    <ol className="demo-steps" aria-label="Demo progress">
      {steps.map((x, i) => (
        <li key={x.label} className={x.done ? 'done' : i === next ? 'next' : ''}>
          <span className="dot">{x.done ? <Icon name="check" size={11} /> : i + 1}</span>
          {x.label}
        </li>
      ))}
    </ol>
  );
}

export default function App() {
  const [route, go] = useRoute();
  const s = useDemo();
  const { isActive } = useSpacetimeDB();

  // Automated call when the poll gets no reply. placeCall ignores repeats, so open tabs can't double-call.
  const waiting = s.outage && !s.answer && s.call === 'none';
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => placeCall('auto'), AUTO_CALL_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Views">
        <a className="brand" href="#/board">
          <span className="mark" aria-hidden="true" />
          Before Zero
        </a>
        <ul>
          {NAV.map((n) => (
            <li key={n.route}>
              <a href={`#/${n.route}`} className={route === n.route ? 'on' : ''} aria-current={route === n.route ? 'page' : undefined}>
                <Icon name={n.icon} size={16} />
                <span>{n.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="rail-foot">
          <h2>Demo run</h2>
          <Steps />
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{TITLE[route]}</h1>
          <span className="clock" aria-label="Simulated clock">
            <Icon name="clock" size={15} />
            {fmt(s.clock)}
          </span>
          <span className="chip" title="Screens read local fixture data until the live tables are wired in TL-07">Fixture data</span>
          <a className={`chip ${isActive ? 'chip-live' : ''}`} href="#/connection">{isActive ? 'Database connected' : 'Database offline'}</a>
          <button
            className="btn btn-quiet reset"
            aria-label="Reset demo"
            onClick={() => {
              reset();
              go('register');
            }}
          >
            <Icon name="reset" size={15} /> <span className="btn-label">Reset demo</span>
          </button>
        </header>

        <main className={`view view-${route}`}>
          {route === 'board' && <Board key={s.registration ? 'r' : 'n'} />}
          {route === 'register' && <Register go={go} />}
          {route === 'resident' && <ResidentPhone />}
          {route === 'driver' && <DriverPhone />}
          {route === 'connection' && <ConnectionCheck />}
        </main>
      </div>
    </div>
  );
}
