# Design handoff — Mango Tracker UI

The visual source of truth for the v0.4 design pass. Delivered as a bundle; extracted
here so it lives in the repo rather than in someone's Downloads folder.

| File | What it is |
|---|---|
| `Mango Tracker.dc.html` | All 8 screens on one canvas, fully interactive. **The pixel source of truth** — it wins over the prose whenever they disagree. |
| `handoff.md` | The written spec: tokens, screen-by-screen breakdowns, interactions. (The bundle's `README.md`, renamed to avoid colliding with this file.) |
| `support.js` | Prototype runtime **only — do not port.** Kept because `Mango Tracker.dc.html` loads it via `./support.js` and won't run interactively without it. |

Open the HTML in a browser and interact with it before writing code. The celebration
timing and the sticker-shadow press states don't come across in a static read.

## What was deliberately not vendored

The bundle also contained a `product-vision.md`. It is **stale** — an earlier copy of
[`docs/specs/2026-08-19-mango-tracker-product-vision.md`](../specs/2026-08-19-mango-tracker-product-vision.md),
which has since been corrected in two places that matter. Always read the one in
`docs/specs/`.

## Where the designs and the code deliberately disagree

The handoff was drawn before v0.3 shipped, so several screens assume a product shape the
code has since rejected on purpose. **Skinning must not smuggle these back in.**

| Handoff shows | Code does | Why the code wins |
|---|---|---|
| Screen 1's `JUST ME` / `SHARED 🍽` attribution pills | `TapTarget` has no attribution — one tap, no prompt | Settled decision. The repo's vision doc states it directly: *"That is the whole interaction — the log counts for them and toward the group, with no attribution prompt."* Untagged group logging is an admin action, not a member choice — see the [member logging spec](../specs/2026-08-24-member-logging-design.md). |
| One hero mango (one item type) | `pickLayout()` renders 1 / 2–4 / 5+ item types as hero / 2-col / 3-col grids | Sessions can track several item types. The handoff never drew the grid sizes; extend the design language to them. |
| Screen 2 as a ranked list with per-person bars | `Leaderboard` is a per-person × per-item matrix | Ranking is undefined across multiple item types. Borrow the row treatment, keep the matrix. |
| Screen 1's `/ 100 TO THE GOAL` thermometer | No goal concept exists | Would need a schema change. Out of scope. |
| Session auto-closes at the end of its time box | The time box is a soft deadline; closing is an explicit admin action | Corrected in the repo's vision doc. |
| Screen 3 (Recap) | No route exists yet | Not built. |

Two things the handoff has no design for, because they postdate it: `UndoToast`, and
`SyncBadge`'s degraded-storage state. The `3 QUEUED` chip on screen 1 is the nearest
reference.

## Known placeholders

The mango is the 🥭 **emoji at every size, and the handoff says so explicitly**: the tap
target and celebrations want a commissioned vector with 2–3 variants (idle, squashed,
rocket-with-flame). Emoji renders inconsistently across platforms and can't be squashed or
rotated convincingly. Same for the other glyphs used as icons (🍽 🔗 ✉️ ➕ 🚪 👑 🚀) — they
should become a real icon set.
