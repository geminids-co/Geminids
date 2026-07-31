# GEMINIDS — DESIGN SYSTEM SPECIFICATION
### Precision Astronomical Field Journal — Interface Standard v1.0

This document is the single source of truth for the Geminids visual language.
It is written as a field manual, not a mood board: every token below has a
reason tied to the subject (positional astronomy, field logs, transmission
records), not to a generic "brutalist" aesthetic borrowed wholesale from
elsewhere.

---

## 0. DESIGN THESIS

Geminids is not a horoscope app. It is a record-keeping instrument for
people who track the sky. The interface should feel like it belongs next
to a star atlas and a logbook, not next to a lifestyle app. Every visual
decision below is justified against that job:

- **Pure binary color** — a field journal is printed in ink on paper, or
  glows on a monochrome CRT/terminal. There is no room for color because
  color is not data here; position, time, and magnitude are.
- **Right Ascension / Declination graticule as background texture** —
  instead of decorative dot-particles ("stars"), the background is an
  actual coordinate framework, the same kind you'd see etched on a star
  chart or a telescope's setting circle. It's structural, not atmospheric.
- **Monospace-first typography** — logs, timestamps, and coordinates are
  tabular data. They must align in fixed-width columns the way a terminal
  or a printed observation log does.
- **Hairline rules over containers** — no cards, no bubbles, no shadows.
  Content is separated the way entries in a logbook are separated: by a
  ruled line, not a box.

---

## 1. COLOR — STRICT BINARY

No grays. No tints. No opacity-based "soft black." Where visual weight
needs to be reduced (e.g. secondary metadata), it is reduced through
**type scale and letter-spacing**, never through a lightened value.

```css
:root {
  --gem-white: #ffffff; /* absolute paper/void white — base surface */
  --gem-black: #000000; /* absolute ink/type black — all content, rules, glyphs */

  /* The only two "modes" are literal inversions of the above. */
  --gem-surface: var(--gem-white);
  --gem-ink: var(--gem-black);
}

/* Inverted panel (used sparingly — e.g. the active "TRANSMIT" state,
   the selected nav item, a flagged/priority log entry). This is still
   binary: it is a full swap, not a shade. */
.gem-invert {
  --gem-surface: #000000;
  --gem-ink: #ffffff;
  background: var(--gem-surface);
  color: var(--gem-ink);
}
```

**Rule:** if a component ever needs a "muted" or "disabled" look, that
is expressed with reduced type size, wider letter-spacing, or a dashed
(not solid) rule — never with a hex value between #000 and #fff.

---

## 2. GRID & STRUCTURAL SYSTEM

### 2.1 Border logic

All structural borders are exactly `1px solid var(--gem-black)`. No
border-radius exists anywhere in the system (`--gem-radius: 0` is set
once, globally, and never overridden).

```css
:root {
  --gem-radius: 0px;
  --gem-border: 1px solid var(--gem-black);
  --gem-border-hairline: 0.5px solid var(--gem-black); /* for dense data tables on hi-dpi */
}

* {
  border-radius: var(--gem-radius) !important;
}
```

### 2.2 Layout grid

A 12-column grid, but used asymmetrically and editorially — content is
deliberately NOT centered by default. Field logs run ragged, annotations
sit off to the margin, exactly like marginalia in a real logbook.

```css
:root {
  --gem-grid-columns: 12;
  --gem-gutter: 0px;        /* columns touch — separation comes from rules, not gaps */
  --gem-margin-desktop: 48px;
  --gem-margin-mobile: 16px;
  --gem-content-max: 1440px;
}

.gem-grid {
  display: grid;
  grid-template-columns: repeat(var(--gem-grid-columns), 1fr);
  width: 100%;
  max-width: var(--gem-content-max);
  margin-inline: auto;
  border-left: var(--gem-border);
}

.gem-grid > * {
  border-right: var(--gem-border);
  border-bottom: var(--gem-border);
  padding: 24px;
}
```

### 2.3 Negative space rhythm

Spacing follows a single scale, in a base-8 rhythm, but pushed further
apart than a typical UI system — a field journal breathes.

```css
:root {
  --gem-space-1: 8px;
  --gem-space-2: 16px;
  --gem-space-3: 24px;
  --gem-space-4: 40px;
  --gem-space-5: 64px;
  --gem-space-6: 104px;
  --gem-space-7: 168px;
}
```

---

## 3. THE CELESTIAL GRID (signature background element)

This is the one place the system takes a visual risk, and it earns its
keep by being *functionally correct* astronomy, not decoration: a real
Right-Ascension / Declination graticule, the kind printed on a star
atlas or etched into a telescope setting circle, rendered as a fixed
SVG background layer at very low visual weight (thin lines, wide
spacing) so it never competes with foreground type.

```css
.gem-celestial-field {
  position: relative;
  isolation: isolate;
}

.gem-celestial-field::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image:
    /* Declination lines — horizontal */
    repeating-linear-gradient(
      to bottom,
      var(--gem-black) 0px,
      var(--gem-black) 1px,
      transparent 1px,
      transparent 96px
    ),
    /* Right Ascension lines — vertical */
    repeating-linear-gradient(
      to right,
      var(--gem-black) 0px,
      var(--gem-black) 1px,
      transparent 1px,
      transparent 96px
    );
  opacity: 0.06; /* structural, not decorative — must stay near-invisible */
}

/* Crosshair marker — used to flag a coordinate, a cited object,
   or the "you are here" position in a data view. Not a random dot. */
.gem-crosshair {
  position: relative;
  width: 24px;
  height: 24px;
}
.gem-crosshair::before,
.gem-crosshair::after {
  content: "";
  position: absolute;
  background: var(--gem-black);
}
.gem-crosshair::before { /* horizontal tick */
  top: 50%; left: 0; width: 100%; height: 1px; transform: translateY(-50%);
}
.gem-crosshair::after { /* vertical tick */
  left: 50%; top: 0; height: 100%; width: 1px; transform: translateX(-50%);
}
.gem-crosshair-center {
  position: absolute; top: 50%; left: 50%;
  width: 4px; height: 4px;
  background: var(--gem-black);
  transform: translate(-50%, -50%);
}
```

RA/Dec tick labels (used along the edge of full-bleed views, e.g. a
dashboard or an observation detail screen):

```html
<div class="gem-ra-axis" aria-hidden="true">
  <span>00h</span><span>04h</span><span>08h</span><span>12h</span>
  <span>16h</span><span>20h</span><span>24h</span>
</div>
```

```css
.gem-ra-axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--gem-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--gem-black);
  border-top: var(--gem-border);
  padding-top: 4px;
}
```

---

## 4. TYPOGRAPHY

Two roles, deliberately not more:

1. **Display / editorial sans** — `Space Grotesk`. Condensed enough to
   feel instrumental rather than friendly, used at large sizes and tight
   tracking for section heads and the wordmark. Falls back to a
   geometric grotesk stack.
2. **Data / body / mono** — `JetBrains Mono`. Used for everything that
   is a log, a timestamp, a coordinate, a metadata tag, an input field,
   or body copy in the reading views. This is the workhorse face — the
   app should read as ~80% monospace.

```css
:root {
  --gem-font-display: 'Space Grotesk', 'Neue Haas Grotesk', 'Helvetica Neue', Arial, sans-serif;
  --gem-font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;

  /* Type scale — major-third-ish, but hand-tuned so headline sizes
     feel like a masthead, not a marketing hero */
  --gem-text-2xs: 10px;   /* coordinate tags, timestamps in dense tables */
  --gem-text-xs:  11px;   /* metadata line under every message/log */
  --gem-text-sm:  13px;   /* secondary body, captions */
  --gem-text-base:15px;   /* primary body / chat transmissions */
  --gem-text-md:  19px;   /* subheads, list titles */
  --gem-text-lg:  28px;   /* section heads */
  --gem-text-xl:  44px;   /* screen titles */
  --gem-text-2xl: 76px;   /* masthead / wordmark, editorial covers */

  --gem-leading-tight: 1.05;
  --gem-leading-data:  1.4;
  --gem-leading-body:  1.55;

  --gem-tracking-tight: -0.02em;  /* display headlines */
  --gem-tracking-wide:  0.06em;   /* eyebrow labels, metadata, buttons */
  --gem-tracking-widest:0.14em;   /* single-word section markers, e.g. "TRANSMISSION LOG" */
}

body {
  font-family: var(--gem-font-mono);
  font-size: var(--gem-text-base);
  line-height: var(--gem-leading-body);
  color: var(--gem-black);
  background: var(--gem-white);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, .gem-display {
  font-family: var(--gem-font-display);
  font-weight: 700;
  letter-spacing: var(--gem-tracking-tight);
  text-transform: uppercase;
  line-height: var(--gem-leading-tight);
}

h1, .gem-h1 { font-size: var(--gem-text-xl); }
h2, .gem-h2 { font-size: var(--gem-text-lg); }
h3, .gem-h3 { font-size: var(--gem-text-md); font-family: var(--gem-font-mono); text-transform: none; letter-spacing: 0; }

.gem-eyebrow, .gem-label, .gem-meta {
  font-family: var(--gem-font-mono);
  font-size: var(--gem-text-xs);
  letter-spacing: var(--gem-tracking-wide);
  text-transform: uppercase;
}

.gem-sector-marker {
  font-family: var(--gem-font-mono);
  font-size: var(--gem-text-2xs);
  letter-spacing: var(--gem-tracking-widest);
  text-transform: uppercase;
}
```

Google Fonts import (or self-host these two families for production —
recommended, see §6):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
```

---

## 5. TAILWIND CONFIG

Drop-in `tailwind.config.js` that maps every token above 1:1 so the rest
of the codebase can build with utility classes instead of hand-rolled CSS.

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,jsx,ts,tsx}'],
  theme: {
    // Fully overridden, not extended — the system is intentionally
    // closed. There is no palette to "extend" into.
    colors: {
      white: '#ffffff',
      black: '#000000',
      transparent: 'transparent',
      current: 'currentColor',
    },
    fontFamily: {
      display: ['Space Grotesk', 'Helvetica Neue', 'Arial', 'sans-serif'],
      mono: ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
    },
    fontSize: {
      '2xs': '10px',
      xs: '11px',
      sm: '13px',
      base: '15px',
      md: '19px',
      lg: '28px',
      xl: '44px',
      '2xl': '76px',
    },
    letterSpacing: {
      tight: '-0.02em',
      normal: '0',
      wide: '0.06em',
      widest: '0.14em',
    },
    borderRadius: {
      none: '0px',
      DEFAULT: '0px',
    },
    spacing: {
      0: '0px', 1: '8px', 2: '16px', 3: '24px',
      4: '40px', 5: '64px', 6: '104px', 7: '168px',
    },
    extend: {
      borderWidth: { DEFAULT: '1px', 0: '0', hairline: '0.5px' },
    },
  },
  plugins: [],
};
```

---

## 6. PRODUCTION NOTES

- **Font loading**: self-host `JetBrains Mono` and `Space Grotesk` as
  `woff2` with `font-display: swap` for production — don't depend on
  the Google Fonts CDN for a data-heavy interface that needs to render
  fast on mobile networks.
- **Reduced motion**: any transition (e.g. the crosshair pulse on a
  new transmission) must be wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- **Contrast**: because the palette is literal #000/#fff, WCAG contrast
  is trivially AAA (21:1) everywhere — the one thing this system never
  has to worry about.
- **Dark mode**: there isn't a separate dark theme. `.gem-invert` (§1)
  is used per-component for emphasis, not as a global toggle — a field
  journal doesn't have a "night mode," it has flagged entries.
