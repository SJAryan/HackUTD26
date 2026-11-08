// Fixture or live. Fixture is the scripted judge walkthrough and the offline fallback;
// live reads A's views on SpacetimeDB and writes through the reducers.
import { useSyncExternalStore } from 'react';

export type Mode = 'fixture' | 'live';
const KEY = 'before-zero-mode';

const read = (): Mode => {
  try {
    return localStorage.getItem(KEY) === 'live' ? 'live' : 'fixture';
  } catch {
    return 'fixture';
  }
};

let mode = read();
const listeners = new Set<() => void>();

export function setMode(next: Mode) {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private window without storage: the choice lasts for this tab */
  }
  listeners.forEach((l) => l());
}

window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  mode = read();
  listeners.forEach((l) => l());
});

export const useMode = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
  );
