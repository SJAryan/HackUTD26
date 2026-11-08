// TL-08: send committed ETA intents from A's bridge_outbox view to the enrolled household.
// The outbox row stays 'pending' (no reducer marks it sent yet), so the bridge keeps its own
// per-key send record in .bridge-state.json. Accepted is never resent; failed is retried with the
// same idempotency key; ambiguous (timeout or unreadable response) is held for reconciliation.
import { ApiError } from "@photon-ai/api";

export type OutboxRow = { key: string; recipient: string; purpose: string; body: string };
export type SendResult = "accepted" | "failed" | "ambiguous";
export type SentRecord = { status: SendResult; at: string; attempts: number };
export type SentLog = Record<string, SentRecord>;
// The enrolled sender's Photon direct space, learned from their own inbound message.
export type Space = { spaceId: string; senderId: string };

export type OutboxDeps = {
  send: (space: Space, key: string, body: string) => Promise<SendResult>;
  log: (line: string) => void;
  now: () => number;
};

export const RETRY_FAILED_MS = 15_000;

// A definite refusal is "failed" (safe to retry with the same key). Anything where Photon may have
// accepted the send without us seeing it is "ambiguous".
export function classifySendError(error: unknown): Exclude<SendResult, "accepted"> {
  if (error instanceof ApiError && ![408, 502, 504].includes(error.status)) return "failed";
  return "ambiguous";
}

// Returns true when the send log changed and should be saved.
export async function processOutbox(
  rows: Iterable<OutboxRow>, household: string, space: Space | undefined,
  sent: SentLog, deps: OutboxDeps, noted: Set<string>,
): Promise<boolean> {
  const once = (id: string, line: string) => { if (!noted.has(id)) { noted.add(id); deps.log(line); } };
  const target = `household:${household}`;
  let changed = false;
  const done = new Set<string>(); // a view update can deliver the same row twice in one pass
  for (const row of rows) {
    if (done.has(row.key)) continue;
    done.add(row.key);
    if (row.purpose !== "eta" || row.recipient !== target) {
      once(`skip:${row.key}`, `OUTBOX ${row.key} not sent: no channel for ${row.recipient} (${row.purpose})`);
      continue;
    }
    const prev = sent[row.key];
    if (prev?.status === "accepted") continue;
    if (prev?.status === "ambiguous") {
      once(`ambiguous:${row.key}`, `OUTBOX ${row.key} outcome unknown; not resending, needs reconciliation`);
      continue;
    }
    if (prev?.status === "failed" && deps.now() < Date.parse(prev.at) + RETRY_FAILED_MS) continue;
    if (!space) {
      once(`nospace:${household}`, `OUTBOX waiting: ${target} has not texted this line yet, so there is no thread to reply in (no cold messages)`);
      continue;
    }
    const status = await deps.send(space, row.key, row.body);
    sent[row.key] = { status, at: new Date(deps.now()).toISOString(), attempts: (prev?.attempts ?? 0) + 1 };
    changed = true;
    deps.log(`OUTBOX ${row.key} -> ${target}: ${status}${status === "accepted" ? " for dispatch (delivery not confirmed)" : ""}`);
  }
  return changed;
}
