// TL-08: send a saved check-in through the same ingest path as live messages.
// Usage: npm run replay -- fixtures/h17-checkin.json
// A replay is never a live integration, and it never messages anyone.
import { readFileSync } from "node:fs";
import { fromFixture, handle } from "./inbound.ts";
import { describeReceipt } from "./receipt.ts";
import { DB, HOST, checkinReceipt, connect, finish, ingestVia, requireBridgeRole } from "./stdb.ts";

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
  if (outcome === "failed") {
    console.log(`REPLAY result: error for ${event.eventId} (see the line above)`);
    finish(conn, 1);
  } else {
    // household and checkin stay private (TL-05); the bridge_checkins view is the receipt.
    // A repeated eventId is a reducer no-op, so its receipt shows the row recorded the first time.
    const receipt = await checkinReceipt(conn, event.eventId);
    console.log(`REPLAY result: ${describeReceipt(receipt)} for ${event.eventId}`);
    finish(conn, receipt ? 0 : 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Replay failed.");
  finish(conn, 1);
}
