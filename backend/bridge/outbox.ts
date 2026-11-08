// TL-08: send committed ETA intents from A's bridge_outbox view to the enrolled household.
// The outbox row stays 'pending' (no reducer marks it sent yet), so the bridge keeps its own
// per-key send record in .bridge-state.json. Each key is sent at most once:
// - accepted is never resent;
// - failed (Photon refused it) becomes needs_reconciliation and is never auto-retried, because the
//   bridge cannot see job status and the view does not yet filter stale intents, so a retry could
//   deliver an ETA for a job that has already moved on;
// - ambiguous (timeout or unreadable response) is held for reconciliation.
// Only the newest intent per job that is still in the view is ever sent: an older job version is
// obsolete for good, and a legacy failed record whose row left the view is obsolete.
import { ApiError } from "@photon-ai/api";

export type OutboxRow = { key: string; jobId: bigint; jobVersion: number; recipient: string; purpose: string; body: string };
export type SendResult = "accepted" | "failed" | "ambiguous";
// "failed" only appears in state files written by earlier builds that auto-retried.
export type SentRecord = { status: "accepted" | "ambiguous" | "needs_reconciliation" | "obsolete" | "failed"; at: string; attempts: number };
export type SentLog = Record<string, SentRecord>;
// The enrolled sender's Photon direct space, learned from their own inbound message.
export type Space = { spaceId: string; senderId: string };

export type OutboxDeps = {
  send: (space: Space, key: string, body: string) => Promise<SendResult>;
  log: (line: string) => void;
  now: () => number;
};

// A definite refusal is "failed". Anything where Photon may have accepted the send without us
// seeing it is "ambiguous".
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
  const at = new Date(deps.now()).toISOString();
  let changed = false;

  // Act only on the current snapshot. A legacy failed intent that left the view is obsolete.
  const snapshot = [...rows];
  const present = new Set(snapshot.map((r) => r.key));
  for (const [key, prev] of Object.entries(sent)) {
    if (prev.status === "failed" && !present.has(key)) {
      sent[key] = { ...prev, status: "obsolete", at };
      changed = true;
      deps.log(`OUTBOX ${key} obsolete: no longer in the view; not sending`);
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
    if (prev?.status === "ambiguous") {
      once(`reconcile:${row.key}`, `OUTBOX ${row.key} outcome unknown; not resending, needs reconciliation`);
      continue;
    }
    if (prev?.status === "failed") { // legacy record: never auto-retried any more
      sent[row.key] = { ...prev, status: "needs_reconciliation", at };
      changed = true;
      once(`reconcile:${row.key}`, `OUTBOX ${row.key} refused earlier; not resending, needs reconciliation`);
      continue;
    }
    if (prev) continue; // accepted, needs_reconciliation or obsolete: each key is sent at most once
    if (row.jobVersion < newest.get(String(row.jobId))!) {
      sent[row.key] = { status: "obsolete", at, attempts: 0 };
      changed = true;
      deps.log(`OUTBOX ${row.key} obsolete: job ${row.jobId} is now v${newest.get(String(row.jobId))}; not sending`);
      continue;
    }
    if (!space) {
      once(`nospace:${household}`, `OUTBOX waiting: ${target} has not texted this line yet, so there is no thread to reply in (no cold messages)`);
      continue;
    }
    const result = await deps.send(space, row.key, row.body);
    sent[row.key] = { status: result === "failed" ? "needs_reconciliation" : result, at, attempts: 1 };
    changed = true;
    if (result === "failed") {
      noted.add(`reconcile:${row.key}`);
      deps.log(`OUTBOX ${row.key} -> ${target}: failed; not retrying (the bridge cannot see job status), needs reconciliation`);
    } else {
      deps.log(`OUTBOX ${row.key} -> ${target}: ${result}${result === "accepted" ? " for dispatch (delivery not confirmed)" : ""}`);
    }
  }
  return changed;
}
