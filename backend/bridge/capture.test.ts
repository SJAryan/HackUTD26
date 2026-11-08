import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTURES_DIR, captureTarget, sanitize, toFixture } from "./capture.ts";

// Synthetic message in the listMessages item shape; numbers are fictional 555 values.
const sender = "+15555550117";
const agent = "+15555550188";
const message = {
  id: "msg_synthetic_1",
  platform: "imessage",
  status: "received",
  createdAt: "2026-11-08T02:00:00.000Z",
  sentBy: { id: "usr_h", kind: "human", platform: "imessage", handle: sender, name: "Real Person" },
  receivedBy: { id: "usr_a", kind: "agent", platform: "imessage", handle: agent },
  space: { id: "spc_1", kind: "direct", platform: "imessage" },
  content: { type: "text", format: "plain", text: "My backup shows 30–60 minutes left. Can the driver reach the side entrance? Call 15555550117" },
} as any;

test("fixture redacts both identities and names, keeps provider IDs and observed time", () => {
  const f = toFixture(message, { sender, agent }, "H17", "tornado", "2026-11-08T02:00:03.000Z");
  const text = JSON.stringify(f);
  assert.ok(!text.includes("5555550117") && !text.includes("5555550188") && !text.includes("Real Person"));
  assert.equal(f.provider.sentBy.handle, "<test-sender>");
  assert.equal(f.provider.receivedBy.handle, "<agent-line>");
  assert.deepEqual(
    { eventId: f.event.eventId, householdBinding: f.event.householdBinding, observedAt: f.event.observedAt, extracted: f.event.extracted },
    { eventId: "msg_synthetic_1", householdBinding: "H17", observedAt: "2026-11-08T02:00:00.000Z", extracted: null },
  );
  assert.match(f.event.text, /30–60 minutes left/);
});

test("fixture redacts the project ID everywhere", () => {
  const project = "pho_prj_test123";
  const withProject = { ...message, projectId: project, space: { ...message.space, projectId: project, uri: `projects/${project}/spaces/spc_1` } };
  const f = toFixture(withProject, { sender, agent, project }, "H17", "tornado", "2026-11-08T02:00:03.000Z");
  const text = JSON.stringify(f);
  assert.ok(!text.includes(project));
  assert.equal(f.provider.projectId, "<project-id>");
  assert.equal(f.provider.space.projectId, "<project-id>");
  assert.equal(f.provider.space.uri, "projects/<project-id>/spaces/spc_1");
  assert.equal(f.event.eventId, "msg_synthetic_1");
});

test("same provider message gives the same eventId on replay", () => {
  const a = toFixture(message, { sender, agent }, "H17", "tornado", "2026-11-08T02:00:03.000Z");
  const b = toFixture(message, { sender, agent }, "H17", "tornado", "2026-11-08T02:09:00.000Z");
  assert.equal(a.event.eventId, b.event.eventId);
  assert.equal(a.event.observedAt, b.event.observedAt);
});

// Formatted-number redaction. All numbers are fictional 555 values.
const fakeSender = "+12145550101";
const fakeAgent = "+14695550188";
const say = (text: string) => ({ ...message, sentBy: { ...message.sentBy, handle: fakeSender }, receivedBy: { ...message.receivedBy, handle: fakeAgent }, content: { ...message.content, text } });

for (const written of ["(214) 555-0101", "214-555-0101", "214.555.0101", "2145550101", "+1 214 555 0101", "12145550101", "+1 (214) 555-0101"]) {
  test(`masks the sender written as ${written}`, () => {
    const f = toFixture(say(`Call me at ${written} please`) as any, { sender: fakeSender, agent: fakeAgent }, "H17", "tornado-1", "2026-11-08T08:00:03.000Z");
    assert.equal(f.event.text, "Call me at <test-sender> please");
    assert.ok(!JSON.stringify(f).replace(/\D/g, "").includes("2145550101"));
  });
}

test("masks the agent line written with formatting", () => {
  const f = toFixture(say("Texted (469) 555-0188 earlier") as any, { sender: fakeSender, agent: fakeAgent }, "H17", "tornado-1", "2026-11-08T08:00:03.000Z");
  assert.equal(f.event.text, "Texted <agent-line> earlier");
});

test("masks an email identity in mixed case", () => {
  const out = sanitize({ text: "Reach me at Test.Sender@Example.COM today" }, "test.sender@example.com", fakeAgent);
  assert.equal(out.text, "Reach me at <test-sender> today");
});

test("leaves an unrelated number alone", () => {
  const text = "Generator ticket 972-555-0199, unit 42, about 30 to 60 minutes left";
  assert.equal(sanitize({ text }, fakeSender, fakeAgent).text, text);
});

test("refuses to write when the sender's digits survive in another form", () => {
  assert.throws(() => sanitize({ text: "2 1 4 / 5 5 5 / 0 1 0 1" }, fakeSender, fakeAgent), /refusing to write/);
});

test("raw captures may only be written inside captures/", () => {
  assert.equal(captureTarget(join(CAPTURES_DIR, "h17-checkin.json")), join(CAPTURES_DIR, "h17-checkin.json"));
  assert.throws(() => captureTarget(join(CAPTURES_DIR, "..", "fixtures", "h17-checkin.json")), /inside captures/);
  assert.throws(() => captureTarget(CAPTURES_DIR), /inside captures/);
});

// The committed fixture is a synthetic replay: no provider data, no Photon IDs, no phone-like numbers.
test("committed H17 fixture is synthetic and matches the ingestCheckin argument shape", () => {
  const raw = readFileSync(new URL("./fixtures/h17-checkin.json", import.meta.url), "utf8");
  assert.ok(!/pho_/i.test(raw), "no Photon IDs");
  assert.ok(!/\d{7,}/.test(raw), "no long digit runs");
  assert.ok(!/\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}(?!\d)/.test(raw), "no phone-shaped numbers");
  const f = JSON.parse(raw);
  assert.deepEqual(Object.keys(f).sort(), ["_source", "event"]);
  assert.match(f._source, /^SYNTHETIC replay/);
  const e = f.event;
  assert.deepEqual(Object.keys(e).sort(), ["eventId", "extracted", "householdBinding", "incidentId", "observedAt", "text"]);
  // ingestCheckin({ eventId, incidentId, householdId, observedAt: Timestamp, text, runtimeLowerMin?, runtimeUpperMin? })
  const args = { eventId: e.eventId, incidentId: e.incidentId, householdId: e.householdBinding, observedAt: new Date(e.observedAt), text: e.text };
  for (const k of ["eventId", "incidentId", "householdId", "text"] as const) assert.equal(typeof args[k], "string");
  assert.equal(args.observedAt.toISOString(), "2026-11-08T08:00:00.000Z");
  assert.equal(args.incidentId, "tornado-1");
  assert.equal(args.householdId, "H17");
  assert.equal(e.extracted, null);
});
