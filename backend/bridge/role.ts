// TL-08: the bridge session must hold A's 'bridge' role for its incident (TL-05).
// Kept free of SpacetimeDB imports so it can be tested with plain node --test.

export type Role = { role: string; incidentId: string };

export type RoleDeps = {
  current: () => Role | undefined; // my_role view
  claim: (code: string) => Promise<void>; // reducers.claimInvite
  waitForRole: () => Promise<Role | undefined>; // resolves once my_role shows a row, or undefined on timeout
};

// Claims the invite only when this identity has no role yet; never logs the code.
export async function ensureBridgeRole(deps: RoleDeps, incidentId: string, inviteCode: string | undefined): Promise<Role> {
  let me = deps.current();
  if (!me) {
    if (!inviteCode) {
      throw new Error("This bridge identity has no role. Set BRIDGE_INVITE_CODE to a bridge invite for " +
        `${incidentId} (the module owner creates it; see docs/setup.md) and run again.`);
    }
    try {
      await deps.claim(inviteCode);
    } catch (error) {
      throw new Error(`Claiming the bridge invite failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    me = await deps.waitForRole();
    if (!me) throw new Error("Invite claimed, but my_role did not update in time.");
  }
  if (me.role !== "bridge" || me.incidentId !== incidentId) {
    throw new Error(`This identity is '${me.role}' for ${me.incidentId}; the bridge needs 'bridge' for ${incidentId}. ` +
      "Delete .stdb-token to start a new identity, then claim a bridge invite.");
  }
  return me;
}
