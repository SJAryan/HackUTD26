// TL-08: send a saved check-in through the same ingest path as live messages.
// Usage: npm run replay -- fixtures/h17-checkin.json
// A replay is never a live integration, and it never messages anyone.
import { readFileSync } from "node:fs";
import { fromFixture, handle } from "./inbound.ts";
import { DB, HOST, connect, finish, ingestVia, requireBridgeRole } from "./stdb.ts";

const file = process.argv[2];
let conn: Awaited<ReturnType<typeof connect>> | undefined;
try {
  if (!file) throw new Error("Usage: npm run replay -- <fixture.json>");
  const { event, incidentId, householdId } = fromFixture(JSON.parse(readFileSync(file, "utf8")));
  console.log(`REPLAY of ${file} into ${DB} at ${HOST}. This is a replay, not a live integration.`);
  conn = await connect();
  await requireBridgeRole(conn, incidentId);
  const outcome = await handle(event, householdId, incidentId, {
    ingest: ingestVia(conn),
    reply: async () => { throw new Error("REPLAY never replies"); },
    log: (line) => console.log(line),
  }, new Set(), "REPLAY");
  // household and checkin are private (TL-05), so report the reducer outcome, not table state.
  // A's reducer treats a repeated eventId as a no-op, and both cases succeed, so they look the same here.
  console.log(outcome === "ingested"
    ? `REPLAY result: ok for ${event.eventId} (committed, or a no-op if this eventId was already recorded)`
    : outcome === "duplicate" ? `REPLAY result: duplicate no-op for ${event.eventId}`
    : `REPLAY result: error for ${event.eventId} (see the line above)`);
  finish(conn, outcome === "failed" ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Replay failed.");
  finish(conn, 1);
}
