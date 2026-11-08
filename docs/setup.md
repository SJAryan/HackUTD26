# Time Left: setup and shared contract (TL-01)

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
| `spacetimedb/src/` | A | Schema, reducers and seed (`index.ts`) |
| `spacetimedb/src/domain/` | C | Pure dispatch rules, imported by A (TL-03/TL-05) |
| `src/module_bindings/` | A | Generated; never edit by hand. Run `npm run stdb:generate` |
| `src/` (everything else) | D | React client. `src/App.tsx` is a TL-01 connection check D replaces |
| `bridge/` | B | Photon bridge (not created yet) |
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

## TL-01 acceptance check

```bash
npm run stdb:reset:local && npm run check:tl01
```

Two independent sessions (distinct identities) subscribe to `incident`, `household` and `checkin`.
Session A records H17's 02:00 check-in. Session B must see H17 change through its subscription.
The script also replays the same event ID (no new effect) and sends an unknown household
(rejected). It ends with `PASS: TL-01 two-session subscription check`. To point it at another
server, set `SPACETIMEDB_HOST` and `SPACETIMEDB_DB_NAME`.

## Seed: tornado incident

| Table | Rows |
|---|---|
| `incident` | `tornado-1`, kind `tornado`, clock 2026-11-08 02:00 America/Chicago (08:00 UTC) |
| `household` | `H17`; `H22` (silent placeholder; C may rename it in the TL-03 fixture) |
| `asset` | `BAT-01`, battery, available |
| `driver` | `ana` (Ana), available |

The freeze incident is not seeded yet; C's TL-03 fixture defines it.

## Interfaces available now

Use the generated bindings: `import { DbConnection, tables, reducers } from './module_bindings'`.

**`ingestCheckin`** (B -> A, live locally):

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

Not built yet: roles and authorization, private tables and views, `reserve`, `postJobMessage`,
`updateJob` and `requestAgentContact`. These come in TL-05 and TL-06. All tables are public for
TL-01; TL-05 moves case data behind scoped views.

## Maincloud (not done yet)

Publishing to Maincloud is a separate step for A, using the booth access code (kept out of the
repo):

```bash
spacetime publish --server maincloud --module-path spacetimedb <shared-db-name>
```

Then teammates set `VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com` and the shared name
in `.env.local`.

## Known issues

- On a Windows laptop with Smart App Control or another Application Control policy, `vite`
  cannot load Rollup's native binary (`rollup.win32-x64-msvc.node`). The module, bindings and
  `check:tl01` still work; `npm run dev` and `npm run build` fail on that machine.
