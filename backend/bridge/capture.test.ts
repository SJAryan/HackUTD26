import { test } from "node:test";
import assert from "node:assert/strict";
import { toFixture } from "./capture.ts";

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
