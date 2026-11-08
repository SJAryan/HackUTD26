---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/screens"]
---

# Before Zero web client (coordinator board, registration, resident and driver phone views)

Mode: Operate. Audience: an outage coordinator at 2am on a laptop or projector; a driver and a resident on phones; judges trying it live. Task: see the whole incident, act on the smallest margin first, dispatch without double-booking. Quality bar: incident.io for interaction (live status, source-linked timeline, actions in context) and Stripe Dashboard for format (rail, KPI row, filterable table, detail drawer). Constraint: red and white, red owns the brand frame; urgency by icon, fill and weight, never colour alone. Synthetic data only; the real story never appears in the UI.

## Direction contract

THESIS: The category-standard operations dashboard, played straight: whole incident first, then the household that needs action, then its evidence and dispatch. Refuses a novelty board or a map.

OWN-WORLD: White ground, cool grey rules, ink text, one brand red (#c41e1e) on the logo, active nav and primary actions. System UI type with tabular numerals. State pills: Act now solid red with alert icon, Watch amber, Unknown dashed with question icon, Silent slate with phone-off icon, Dispatched green check. Authored line icons, one stroke.

STORY: The coordinator sees counts for every lane, filters to Act now, opens H17, reads the reply that set its margin, sees why R4 no longer makes it, reserves the closest battery and driver, and watches the confirmation go out only after the commit.

FIRST VIEWPORT: Left rail (Board, Registration, Resident phone, Driver phone). Top bar with incident, clock, live status and Reset. KPI row of four lanes plus free resources. Lane tabs, search and the ranked household table filling the width; the H17 drawer slides in on the right with timeline, routes and Reserve.

FORM: The category standard (canon), chosen by the user on the decision page; seed:e298465dacb78d92.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
