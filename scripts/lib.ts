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

// Each session's auth token, so a check can reconnect as the same identity.
const tokens = new WeakMap<DbConnection, string>();
export const tokenOf = (conn: DbConnection) => tokens.get(conn)!;

export function connect(label: string, queries: Query, token?: string): Promise<DbConnection> {
  return within(10_000, `${label} connect`, new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnect((c, _identity, newToken) => {
        tokens.set(c, newToken);
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
// Throws the server's error text (e.g. "rejected: ...") when the reducer refuses.
export function createInvite(role: string, incidentId: string, subjectId = ''): string {
  const code = `${role}-${randomUUID()}`;
  owner(['call', '--server', SERVER, DB, 'create_invite',
    JSON.stringify(code), JSON.stringify(role), JSON.stringify(incidentId), JSON.stringify(subjectId)]);
  return code;
}

// Owner-only read of private tables, for checking that a rejected call wrote nothing.
// Returns the number of rows the query matched.
export function ownerSqlCount(query: string): number {
  const out = owner(['sql', '--server', SERVER, DB, query]);
  const rows = out.split('\n').filter(l => l.trim() && !l.startsWith('WARNING'));
  return Math.max(0, rows.length - 2); // header and separator lines
}

// Owner-only reducer call through the CLI. Arguments are JSON-encoded. Throws the server's text.
export function ownerCall(reducer: string, ...args: unknown[]): string {
  return owner(['call', '--server', SERVER, DB, reducer, ...args.map(a => JSON.stringify(a))]);
}

function owner(args: string[]): string {
  try {
    return execFileSync('spacetime', args, { stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '');
    throw new Error(stderr.match(/Response text: (.*)/)?.[1] ?? stderr.trim());
  }
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
