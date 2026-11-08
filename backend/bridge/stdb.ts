// SpacetimeDB side of the bridge. Uses A's generated bindings; never edit them here.
// TL-05 made every table private: the bridge reads only the my_role, bridge_outbox and bridge_checkins views.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Timestamp } from "spacetimedb";
import { DbConnection, tables } from "../../src/module_bindings/index.ts";
import type { CheckinArgs } from "./inbound.ts";
import { waitForReceipt, type Receipt } from "./receipt.ts";
import { ensureBridgeRole, type Role } from "./role.ts";

export const HOST = process.env.SPACETIMEDB_HOST ?? "ws://localhost:3000";
export const DB = process.env.SPACETIMEDB_DB_NAME ?? "time-left";

// The identity token is the bridge's credential: it holds the claimed role across restarts.
// Gitignored; never print it.
const TOKEN_FILE = new URL("./.stdb-token", import.meta.url);

const readToken = () => (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() || undefined : undefined);

// Connects with the saved token (or a new identity, whose token is saved before any role is claimed)
// and subscribes to the bridge's views.
export function connect(): Promise<DbConnection> {
  const saved = readToken();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SpacetimeDB connect timed out (${HOST}, ${DB})`)), 10_000);
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .withToken(saved)
      .onConnect((conn, _identity, token) => {
        if (token && token !== saved) writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
        conn.subscriptionBuilder()
          .onApplied(() => { clearTimeout(timer); resolve(conn); })
          .onError((ctx) => { clearTimeout(timer); reject(ctx.event ?? new Error("SpacetimeDB subscription failed")); })
          .subscribe([tables.myRole, tables.bridgeOutbox, tables.bridgeCheckins]);
      })
      .onConnectError((_ctx, err) => {
        clearTimeout(timer);
        const why = err?.message ? `: ${err.message}` : " (is the server running?)";
        const hint = saved ? " If the server is up, the saved .stdb-token may be stale; delete it to start a new identity." : "";
        reject(new Error(`SpacetimeDB connect failed (${HOST}, ${DB})${why}.${hint}`));
      })
      .build();
  });
}

const myRole = (conn: DbConnection): Role | undefined => [...conn.db.myRole.iter()][0];

// Claims BRIDGE_INVITE_CODE on first run; afterwards the saved token already carries the role.
export function requireBridgeRole(conn: DbConnection, incidentId: string): Promise<Role> {
  return ensureBridgeRole({
    current: () => myRole(conn),
    claim: (code) => conn.reducers.claimInvite({ code }),
    waitForRole: async () => {
      for (let i = 0; i < 50 && !myRole(conn); i++) await new Promise((r) => setTimeout(r, 100));
      return myRole(conn);
    },
  }, incidentId, process.env.BRIDGE_INVITE_CODE);
}

export function ingestVia(conn: DbConnection) {
  return async (a: CheckinArgs) => {
    await conn.reducers.ingestCheckin({
      eventId: a.eventId,
      incidentId: a.incidentId,
      householdId: a.householdId,
      observedAt: Timestamp.fromDate(a.observedAt),
      text: a.text,
      runtimeLowerMin: a.runtimeLowerMin,
      runtimeUpperMin: a.runtimeUpperMin,
    });
  };
}

// The recorded row's household and runtime from the bridge_checkins view, or undefined if it never shows up.
export function checkinReceipt(conn: DbConnection, eventId: string): Promise<Receipt | undefined> {
  return waitForReceipt(() => conn.db.bridgeCheckins.iter(), eventId);
}

// Close the socket before exiting; exiting with an open socket aborts Node on Windows (see docs/setup.md).
export function finish(conn: DbConnection | undefined, code: number): void {
  conn?.disconnect();
  setTimeout(() => process.exit(code), 200);
}
