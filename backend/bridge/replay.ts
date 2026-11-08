// TL-08: send a saved check-in through the same ingest path as live messages.
// Usage: npm run replay -- fixtures/h17-checkin.json
// A replay is never a live integration, and it never messages anyone.
import { readFileSync } from "node:fs";
import { fromFixture, handle } from "./inbound.ts";
import { DB, HOST, connect, finish, householdSummary, ingestVia } from "./stdb.ts";

const file = process.argv[2];
let conn: Awaited<ReturnType<typeof connect>> | undefined;
try {
  if (!file) throw new Error("Usage: npm run replay -- <fixture.json>");
  const { event, incidentId, householdId } = fromFixture(JSON.parse(readFileSync(file, "utf8")));
  console.log(`REPLAY of ${file} into ${DB} at ${HOST}. This is a replay, not a live integration.`);
  conn = await connect();
  console.log(`REPLAY before: ${householdSummary(conn, householdId, event.eventId)}`);
  const outcome = await handle(event, householdId, incidentId, {
    ingest: ingestVia(conn),
    reply: async () => { throw new Error("REPLAY never replies"); },
    log: (line) => console.log(line),
  }, new Set(), "REPLAY");
  await new Promise((r) => setTimeout(r, 500)); // let the subscription apply the commit
  console.log(`REPLAY after:  ${householdSummary(conn, householdId, event.eventId)}`);
  finish(conn, outcome === "ingested" ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Replay failed.");
  finish(conn, 1);
}
