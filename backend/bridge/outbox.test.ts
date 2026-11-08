import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@photon-ai/api";
import { classifySendError, processOutbox, sendKey, type OutboxRow, type SendResult, type SentLog, type Space } from "./outbox.ts";

const SECOND = 1_000;

// Synthetic rows in A's outbox shape (key = job:<id>:v<version>:<recipient>:<purpose>).
// createdAt stands in for the row's SpacetimeDB Timestamp; a database reset gives a different one.
const CREATED = 1_794_124_800_000_000n; // 2026-11-08T08:00:00Z in microseconds
const at = (micros: bigint) => ({ microsSinceUnixEpoch: micros });
const eta = (jobId: number, version = 1, household = "H17", created = CREATED): OutboxRow => ({
  key: `job:${jobId}:v${version}:household:${household}:eta`, createdAt: at(created),
  jobId: BigInt(jobId), jobVersion: version,
  recipient: `household:${household}`, purpose: "eta",
  body: "Ana is bringing a battery. Estimated ready by 2:13 AM.",
});
const assignment: OutboxRow = {
  key: "job:1:v1:driver:ana:assignment", createdAt: at(CREATED), jobId: 1n, jobVersion: 1, recipient: "driver:ana", purpose: "assignment",
  body: "New stop: H17 via R4 with BAT-01. Ready by 2:13 AM.",
};
const space: Space = { spaceId: "spc_synthetic", senderId: "usr_agent_synthetic" };

function world(results: SendResult[] = []) {
  let clock = Date.parse("2026-11-08T08:00:00.000Z");
  const sends: { key: string; body: string; space: Space }[] = [];
  const log: string[] = [];
  const deps = {
    send: async (s: Space, key: string, body: string) => { sends.push({ key, body, space: s }); return results.shift() ?? "accepted"; },
    log: (l: string) => { log.push(l); },
    now: () => clock,
  };
  return { deps, sends, log, sent: {} as SentLog, noted: new Set<string>(), tick: (ms: number) => { clock += ms; } };
}

test("H17 ETA row is sent once with its send key as the idempotency key, even when seen twice", async () => {
  const w = world();
  const row = eta(1);
  await processOutbox([row, row], "H17", space, w.sent, w.deps, w.noted); // same row twice in one view update
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted); // and again on the next poll
  assert.equal(w.sends.length, 1);
  assert.deepEqual(w.sends[0], { key: `${row.key}@${CREATED}`, body: row.body, space });
  assert.equal(w.sent[sendKey(row)].status, "accepted");
});

test("a new job version is a new key and sends again", async () => {
  const w = world();
  await processOutbox([eta(1, 1)], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([eta(1, 1), eta(1, 2)], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key.split("@")[0]), ["job:1:v1:household:H17:eta", "job:1:v2:household:H17:eta"]);
});

test("driver recipient is not sent and is logged once without numbers", async () => {
  const w = world();
  await processOutbox([assignment, eta(1)], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([assignment], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key.split("@")[0]), [eta(1).key]);
  const skips = w.log.filter((l) => l.includes("no channel for driver:ana"));
  assert.equal(skips.length, 1);
  assert.ok(!/\d{7,}/.test(w.log.join("\n")));
});

test("a household that is not enrolled is not sent", async () => {
  const w = world();
  await processOutbox([eta(2, 1, "H22")], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 0);
  assert.ok(w.log.some((l) => l.includes("no channel for household:H22")));
  assert.equal(w.sent[sendKey(eta(2, 1, "H22"))], undefined);
});

test("accepted is never resent", async () => {
  const w = world(["accepted"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(60 * SECOND);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.deepEqual(w.sent[sendKey(row)], { status: "accepted", at: "2026-11-08T08:00:00.000Z", attempts: 1 });
});

test("failed send, then delivery with the row still in the view: no resend at 20s or 60s", async () => {
  const w = world(["failed", "accepted"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sent[sendKey(row)].status, "needs_reconciliation");
  // The job is delivered, but the unfiltered view still holds the v1 ETA row.
  w.tick(20 * SECOND);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(40 * SECOND);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.equal(w.sent[sendKey(row)].status, "needs_reconciliation");
  const notes = w.log.filter((l) => l.includes("needs reconciliation"));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /failed; not retrying/);
  assert.ok(!/\d{7,}/.test(w.log.join("\n")));
});

test("a legacy failed record from an older build is never retried", async () => {
  const w = world();
  const row = eta(1);
  w.sent[sendKey(row)] = { status: "failed", at: "2026-11-08T07:59:00.000Z", attempts: 1 };
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(60 * SECOND);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 0);
  assert.equal(w.sent[sendKey(row)].status, "needs_reconciliation");
});

test("ambiguous send is not resent and is flagged for reconciliation", async () => {
  const w = world(["ambiguous"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(150 * SECOND);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.equal(w.sent[sendKey(row)].status, "ambiguous");
  assert.equal(w.log.filter((l) => l.includes("needs reconciliation")).length, 1);
});

test("no thread yet: waits without sending or recording, then sends once the sender has texted", async () => {
  const w = world();
  const row = eta(1);
  assert.equal(await processOutbox([row], "H17", undefined, w.sent, w.deps, w.noted), false);
  assert.equal(w.sends.length, 0);
  assert.deepEqual(w.sent, {});
  assert.ok(w.log.some((l) => l.includes("no cold messages")));
  assert.equal(await processOutbox([row], "H17", space, w.sent, w.deps, w.noted), true);
  assert.equal(w.sends.length, 1);
});

test("a legacy failed record whose row left the view is obsolete and never sent", async () => {
  const w = world();
  const row = eta(1);
  w.sent[sendKey(row)] = { status: "failed", at: "2026-11-08T07:59:00.000Z", attempts: 1 };
  await processOutbox([], "H17", space, w.sent, w.deps, w.noted); // job moved on: the view drops the row
  assert.equal(w.sent[sendKey(row)].status, "obsolete");
  w.tick(60 * SECOND);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted); // even if it showed up again
  assert.equal(w.sends.length, 0);
  assert.ok(w.log.some((l) => l.includes(`${row.key} obsolete: no longer in the view`)));
});

test("v1 failed and v2 present: v1 is not resent, only v2 is sent", async () => {
  const w = world(["failed", "accepted"]);
  await processOutbox([eta(1, 1)], "H17", space, w.sent, w.deps, w.noted);
  w.tick(20 * SECOND);
  await processOutbox([eta(1, 1), eta(1, 2)], "H17", space, w.sent, w.deps, w.noted);
  w.tick(20 * SECOND);
  await processOutbox([eta(1, 1), eta(1, 2)], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key.split("@")[0]), [eta(1, 1).key, eta(1, 2).key]);
  assert.equal(w.sent[sendKey(eta(1, 1))].status, "needs_reconciliation");
  assert.equal(w.sent[sendKey(eta(1, 2))].status, "accepted");
});

test("an older version is never sent when a newer one is in the same snapshot", async () => {
  const w = world();
  await processOutbox([eta(1, 2), eta(1, 1)], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key.split("@")[0]), [eta(1, 2).key]);
  assert.equal(w.sent[sendKey(eta(1, 1))].status, "obsolete");
});

test("send errors: definite API refusals are failed; timeouts and gateway errors are ambiguous", () => {
  const api = (status: number) => Object.assign(Object.create(ApiError.prototype), { status }) as ApiError;
  assert.equal(classifySendError(api(400)), "failed");
  assert.equal(classifySendError(api(429)), "failed");
  assert.equal(classifySendError(api(503)), "failed");
  assert.equal(classifySendError(api(504)), "ambiguous");
  assert.equal(classifySendError(api(408)), "ambiguous");
  assert.equal(classifySendError(new Error("timeout")), "ambiguous");
});

test("after a database reset the same outbox key with a new createdAt sends again with a new idempotency key", async () => {
  const w = world();
  const before = eta(1);
  const after = eta(1, 1, "H17", CREATED + 3_600_000_000n); // reset: job IDs restart, row created later
  assert.equal(before.key, after.key);
  await processOutbox([before], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([after], "H17", space, w.sent, w.deps, w.noted); // new database instance
  assert.equal(w.sends.length, 2);
  assert.notEqual(w.sends[0].key, w.sends[1].key);
  assert.equal(w.sends[1].key, sendKey(after));
  assert.equal(w.sent[sendKey(before)].status, "accepted");
  assert.equal(w.sent[sendKey(after)].status, "accepted");
  assert.ok(!/\d{7,}/.test(w.log.join("\n")));
});

test("same outbox key and same createdAt is never resent, even from a reloaded send log", async () => {
  const w = world();
  await processOutbox([eta(1)], "H17", space, w.sent, w.deps, w.noted);
  const reloaded: SentLog = JSON.parse(JSON.stringify(w.sent)); // bridge restart reads .bridge-state.json
  await processOutbox([eta(1)], "H17", space, reloaded, w.deps, new Set());
  assert.equal(w.sends.length, 1);
});

test("a send record under a bare outbox key from an older build does not block the new send key", async () => {
  const w = world();
  const row = eta(1);
  w.sent[row.key] = { status: "accepted", at: "2026-11-08T07:00:00.000Z", attempts: 1 };
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), [sendKey(row)]);
});

// Pre-upgrade .bridge-state.json files keyed records by the bare outbox key.
const AFTER_CREATED = "2026-11-08T08:00:05.000Z"; // sent 5s after the row was created
const WELL_BEFORE = "2026-11-08T07:00:00.000Z"; // an hour before: an earlier database instance
const SKEW = "2026-11-08T07:59:30.000Z"; // 30s before: inside the skew window

for (const status of ["accepted", "ambiguous", "needs_reconciliation", "failed", "obsolete"] as const) {
  test(`upgrade without reset: a legacy ${status} record is migrated to the send key and not resent`, async () => {
    const w = world();
    const row = eta(1);
    w.sent[row.key] = { status, at: AFTER_CREATED, attempts: 1 };
    assert.equal(await processOutbox([row], "H17", space, w.sent, w.deps, w.noted), true);
    assert.equal(w.sends.length, 0);
    await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
    assert.equal(w.sends.length, 0);
    assert.equal(w.sent[row.key], undefined);
    assert.deepEqual(w.sent[sendKey(row)], {
      status: status === "failed" ? "needs_reconciliation" : status, at: AFTER_CREATED, attempts: 1,
    });
    assert.ok(w.log.some((l) => l.includes("migrated legacy send record")));
  });
}

test("reset: a legacy record from well before the new row is dropped and the row sends once", async () => {
  const w = world();
  const row = eta(1);
  w.sent[row.key] = { status: "accepted", at: WELL_BEFORE, attempts: 1 };
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), [sendKey(row)]);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.equal(w.sent[row.key], undefined);
  assert.equal(w.sent[sendKey(row)].status, "accepted");
});

test("reset: a legacy failed record from well before the new row is not mistaken for this row", async () => {
  const w = world();
  const row = eta(1);
  w.sent[row.key] = { status: "failed", at: WELL_BEFORE, attempts: 1 };
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.equal(w.sent[row.key], undefined);
});

for (const [label, legacyAt] of [["within 60s before createdAt", SKEW], ["unparseable", "not a date"]] as const) {
  test(`legacy record with ${label} timing is held for reconciliation, not sent`, async () => {
    const w = world();
    const row = eta(1);
    w.sent[row.key] = { status: "accepted", at: legacyAt, attempts: 2 };
    assert.equal(await processOutbox([row], "H17", space, w.sent, w.deps, w.noted), true);
    await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
    assert.equal(w.sends.length, 0);
    assert.equal(w.sent[row.key], undefined);
    assert.deepEqual(w.sent[sendKey(row)], { status: "needs_reconciliation", at: "2026-11-08T08:00:00.000Z", attempts: 2 });
    assert.equal(w.log.filter((l) => l.includes("needs reconciliation")).length, 1);
  });
}

test("no legacy record: a genuinely new row sends once, then not again", async () => {
  const w = world();
  const row = eta(3);
  w.sent[eta(1).key] = { status: "accepted", at: AFTER_CREATED, attempts: 1 }; // unrelated legacy key
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), [sendKey(row)]);
});
