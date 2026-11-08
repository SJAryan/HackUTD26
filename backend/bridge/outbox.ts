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
// All of this is keyed by the send key (outbox key + row createdAt), not the bare outbox key: job IDs
// restart at 1 after a database reset, so the bare key repeats across database instances and Photon
// would dedupe the new send against an earlier run's idempotency key.
import { ApiError } from "@photon-ai/api";

export type OutboxRow = {
  key: string; jobId: bigint; jobVersion: number; recipient: string; purpose: string; body: string;
  createdAt: { microsSinceUnixEpoch: bigint }; // a SpacetimeDB Timestamp
};
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

// The SentLog key and the Photon idempotency-key: unique per database instance, stable across polls.
export const sendKey = (row: OutboxRow) => `${row.key}@${row.createdAt.microsSinceUnixEpoch}`;
// Logs show the outbox key only, so log lines stay free of long digit runs.
export const outboxKeyOf = (key: string) => key.split("@")[0];
// A bare-key record sent less than this long before its row's createdAt is too close to call.
const LEGACY_SKEW_MS = 60_000;

// Returns true when the send log changed and should be saved.
export async function processOutbox(
  rows: Iterable<OutboxRow>, household: string, space: Space | undefined,
  sent: SentLog, deps: OutboxDeps, noted: Set<string>,
): Promise<boolean> {
  const once = (id: string, line: string) => { if (!noted.has(id)) { noted.add(id); deps.log(line); } };
  const target = `household:${household}`;
  const at = new Date(deps.now()).toISOString();
  let changed = false;

  const snapshot = [...rows];
  // Pre-upgrade state files keyed records by the bare outbox key. Move each one to its send key
  // before anything else reads the log, so its `at` is still the original send time.
  for (const row of snapshot) {
    const key = sendKey(row);
    const legacy = sent[row.key];
    if (!legacy || sent[key]) continue;
    delete sent[row.key];
    changed = true;
    const legacyMs = Date.parse(legacy.at);
    const rowCreatedMs = Number(row.createdAt.microsSinceUnixEpoch / 1000n);
    if (legacyMs >= rowCreatedMs) { // sent after this row existed: it is this row
      sent[key] = { ...legacy, status: legacy.status === "failed" ? "needs_reconciliation" : legacy.status };
      deps.log(`OUTBOX ${row.key} migrated legacy send record (${sent[key].status}); not resending`);
    } else if (legacyMs < rowCreatedMs - LEGACY_SKEW_MS) { // sent well before this row: earlier database
      deps.log(`OUTBOX ${row.key} legacy send record predates this row (earlier database); treating as new`);
    } else { // within the clock-skew window or unreadable: cannot tell, so do not risk a duplicate
      sent[key] = { status: "needs_reconciliation", at, attempts: legacy.attempts };
      noted.add(`reconcile:${key}`);
      deps.log(`OUTBOX ${row.key} legacy send record could not be matched to this row; not sending, needs reconciliation`);
    }
  }

  // Act only on the current snapshot. A legacy failed intent that left the view is obsolete.
  const present = new Set(snapshot.map(sendKey));
  for (const [key, prev] of Object.entries(sent)) {
    if (prev.status === "failed" && !present.has(key)) {
      sent[key] = { ...prev, status: "obsolete", at };
      changed = true;
      deps.log(`OUTBOX ${outboxKeyOf(key)} obsolete: no longer in the view; not sending`);
    }
  }
  const newest = new Map<string, number>();
  for (const r of snapshot) newest.set(String(r.jobId), Math.max(newest.get(String(r.jobId)) ?? 0, r.jobVersion));

  const done = new Set<string>(); // a view update can deliver the same row twice in one pass
  for (const row of snapshot) {
    const key = sendKey(row);
    if (done.has(key)) continue;
    done.add(key);
    if (row.purpose !== "eta" || row.recipient !== target) {
      once(`skip:${key}`, `OUTBOX ${row.key} not sent: no channel for ${row.recipient} (${row.purpose})`);
      continue;
    }
    const prev = sent[key];
    if (prev?.status === "ambiguous") {
      once(`reconcile:${key}`, `OUTBOX ${row.key} outcome unknown; not resending, needs reconciliation`);
      continue;
    }
    if (prev?.status === "failed") { // legacy record: never auto-retried any more
      sent[key] = { ...prev, status: "needs_reconciliation", at };
      changed = true;
      once(`reconcile:${key}`, `OUTBOX ${row.key} refused earlier; not resending, needs reconciliation`);
      continue;
    }
    if (prev) continue; // accepted, needs_reconciliation or obsolete: each key is sent at most once
    if (row.jobVersion < newest.get(String(row.jobId))!) {
      sent[key] = { status: "obsolete", at, attempts: 0 };
      changed = true;
      deps.log(`OUTBOX ${row.key} obsolete: job ${row.jobId} is now v${newest.get(String(row.jobId))}; not sending`);
      continue;
    }
    if (!space) {
      once(`nospace:${household}`, `OUTBOX waiting: ${target} has not texted this line yet, so there is no thread to reply in (no cold messages)`);
      continue;
    }
    const result = await deps.send(space, key, row.body);
    sent[key] = { status: result === "failed" ? "needs_reconciliation" : result, at, attempts: 1 };
    changed = true;
    if (result === "failed") {
      noted.add(`reconcile:${key}`);
      deps.log(`OUTBOX ${row.key} -> ${target}: failed; not retrying (the bridge cannot see job status), needs reconciliation`);
    } else {
      deps.log(`OUTBOX ${row.key} -> ${target}: ${result}${result === "accepted" ? " for dispatch (delivery not confirmed)" : ""}`);
    }
  }
  return changed;
}
