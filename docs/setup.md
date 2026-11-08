# Before Zero: setup and shared contract (TL-01, TL-05, TL-06, TL-09, TL-11, TL-15, TL-18)

Owner: A (backend and integration). Scaffolded with `spacetime init --template react-ts`.
All data in the seed is synthetic.

## Versions

| Tool | Version |
|---|---|
| SpacetimeDB CLI | 2.14.1 (`spacetime --version`) |
| `spacetimedb` npm package | 2.14.x, locked in `package-lock.json` |
| Node | 24.x (the template asks for ^24.22.1; 24.14 works with an npm warning) |

## Paths and owners

| Path | Owner | Contents |
|---|---|---|
| `spacetimedb/src/` | A | Schema, reducers, views and seed (`index.ts`); `rules.ts` fixture adapter |
| `spacetimedb/src/domain/` | C | Pure dispatch rules, imported by A (TL-03/TL-05) |
| `src/module_bindings/` | A | Generated; never edit by hand. Run `npm run stdb:generate` |
| `src/` (everything else) | D | React client. `src/App.tsx` is a connection check D replaces |
| `backend/bridge/` | B | Photon bridge: own `package.json` and lockfile; see its README |
| `fixtures/`, `sim/` | C | Fixtures and simulator (not created yet) |
| `scripts/` | A | Integration checks |
| `package.json`, lockfiles, `spacetime.json`, `.env.example` | A | Shared; ask A before changing them |

## Run it locally

From the repo root:

```bash
npm install && npm --prefix spacetimedb install
spacetime start                  # separate terminal; local server on ws://localhost:3000
npm run stdb:publish:local       # publishes database "time-left" and seeds it on first publish
npm run stdb:generate            # regenerates src/module_bindings after a schema change
cp .env.example .env.local       # client and scripts read these names
npm run dev                      # React client on http://localhost:5173
```

Reset to the seed (destroys local data, reruns `init`):

```bash
npm run stdb:reset:local
```

Always use the npm scripts or pass `--server local`. `spacetime.json` defaults to Maincloud.

## Acceptance checks

Each check needs a freshly reset database and runs owner-only invite calls through your CLI
identity, so run them as the identity that published the module.

```bash
npm run stdb:reset:local && npm run check:tl01
npm run stdb:reset:local && npm run check:tl05
npm run stdb:reset:local && npm run check:tl06
npm run stdb:reset:local && npm run check:tl09
npm run stdb:reset:local && npm run check:tl11
npm run stdb:reset:local && npm run check:tl15
npm run stdb:reset:local && npm run check:tl18
```

- **TL-01:** a bridge session records H17's 02:00 check-in; a coordinator session sees H17 change
  through its view. A replayed event ID has no effect, an unknown household is rejected, and a
  session without a role is refused and reads nothing. Ends with
  `PASS: TL-01 two-session subscription check`.
- **TL-05:** two coordinators race for BAT-01 for H17 (via R4-ALT, Ana) and H22 (via R7, Ben).
  Exactly one commits; the other gets `conflict: BAT-01 is reserved by job 1`. There is one job,
  two notification intents for that job only, and only the assigned driver sees it. It also
  checks a stale `expectedVersion`, a duplicate detour report and a replayed `jobRequestId`, and
  that a cross-incident reserve (freeze asset or route for a tornado household) and a
  cross-incident invite (freeze driver or household for `tornado-1`) are rejected and write
  nothing. `RACE_REVERSE=1` sends coordinator 2's call first. Ends with `PASS: TL-05 last-battery race`.
- **TL-06:** after Ana is assigned to H17, the resident asks "Can you use the side entrance?" and
  Ana replies; both see the same ordered thread without refreshing. A repeated send appears once.
  Resident H22 and driver Ben are refused and read nothing. Ana marks arrived and H17 confirms
  delivery, with a stale or delayed update rejected. Resident H17 reconnects with the same token
  and gets the full history back. Ends with `PASS: TL-06 job thread`.
- **TL-09:** H17 and H22 create preparedness profiles (a retry adds nothing). H17's agent
  request is refused before delivery, then accepted once after Ana delivers; a retry adds
  nothing and a second consent ID is a conflict. H22 skips (a retry adds nothing): the decline
  is recorded, no lead is created, and a request after the skip is
  `conflict: the resident skipped. Nothing was saved.` H17 skipping after opting in is a
  conflict. The coordinator sees 2 registrations and 1 opt-in, never the lead; drivers and
  sessions without a role see no profiles. Ends with `PASS: TL-09 enrollment and agent contact`.
- **TL-11** (about 12 s; sets a 2 s interval and restores 300 s): coordinator 1 opens rounds for
  H17 and H22. H17 replies and its round closes with no follow-up. H22 stays silent: it gets a
  follow-up owned by coordinator 1 with its earlier evidence kept, then escalates with the same
  owner. A stale claim conflicts and an outsider is refused; coordinator 2 claims it. H22's
  reply cancels it and nothing escalates afterwards. The audit reads created, escalated,
  claimed, cancelled, and calling the sweep directly is refused. After delivery, `releaseJob`
  frees BAT-01 and Ana, and BAT-01 is reserved for H22. Ends with
  `PASS: TL-11 follow-ups and release`.
- **TL-15:** H17 confirms `powered_equipment` (a retry adds nothing) and the coordinator sees it
  with dispatch need `battery` and "self-confirmed via preparedness profile". A second
  confirmation, an unknown need ID and a reused confirmation ID are rejected and store nothing.
  Resident H22, driver Ana and a session without a role read nothing, and the coordinator row has
  no sources, signals or confidence. Skipped H22 has no row. Household rows are unchanged and
  H17's numbers are still R4 +17, R4-ALT +6. `resetIncident` clears the confirmation. Ends with
  `PASS: TL-15 confirmed need storage`.
- **TL-18:** checks the display labels and that the seed clock and every `freeAt` are now. Plays
  H17's story live (R4 +17, R4-ALT +6, then R4 -3 after the detour; server ETA = reserve time +
  24 min). It builds up state in every lead-incident table, confirms a coordinator and an
  unknown incident are refused, then resets the lead incident. Every table is back to 0 and the
  seed is restored with a new clock. Members, invites and config are unchanged, every session
  keeps its role and the second incident is untouched. The same story then replays with the
  same IDs. Ends with `PASS: TL-18 real-time seed and repeatable reset`.

To point a check at another server, set `SPACETIMEDB_HOST`, `SPACETIMEDB_DB_NAME` and
`SPACETIMEDB_SERVER` (the CLI nickname, e.g. `maincloud`).

## Roles

Every session starts with no role and sees nothing. The module owner (the identity that
published it) creates single-use invite codes; a session claims one to get its role.

```bash
# Owner only. Make up a code and share it privately; never commit it.
spacetime call --server local time-left create_invite '"<code>"' '"coordinator"' '"tornado-1"' '""'
spacetime call --server local time-left create_invite '"<code>"' '"driver"' '"tornado-1"' '"ana"'
spacetime call --server local time-left create_invite '"<code>"' '"bridge"' '"tornado-1"' '""'
```

```ts
await conn.reducers.claimInvite({ code }); // binds this session's identity to the role
```

| Role | `subjectId` | Can call | Can read (views) |
|---|---|---|---|
| `coordinator` | `''` | `ingestCheckin`, `confirmRouteReport`, `reserve`, `openCheckinRound`, `claimFollowup`, `releaseJob` | `coordinator_*` and `job_messages` for its incident |
| `driver` | driver ID | `postJobMessage`, `updateJob` (`arrived`) on its jobs | `driver_jobs`, `job_messages`: its own jobs only |
| `bridge` | `''` | `ingestCheckin` | `bridge_outbox` and `bridge_checkins` (receipts) for its incident |
| `resident` | household ID | `postJobMessage`, `updateJob` (`delivered`) on its jobs; `enrollPreparedness`, `requestAgentContact`, `skipAgentContact`, `confirmSuggestedNeed` | `resident_jobs`, `job_messages`, `my_profile`, `my_agent_request`, `my_agent_decline`, `my_confirmed_need`: its own household only |

A driver or resident invite is rejected unless that driver or household belongs to the invite's
incident. Invite codes are single-use but do not expire; share them privately.

Every session can read `my_role` and `my_incident`. The browser keeps its identity token in
`localStorage`, so a role survives reloads; use a private window for a second identity.

## Seed

**Incident IDs are internal; the demo shows `kind` and `name`.** The IDs stay as they are so C's
and B's fixtures and tests keep working. Screens must show the incident row's `name`, never the
ID:

| ID | Role in the demo | `kind` / `name` shown |
|---|---|---|
| `tornado-1` | **Lead incident** (H17 story) | `freeze` / "Winter freeze outage (synthetic)" |
| `freeze-1` | Second incident | `tornado` / "Tornado outage (synthetic)" |

**Real time.** Each seed runs at publish time and again on every `resetIncident`. The incident
`clockAt` and every driver's and asset's `freeAt` are set to that moment, so the server's ETAs
(`reserve` uses `ctx.timestamp`) and the board's live margins agree at any time of day. A
report of 30-60 minutes gives C's numbers: R4 +17, R4-ALT +6, and R4 -3 after a confirmed
20-minute detour (Watch, then Act now with R4-ALT best). Margins are whole minutes, rounded
down, so each minute that passes after the report takes one off.

**Lead (`tornado-1`)**, clock = now:

| Table | Rows |
|---|---|
| `household` | `H17`, `H22` (silent), both need `battery` |
| `asset` | `BAT-01`, battery, free at the clock |
| `driver` | `ana` (Ana), `ben` (Ben), free at the clock |
| `route` | `R4` H17/Ana/BAT-01, ready clock+13; `R4-ALT` H17/Ana/BAT-01, ready clock+24; `R7` H22/Ben/BAT-01, ready clock+19 |

H17, R4 and R4-ALT match C's TL-03 tornado fixture. R7 and Ben are A's race seed until C's
fixture covers H22.

**Second (`freeze-1`)**, clock = now, IDs and travel values from C's TL-03 freeze fixture (PR #20):

| Table | Rows |
|---|---|
| `household` | `F03` needs `generator`; `F09`, `F14` (silent) need `battery` |
| `asset` | `GEN-02` generator, `BAT-07` battery |
| `driver` | `leo` (Leo) |
| `route` | `FZ-R1` F03/Leo/GEN-02, ready clock+18; `FZ-R2` F09/Leo/BAT-07, ready clock+23 |

The ~200 synthetic households (#41) are not seeded yet.

## Demo reset and invites (TL-18)

Owner only: run these as the identity that published the module. Point them at Maincloud with
`SPACETIMEDB_SERVER=maincloud SPACETIMEDB_DB_NAME=time-left-hackutd26`.

```bash
npm run demo:reset                     # both incidents back to the seed, re-anchored to now
npm run demo:reset -- tornado-1        # just the lead incident
DEMO_FOLLOWUP_SEC=60 npm run demo:reset # also sets the follow-up interval (default 300)
npm run demo:invites                   # prints 7 fresh single-use invites and where each goes
```

- `reset_incident(incidentId)` clears that incident's check-ins, jobs, job messages, outbox
  intents, route reports, releases, rounds, follow-ups, audit, profiles, agent contacts and
  declines. It then recreates its households, assets, drivers and routes from the seed (so every
  `activeJobId`, version, runtime and confirmed delay is back to the seed) with the clock at now.
- It never touches `member`, `invite` or `config`, so claimed roles keep working and their
  household and driver IDs exist again. Other incidents are untouched.
- `demo:reset` also restarts the follow-up sweep, which a publish that keeps data does not.
- `demo:invites` mints a coordinator for each incident, drivers Ana and Ben, residents H17 and
  H22, and one bridge. Codes go to the terminal only; never commit or paste them in the repo.

## Interfaces available now

Use the generated bindings: `import { DbConnection, tables, reducers } from './module_bindings'`.

All tables are private. Clients subscribe to views: `tables.myRole`, `tables.myIncident`,
`tables.coordinatorHouseholds`, `tables.coordinatorCheckins`, `tables.coordinatorAssets`,
`tables.coordinatorDrivers`, `tables.coordinatorRoutes`, `tables.coordinatorJobs`,
`tables.driverJobs`, `tables.residentJobs`, `tables.jobMessages`, `tables.bridgeOutbox`,
`tables.bridgeCheckins`, `tables.myProfile`, `tables.myAgentRequest`, `tables.myAgentDecline`,
`tables.coordinatorProfiles`, `tables.coordinatorRegistryStats`, `tables.coordinatorRounds`,
`tables.coordinatorFollowups` and `tables.coordinatorFollowupAudit`.
A view change can arrive as a delete plus an
insert, so read the current rows rather than relying on `onUpdate`.

Errors reject the reducer promise with a message. Messages starting `conflict:` mean someone
else's change won; `forbidden:` means the session's role does not allow the call; `rejected:`
means the request mixes incidents.

**`ingestCheckin`** (B -> A; bridge or coordinator):

```ts
conn.reducers.ingestCheckin({
  eventId: 'tl01-h17-0200',      // stable; a replay is a no-op
  incidentId: 'tornado-1',
  householdId: 'H17',            // TL-08 replaces this with the server-resolved binding
  observedAt: incident.clockAt,  // Timestamp; anchors the runtime window
  text: 'My backup shows 30-60 minutes left. Can the driver reach the side entrance?',
  runtimeLowerMin: 30,           // omit when unknown; unknown stays unknown
  runtimeUpperMin: 60,           // omit when open-ended
});
```

- **Success:** a `checkin` row is inserted. If `observedAt` is newer than the household's last
  observation, the `household` row updates and `version` increments.
- **Errors:** an unknown household or incident mismatch is rejected; lower > upper is rejected.
- **Older report:** kept in `checkin`, but does not overwrite newer household evidence.
- **Receipt for the bridge:** subscribe to `tables.bridgeCheckins` and wait for the row with your
  `eventId`. It carries `householdId`, `observedAt`, `receivedAt` and the runtime the server
  stored. A bridge session cannot read households, so use this instead of `coordinator_*`.

**`confirmRouteReport`** (coordinator):

```ts
conn.reducers.confirmRouteReport({ reportId: 'rep-r4-detour', incidentId: 'tornado-1', routeId: 'R4', delayMin: 20 });
```

Sets the route's `confirmedDelayMin`. A repeated `reportId` is a no-op, and the delay replaces
the previous one instead of adding to it.

**`reserve`** (D -> A; coordinator):

```ts
conn.reducers.reserve({
  jobRequestId: crypto.randomUUID(), // stable per click; retry with the same ID
  caseId: 'H17',
  routeId: 'R4-ALT',                 // added to the agreed contract: picks the travel legs
  assetId: 'BAT-01',
  driverId: 'ana',
  expectedVersion: 1,                // household.version from the coordinator's view
});
```

- **Success:** in one transaction, a `job` is created (`version` 1, `status` `assigned`, `etaAt`
  from the dispatch rules). The household, asset and driver are marked with `activeJobId`, the
  household `version` increments, and two `outbox` intents are written: `eta` to the household
  and `assignment` to the driver.
- **Duplicate:** the same `jobRequestId` again is a no-op.
- **Conflict:** stale `expectedVersion`, or the household, asset or driver already has a job.
  Nothing is written.
- **Rejected:** wrong role, unknown IDs, a route, asset or driver from another incident
  (`rejected: asset BAT-07 belongs to freeze-1, not tornado-1`), a route that does not join the
  case, asset and driver, or an asset of the wrong kind. Nothing is written.

**Outbox intents** (A -> B), read through `bridge_outbox`. Each has a unique
`key` (`job:<id>:v<version>:<recipient>:<purpose>`), `recipient` (`household:H17` or
`driver:ana`), `purpose`, a plain-text `body` and `status` `pending`. Marking an intent sent comes
with TL-08.

**`postJobMessage`** (D -> A; the job's resident or assigned driver):

```ts
conn.reducers.postJobMessage({
  jobId,                              // from resident_jobs or driver_jobs (bigint)
  clientMessageId: crypto.randomUUID(), // stable per message; retry with the same ID
  text: 'Can you use the side entrance?', // 1-1000 characters after trimming
});
```

- **Success:** a `job_message` row with the next `seq` for that job, `kind` `text`, the sender's
  role and display label (driver name or household ID), and the server time. The sender comes
  from the session, never from the arguments.
- **Duplicate:** the same sender, job and `clientMessageId` again is a no-op.
- **Rejected:** `forbidden:` for anyone who is not that job's resident or current driver;
  empty or overlong text.
- **Reading:** subscribe to `tables.jobMessages`, filter by `jobId` and sort by `seq`. Reconnecting
  with the same token replays the full thread.

**`updateJob`** (D -> A; the job's resident or assigned driver):

```ts
conn.reducers.updateJob({ jobId, expectedVersion: job.version, status: 'arrived' });
```

| `status` | Who | From | Result |
|---|---|---|---|
| `arrived` | assigned driver | `assigned` | job `version` + 1; thread event `[arrived] Ana arrived` |
| `delivered` | resident | `arrived` | job `version` + 1; thread event `[delivered] H17 confirmed delivery` |

A stale `expectedVersion` or wrong current status is a `conflict:`, so a delayed or duplicate
ARRIVED cannot change the job again. The wrong role is `forbidden:`. Delivery on its own does
not free the driver or battery; a coordinator calls `releaseJob` (below).

**`enrollPreparedness`** (TL-09, D -> A; the household's resident, before the incident):

```ts
conn.reducers.enrollPreparedness({
  enrollmentId: crypto.randomUUID(),      // stable per submit; retry with the same ID
  medicalNeed: 'home_oxygen',             // 'home_oxygen' | 'dialysis' | 'no_heat'
  backupDevice: 'oxygen concentrator battery',
  address: '100 Example Lane (synthetic)', // synthetic details only in the demo
  preferredContact: 'imessage',           // 'imessage' | 'phone_call'
});
```

- **Success:** one private `profile` row for the session's household (from its resident invite).
  The resident reads it through `my_profile`; coordinators through `coordinator_profiles`.
- **Duplicate:** the same `enrollmentId` again is a no-op.
- **Conflict:** the household already has a profile, or the `enrollmentId` belongs to another
  household. **Rejected:** unknown need or contact method, empty or overlong text.
  `forbidden:` without a resident session.

**`requestAgentContact`** (TL-09, D -> A; the household's resident, after delivery):

```ts
conn.reducers.requestAgentContact({ consentId: crypto.randomUUID() }); // stable per consent click
```

- **Success:** one private `agent_contact` lead for the household, linked to its delivered job
  and carrying the profile's preferred contact. The resident sees the receipt in
  `my_agent_request` (show it as `L-<id>`). This is a prototype lead, not a policy or a quote.
- **Duplicate:** the same `consentId` again is a no-op.
- **Conflict:** no delivered job yet (`offered only after help is delivered`), the household
  already has a request, or the resident skipped
  (`conflict: the resident skipped. Nothing was saved.`). **Rejected:** no preparedness profile.
- **Counting:** `coordinator_registry_stats` gives one row per incident with `registrations` and
  `agentOptIns`, counted separately. Coordinators never see the leads themselves.

**`skipAgentContact`** (TL-09, D -> A; the household's resident):

```ts
conn.reducers.skipAgentContact({});
```

- **Success:** records the decline in the private `agent_decline` table and creates no lead.
  The resident sees it in `my_agent_decline`, so the screen can show "Skipped" after a reload.
- **Duplicate:** skipping again is a no-op.
- **Final:** after a skip, `requestAgentContact` is a conflict, so a late or stray request can
  never turn it into a lead.
- **Conflict:** the household already opted in (`conflict: H17 already has request L-1`).
- **Counting:** skips never change `agentOptIns`. A skip does not require a delivered job.
- **Equal access:** `reserve`, `ingestCheckin` and the coordinator household rows never read
  profiles or leads, so opting in or skipping cannot change who gets help or how fast.

**`confirmSuggestedNeed`** (TL-15, D -> A; the household's resident):

```ts
// Confirm or Correct: send the kept suggestion's id (C's NeedSuggestion['id']).
// confirmationId is stable per click, so a retry is a no-op. Skip: send nothing.
conn.reducers.confirmSuggestedNeed({ confirmationId: crypto.randomUUID(), needId: 'powered_equipment' });
```

- **Success:** one private `confirmed_need` row for the household: `needId`, `dispatchNeed`
  (derived by the server: `powered_equipment` -> `battery`, `step_free_access` -> none) and
  `confirmedAt`. Nothing about the policy (sources, signals, confidence) is sent or stored.
- **Duplicate:** the same `confirmationId` again is a no-op.
- **Errors:** `unknown needId <id>`; `conflict: H17 already confirmed powered_equipment` (one
  per household); `conflict: confirmationId already used`; `forbidden: requires a resident session`.
- **Independent of TL-09:** it does not need or change a profile, and `enrollPreparedness` is
  unchanged. A registration screen calls `enrollPreparedness`, then this for a kept need.
- **Views:** `my_confirmed_need` (the resident's own row) and `coordinator_confirmed_needs`
  (`householdId`, `needId`, `dispatchNeed`, `label` = "self-confirmed via preparedness profile",
  `confirmedAt`). Drivers and other residents see nothing.
- **Equal access:** dispatch never reads it, and `household.need` is unchanged, so confirming or
  skipping cannot change who gets help or how fast. `resetIncident` clears it.

**Check-in rounds and silent follow-ups** (TL-11):

```ts
// Coordinator starts outreach for a household; they become the default callback owner.
conn.reducers.openCheckinRound({ roundKey: crypto.randomUUID(), incidentId: 'tornado-1', householdId: 'H22' });
// Coordinator takes over a callback; expectedVersion is followup.version from the view.
conn.reducers.claimFollowup({ followupId, expectedVersion: f.version });
```

- **Round:** `checkin_round` row with `status` `open` and `dueAt` = now + the follow-up interval.
  A repeated `roundKey` is a no-op; a second open or silent round for the household is a
  `conflict:`.
- **Verified reply:** any new `ingestCheckin` for the household (bridge or coordinator) closes
  its open or silent round as `answered` right away and cancels its follow-up. The sweep repeats
  this check as a backstop.
- **Silent:** a scheduled sweep (about five times per interval) rechecks each open round. If it
  is due with no reply received since it opened, the round becomes `silent` and a `followup` is
  created with `owner` (the round's opener), `dueAt` (now + interval) and the household's last
  evidence (`lastEventId`, `lastObservedAt`, runtime; unknown stays unknown).
- **Escalation:** a follow-up still open or claimed past its `dueAt` gets `escalationLevel` + 1
  and a new `dueAt`. Its owner never changes on its own, so a silent household always has one.
- **Claim:** `claimFollowup` sets the owner to the caller and `status` `claimed`. A stale
  `expectedVersion` or a cancelled follow-up is a `conflict:`; claiming your own again is a no-op.
- **Audit:** every create, escalate, claim and cancel writes a `followup_audit` row (`actor` is
  empty for the sweep).
- **Reading:** coordinators subscribe to `tables.coordinatorRounds`,
  `tables.coordinatorFollowups` and `tables.coordinatorFollowupAudit`. Household rows are
  unchanged; show the Silent lane from the household's round.
- **Interval:** 300 s (5 minutes) by default. The owner changes it for a demo with
  `spacetime call --server local time-left set_followup_interval 60`. New rounds and callbacks
  use the new value. The sweep runs only on its schedule; calling it directly is `forbidden:`.

**`releaseJob`** (TL-05 deferred; coordinator):

```ts
conn.reducers.releaseJob({ jobId, expectedVersion: job.version });
```

- **Success:** after delivery, the job's battery and driver get `activeJobId` cleared and
  `freeAt` = now, so they can be reserved again. The job keeps `status` `delivered`, so the
  agent-contact offer still applies. The household keeps its `activeJobId`.
- **Duplicate:** releasing again is a no-op. **Conflict:** the job is not delivered yet, or a
  stale `expectedVersion`.

Not built yet: notifying the resident by Photon on arrival (TL-08), opening rounds from the
bridge, the TL-11 dispatch benchmark (C), and a public signup without a resident invite.

**Dispatch rules:** `spacetimedb/src/rules.ts` copies `readyAt` from C's unmerged TL-03 branch as
a fixture. Once TL-03 is on main, its body becomes a re-export of
`./domain/dispatch`.

## Maincloud

The shared database is `time-left-hackutd26`. Teammates set
`VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com` and
`VITE_SPACETIMEDB_DB_NAME=time-left-hackutd26` in `.env.local`.

TL-05 changes the schema incompatibly (tables become private, columns are added), so A
republishes with its data cleared, which reruns the seed:

```bash
spacetime publish --server maincloud --module-path spacetimedb time-left-hackutd26 --delete-data=always
```

The publishing identity becomes the owner who creates invites on Maincloud.

Maincloud is behind main (TL-09 and TL-11 added tables), so it needs that republish before
registration or follow-ups work live. Before a recording or a live run, the owner runs
`demo:reset` against Maincloud (see "Demo reset and invites"). Run `demo:invites` only when
someone needs a new role.

## Known issues

- On a Windows laptop with Smart App Control or another Application Control policy, `vite`
  cannot load Rollup's native binary (`rollup.win32-x64-msvc.node`). The module, bindings and
  checks still work; `npm run dev` and `npm run build` fail on that machine.
