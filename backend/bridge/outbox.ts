// TL-08: send committed ETA intents from A's bridge_outbox view to the enrolled household.
// The outbox row stays 'pending' (no reducer marks it sent yet), so the bridge keeps its own
// per-key send record in .bridge-state.json. Accepted is never resent; failed is retried with the
// same idempotency key; ambiguous (timeout or unreadable response) is held for reconciliation.
// Only the newest intent per job that is still in the view is ever sent: an older job version or a
// row that left the view is obsolete for good, and a failing ETA expires instead of retrying forever.
import { ApiError } from "@photon-ai/api";

export type OutboxRow = { key: string; jobId: bigint; jobVersion: number; recipient: string; purpose: string; body: string };
export type SendResult = "accepted" | "failed" | "ambiguous";
// obsolete: superseded or gone from the view; expired: gave up retrying. Neither is ever sent again.
export type SentRecord = { status: SendResult | "obsolete" | "expired"; at: string; attempts: number; firstAt?: string };
export type SentLog = Record<string, SentRecord>;
// The enrolled sender's Photon direct space, learned from their own inbound message.
export type Space = { spaceId: string; senderId: string };

export type OutboxDeps = {
  send: (space: Space, key: string, body: string) => Promise<SendResult>;
  log: (line: string) => void;
  now: () => number;
};

export const RETRY_FAILED_MS = 15_000;
export const MAX_RETRIES = 3; // after the first attempt
export const RETRY_WINDOW_MS = 120_000; // measured from the first attempt

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
  const now = deps.now();
  const at = new Date(now).toISOString();
  let changed = false;
  const mark = (key: string, prev: SentRecord | undefined, status: "obsolete" | "expired") => {
    sent[key] = { status, at, attempts: prev?.attempts ?? 0, ...(prev?.firstAt ? { firstAt: prev.firstAt } : {}) };
    changed = true;
  };

  // Act only on the current snapshot. A failed intent that left the view is obsolete, never retried.
  const snapshot = [...rows];
  const present = new Set(snapshot.map((r) => r.key));
  for (const [key, prev] of Object.entries(sent)) {
    if (prev.status === "failed" && !present.has(key)) {
      mark(key, prev, "obsolete");
      deps.log(`OUTBOX ${key} obsolete: no longer in the view; not retrying`);
    }
  }
  const newest = new Map<string, number>();
  for (const r of snapshot) newest.set(String(r.jobId), Math.max(newest.get(String(r.jobId)) ?? 0, r.jobVersion));

  const done = new Set<string>(); // a view update can deliver the same row twice in one pass
  for (const row of snapshot) {
    if (done.has(row.key)) continue;
    done.add(row.key);
    if (row.purpose !== "eta" || row.recipient !== target) {
      once(`skip:${row.key}`, `OUTBOX ${row.key} not sent: no channel for ${row.recipient} (${row.purpose})`);
      continue;
    }
    const prev = sent[row.key];
    if (prev?.status === "accepted" || prev?.status === "obsolete" || prev?.status === "expired") continue;
    if (prev?.status === "ambiguous") {
      once(`ambiguous:${row.key}`, `OUTBOX ${row.key} outcome unknown; not resending, needs reconciliation`);
      continue;
    }
    if (row.jobVersion < newest.get(String(row.jobId))!) {
      mark(row.key, prev, "obsolete");
      deps.log(`OUTBOX ${row.key} obsolete: job ${row.jobId} is now v${newest.get(String(row.jobId))}; not sending`);
      continue;
    }
    if (prev?.status === "failed") {
      const firstAt = Date.parse(prev.firstAt ?? prev.at);
      if (prev.attempts > MAX_RETRIES || now > firstAt + RETRY_WINDOW_MS) {
        mark(row.key, prev, "expired");
        deps.log(`OUTBOX ${row.key} expired after ${prev.attempts} attempts; not sending, needs reconciliation`);
        continue;
      }
      if (now < Date.parse(prev.at) + RETRY_FAILED_MS) continue;
    }
    if (!space) {
      once(`nospace:${household}`, `OUTBOX waiting: ${target} has not texted this line yet, so there is no thread to reply in (no cold messages)`);
      continue;
    }
    const status = await deps.send(space, row.key, row.body);
    sent[row.key] = { status, at, attempts: (prev?.attempts ?? 0) + 1, firstAt: prev?.firstAt ?? prev?.at ?? at };
    changed = true;
    deps.log(`OUTBOX ${row.key} -> ${target}: ${status}${status === "accepted" ? " for dispatch (delivery not confirmed)" : ""}`);
  }
  return changed;
}
