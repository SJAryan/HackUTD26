// Shared helpers for the integration checks in scripts/.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DbConnection } from '../src/module_bindings';

export const HOST = process.env.SPACETIMEDB_HOST ?? 'ws://localhost:3000';
export const DB = process.env.SPACETIMEDB_DB_NAME ?? 'time-left';
// CLI server nickname for owner-only calls; must match HOST.
export const SERVER = process.env.SPACETIMEDB_SERVER ?? 'local';

const open: DbConnection[] = [];

// Close sockets before exiting; exiting with an open socket aborts Node on Windows.
export function finish(code: number): never {
  for (const c of open) c.disconnect();
  setTimeout(() => process.exit(code), 200);
  throw new Error('exiting');
}

export function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  return finish(1);
}

export function run(main: () => Promise<void>) {
  main().catch(err => {
    if (err?.message === 'exiting') return;
    try {
      fail(String(err?.message ?? err));
    } catch {
      // fail() always throws after scheduling the exit
    }
  });
}

export function within<T>(ms: number, label: string, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ]);
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Resolves once `check` passes against the client cache, which only the subscription updates.
export function waitFor(label: string, check: () => boolean, ms = 5_000) {
  return within(ms, label, new Promise<void>(resolve => {
    const poll = () => (check() ? resolve() : setTimeout(poll, 25));
    poll();
  }));
}

type Query = Parameters<ReturnType<DbConnection['subscriptionBuilder']>['subscribe']>[0];

export function connect(label: string, queries: Query): Promise<DbConnection> {
  return within(10_000, `${label} connect`, new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect(c => {
        open.push(c);
        c.subscriptionBuilder()
          .onApplied(() => resolve(c))
          .onError((_ctx, err) => reject(err))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => reject(err))
      .build();
  }));
}

// Owner-only: create a single-use invite through the CLI's (owner) identity.
// Codes are random per run and never written to disk.
export function createInvite(role: string, incidentId: string, subjectId = ''): string {
  const code = `${role}-${randomUUID()}`;
  execFileSync('spacetime', [
    'call', '--server', SERVER, DB, 'create_invite',
    JSON.stringify(code), JSON.stringify(role), JSON.stringify(incidentId), JSON.stringify(subjectId),
  ], { stdio: 'pipe' });
  return code;
}

// Connect, then claim a role invite. Resolves once the session's role is visible.
export async function connectAs(label: string, role: string, incidentId: string, subjectId: string, queries: Query) {
  const conn = await connect(label, queries);
  await conn.reducers.claimInvite({ code: createInvite(role, incidentId, subjectId) });
  console.log(`${label}: ${role}${subjectId ? ` ${subjectId}` : ''} as ${conn.identity!.toHexString().slice(0, 12)}…`);
  return conn;
}

export async function rejects(label: string, call: () => Promise<unknown>, pattern: RegExp) {
  try {
    await call();
  } catch (err) {
    const message = (err as Error).message;
    if (!pattern.test(message)) fail(`${label}: unexpected error "${message}"`);
    return message;
  }
  return fail(`${label}: was accepted`);
}
