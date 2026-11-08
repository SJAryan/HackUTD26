import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureBridgeRole, type Role } from "./role.ts";

const CODE = "synthetic-invite-code";

function fake(initial?: Role, granted: Role = { role: "bridge", incidentId: "tornado-1" }) {
  let role = initial;
  const claims: string[] = [];
  return {
    claims,
    deps: {
      current: () => role,
      claim: async (code: string) => { claims.push(code); role = granted; },
      waitForRole: async () => role,
    },
  };
}

test("an identity that already has the bridge role does not claim again", async () => {
  const f = fake({ role: "bridge", incidentId: "tornado-1" });
  assert.deepEqual(await ensureBridgeRole(f.deps, "tornado-1", CODE), { role: "bridge", incidentId: "tornado-1" });
  assert.deepEqual(f.claims, []);
});

test("a new identity claims the invite once", async () => {
  const f = fake();
  await ensureBridgeRole(f.deps, "tornado-1", CODE);
  assert.deepEqual(f.claims, [CODE]);
});

test("no role and no invite code fails clearly", async () => {
  await assert.rejects(ensureBridgeRole(fake().deps, "tornado-1", undefined), /BRIDGE_INVITE_CODE.*docs\/setup\.md/);
});

test("a non-bridge role or another incident fails clearly", async () => {
  await assert.rejects(ensureBridgeRole(fake({ role: "coordinator", incidentId: "tornado-1" }).deps, "tornado-1", CODE), /'coordinator'.*needs 'bridge'/);
  await assert.rejects(ensureBridgeRole(fake({ role: "bridge", incidentId: "freeze-1" }).deps, "tornado-1", CODE), /needs 'bridge' for tornado-1/);
  await assert.rejects(ensureBridgeRole(fake(undefined, { role: "driver", incidentId: "tornado-1" }).deps, "tornado-1", CODE), /'driver'/);
});

test("a rejected claim fails without echoing the invite code", async () => {
  const deps = { ...fake().deps, claim: async () => { throw new Error("invalid or used invite code"); } };
  await assert.rejects(ensureBridgeRole(deps, "tornado-1", CODE), (e: Error) => /invalid or used/.test(e.message) && !e.message.includes(CODE));
});
