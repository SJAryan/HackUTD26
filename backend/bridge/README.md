# Photon bridge (member B)

TL-02 proves one real iMessage round trip on the team test line and captures one
sanitized check-in event for A (`ingestCheckin`) and D (UI example).

## Setup (once)

1. In the [Photon Beta dashboard](https://app.beta.photon.codes), copy the Project ID
   (`pho_prj_...`) and create an API key with `project:read` and `project:write`.
2. Open **iMessage**, add the consenting teammate's send-from identity, then
   **Assign a number from the shared pool**. That number is `PHOTON_AGENT_HANDLE`.
3. `cp .env.example .env` and fill it in. `.env` is gitignored; never commit it.
4. `npm install` (Node 24+).

## 1. Live round trip (official first-reply guide)

```sh
npm run ping
```

After `Ready`, the teammate starts a **new direct iMessage** (not SMS) to the
assigned number and sends exactly `ping` within 2 minutes.

Pass: the phone receives `Hello from your Photon agent!` in the same thread.
`Reply accepted` in the terminal only means Photon accepted the send.

## 2. Capture the H17 check-in

```sh
npm run capture -- H17 tornado-1 captures/h17-checkin.json
```

After `Ready`, the teammate sends in the same thread:

> My backup shows 30–60 minutes left. Can the driver reach the side entrance?

Pass: the file is written, contains neither real handle in any format, and
`event.eventId` is the Photon message ID. It refuses to overwrite an existing file
and refuses to write if either identity's digits survive sanitizing. `captures/` is
gitignored: raw captures stay on the capturing laptop and are never committed.
`extracted` stays `null` until TL-08. `tornado-1` is A's seeded incident ID.

The committed `fixtures/h17-checkin.json` is a **synthetic replay** modeled on a live
capture, holding only the `event` that A (`ingestCheckin`) and D need. Replaying it
is a replay, not a live integration.

## 3. TL-08: live check-ins and ETA texts

```sh
npm run live                              # poll Photon, ingest check-ins, send ETA intents
npm run replay -- fixtures/h17-checkin.json   # synthetic replay; never messages anyone
```

**Bridge role (TL-05).** `ingestCheckin` needs the `bridge` role and every table is private. On
the first run the bridge connects as a new SpacetimeDB identity, saves its token to `.stdb-token`
and claims `BRIDGE_INVITE_CODE`. The module owner creates that invite (see `docs/setup.md`,
"Roles"). Later runs reconnect with the saved token, so they keep the role and skip the claim.
The bridge stops with a clear error if the identity has no role and no code, or holds a role other
than `bridge` for `BRIDGE_INCIDENT_ID`. `.stdb-token` is a credential: it is gitignored, and you
should never share it. Delete it to start over with a new identity. A republish that clears data
also clears roles, so after one, claim a fresh invite.

**Check-ins.** The bridge only processes messages from `PHOTON_TEST_SENDER`, bound to
`BRIDGE_SENDER_HOUSEHOLD`, and records them with `ingestCheckin`. Replay reports the reducer outcome
only (`ok` / `duplicate no-op` / `error`), because `household` and `checkin` are private. A's
reducer makes a repeated `eventId` a silent no-op, so a server-side duplicate also reports `ok`.

**ETA texts.** The bridge subscribes to `bridge_outbox`. For each `eta` row addressed to
`household:<BRIDGE_SENDER_HOUSEHOLD>`, it sends `body` into the sender's own thread with
`idempotency-key` = the row's `key`. It sends nothing for other recipients and logs
`no channel for driver:ana (assignment)` instead. Until the sender has texted the line, there is no
thread, so it logs and waits instead of starting a conversation.

Outbox rows stay `pending` (no reducer marks them sent yet), so `.bridge-state.json` (gitignored)
records each key as one of:

| Status | Meaning | Next |
|---|---|---|
| `accepted` | Photon took the send (delivery not confirmed) | never resent |
| `needs_reconciliation` | Photon refused it (4xx, 429, 503) | **not retried**; a person checks and resends if the job is still current |
| `ambiguous` | timeout, 408/502/504 or unreadable response; Photon may have sent it | not resent; check the phone, then edit the entry to reconcile |
| `obsolete` | a newer version of the same job is in the view, or the row left the view | never sent |

**Failed ETAs are not retried.** The bridge cannot read the private job table, and
`bridge_outbox` still returns intents for jobs that have moved on (a status change bumps the job
version but leaves the old row in the view). An automatic retry could therefore text "Ana is
bringing a battery" after the battery was delivered. Until A's view returns only rows whose job is
`assigned` at the matching version, a refused ETA is logged as `needs reconciliation` (key only, no
phone numbers) and left for the coordinator. Records named `failed` in an older
`.bridge-state.json` are treated the same way.

## Checks

```sh
npm test
```

## Evidence to post on TL-02

- Channel: iMessage, Photon Beta shared line; connection: SDK polling (`listMessages`)
- Date/time, pass/fail, any `Photon API error <status> (request <id>)` lines
- Phone screenshot with numbers redacted
- Whether the event file is a live capture (it says so in `_source`); a replay is never a live integration
