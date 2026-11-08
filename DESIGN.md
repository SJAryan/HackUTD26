---
name: Before Zero
description: Outage operations board that ranks registered households by margin and dispatches without double-booking.
colors:
  brand-red: "#c41e1e"
  brand-red-press: "#a51818"
  red-wash: "#fdf0f0"
  red-band: "rgba(196, 30, 30, 0.16)"
  ink: "#1d2129"
  ink-2: "#3c4350"
  mute: "#6b7280"
  rule: "#e5e7eb"
  rule-2: "#d3d7de"
  ground: "#f6f7f9"
  white: "#ffffff"
  amber: "#8a5300"
  amber-wash: "#fff5e3"
  amber-rule: "#f0d39a"
  green: "#17663a"
  green-wash: "#e7f5ec"
  green-solid: "#1e8449"
  slate-wash: "#e9ecf1"
  imessage-blue: "#0a7cff"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  metric:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  table:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  bubble: "18px"
  device: "46px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  gutter: "28px"
components:
  button-primary:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.brand-red-press}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    height: "36px"
  button-accept:
    backgroundColor: "{colors.green-solid}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    height: "36px"
  pill-act-now:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  pill-watch:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
    height: "22px"
  pill-unknown:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: "22px"
  pill-silent:
    backgroundColor: "{colors.slate-wash}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: "22px"
  pill-dispatched:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green}"
    rounded: "{rounded.pill}"
    height: "22px"
  kpi-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  nav-item-active:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.brand-red}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  input-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 12px"
---

# Design System: Before Zero

## Overview

**Creative North Star: "The 2am Incident Desk"**

The category-standard operations dashboard, played straight. A coordinator sees the whole incident first (KPI lanes), then the household that needs action (a ranked, filterable table), then its evidence and dispatch (a right-hand detail drawer). The interaction bar is a live incident tool; the format bar is a payments-grade dashboard: rail, KPI row, table, drawer. No novelty board, no map.

The world is white ground, cool grey rules and ink text, with one brand red framing the product: the logo, the active nav item, the active tab and the primary action. Density is moderate and legible at projector distance; numbers are tabular so margins line up. Phone views (resident iMessage thread, incoming call, driver job) sit inside a drawn device frame on desktop and go full-bleed on small screens.

Before Zero is not a State Farm product. Red and white is a palette direction from the sponsor track, never a borrowed identity: no State Farm logo, wordmark or implied endorsement.

**Key Characteristics:**
- Rail, top bar, KPI row, lane tabs, ranked table, sticky detail drawer.
- One brand red; lanes distinguished by icon + fill + weight, not hue alone.
- System UI type, tabular numerals everywhere.
- Flat white cards on a pale cool ground, separated by 1px rules and a whisper shadow.
- Authored 20px line icons, one 1.6 stroke, round caps.

## Colors

A white-and-ink operations palette with a single brand red and three semantic washes (amber, green, slate) that only ever appear on lane state.

### Primary
- **Brand Red** (`brand-red`): logo mark and wordmark, active rail item text, active tab underline and count, primary buttons, focus ring, text caret, Act now pill fill, tight margins. **Brand Red Press** (`brand-red-press`) is its hover/pressed state.
- **Red Wash** (`red-wash`): active nav background, selected table row, focus halo on inputs, decision icons in the timeline.
- **Red Band** (`red-band`): the arrival-window band on route tracks only.

### Secondary (semantic state)
- **Watch Amber** (`amber`, `amber-wash`, `amber-rule`): Watch lane pill, report events, conflict results and warning callouts.
- **Dispatched Green** (`green`, `green-wash`, `green-solid`): live status chip, Dispatched pill, committed results, completed demo steps, the driver's Accept button.
- **Silent Slate** (`slate-wash`): Silent lane pill fill.

### Neutral
- **Ink** (`ink`): primary text, selected KPI outline, device frame, incoming-call screen.
- **Ink 2** (`ink-2`): secondary text, report quotes, nav at rest.
- **Mute** (`mute`): labels, table headers, timestamps, helper text.
- **Rule / Rule 2** (`rule`, `rule-2`): dividers and card borders; Rule 2 for input and secondary-button strokes.
- **Ground** (`ground`): page background, hover fills, quiet chips, reply blocks.
- **White** (`white`): cards, drawer, rail, top bar.

### Native exception
- **iMessage Blue** (`imessage-blue`): sent bubbles and native poll buttons inside the simulated resident phone only. It is a native-affordance quotation, not a brand color, and never appears in the coordinator chrome.

**The One Red Rule.** Red owns the brand frame and the primary action. A screen carries one primary red button at a time.

**The Never-Red-Alone Rule.** Urgency is carried by icon, fill and weight, never by red alone. Act now is a solid red pill with an alert triangle; Watch is an amber outline with an eye; Unknown is dashed with a question mark; Silent is slate with a phone-off; Dispatched is green with a check. Tight margins pair red with bold weight and, on routes, an alert icon.

## Typography

**Display / Body Font:** system-ui (with -apple-system, Segoe UI, Roboto, sans-serif)

**Character:** Native, neutral and fast; the product's voice is the numbers, so type stays out of the way and every figure is tabular.

### Hierarchy
- **Headline** (700, 26px, 1.2, -0.02em): registration-site intro only; 22px under 760px.
- **Metric** (650, 30px, 1.15, -0.02em): KPI lane counts; 26px on mobile.
- **Title** (650, 18px): drawer household ID and driver job heading. Top-bar incident name is 600 at 16px.
- **Body** (400, 14px, 1.45): base text. Form inputs and compose fields use 14.5px.
- **Table** (400, 13.5px): table cells, drawer facts, callouts, buttons (600).
- **Label** (600, 12px): table headers, pills, chips, KPI subtext (400). Sentence case, never uppercase.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is global; margins, clocks and counts always align. Margins are signed (`+6 min`, `−3 min`) and set in 600-700.

## Layout

App shell is a two-column grid: a 232px sticky white rail and a fluid main column. The top bar is sticky, 60px min height, 28px side padding. Views pad 24px top, 28px sides. The board stacks notice, KPI row and table panel with 16px gaps; when a household is open, a 420px drawer column joins at 20px gap and sticks 84px from the top.

KPI row: four equal lane cards plus a 1.25fr free-resources card, 12px gaps. Spacing runs on a 4px base (4, 8, 12, 16, 20, 24, 28). Phones render in a 390x780 device frame (430x860 above 1180px, with larger bubble and job type for demo distance).

Responsive: at 1180px the drawer becomes a fixed right sheet (max 440px) and the resources card spans the KPI row. At 900px the rail collapses to an icon-only horizontal bar and Reset becomes icon-only. At 760px KPIs go two-up, the table swaps for stacked cards and lane tabs scroll with a fade mask. At 520px phone views go full-bleed with no frame.

## Elevation & Depth

Flat, layered by tone and 1px rules. Cards and panels sit on the pale ground with a near-invisible shadow; real elevation is reserved for things that float over content.

### Shadow Vocabulary
- **Whisper** (`0 1px 2px rgba(29,33,41,0.06), 0 1px 1px rgba(29,33,41,0.03)`): cards, panels, drawer, primary and secondary buttons.
- **Lift** (`0 12px 32px rgba(29,33,41,0.14), 0 2px 6px rgba(29,33,41,0.06)`): the device frame and the drawer when it becomes an overlay sheet.

**The Rules-Not-Shadows Rule.** Separate with 1px rules first. Selection is shown with a 1px ring (ink for KPI, red for route and choice), not a deeper shadow.

## Shapes

Gently rounded and consistent: 6px on controls (buttons, inputs, nav items, choices), 8px on cards and callouts, 10px on the drawer, 12px on site and job cards, full pills for lane state, counts and chips, 18px for message bubbles and the compose field, 46px for the device frame. Inputs are 40px tall, buttons 36px (44-50px block buttons on phones).

## Components

### Buttons
- **Shape:** 6px corners, 36px tall, 600 weight at 13.5px, icon gap 7px.
- **Primary:** brand red with white text and whisper shadow; darkens to press red on hover.
- **Secondary:** white with a Rule 2 stroke; stroke darkens to mute on hover.
- **Quiet:** transparent ink-2 text; ground fill on hover. **Accept:** solid green, driver only.
- **Focus:** 2px red outline, 2px offset. Disabled drops to 50% opacity.

### Lane Pills
- 22px full pills, 12px/600, 13px leading icon. Act now solid red + alert; Watch amber wash with amber stroke + eye; Unknown white with dashed grey stroke + question; Silent slate + phone-off; Dispatched green wash + check.

### KPI Cards
- White, 8px, whisper shadow, rule border. Label row with lane icon, a tabular metric, a mute subline. Clickable to filter; the selected card gets an ink 1px ring. The Act now card colors its label and count red. A lane change pulses the count once (900ms, ease-out-expo).

### Table Panel and Tabs
- Tabs are 46px with a 2px underline; active is red text and underline with a red-wash count badge. Search is 32px with a red focus border and red-wash halo. Rows are 13.5px, rule-separated; hover tints faintly, selected rows fill red wash, and a changed row flashes once.

### Detail Drawer
- Sticky header (household ID title, pill, close), a facts grid, then blocks for latest reply, route options, dispatch and timeline. Route options are selectable cards with a time track: a red-band arrival window and an ink ready-dot that turns red when late. Timeline uses 22px round icons tinted by event kind on a 1px spine.

### Inputs
- 40px, 6px corners, Rule 2 stroke; focus swaps to red stroke and a 3px red-wash halo. Choice chips use the same red ring when selected.

### Navigation
- Rail items 8px/10px padding, 6px corners, 500 weight in ink-2; active is red-wash fill, red text, 600 weight. Below 900px it becomes an icon-only top bar.

### Device Frame (signature)
- 10px ink bezel, 46px corners, Lift shadow, a simulated status bar and a "Simulated" chip. Resident thread uses native iMessage styling (grey received, blue sent, outlined poll replies); the call screen is full ink with dark keypad rows; the driver view is a ground-filled job list.

## Do's and Don'ts

### Do:
- **Do** pair every lane state with its icon and fill; color is the third signal, not the first.
- **Do** keep one red primary action per view and put it where the decision is made (drawer dispatch, registration submit).
- **Do** use tabular, signed margins and show where each number came from (reply, timestamp).
- **Do** label fixture and simulated data visibly (Synthetic/Demo tags, Fixture data chip, Simulated chip).
- **Do** use the authored icon set at 20px viewBox, 1.6 stroke, round caps, currentColor.

### Don't:
- **Don't** signal urgency with red alone, or use red for decoration, borders at rest or large fills beyond the primary button and Act now pill.
- **Don't** use iMessage blue outside the simulated resident phone.
- **Don't** add a State Farm logo, wordmark or anything implying endorsement.
- **Don't** add a map, novelty board or hero art to the coordinator surface.
- **Don't** introduce heavier shadows on cards; elevation is for the device frame and overlay sheet only.
- **Don't** use uppercase eyebrow labels; labels are sentence case at 12px/600.
