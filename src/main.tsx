import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { Identity } from 'spacetimedb';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, ErrorContext } from './module_bindings/index.ts';
import { useMode } from './live/mode.ts';

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'time-left';

// One SpacetimeDB identity per screen, not per browser. Tabs and private windows of one
// browser share localStorage, so a single token would give every tab the same role. Each
// screen keeps its own token instead: the board is the coordinator, the registration site
// and resident phone are the resident, and the driver phone is the driver. A reload keeps
// the role, and closing a tab never loses a claimed invite. A second driver or resident
// needs another browser or device.
type Slot = 'coordinator' | 'resident' | 'driver';
const slotOf = (hash: string): Slot => {
  const route = hash.replace('#/', '');
  return route === 'driver' ? 'driver' : route === 'resident' || route === 'register' ? 'resident' : 'coordinator';
};
const tokenKey = (slot: Slot) => `${HOST}/${DB_NAME}/${slot}/auth_token`;

const onDisconnect = () => {
  console.log('Disconnected from SpacetimeDB');
};

const onConnectError = (_ctx: ErrorContext, err: Error) => {
  console.log('Error connecting to SpacetimeDB:', err);
};

// One connection per page load, made with the token of the screen the page opened on.
// The SDK pools connections by host and database and keeps a live one across remounts,
// so switching identity inside a page is not possible; a reload is the clean switch.
const CONNECTED: Slot = slotOf(window.location.hash);
const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem(tokenKey(CONNECTED)) || undefined)
  .onConnect((_conn: DbConnection, identity: Identity, token: string) => {
    localStorage.setItem(tokenKey(CONNECTED), token);
    console.log(`Connected to SpacetimeDB as the ${CONNECTED} screen with identity:`, identity.toHexString());
  })
  .onDisconnect(onDisconnect)
  .onConnectError(onConnectError);

function Root() {
  const mode = useMode();
  const [slot, setSlot] = useState<Slot>(CONNECTED);
  useEffect(() => {
    const on = () => setSlot(slotOf(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // In live mode, moving to a screen with another role reloads into that role's identity.
  // Fixture mode never reads the connection, so its navigation stays instant.
  useEffect(() => {
    if (mode === 'live' && slot !== CONNECTED) window.location.reload();
  }, [mode, slot]);
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
