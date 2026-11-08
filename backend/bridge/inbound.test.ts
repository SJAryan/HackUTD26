import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromFixture, handle, householdFor, inboundText, replyText, type CheckinArgs, type Deps, type PhotonItem } from "./inbound.ts";
import { extractRuntime } from "./extract.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/h17-checkin.json", import.meta.url), "utf8"));

// Fake reducer with the same duplicate rule as A's ingestCheckin: a known eventId is a no-op.
function fakeWorld() {
  const checkins = new Map<string, CheckinArgs>();
  const calls = { ingest: 0, reply: [] as string[], log: [] as string[] };
  const deps: Deps = {
    ingest: async (args) => { calls.ingest++; if (!checkins.has(args.eventId)) checkins.set(args.eventId, args); },
    reply: async (_to, _parent, text) => { calls.reply.push(text); },
    log: (line) => { calls.log.push(line); },
  };
  return { checkins, calls, deps };
}

test("replaying the fixture twice is once-effective and never replies", async () => {
  const { checkins, calls, deps } = fakeWorld();
  const { event, incidentId, householdId } = fromFixture(fixture);
  assert.equal(incidentId, "tornado-1");
  const seen = new Set<string>();
  assert.equal(await handle(event, householdId, incidentId, deps, seen, "REPLAY"), "ingested");
  assert.equal(await handle(event, householdId, incidentId, deps, seen, "REPLAY"), "duplicate");
  // A second process has a fresh seen-set; the reducer rule still keeps one effect.
  await handle(event, householdId, incidentId, deps, new Set(), "REPLAY");
  assert.equal(calls.ingest, 2);
  assert.equal(checkins.size, 1);
  const row = checkins.get(event.eventId)!;
  assert.deepEqual([row.householdId, row.incidentId, row.runtimeLowerMin, row.runtimeUpperMin], ["H17", "tornado-1", 30, 60]);
  assert.equal(row.observedAt.toISOString(), fixture.event.observedAt);
  assert.deepEqual(calls.reply, []);
  assert.ok(calls.log.every((l) => l.startsWith("REPLAY ")));
});

const item = (over: Partial<PhotonItem> & { text?: string } = {}): PhotonItem => ({
  id: "msg_1", platform: "imessage", status: "received", createdAt: "2026-11-08T08:00:00.000Z",
  sentBy: { platform: "imessage", kind: "human", handle: "+15555550117", id: "usr_h" },
  receivedBy: { platform: "imessage", kind: "agent", handle: "+15555550188", id: "usr_a" },
  space: { platform: "imessage", kind: "direct", id: "spc_1" },
  content: { type: "text", format: "plain", text: over.text ?? "about 45 minutes" },
  ...over,
});
const binding = { sender: "+15555550117", householdId: "H17", incidentId: "tornado-1" };

test("live: bound sender is ingested once and gets one receipt; no ETA", async () => {
  const { checkins, calls, deps } = fakeWorld();
  const m = item();
  const event = inboundText(m, "imessage", "+15555550188")!;
  assert.equal(householdFor(m, binding), "H17");
  const seen = new Set<string>();
  await handle(event, "H17", "tornado-1", deps, seen, "LIVE");
  await handle(event, "H17", "tornado-1", deps, seen, "LIVE");
  assert.equal(checkins.size, 1);
  assert.deepEqual(calls.reply, ["Got it, we've recorded about 45 minutes of backup. A coordinator will follow up."]);
  assert.ok(!/eta|arriv/i.test(calls.reply[0]));
});

test("live: phone percentage records the message with runtime unset and asks one question", async () => {
  const { checkins, calls, deps } = fakeWorld();
  const event = inboundText(item({ text: "my phone is at 20%" }), "imessage", "+15555550188")!;
  await handle(event, "H17", "tornado-1", deps, new Set(), "LIVE");
  const row = [...checkins.values()][0];
  assert.equal(row.runtimeLowerMin, undefined);
  assert.equal(row.runtimeUpperMin, undefined);
  assert.equal(calls.reply.length, 1);
  assert.match(calls.reply[0], /battery display/);
});

test("live: phone runtime with unknown oxygen backup records runtime unset and asks, never a receipt", async () => {
  const { checkins, calls, deps } = fakeWorld();
  const event = inboundText(item({ text: "My phone battery has 2 hours left but my oxygen backup is unknown." }), "imessage", "+15555550188")!;
  assert.equal(await handle(event, "H17", "tornado-1", deps, new Set(), "LIVE"), "ingested");
  const row = [...checkins.values()][0];
  assert.equal(row.runtimeLowerMin, undefined);
  assert.equal(row.runtimeUpperMin, undefined);
  assert.equal(calls.reply.length, 1);
  assert.match(calls.reply[0], /battery display .*oxygen concentrator/);
  assert.ok(!/recorded/.test(calls.reply[0]));
});

test("unbound sender, outbound, group and non-text messages are not check-ins", () => {
  assert.equal(householdFor(item({ sentBy: { platform: "imessage", kind: "human", handle: "+15555550999", id: "usr_x" } }), binding), undefined);
  assert.equal(inboundText(item({ status: "sent" }), "imessage", "+15555550188"), undefined);
  assert.equal(inboundText(item({ space: { platform: "imessage", kind: "group", id: "spc_g" } }), "imessage", "+15555550188"), undefined);
  assert.equal(inboundText(item({ content: { type: "image" } }), "imessage", "+15555550188"), undefined);
  assert.equal(inboundText(item(), "imessage", "+15555550000"), undefined);
});

test("failed ingest is not marked seen so the next poll retries, and sends nothing", async () => {
  const { calls, deps } = fakeWorld();
  deps.ingest = async () => { calls.ingest++; throw new Error("connection lost"); };
  const event = inboundText(item(), "imessage", "+15555550188")!;
  const seen = new Set<string>();
  assert.equal(await handle(event, "H17", "tornado-1", deps, seen, "LIVE"), "failed");
  assert.equal(seen.size, 0);
  assert.deepEqual(calls.reply, []);
});

test("receipt wording for each runtime shape", () => {
  const r = (t: string) => replyText(extractRuntime(t));
  assert.equal(r("30 to 60 minutes"), "Got it, we've recorded about 30 to 60 minutes of backup. A coordinator will follow up.");
  assert.equal(r("1 to 2 hrs"), "Got it, we've recorded about 1 to 2 hours of backup. A coordinator will follow up.");
  assert.equal(r("Under 30 min"), "Got it, we've recorded under 30 minutes of backup. A coordinator will follow up.");
  assert.equal(r("2+ hrs"), "Got it, we've recorded 2 hours or more of backup. A coordinator will follow up.");
  assert.equal(r("Not sure"), undefined);
});

test("live: no runtime records the message for review with runtime unset and sends no reply", async () => {
  const { checkins, calls, deps } = fakeWorld();
  const event = inboundText(item({ text: "Can the driver use the side entrance?" }), "imessage", "+15555550188")!;
  assert.equal(await handle(event, "H17", "tornado-1", deps, new Set(), "LIVE"), "ingested");
  const row = [...checkins.values()][0];
  assert.equal(row.runtimeLowerMin, undefined);
  assert.equal(row.runtimeUpperMin, undefined);
  assert.deepEqual(calls.reply, []);
  assert.ok(calls.log.some((l) => l.includes("needs_review")));
});

test("unenrolled sender: a valid check-in message still maps to no household, so live.ts ignores it", () => {
  const m = item({ sentBy: { platform: "imessage", kind: "human", handle: "+15555550999", id: "usr_x" }, text: "30 to 60 minutes left" });
  assert.ok(inboundText(m, "imessage", "+15555550188"), "message itself passes the inbound checks");
  assert.equal(householdFor(m, binding), undefined);
});
