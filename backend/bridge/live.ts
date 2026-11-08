// TL-08: poll Photon for check-ins from the enrolled test sender and record them with ingestCheckin.
// Usage: npm run live   (Ctrl+C to stop; restarts resume from .bridge-state.json)
// Logs never include phone numbers, the project ID or the API key.
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, Photon } from "@photon-ai/api";
import { configuration } from "./agent.ts";
import { handle, householdFor, inboundText, type Deps, type PhotonItem } from "./inbound.ts";
import { DB, HOST, connect, finish, ingestVia } from "./stdb.ts";

const STATE_FILE = new URL("./.bridge-state.json", import.meta.url);
const POLL_MS = 2_000;
const OVERLAP_MS = 60_000; // re-read recent history for eventual consistency; the seen-set skips repeats
const KEEP_SEEN = 500;

// floor: messages created before the first launch are never processed. cursor: resume point.
type State = { floor: string; cursor: string; seen: string[] };

const loadState = (): State | undefined => {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return undefined; }
};
const saveState = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
const describeError = (e: unknown) =>
  e instanceof ApiError ? `Photon API error ${e.status} (request ${e.requestId ?? "unknown"})` : e instanceof Error ? e.message : "unknown error";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

let conn: Awaited<ReturnType<typeof connect>> | undefined;
process.on("SIGINT", () => { console.log("Stopping."); finish(conn, 0); });

try {
  const c = configuration();
  const binding = { sender: c.sender, householdId: required("BRIDGE_SENDER_HOUSEHOLD"), incidentId: required("BRIDGE_INCIDENT_ID") };
  const photon = new Photon({ headers: { Authorization: `Bearer ${c.key}` } });
  conn = await connect();

  const deps: Deps = {
    ingest: ingestVia(conn),
    reply: async (to, parentMessageId, text) => {
      try {
        await photon.projects.sendMessage({
          path: { id: c.project },
          headers: { "idempotency-key": `checkin-reply:${parentMessageId}` },
          body: { spaceId: to.spaceId, senderId: to.senderId, parentMessageId, content: { type: "text", format: "plain", text } },
        });
        console.log(`LIVE ${parentMessageId} reply accepted for dispatch (delivery not confirmed)`);
      } catch (error) {
        console.log(`LIVE ${parentMessageId} reply failed: ${describeError(error)}`);
      }
    },
    log: (line) => console.log(line),
  };

  const now = new Date().toISOString();
  const state = loadState() ?? { floor: now, cursor: now, seen: [] };
  const seen = new Set(state.seen);
  console.log(`Ready. LIVE: test sender -> ${binding.householdId} in ${binding.incidentId}; SpacetimeDB ${DB} at ${HOST}; resuming from ${state.cursor}.`);

  while (true) {
    try {
      let pageToken: string | undefined;
      let next = state.cursor;
      let retryFrom: string | undefined;
      do {
        const page = await photon.projects.listMessages({
          path: { id: c.project },
          query: {
            createdSince: new Date(Date.parse(state.cursor) - OVERLAP_MS).toISOString(),
            direction: "received", order: "asc", pageSize: 100, platform: c.platform,
            ...(pageToken ? { pageToken } : {}),
          },
        });
        for (const m of page.items as PhotonItem[]) {
          const at = Date.parse(m.createdAt);
          if (at < Date.parse(state.floor) || seen.has(m.id)) continue;
          const event = inboundText(m, c.platform, c.agent);
          if (!event) continue;
          if (at > Date.parse(next)) next = m.createdAt;
          const householdId = householdFor(m, binding);
          if (!householdId) {
            console.log(`LIVE ${m.id} ignored: sender is not enrolled`);
            seen.add(m.id);
            continue;
          }
          const outcome = await handle(event, householdId, binding.incidentId, deps, seen, "LIVE");
          if (outcome === "failed" && (!retryFrom || at < Date.parse(retryFrom))) retryFrom = m.createdAt;
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      state.cursor = retryFrom ?? next;
      state.seen = [...seen].slice(-KEEP_SEEN);
      saveState(state);
      await sleep(POLL_MS);
    } catch (error) {
      // 429 or a transient failure: back off instead of polling faster.
      console.log(`LIVE poll failed: ${describeError(error)}; retrying in 10s`);
      await sleep(10_000);
    }
  }
} catch (error) {
  console.error(describeError(error));
  finish(conn, 1);
}
