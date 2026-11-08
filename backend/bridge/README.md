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
npm run capture -- H17 tornado fixtures/h17-checkin.json
```

After `Ready`, the teammate sends in the same thread:

> My backup shows 30–60 minutes left. Can the driver reach the side entrance?

Pass: the file is written, contains neither real handle, and `event.eventId` is the
Photon message ID. It refuses to overwrite an existing file. Review it before
committing. `extracted` stays `null` until TL-08. `tornado` is a placeholder
until C publishes the incident ID.

## Checks

```sh
npm test
```

## Evidence to post on TL-02

- Channel: iMessage, Photon Beta shared line; connection: SDK polling (`listMessages`)
- Date/time, pass/fail, any `Photon API error <status> (request <id>)` lines
- Phone screenshot with numbers redacted
- Whether the event file is a live capture (it says so in `_source`); a replay is never a live integration
