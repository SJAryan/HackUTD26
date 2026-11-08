import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@photon-ai/api";
import { MAX_RETRIES, RETRY_FAILED_MS, RETRY_WINDOW_MS, classifySendError, processOutbox, type OutboxRow, type SendResult, type SentLog, type Space } from "./outbox.ts";

// Synthetic rows in A's outbox shape (key = job:<id>:v<version>:<recipient>:<purpose>).
const eta = (jobId: number, version = 1, household = "H17"): OutboxRow => ({
  key: `job:${jobId}:v${version}:household:${household}:eta`,
  jobId: BigInt(jobId), jobVersion: version,
  recipient: `household:${household}`, purpose: "eta",
  body: "Ana is bringing a battery. Estimated ready by 2:13 AM.",
});
const assignment: OutboxRow = {
  key: "job:1:v1:driver:ana:assignment", jobId: 1n, jobVersion: 1, recipient: "driver:ana", purpose: "assignment",
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

test("H17 ETA row is sent once with its key as the idempotency key, even when seen twice", async () => {
  const w = world();
  const row = eta(1);
  await processOutbox([row, row], "H17", space, w.sent, w.deps, w.noted); // same row twice in one view update
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted); // and again on the next poll
  assert.equal(w.sends.length, 1);
  assert.deepEqual(w.sends[0], { key: row.key, body: row.body, space });
  assert.equal(w.sent[row.key].status, "accepted");
});

test("a new job version is a new key and sends again", async () => {
  const w = world();
  await processOutbox([eta(1, 1)], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([eta(1, 1), eta(1, 2)], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), ["job:1:v1:household:H17:eta", "job:1:v2:household:H17:eta"]);
});

test("driver recipient is not sent and is logged once without numbers", async () => {
  const w = world();
  await processOutbox([assignment, eta(1)], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([assignment], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), [eta(1).key]);
  const skips = w.log.filter((l) => l.includes("no channel for driver:ana"));
  assert.equal(skips.length, 1);
  assert.ok(!/\d{7,}/.test(w.log.join("\n")));
});

test("a household that is not enrolled is not sent", async () => {
  const w = world();
  await processOutbox([eta(2, 1, "H22")], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 0);
  assert.ok(w.log.some((l) => l.includes("no channel for household:H22")));
  assert.equal(w.sent[eta(2, 1, "H22").key], undefined);
});

test("failed send is retried after the backoff with the same key, then never again once accepted", async () => {
  const w = world(["failed", "accepted"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sent[row.key].status, "failed");
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted); // inside the backoff: no resend
  assert.equal(w.sends.length, 1);
  w.tick(RETRY_FAILED_MS);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sent[row.key], { status: "accepted", at: "2026-11-08T08:00:15.000Z", attempts: 2, firstAt: "2026-11-08T08:00:00.000Z" });
  w.tick(RETRY_FAILED_MS);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 2);
  assert.ok(w.sends.every((s) => s.key === row.key));
});

test("ambiguous send is not resent and is flagged for reconciliation", async () => {
  const w = world(["ambiguous"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(10 * RETRY_FAILED_MS);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.equal(w.sent[row.key].status, "ambiguous");
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

test("failed ETA whose row leaves the view (job delivered) is obsolete and never retried", async () => {
  const w = world(["failed"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sent[row.key].status, "failed");
  w.tick(RETRY_FAILED_MS);
  await processOutbox([], "H17", space, w.sent, w.deps, w.noted); // job moved on: A's view drops the row
  assert.equal(w.sent[row.key].status, "obsolete");
  w.tick(RETRY_FAILED_MS);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted); // even if it showed up again
  assert.equal(w.sends.length, 1);
  assert.ok(w.log.some((l) => l.includes(`${row.key} obsolete: no longer in the view`)));
});

test("v1 failed and v2 present: only v2 is sent, v1 is permanently obsolete", async () => {
  const w = world(["failed", "accepted"]);
  await processOutbox([eta(1, 1)], "H17", space, w.sent, w.deps, w.noted);
  w.tick(RETRY_FAILED_MS);
  await processOutbox([eta(1, 1), eta(1, 2)], "H17", space, w.sent, w.deps, w.noted);
  w.tick(RETRY_FAILED_MS);
  await processOutbox([eta(1, 1), eta(1, 2)], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), [eta(1, 1).key, eta(1, 2).key]);
  assert.equal(w.sent[eta(1, 1).key].status, "obsolete");
  assert.equal(w.sent[eta(1, 2).key].status, "accepted");
});

test("an older version is never sent when a newer one is in the same snapshot", async () => {
  const w = world();
  await processOutbox([eta(1, 2), eta(1, 1)], "H17", space, w.sent, w.deps, w.noted);
  assert.deepEqual(w.sends.map((s) => s.key), [eta(1, 2).key]);
  assert.equal(w.sent[eta(1, 1).key].status, "obsolete");
});

test("a failed ETA past 2 minutes from its first attempt expires instead of sending", async () => {
  const w = world(["failed"]);
  const row = eta(1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(RETRY_WINDOW_MS + 1);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  w.tick(RETRY_FAILED_MS);
  await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
  assert.equal(w.sends.length, 1);
  assert.equal(w.sent[row.key].status, "expired");
  assert.equal(w.log.filter((l) => l.includes("expired") && l.includes("needs reconciliation")).length, 1);
});

test("a failed ETA is retried at most 3 times, then expires", async () => {
  const w = world(["failed", "failed", "failed", "failed", "accepted"]);
  const row = eta(1);
  for (let i = 0; i < 8; i++) {
    await processOutbox([row], "H17", space, w.sent, w.deps, w.noted);
    w.tick(RETRY_FAILED_MS);
  }
  assert.equal(w.sends.length, 1 + MAX_RETRIES);
  assert.equal(w.sent[row.key].status, "expired");
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
