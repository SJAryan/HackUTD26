# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Coordinator** (primary). Runs outage response at 2am from a laptop, often projected. Needs to know, across a whole zip code, who will run out of time before the right help can reach them, and to dispatch without double-booking scarce resources.
- **Driver.** On a phone in the field. Sees only the address and the job.
- **Resident.** A registered, medically fragile household. Primary channel is iMessage (SMS fallback for non-iPhones); any web view is secondary.
- **HackUTD judges.** Evaluate the live demo and the Devpost video, including the State Farm, Spacetime and Photon tracks.

## Product Purpose

Before Zero solves the last mile of outage response: knowing who needs help first. It checks in with every registered household over iMessage, compares each household's deadline with how long the right resource takes to arrive, and ranks everyone by that margin. It follows up with anyone who goes silent and makes sure the last battery cannot be sent to two houses at once.

Success: a coordinator can see at a glance who is in trouble, act on the most urgent margin first, and trust that no household quietly disappears.

Pitch: "We're not fixing the grid or building a new registry. We're solving the last mile: knowing who needs help first."

## Positioning

A registry (Texas STEAR) is a list of names. Before Zero turns it into a ranked, live margin: deadline minus time for the right resource to arrive, with every number linked to the message and timestamp it came from. "AI reads, code decides."

## Operating Context

- Outage starts; households from a STEAR-style registry in the affected zip code load (synthetic data).
- iMessage check-in via Photon: native poll "Backup left? Under 30 min / 30 to 60 / 1 to 2 hrs / 2+ hrs / Not sure", then "How are you staying warm?" Free-text replies are read by AI.
- Margin = deadline − time for the right resource to arrive. "Not sure" stays unknown and triggers a follow-up.
- Live board (SpacetimeDB) with four lanes: **Act now** (margin under 15 min or negative), **Watch** (positive margin), **Unknown** (follow-up sent), **Silent** (last report, callback owner, due time).
- Dispatch: reserve a resource, assign a driver, and only then send the confirmation ("Battery arriving in 25 min, driver: Ana").
- Fixed safety reply when someone reports heating with a grill, generator or oven indoors.

## Capabilities and Constraints

- Need types in the demo (generic underneath):
  - Oxygen concentrator: deadline = reported backup runtime; resource = battery.
  - Home dialysis: deadline = hours until next treatment; resource = generator, or a ride to an open center.
  - No heat: deadline = reported indoor temperature below a safe level; resource = ride to a warming center.
- Scope in: one zip code, about 200 households, 3 need types, 6 batteries, 2 generators, 3 drivers, fixed travel times between areas, a coordinator board, a driver screen, a simulation.
- Stretch: Photon voice calls, more need types.
- Out: insurance claims, real maps, predicted countdowns, the data center version.
- Stack: React + TypeScript web client on SpacetimeDB (repo root scaffold from TL-01).
- **Open decisions** (conflict with `Time-Left-Team-Context.txt`, unresolved):
  - Lead incident: winter freeze (this record) vs tornado first, freeze second (context file).
  - Canonical demo numbers: +10 → −10 (this record) vs +17 → −3, alternate +6 (context file / TL-03).
  - Medical need types and the Uri framing vs the context file's "equipment readiness only, no medical danger countdown".
  - State Farm preparedness enrollment and voluntary agent-contact request (TL-09) are not in this record.
  - Product name in team docs is still "Time Left".

## Brand Commitments

- Name: **Before Zero**.
- Palette direction pinned by the user: red and white, in the spirit of the State Farm sponsor track. Red owns the brand frame and primary actions; urgency must not rely on red alone.
- Before Zero is not a State Farm product: no State Farm logo, wordmark or implied endorsement.
- Voice: plain and factual. Numbers describe deadlines and arrival estimates; every number traces to its source message.

## Evidence on Hand

- Winter Storm Uri: 246 Texans died, per the user's pitch; some on oxygen machines, some missing dialysis, some freezing at home. Cite the source before publishing.
- Texas STEAR registry exists; the demo uses synthetic STEAR-style households only.
- No real residents, phone numbers, customers, or measured outcomes yet. The FCFS vs Before Zero comparison must come from the actual simulation run, or be omitted.

## Product Principles

1. Rank by margin, not by arrival order.
2. AI reads, code decides: extraction is assisted, arithmetic and dispatch authority are deterministic and human-confirmed.
3. Nobody disappears: silence is a state with an owner and a due time.
4. Every number shows its source message and timestamp.
5. Confirm only what has committed: no message before the reservation does.

## Accessibility & Inclusion

- Board must read from across a judging table and on a projector; driver and resident views must work one-handed on a phone.
- Lane and urgency are conveyed by text and shape, never color alone.
- Residents may be on low battery and weak signal: lightweight pages, no install.
