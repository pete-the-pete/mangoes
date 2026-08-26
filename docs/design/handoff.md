# Handoff: Mango Tracker — Core Loop + Admin & Super Admin

## Overview

Mango Tracker is an invite-only, mobile-first (PWA) group counting game. A group admin creates a time-boxed **session** (a beach day, a trip, a party), defines the item(s) being counted (mango, margarita, taco…), and invites members. Members log items in **one tap**, see a live leaderboard, and get a shareable recap when the session closes.

This bundle covers 8 screens across three roles:

| # | Screen | Role |
|---|---|---|
| 1 | Log (the one-tap core loop) | Member |
| 2 | Leaderboard | Member |
| 3 | Recap | Member |
| 4 | Create session | Group admin |
| 5 | Mission control (log on behalf / live roster) | Group admin |
| 6 | Audit log | Group admin |
| 7 | Create group | Group admin |
| 8 | Platform roster & roles | Super admin |

The headline product requirement is **delight on log**: every tap fires a big, over-the-top celebration (rocket blast-off, mango confetti, cymbal clash) in the Duolingo / Slack / Asana tradition. That is not decoration — it is the retention mechanic. Treat it as a first-class feature, not polish.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy directly**.

- `Mango Tracker.dc.html` — all 8 screens on one canvas, fully interactive. Open it in a browser. Tap the big mango on screen 1 to fire the effects; tap ± on screen 5 to see the leaderboard, group total, and audit log all update.
- `support.js` — the prototype runtime only. **Do not port this.** It is scaffolding for the HTML prototype environment.
- `product-vision.md` — the source product spec (roles, sync model, error states, out-of-scope). Read this for behavior questions the designs don't answer.

The task is to **recreate these designs in the target codebase's existing environment** (React Native, React + Tailwind, SwiftUI, whatever is in place) using its established patterns, component library, and state management. If no environment exists yet, pick the appropriate framework for a mobile-first PWA and implement there. The vision doc specifies Clerk for auth and an append-only event log for sync — follow that.

## Fidelity

**High-fidelity.** Colors, typography, spacing, borders, shadows, and animation timings below are final and exact. Recreate pixel-perfectly using the codebase's own primitives. The one deliberate exception: mangoes are rendered as the 🥭 emoji throughout as a placeholder — see **Assets**.

---

## Design Tokens

### Color

| Token | Hex | Use |
|---|---|---|
| `mango-yellow` | `#FFD400` | Primary accent, the tap target, active pills, highlights |
| `mango-orange` | `#FF7A18` | Secondary surface, screen 6 background, GO LIVE button |
| `mango-orange-alt` | `#FF8A1E` | Stripe pattern variant only |
| `hot-pink` | `#FF2D6F` | Alert/urgency accent, screen 3 background, destructive-ish actions |
| `turquoise` | `#00E0CC` | Tertiary accent, "shared/group" semantics, admin toggles |
| `turquoise-deep` | `#00C2B0` | Screen 2 & 7 backgrounds |
| `ink` | `#10312B` | **Every** outline, all body text, dark surfaces. The single most important color. |
| `ink-deep` | `#0A2019` | Super-admin surface, inset track fills |
| `cream` | `#FFF1D6` | Page/card background, text on dark |
| `white` | `#FFFFFF` | Form-field fill only (screens 4, 7) |
| `rust` | `#B8380B` | Small-caps label text on light surfaces, button underside |

Rules: max two background colors per screen. Every element is outlined in `ink` — no borderless cards. Never introduce a new hue; if you need a variant, shift lightness of an existing one.

### Typography

Two families only:

- **Anton** (Google Fonts, 400 only) — all display: numbers, headings, button labels, names, pill labels. Always uppercase. Tight leading (`line-height: .8–1.1`), letter-spacing `0` to `.06em`.
- **Space Grotesk** (Google Fonts, 400/500/700) — all small text: labels, metadata, body copy. Labels are `700`, uppercase, `letter-spacing: .1em–.28em`, sizes `9–15px`.

Display scale as used (px): 150 (hero count), 104 (page title), 62/56/52/50/48 (screen titles), 46/44/42 (stat numbers), 34/30/29/28/26 (secondary numbers, CTAs), 24/23/22/21/20/19/18/17 (row names, small CTAs), 16/15/14/13/12/11 (badges).

Label scale (Space Grotesk 700): 15, 13, 12, 11, 10, 9px. 9–10px is only ever used for uppercase tracked labels inside a phone shell — never for reading copy.

### Spacing, radius, shadow

- Spacing: 4 / 7 / 8 / 10 / 11 / 14 / 16 / 18 / 20 / 22 / 26 / 56px. Always flex/grid + `gap`, never margins between siblings.
- Radius: `8px` (banner), `16–22px` (cards), `26px` (large panel), `50%` (avatars, tap target), `52px` (phone shell), `99px` (pills, CTAs).
- Borders: `3px` (small badges/avatars), `4px` (dense rows), `5px` (cards, pills), `6px` (primary CTAs), `7–8px` (hero circle, phone shell). Always solid `ink`.
- **Sticker shadow** (the signature): hard offset, zero blur, `ink`.
  - Cards: `0 4px 0`, `0 5px 0`, `0 6px 0`, `0 7px 0 #10312B`
  - Buttons: `0 9px 0` / `0 10px 0 #10312B`
  - Badges/headers on the canvas: `5px 5px 0` / `6px 6px 0` / `8px 8px 0` / `9px 9px 0 #10312B`
  - Phone shells: `16px 16px 0 rgba(16,49,43,.45)`
  - Text: `text-shadow: 3px 3px 0` … `8px 8px 0 #10312B` on display type over color.
- **Outlined display text**: `-webkit-text-stroke: 6px #10312B; paint-order: stroke fill;` on yellow Anton (screen 3 title, effect words).
- Off-state convention: an inactive pill/row is `opacity: .55–.6`, `box-shadow: none`, `transform: translateY(5–6px)` — it looks *pressed down*. Active is full opacity, shadow on, `translateY(0)`.

### Motion

| Name | Spec | Use |
|---|---|---|
| `spin` | 360° / 44s, 60s, 70s linear infinite | Sunburst ray backgrounds |
| `spinBack` | −360° / 18s linear infinite | Ray ring inside tap target |
| `pulseDot` | 1.1s ease-in-out infinite; opacity 1→.35, scale 1→.7 | Live-session dot |
| `bob` | 2.4–3s ease-in-out infinite; translateY 0→−10px, rotate −4°→4° | Idle mango |
| `shimmer` | background-position 0→80px, 1.4s linear infinite | Striped progress fill |
| Button press | `transform: translateY(9px)`, shadow 14px→5px | Hero tap target `:active` |
| Progress fill | `width .5s cubic-bezier(.2,1.6,.4,1)` | Overshoot on count change |

Celebration animations are specified in **Interactions** below.

---

## Screen-by-screen

All phone shells: `404 × 846px`, `border: 8px solid ink`, `border-radius: 52px`, `overflow: hidden`, sticker shadow `16px 16px 0 rgba(16,49,43,.45)`. In the real app this is the device viewport — build responsive to safe-area insets; the fixed size is a mock affordance.

The canvas background behind the shells is a radial gradient (`#FFD400 → #FFB300 22% → #FF7A18 46% → #FF2D6F 78%`) used only for presenting the mocks. Do not ship it as an app background.

### 1 · Log (Member) — the core loop

Background: cream, with an 84px horizontal stripe wash at 16% opacity and a slow-rotating conic sunburst (`repeating-conic-gradient`, 9° rays, 44s) anchored below center.

Top to bottom:
1. **Session chip** — `ink` pill, cream text, 11px pulsing turquoise dot, label `CABO DAY 3 · LIVE` (13px/700/.16em).
2. **Avatar stack** — three 38px circles, `3px ink` border, overlapping `−12px`, fills pink/turquoise/yellow, Anton initials; last is an `+4` overflow chip. Deliberate overlap.
3. **Hero count** — Anton `150px`, `line-height .78`, `ink`, `text-shadow: 6px 6px 0 #FFD400`. Beside it: `MANGOES / EATEN` (Anton 26px) and rank line `#2 ON THE BOARD` (13px/700/.14em, rust).
4. **The tap target** — 268px circle, `8px ink` border, yellow fill, double stacked shadow `0 14px 0 #B8380B, 0 14px 0 8px #10312B` (creates an outlined 3D button underside). Inside: a counter-rotating 15° conic ray ring (inset 8px), a cream inner disc (inset 38px, `5px ink`), and a 118px 🥭 bobbing. `:active` → `translateY(9px)`, shadow collapses to `0 5px 0`.
5. **Attribution pills** — `JUST ME` (yellow) / `SHARED 🍽` (turquoise), 5px ink border, radius 99px, Anton 20px. Exactly one active; uses the pressed-down off-state convention. Per spec: individual = +1 to person and group; shared = +1 to group only.
6. **Group total panel** — `ink` card, radius 26px. `GROUP TOTAL` (Anton 19px) + sync state `3 QUEUED` (yellow, 12px/700). Big yellow Anton 56px total + `/ 100 TO THE GOAL`. Thermometer: 22px track, `3px cream` border, radius 99px, dark inset; fill is a 115° pink/orange 14px stripe with `shimmer` running.
7. **Tab bar** — three equal Anton 17px tabs (`LOG` / `BOARD` / `RECAP`), `5px ink` divider rules, active tab filled yellow, inactive `opacity .5`. 26px bottom padding for the home indicator.

### 2 · Leaderboard (Member)

Turquoise-deep background with a −45° 22px cream-stripe wash at 16%.

- Title `THE LEADERBOARD`, Anton 46px, cream, `text-shadow 5px 5px 0 ink`. Below: yellow pill `CABO DAY 3 · 4H 12M LEFT` (12px/700/.2em, 3px ink border).
- **Rows** (6, sorted desc by count): card `border: 5px ink`, radius 22px, translucent cream (`rgba(255,241,214,.82)`); the current user's row is solid cream with a stronger `0 7px 0 ink` shadow, others `0 4px 0 rgba(16,49,43,.5)`. Contents: rank (Anton 25px, 26px wide), 36px avatar (4px ink, per-person fill, Anton initial), name (Anton 20px) over a trash-talk note (10px/700/.12em, `opacity .6`), count (Anton 34px). Under that an 11px bar: track `rgba(16,49,43,.14)`, fill = person's color with a `3px ink` right edge, width = count / leader's count.
- Notes are jokes, not data: `MANGO MENACE`, `BREATHING DOWN HIS NECK`, `PACING HERSELF`, `LATE BLOOMER`, `HERE FOR THE VIBES`, `SHARED / UNTAGGED`.
- `THE GROUP` is a real row (turquoise avatar, `★`) representing untagged/shared logs.
- **Callback card** — `ink`, radius 24px: bobbing 🥭 + `DAVE JUST PASSED YOU` (Anton 20px, yellow) + `2 MINUTES AGO. ARE YOU GONNA TAKE THAT?` (11px/700/.1em, `opacity .75`).

### 3 · Recap (Member)

Hot-pink background + slow 10° conic sunburst (60s).

- `SESSION CLOSED · CABO DAY 3` (12px/700/.28em, cream), then `MANGO KING` — Anton 56px yellow with a `6px ink` text-stroke.
- Winner medallion: 130px yellow circle, `7px ink`, `0 10px 0 ink`, 70px bobbing 🥭. Name `DAVE` (Anton 40px cream, `4px 4px 0 ink`), then cream pill `19 MANGOES · UNDEFEATED`.
- **Stat grid** 2×2, radius 22px, `5px ink`, alternating cream/yellow/turquoise fills: `87 TOTAL MANGOES`, `6 MANGO ATHLETES`, `11PM PEAK MANGO HOUR`, `23 SHARED W/ GROUP` (Anton 42px number over a 11px/700/.14em rust label).
- **Award card** — `ink`, radius 22px: `AWARD: THE LATE BLOOMER` (Anton 18px yellow) + Space Grotesk 500 12px body: "Sam logged 7 mangoes in the last 20 minutes. We all saw it, Sam." Copy tone matters — awards are affectionate roasts, generated from the event log.
- CTA: yellow pill, `6px ink`, `0 9px 0 ink`, Anton 23px `SEND IT TO THE GROUP CHAT`.

### 4 · Create session (Group admin)

Cream with a 26px ink graph-paper grid at 6%.

- Eyebrow `GROUP ADMIN · CABO CREW` (rust), title `NEW SESSION` (Anton 52px).
- **Session name** field: white, `5px ink`, radius 20px, `0 6px 0 ink`; 10px/700/.2em rust label over Anton 29px value.
- **Time box**: two side-by-side cards — `STARTS` (turquoise) / `ENDS` (hot pink, cream text), Anton 24px values.
- **Item types**: label `WHAT ARE WE COUNTING? (TAP)`, then a wrapping row of multi-select pills — Anton 16px, `4px ink`, radius 99px. Selected = orange fill + `0 5px 0 ink`; unselected = white, `opacity .6`, `translateY(5px)`. Options: `MANGO 🥭`, `MARGARITA 🍹`, `TACO 🌮`, `BEER 🍺`, `OYSTER 🦪`. Multi-item sessions are in scope per spec.
- **Invite whole group**: `ink` card with Anton 20px yellow title, dynamic sub-line (`ALL 6 MEMBERS OF CABO CREW` / `PICK MEMBERS MANUALLY`), and a 62×34 pill switch (`4px cream` border, yellow when on, `ink-deep` when off, 22px cream knob with `2px ink`).
- **Invite link**: yellow card, 🔗, `mango.trk/cabo-d3` (Anton 18px) + `INVITE LINK · EXPIRES IN 24H`, plus an `ink` `COPY` chip.
- **Pinned CTA**: orange pill, `6px ink`, `0 10px 0 ink`, Anton 28px `GO LIVE 🚀`, cream text with `3px 3px 0 ink`. Absolutely positioned 20px from the bottom — **the scrolling content column must reserve ~104px bottom padding so nothing hides behind it.**

### 5 · Mission control (Group admin)

`ink` background, 45° yellow stripe wash at 7%.

- Header: pulsing turquoise dot + `LIVE · 4H 12M LEFT` (11px/700/.2em turquoise), title `LOG FOR ANYONE` (Anton 42px yellow). Right-aligned live `GROUP TOTAL` (Anton 44px cream).
- **Roster rows** (6): cream card (turquoise for `THE GROUP`), `4px ink`, radius 18px, 8/11px padding. 34px avatar, name (Anton 19px) over a status line (9px/700/.12em, `opacity .55`) — `LOGGING SINCE 9AM`, `THAT'S YOU`, `SYNCED 2M AGO`, `PHONE IN THE OCEAN`, `INVITE PENDING`, `UNTAGGED BUCKET`. Then a **stepper**: 34px cream `–` circle, count (Anton 26px, 38px wide, centered), 34px yellow `+` circle with `0 4px 0 ink`. Both are 3px-ink circles. **44px minimum hit area in production** — the 34px visual needs padded touch targets.
- Actions: `+1 FOR THE GROUP` (turquoise) and `END SESSION` / `REOPEN 15 MIN` (hot pink) — both `5px ink`, radius 20px, `0 6px 0 cream` (shadow inverts on the dark surface).
- **Pending invites** card: cream with a `5px yellow` border, ✉️, `2 INVITES PENDING` (Anton 17px) + names, plus an `ink` `NUDGE` chip.

### 6 · Audit log (Group admin)

Orange background with a 40px horizontal ink wash at 8%.

- `SESSION CLOSED · ADMIN CAN AMEND` (ink pill), title `AUDIT LOG` (Anton 50px cream, `5px 5px 0 ink`), sub-line `EVERY EDIT IS ON THE RECORD. NO TAKEBACKS.` (12px/700/.12em ink).
- **Entries** (newest first, 8 visible): cream card, `4px ink`, radius 16px. Time (Anton 15px rust, 52px column) · description (13px/700 ink) over actor (`PETE · ADMIN`, `SAM · SELF`, `SYSTEM` — 9px/700/.14em, `opacity .5`) · a **tag badge** (Anton 11px, `3px ink`, radius 99px):

| Tag | Fill |
|---|---|
| `ON BEHALF` | yellow |
| `GROUP` / `SHARED` | turquoise |
| `EDIT` / `SUS` | hot pink |
| `JOIN` / `OPEN` | cream |

- Footer: `EXPORT CSV` (`ink`, yellow text) and `REOPEN 15 MIN` (yellow, `5px ink`, `0 6px 0 ink`).

### 7 · Create group (Group admin)

Turquoise-deep background, −45° 20px cream stripe at 14%.

- Eyebrow `GROUP ADMIN · PETE`, title `BUILD A CREW` (Anton 50px cream, `5px 5px 0 ink`).
- Group name field (cream, `5px ink`, `0 6px 0 ink`); then a 1fr/2fr pair: `EMOJI` (yellow card, 28px glyph) and `DEFAULT ITEM` (cream card, Anton 22px `MANGO 🥭`).
- **Member picker**: label `WHO'S IN THE CREW` + live `{n} PICKED` chip (`ink`, Anton 15px). Rows are full-width toggle buttons — 34px avatar, name (Anton 19px) over email/status (9px/700), and a 28px checkbox (radius 8px, `3px ink`, yellow + `✓` when on). Selected rows are solid cream with `0 5px 0 ink`; unselected are `rgba(255,241,214,.5)`, `translateY(5px)`, no shadow. 5 candidates; one shows `tia@cabo.co · INVITED`.
- **Invite someone new** (`ink` card): ➕, `INVITE SOMEONE NEW` (Anton 17px yellow) + `SENDS A PLATFORM INVITE TOO` — this is the admin path that creates a platform account and a group membership in one action. Yellow `EMAIL` chip.
- **Pinned CTA**: hot-pink pill, `6px ink`, `0 10px 0 ink`, Anton 26px `CREATE GROUP`. Content column reserves 104px bottom padding.

### 8 · Platform roster & roles (Super admin)

`ink-deep` background with a large 9° conic sunburst at 13% (70s) bleeding off the top.

- Eyebrow 👑 `SUPER ADMIN · PETE`, title `WHO GETS THE KEYS` (Anton 48px cream).
- **Stat trio** (3-col grid, radius 16px, `4px ink`): `7 USERS` (yellow), `2 ADMINS` (turquoise), `4 GROUPS` (hot pink, cream text). Anton 30px number over a 9px/700/.12em label. Admin count is derived from the roster, not hardcoded.
- Label `PLATFORM ROSTER · TAP TO PROMOTE / DEMOTE`, then **roster rows** — cream, `4px ink` (yellow border for the super admin), radius 18px. 34px avatar, name (Anton 19px) over group memberships (9px/700, `opacity .55`: `4 GROUPS · OWNER`, `CABO CREW · SKI TRIP`, `NO GROUPS YET`, `INVITE SENT 3D AGO`), and a **role badge** (Anton 12px, `3px ink`, radius 99px):

| Role | Fill | Behavior |
|---|---|---|
| `SUPER` | yellow | Locked — not tappable, `cursor: default` |
| `ADMIN` | turquoise | Tap → MEMBER |
| `MEMBER` | cream | Tap → ADMIN |
| `INVITED` | orange | Tap → MEMBER (accepts/forces) |

- **Signup kill switch**: `ink` card with a `4px yellow` border, 🚪, `INVITE-ONLY · SIGNUP OFF` (Anton 17px yellow) + `3 SEATS UNCLAIMED · 1 INVITE EXPIRED`, and a 52×28 yellow pill switch with an `ink-deep` knob. Per spec, self-serve signup does not exist — this reflects state, and disabling it should be a guarded action.
- Footer: `INVITE TO PLATFORM` (yellow, flex 2, `6px ink`, `0 9px 0 cream`) and `LOGS` (`ink-deep`, flex 1, `6px cream` border, cream text).

---

## Interactions & Behavior

### The celebration on log (highest-priority behavior)

On every member log (screen 1 tap), pick **one of three** effects — randomly by default, with a forced-effect override for QA:

1. **Rocket** — `rocketUp`, 1.15s `cubic-bezier(.5,0,.75,.2)`: a 92px mango starts at 52% height, scales `.6 → 1.15` while dipping `+30px` (the crouch), then flies to `translateY(-760px)` at `scale .85`. A flame element (44×120, `border-radius: 50% 50% 40% 40%`, yellow→pink→transparent gradient) sits under it, animating `flame` at **0.09s linear infinite** (`scaleY 1→1.5`, `scaleX 1→.7`, opacity 1→.7) — the fast flicker is what makes it read as thrust.
2. **Confetti** — 34 mango particles from screen center. Per particle: random angle over 2π, distance `130–390px`, size `18–52px`, rotation `−450°…450°`, duration `0.8–1.3s` `cubic-bezier(.15,.7,.3,1)`, stagger `0–0.18s`. Vertical target is biased `−80px` so the mass arcs upward before falling. Keyframe `burst`: from `translate(0,0) rotate(0) scale(.3)` opacity 1, holding opacity to 70%, to `translate(dx,dy) rotate(rot) scale(1)` opacity 0.
3. **Clash** — two 110px mangoes fly in from ±260px (`clashL`/`clashR`, 0.6s `cubic-bezier(.3,1.6,.5,1)`): rotate ∓40°→±10° while scaling `.7 → 1.2` at impact (55%), rebound out to ±46px, settle and fade. At 0.34s a 260px yellow 10-point star (`clip-path: polygon(...)`, `6px ink`) does `starPop` — 0.7s, `scale 0 → 1.3 → 2.4`, `rotate 0 → 60°`, fading out.

Every effect also fires:
- a full-bleed cream **flash** (`flashBg`, 0.5s: opacity 0 → .85 at 15% → 0);
- a **word mark** — Anton 74px yellow with a `7px ink` stroke, `wordOut` 1.2s: `scale .3 → 1.1 → 1 → 1.6` with rotate `−6°`, fading at the end. Copy: `BLAST OFF!!` / `MANGO RAIN!!` / `KA-CHUNK!!`.
- Total effect window: **1.5s**, then state clears. Effects must **never block or delay** the count increment.

Add haptics on native (`impactHeavy`), and respect `prefers-reduced-motion` with a reduced variant (flash + word only, no particles).

### Optimistic logging

Tapping the mango immediately: increments personal count (only when attribution is `JUST ME`), increments group total, increments the queued-sync counter, animates the thermometer, and re-sorts the leaderboard. Per the vision doc this must all work **offline** — the log lands locally with a `pending sync` indicator and flushes on reconnect. Sync state is visible (`3 QUEUED`) but never blocking, and never an error state.

### Admin actions

- **Stepper ±** on screen 5 mutates that member's count, the group total, and (for the current user) their personal count — clamped at 0 — and **writes an audit entry** with a real timestamp, actor `PETE · ADMIN`, and tag `ON BEHALF` (+) or `EDIT` (−). All three admin screens read the same store, so the entry appears at the top of screen 6 instantly.
- `+1 FOR THE GROUP` writes to the untagged `THE GROUP` bucket.
- `END SESSION` / `REOPEN 15 MIN` toggles session state. On close: member editing is blocked, the recap fires, and admin amendments remain possible — each one audited.
- Screen 8 role cycling is optimistic; `SUPER` is immutable in the UI.

### Selection semantics

Item chips (4) and crew members (7) are multi-select toggles; attribution pills (1) are exclusive. All three use the same visual off-state (`opacity .55–.6`, no shadow, `translateY(5–6px)`).

### States still to design

Not in this bundle — flag before building: invite-accept, expired/invalid invite link, "no active session" empty state, offline banner, and the member-blocked-after-close message.

## State Management

Prototype state, as a starting shape:

```
me            number   current user's count
total         number   group total
mode          'ME' | 'SHARED'
fx            null | 'rocket' | 'confetti' | 'clash'
particles     array    generated per confetti burst
queued        number   unsynced logs
adj           map      admin adjustments per member
items         string[] selected item types (session draft)
inviteAll     boolean  invite-whole-group switch
closed        boolean  session state
crewPicked    string[] selected members (group draft)
roles         map      name → SUPER | ADMIN | MEMBER | INVITED
audit         array    { time, text, by, tag } newest-first
```

In production this is **derived from an append-only event log**, not stored aggregates — per the vision doc, any client reconstructs correct totals by replaying unseen events. Each client keeps a per-session **sync cursor**, pulls the delta on reconnect/foreground/interval, uses SSE on wifi and interval polling on cellular (treat "unknown" connection type as cellular). The leaderboard, recap stats, and audit log are all projections of that same log.

## Assets

- **Fonts**: Anton (400) and Space Grotesk (400/500/700) from Google Fonts. Self-host in production.
- **Mango artwork**: currently the 🥭 emoji as a **placeholder** at every size (34px → 150px). The tap target and celebrations really want a **custom illustrated mango** — a bold, thick-outlined vector matching this design language, ideally 2–3 variants (idle, squashed, rocket-with-flame) for the animations. Emoji renders inconsistently across platforms and can't be squashed/rotated convincingly. Commission or draw this before shipping.
- Other glyphs used as UI icons (🍽 🔗 ✉️ ➕ 🚪 👑 🏝 🚀 ✓ ★) should be replaced with the codebase's icon set.
- All patterns (stripes, sunbursts, graph paper, star burst) are pure CSS gradients / `clip-path` — no image assets.

## Files

| File | What it is |
|---|---|
| `Mango Tracker.dc.html` | All 8 screens, interactive. The design source of truth. |
| `support.js` | Prototype runtime. Do not port. |
| `product-vision.md` | Product spec: roles, requirements, sync model, error states, out-of-scope. |

Open the HTML in a browser and interact with it before writing code — the celebration timing and the sticker-shadow press states don't come across in a static read.
