# Time Left: setup and shared contract (TL-01, TL-05, TL-06, TL-09)

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
| `coordinator` | `''` | `ingestCheckin`, `confirmRouteReport`, `reserve` | `coordinator_*` and `job_messages` for its incident |
| `driver` | driver ID | `postJobMessage`, `updateJob` (`arrived`) on its jobs | `driver_jobs`, `job_messages`: its own jobs only |
| `bridge` | `''` | `ingestCheckin` | `bridge_outbox` and `bridge_checkins` (receipts) for its incident |
| `resident` | household ID | `postJobMessage`, `updateJob` (`delivered`) on its jobs; `enrollPreparedness`, `requestAgentContact`, `skipAgentContact` | `resident_jobs`, `job_messages`, `my_profile`, `my_agent_request`, `my_agent_decline`: its own household only |

A driver or resident invite is rejected unless that driver or household belongs to the invite's
incident. Invite codes are single-use but do not expire; share them privately.

Every session can read `my_role` and `my_incident`. The browser keeps its identity token in
`localStorage`, so a role survives reloads; use a private window for a second identity.

## Seed

**Tornado (`tornado-1`)**, clock 2026-11-08 02:00 America/Chicago (08:00 UTC):

| Table | Rows |
|---|---|
| `household` | `H17`, `H22` (silent), both need `battery` |
| `asset` | `BAT-01`, battery, free at the incident clock |
| `driver` | `ana` (Ana), `ben` (Ben), free at the incident clock |
| `route` | `R4` H17/Ana/BAT-01, ready 02:13; `R4-ALT` H17/Ana/BAT-01, ready 02:24; `R7` H22/Ben/BAT-01, ready 02:19 |

H17, R4 and R4-ALT match C's TL-03 tornado fixture. R7 and Ben are A's race seed until C's
fixture covers H22.

**Freeze (`freeze-1`)**, clock 2026-01-20 06:00 America/Chicago (12:00 UTC), IDs and travel
values from C's TL-03 freeze fixture (PR #20):

| Table | Rows |
|---|---|
| `household` | `F03` needs `generator`; `F09`, `F14` (silent) need `battery` |
| `asset` | `GEN-02` generator, `BAT-07` battery |
| `driver` | `leo` (Leo) |
| `route` | `FZ-R1` F03/Leo/GEN-02, ready 06:18; `FZ-R2` F09/Leo/BAT-07, ready 06:23 |

The Before Zero update makes the freeze the lead incident, with H17 registering for it; that
re-seed waits for C's numbers.

## Interfaces available now

Use the generated bindings: `import { DbConnection, tables, reducers } from './module_bindings'`.

All tables are private. Clients subscribe to views: `tables.myRole`, `tables.myIncident`,
`tables.coordinatorHouseholds`, `tables.coordinatorCheckins`, `tables.coordinatorAssets`,
`tables.coordinatorDrivers`, `tables.coordinatorRoutes`, `tables.coordinatorJobs`,
`tables.driverJobs`, `tables.residentJobs`, `tables.jobMessages`, `tables.bridgeOutbox`,
`tables.bridgeCheckins`, `tables.myProfile`, `tables.myAgentRequest`, `tables.myAgentDecline`,
`tables.coordinatorProfiles` and `tables.coordinatorRegistryStats`.
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
ARRIVED cannot change the job again. The wrong role is `forbidden:`. Delivery does not yet free
the driver or battery.

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

Not built yet: releasing an asset or driver, callback ownership and scheduled follow-up
(TL-11), notifying the resident by Photon on arrival (TL-08), and a public signup without a
resident invite.

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

## Known issues

- On a Windows laptop with Smart App Control or another Application Control policy, `vite`
  cannot load Rollup's native binary (`rollup.win32-x64-msvc.node`). The module, bindings and
  checks still work; `npm run dev` and `npm run build` fail on that machine.
