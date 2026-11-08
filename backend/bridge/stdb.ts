// SpacetimeDB side of the bridge. Uses A's generated bindings; never edit them here.
import { Timestamp } from "spacetimedb";
import { DbConnection, tables } from "../../src/module_bindings/index.ts";
import type { CheckinArgs } from "./inbound.ts";

export const HOST = process.env.SPACETIMEDB_HOST ?? "ws://localhost:3000";
export const DB = process.env.SPACETIMEDB_DB_NAME ?? "time-left";

// Connects and subscribes to household + checkin so callers can report the committed effect.
export function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SpacetimeDB connect timed out (${HOST}, ${DB})`)), 10_000);
    DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB)
      .onConnect((conn) => {
        conn.subscriptionBuilder()
          .onApplied(() => { clearTimeout(timer); resolve(conn); })
          .onError((ctx) => { clearTimeout(timer); reject(ctx.event ?? new Error("SpacetimeDB subscription failed")); })
          .subscribe([tables.household, tables.checkin]);
      })
      .onConnectError((_ctx, err) => { clearTimeout(timer); reject(err); })
      .build();
  });
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

export function householdSummary(conn: DbConnection, householdId: string, eventId: string): string {
  const h = [...conn.db.household.iter()].find((row) => row.id === householdId);
  const rows = [...conn.db.checkin.iter()].filter((row) => row.eventId === eventId).length;
  if (!h) return `${householdId} not found`;
  const range = h.runtimeLowerMin === undefined ? "unknown" : `${h.runtimeLowerMin}-${h.runtimeUpperMin ?? "open"} min`;
  return `${householdId} v${h.version}, runtime ${range}, last event ${h.lastEventId ?? "none"}; checkin rows for ${eventId}: ${rows}`;
}

// Close the socket before exiting; exiting with an open socket aborts Node on Windows (see docs/setup.md).
export function finish(conn: DbConnection | undefined, code: number): void {
  conn?.disconnect();
  setTimeout(() => process.exit(code), 200);
}
