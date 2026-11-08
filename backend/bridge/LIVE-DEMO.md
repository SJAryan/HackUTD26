# Live demo runbook: Photon bridge on Maincloud (TL-19)

These are the steps B followed for the TL-19 live run on 2026-11-08 (recorded in #12), in order
and including the fixes we needed along the way. Follow them top to bottom on demo day.

Who does what:

| Who | Does |
|---|---|
| **A** (module owner) | Publishes to Maincloud, mints invites, runs `demo:reset` |
| **B** (bridge) | Runs `npm run live` in `backend/bridge/` and watches its log |
| **D** (screens) | Runs the React app and opens the board, driver phone, resident phone and registration site |
| **Handset holder** | The consenting teammate whose number is `PHOTON_TEST_SENDER` |

> Never put invite codes, Photon keys, phone numbers or `.stdb-token` in the repo, an issue,
> a screenshot or a chat that others can read. Send each invite code privately to its owner.

---

## 0. One-time setup

### B: bridge

1. Install Node 24 or newer, then run:
   ```sh
   cd backend/bridge
   npm ci
   ```
2. `cp .env.example .env` and fill it in (Photon dashboard steps are in [README.md](README.md#setup-once)):
   - `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `PHOTON_PLATFORM=imessage`
   - `PHOTON_TEST_SENDER`: the handset holder's iMessage identity
   - `PHOTON_AGENT_HANDLE`: the Photon line the handset texts
   - `BRIDGE_SENDER_HOUSEHOLD=H17`, `BRIDGE_INCIDENT_ID=tornado-1`
   - `SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com`
   - `SPACETIMEDB_DB_NAME=time-left-hackutd26`
   - `BRIDGE_INVITE_CODE=`: the `bridge (tornado-1)` code from A (step 1)
3. Run the checks with `npm test`. All tests should pass.

### D: screens

1. In the repo root, set the Maincloud target in `.env.local`:
   ```sh
   VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
   VITE_SPACETIMEDB_DB_NAME=time-left-hackutd26
   ```
2. Run `npm ci`, then `npm run dev`, and open the URL it prints (http://localhost:5173, or the
   next free port, such as 5175).
   - On a Windows laptop with Smart App Control, `vite` can't load Rollup's native binary. Run
     the screens on another laptop.

### Handset holder

1. In Messages, start a **new direct iMessage** (blue bubble, not SMS) to the Photon line
   (`PHOTON_AGENT_HANDLE`). The bridge ignores texts from any other number.

---

## 1. A: invites (only for screens without a role)

A runs `demo:invites` on Maincloud (see "Demo reset" in `docs/setup.md`) and sends each code
privately:

| Code | Goes to | Claimed on |
|---|---|---|
| `coordinator (tornado-1)` | D | Board, lead window, **Claim role** |
| `coordinator (freeze-1)` | D | Board in a **second browser profile** |
| `driver ana (tornado-1)` | D | Driver phone for Ana |
| `driver ben (tornado-1)` | D | Driver phone for Ben (H22 race) |
| `resident H17 (tornado-1)` | D | Resident phone + registration site for H17 |
| `resident H22 (tornado-1)` | D | Resident phone for H22 (silent household) |
| `bridge (tornado-1)` | B | `backend/bridge/.env` → `BRIDGE_INVITE_CODE` |

Each code works once. Roles survive `demo:reset`, so skip this step for screens that already have
a role.
- **Bridge:** if `backend/bridge/.stdb-token` exists, the bridge already has its role and ignores
  the code. Delete `.stdb-token` only if you're starting over with a new bridge code.

## 2. D: open the screens and claim roles

1. Switch to **Live** in the top-right toggle (not **Fixture**).
2. Claim each code on its **own** screen with that screen's **Claim role** form. Don't use the
   Connection check screen for a driver or resident code, because it binds the coordinator
   identity.
3. Use a separate Chrome profile for a second identity of the same kind. Incognito windows share
   storage, so they don't work for this. For example:
   - Profile 1: lead coordinator, Ana and H17
   - Profile 2: second coordinator, Ben and H22
4. Open the **Board** (coordinator), **Driver phone** (Ana) and **Resident phone** (H17) where the
   judges can see them.

## 3. A: reset Maincloud right before the run

The live numbers on the board (R4 +17, R4-ALT +6) are only right just after a reset. Check with
the team that nobody is in the middle of a test, because the reset wipes jobs, check-ins and
registrations. Claimed roles are kept.

```powershell
# PowerShell
$env:SPACETIMEDB_SERVER = 'maincloud'; $env:SPACETIMEDB_DB_NAME = 'time-left-hackutd26'
$env:DEMO_FOLLOWUP_SEC = '60'; npm run demo:reset
Remove-Item Env:SPACETIMEDB_SERVER, Env:SPACETIMEDB_DB_NAME, Env:DEMO_FOLLOWUP_SEC
```

```sh
# bash
SPACETIMEDB_SERVER=maincloud SPACETIMEDB_DB_NAME=time-left-hackutd26 DEMO_FOLLOWUP_SEC=60 npm run demo:reset
```

Then refresh D's screens. Anything texted **before** the reset is wiped, so the handset waits until
A confirms the reset ran.

## 4. B: start the bridge (exactly one copy)

1. First make sure no old bridge is still running from an earlier terminal or session. In our run
   a second copy had been polling for two hours.
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'live.ts' } | Select-Object ProcessId, CreationDate
   ```
   - Stop any copy it lists with `Stop-Process -Id <id>`.
2. Start the bridge:
   ```sh
   cd backend/bridge
   npm run live
   ```
3. Wait for:
   ```
   Ready. LIVE as bridge for tornado-1: test sender -> H17; SpacetimeDB time-left-hackutd26 at wss://maincloud.spacetimedb.com; ...
   ```
   - On the first run it claims `BRIDGE_INVITE_CODE` and saves `.stdb-token`.
   - Lines like `OUTBOX ... not sent: no channel for driver:ana (assignment)` are expected. The
     bridge only texts H17's thread.

## 5. H17 registers (puts the address on Ana's phone)

The reset clears registrations. If H17 doesn't register, Ana's phone shows
**"No address on file; call the coordinator."**

1. On D's screens, open **Registration site** → **Live** as H17.
2. The street address is already filled in as **`418 Larkspur Ln (synthetic)`**. Keep it, or type
   any made-up address. Never use a real one.
3. Submit, and confirm the suggested need if asked (TL-15).

## 6. Handset: the live check-in

The handset sends, in the same iMessage thread:

> My backup shows 30–60 minutes left. Can the driver reach the side entrance?

**Pass when:**
- The bridge log shows the Photon message ID as the `eventId`:
  ```
  LIVE pho_msg_... receipt found, H17 30-60 min
  LIVE pho_msg_... -> H17/tornado-1: 30-60 min
  LIVE pho_msg_... reply accepted for dispatch (delivery not confirmed)
  ```
- The handset gets the bridge's reply in the same thread. Nobody types a reply; the bridge sends
  it.
- H17 changes lane on D's board **without a refresh**.

## 7. Coordinator: reserve R4 → ETA text

1. On the Board, click H17 and press **"Reserve … and send Ana on R4"**.
2. **Pass when:**
   - The bridge log shows the ETA once:
     ```
     OUTBOX job:<n>:v1:household:H17:eta -> household:H17: accepted for dispatch (delivery not confirmed)
     ```
   - The handset receives *"Ana is bringing a … Estimated ready by …"* **exactly once**.
   - Ana's driver phone shows the job, ETA and H17's address from step 5.

## 8. B: replay check (no new effect)

1. Stop the bridge with Ctrl+C, then start it again with `npm run live`.
2. **Pass when** it logs `Ready` and nothing else for H17:
   - no new `LIVE pho_msg_...` line
   - no second ETA
   - in `.bridge-state.json`, the ETA's send key still shows `attempts: 1`

## 9. Optional: detour

Confirm a detour for the job on the board. There's a known gap (`check:tl12`): the old ETA isn't
refreshed. It must not be sent a second time either.

## 10. Record the run

Post in #12: the time (UTC), commit, live or replay, the `eventId`, the ETA send key, what passed
and what was skipped. Example: the TL-19 run comment in #12.

---

## Not built yet

- **"Backup left?" outreach poll (demo step 3).** The team decided Photon sends it, but it needs an
  outbox intent from A's `openCheckinRound` (request on #37) and then bridge support.
  - Photon never starts a thread, so the handset must send one opt-in text beforehand, followed
    by a `demo:reset`.
  - Until then, the demo opens with the resident texting first (step 6).

## Troubleshooting

| You see | Do |
|---|---|
| `No address on file; call the coordinator.` on Ana's phone | H17 hasn't registered since the reset: do step 5 |
| Board numbers aren't R4 +17 / R4-ALT +6 | The seed clock is stale: A reruns the reset (step 3) |
| Bridge says the identity has no role, or the saved token is stale | Delete `.stdb-token`, get a new `bridge` code from A, put it in `.env`, restart |
| An unexpected `OUTBOX job:<n>` for H22/Ben before your run | Someone tested after the reset: ask A to reset again |
| Handset text has no `LIVE` line in the log | Check it's iMessage (blue), from `PHOTON_TEST_SENDER`, to `PHOTON_AGENT_HANDLE`, and that only one bridge is running |
| `vite` fails with a Rollup error on Windows | Smart App Control: run the screens on another laptop |
