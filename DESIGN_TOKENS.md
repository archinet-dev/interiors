# Design Tokens — Space Makeover Visualizer

Extracted from `wireframes/Space Makeover Visualizer Wireframes.html` (a self-unpacking
"bundled page": template HTML + base64/gzip assets inside `<script type="__bundler/*">` tags).

> **IMPORTANT caveat from the source.** The wireframe explicitly states: *"Frames below are
> structural — not visual design."* It is a UX map (12 sections, 50+ frames) of the screen
> anatomy, states, and flows — **not** a finished visual theme. The palette below is the
> wireframe's own neutral paper palette + one blue accent. Treat colors as a starting
> scaffold; the real product theme (oklch tokens, light/dark) is to be designed per
> `PROMPT.md`. The wireframe shows **no light/dark theme split** — it is a single neutral
> "paper" surface. The structural/layout/component findings ARE authoritative.

---

## Color tokens (exact, from the wireframe `--var` block)

These are defined inline once on the root `<div>` (no `:root`, no theme switch).

```css
:root {
  /* Surfaces (neutral "paper" wireframe palette) */
  --bg:          #e8e8e4;  /* page background, warm grey */
  --frame:       #ffffff;  /* card / panel / device-frame surface */
  --fill:        #eeeeea;  /* image-area fill (darker stripe) */
  --fill2:       #f6f6f2;  /* image-area fill (lighter stripe) — paired w/ --fill in 45deg hatch */

  /* Text */
  --ink:         #2c2c29;  /* primary text */
  --soft:        #76766f;  /* secondary / muted text, captions */

  /* Borders / lines */
  --line:        #d4d4cf;  /* hairline borders, dividers */
  --line2:       #a0a09a;  /* stronger border (real interactive elements) */
  --dash:        #b7b7b1;  /* dashed border for placeholder / empty / denied states */

  /* Primary / accent (blue) */
  --accent:      oklch(0.55 0.12 250);   /* primary action, active ring, listening state */
  --accent-fill: oklch(0.955 0.022 250); /* tinted accent background (edit-loop lane, fills) */

  /* Secondary accent (amber/orange) — used for numbered step badges & "note" callouts */
  --note:        oklch(0.605 0.135 52);
  --note-fill:   oklch(0.96 0.045 72);

  /* State colors */
  --ok:          oklch(0.6 0.11 150);  /* success / green */
  --bad:         oklch(0.58 0.16 25);  /* error / red */

  /* Bundler error sink (from outer shell, reference only) */
  /* error bg #2a1215, error text #ff8a80, error border #5c2b2e */
}
```

Roles at a glance: **background** `--bg`; **surface** `--frame`; **image placeholder**
`--fill`/`--fill2` (45° hatch); **text** `--ink`/`--soft`; **borders** `--line`/`--line2`/`--dash`;
**primary/accent** `--accent`+`--accent-fill`; **states** `--ok`/`--bad`; **secondary** `--note`.

Common literal usages seen: `rgba(255,255,255,.82)` (semi-opaque chip over image),
`#fff` text on `--note`/`--accent` badges, `color-mix(in oklch, var(--accent) 35%, var(--line))`
for the edit-loop lane border.

---

## Typography

- **Body / UI font:** `'IBM Plex Sans', system-ui, sans-serif` (set on root).
- **Mono / label font:** `'IBM Plex Mono', monospace` — used for eyebrow labels, section
  tags, step counters, version counts. Treatment: `font-size:10–11px; letter-spacing:.08–.16em;
  text-transform:uppercase; font-weight:600;`.
- Fonts are embedded as woff2 assets; in production load IBM Plex Sans + Mono.
- `-webkit-font-smoothing: antialiased;` on root.

Type scale (px, by frequency of use → the working scale):

| Role                        | size            | weight        | notes |
|-----------------------------|-----------------|---------------|-------|
| Body / control text         | 12 (and 11.5)   | 400/500       | dominant size |
| Small caption / meta        | 10–11           | 400/600       | muted `--soft` |
| Micro label (mono eyebrow)  | 9–10.5          | 600           | uppercase, tracked |
| Default paragraph           | 13 (lead 14.5)  | 400, lh ~1.5–1.6 | `--soft` |
| Section heading `<h2>`      | 21              | 700           | `letter-spacing:-0.01em` |
| Larger headings             | 22 / 24         | 700           | |
| Display (rare)              | 30 / 34 / 38    | 700           | |

Line-heights: body ~1.5, paragraphs ~1.55–1.6, tight labels ~1.4.

---

## Spacing / radius / shadow

- **Spacing** (no formal scale; observed step set, px): `6, 8, 9, 10, 13, 14, 18, 22, 24, 26, 40, 46`.
  Card padding commonly `26px 24px` or `20px 18px`; root page padding `46px 40px 110px`.
  Gaps `8–14px` inside groups, `24px` between lanes.
- **Border-radius** (px, most→least used): `8` (buttons/cards), `9`, `12`, `14` (large panels),
  `7`, `6`, `2` (legend swatch), `16`, `20`/`23`/`30` (pills/chips), `50%` (badges, mic, dots).
- **Borders:** hairline `1px solid var(--line)`; interactive `1.5px solid var(--line2)`;
  placeholder `1.5px dashed var(--dash)`.
- **Shadows:** the wireframe itself is nearly flat (deliberately). Only the outer bundler
  shell uses `0 1px 4px rgba(0,0,0,0.12)`. No elevation token system is defined — define one
  for the real app.

---

## Layout

- **Page max-width:** `1320px`, centered (`margin:0 auto`).
- **Mobile workspace frame:** `300px` wide (device mock). **Desktop workspace:** canvas `~560px`
  with a persistent right conversation/transcript rail (full desktop ~`980px`). Header text
  states the breakpoint intent: **"Mobile 300px · Desktop 980px"**, **mobile-first; desktop
  expands the canvas.**
- **Container-query / breakpoint hint:** layout is described as adaptive — *mobile collapses
  history + transcript to reclaim space; desktop keeps them open*. Implies container queries
  on the workspace shell (per `PROMPT.md`).

**Workspace anatomy (Section C — the core screen):**
1. **Top bar / chrome** — Compare, Settings, theme, download. Never covers the canvas. Mobile = Compare+Settings only.
2. **Active image** — the room owns the screen; pinch-zoom + pan on mobile. (45° hatch placeholder in wireframe.)
3. **Voice indicator** — always pinned + reachable, the primary edit affordance. Big mic, status text, live waveform.
4. **Transcript** — mobile: 2-line peek that expands; desktop: full scroll rail. Shows input + output captions.
5. **History filmstrip** — every version as a thumbnail, active one is ringed (`--accent`). Tap to revert.

**Animations** (keyframes defined): `wf-pulse` (listening dot), `wf-bar` (waveform bars),
`wf-shimmer` (skeleton), `wf-orbit` (working spinner). Every animated state has a static
`prefers-reduced-motion` equivalent — meaning carried by text+color, never motion alone.

---

## Component inventory

| Component | One-liner | Key visual treatment |
|-----------|-----------|----------------------|
| Page header | Title + lede + meta | `--soft` lede, mono meta line |
| Card / panel | Generic container | `--frame` bg, `1px var(--line)`, radius 12–14, pad ~24px |
| Primary button | Main CTA (e.g. shutter, retry) | `--accent` border + `--accent-fill`, radius 8 |
| Secondary button | Neutral action | `1px/1.5px var(--line2)`, `--frame` bg, radius 8 |
| Pill / chip | Compare / History / Settings toggles | radius 20–30, `1px var(--line2)`, 11.5px |
| Step badge | Numbered annotation | `50%` circle, `--note` bg, `#fff` mono 700 |
| Eyebrow / section tag | Mono uppercase label | 10–11px mono, tracked, `--accent` or `--soft` |
| `<voice-indicator>` | Mic + status + waveform; per-state look | states: idle, listening (pulse + accent), heard, working (orbit), reconnecting, timeout |
| History filmstrip | Horizontal version thumbnails | active thumb ringed in `--accent`; tap to revert |
| Transcript rail/peek | Input+output captions | mobile 2-line peek → expand; desktop scroll rail |
| Before/After compare | Split view of two images | draggable divider + handle, swipe; also a toggle mode |
| Settings popover/sheet | Model/voice/camera/theme | desktop popover anchored to ⚙; mobile bottom sheet; Flash vs Pro model toggle |
| Pro render prompt | Opt-in high-quality re-render | brief "Want this in high quality?" → one tap; "Nano Banana Pro · up to 4K" |
| Toast | Errors/timeouts | graceful, with Retry action (Section I) |
| Placeholder / empty | Dashed outline | `1.5px dashed var(--dash)` |
| Image area | Photo slot | 45° hatch `repeating-linear-gradient(45deg,var(--fill) 0 7px,var(--fill2) 7px 14px)` |

---

## Pass 0 relevance — minimal walking-skeleton screen

Pass 0 needs only: a **centered room `<img>`** + a **single "Try a sample edit" button**.
Per the wireframe's structural language, the minimal frame is:

- **Page:** `background: var(--bg)` (#e8e8e4), root font IBM Plex Sans, `color: var(--ink)`.
- **Image:** centered, "the room owns the screen." Wrap in a `--frame` (#ffffff) surface card
  with `border:1px solid var(--line); border-radius:14px;`. Image fills the card; in Pass 0 a
  hardcoded photo replaces the hatch placeholder. Constrain to mobile width `~300px` (mobile-first),
  centered with `margin:0 auto`.
- **Primary button ("Try a sample edit"):** the primary/interactive treatment —
  border + tinted fill in the accent color, radius 8, ~12px IBM Plex Sans:

```css
.btn-primary {
  font: 600 13px/1 'IBM Plex Sans', system-ui, sans-serif;
  color: var(--accent);
  background: var(--accent-fill);
  border: 1.5px solid var(--accent);
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
}
```

- **Layout:** vertical stack, centered — image card on top, button below, generous gap (~14–24px).
  No top bar, no voice indicator, no filmstrip yet (those arrive in later passes).
