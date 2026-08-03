# UI/UX Design System — Career Copilot

**Last updated:** 2026-08-03 · Tokens live in `apps/web/src/styles/tokens.css`

> Tailwind 4 is CSS-first, so the `@theme` block in that file _is_ the configuration —
> there is no `tailwind.config.ts`. That is the single source of truth this document asks for:
> a token cannot drift between a CSS file and a JS config because there is only the CSS file.

---

## 1. Design principles

1. **The resume is the hero.** Every screen exists to make the document better. Chrome
   recedes; content does not compete with navigation.
2. **Show the reason, not just the number.** A score with no explanation is a horoscope.
   Every metric is expandable into the rules that produced it.
3. **AI proposes, the user disposes.** Every AI change appears as before/after with explicit
   accept and reject. Nothing is rewritten silently.
4. **Motion explains, never decorates.** Animation shows where something came from or what
   changed. If it does not carry information, it does not ship.
5. **Beautiful must still be accessible.** Glassmorphism is a surface treatment, never an
   excuse for 2:1 text contrast. Contrast is measured, not eyeballed.

---

## 2. Color

### 2.1 Brand ramps

Aurora identity: an indigo→violet primary with a cyan accent.

| Step | Primary (indigo) | Accent (cyan) | Neutral   |
| ---- | ---------------- | ------------- | --------- |
| 50   | `#eef2ff`        | `#ecfeff`     | `#f9f9fb` |
| 100  | `#e0e7ff`        | `#cffafe`     | `#f1f1f4` |
| 200  | `#c7d2fe`        | `#a5f3fc`     | `#e3e3e8` |
| 300  | `#a5b4fc`        | `#67e8f9`     | `#c9c9d1` |
| 400  | `#818cf8`        | `#22d3ee`     | `#9a9aa6` |
| 500  | `#6366f1`        | `#06b6d4`     | `#6b6b78` |
| 600  | `#4f46e5`        | `#0891b2`     | `#4a4a56` |
| 700  | `#4338ca`        | `#0e7490`     | `#33333d` |
| 800  | `#3730a3`        | `#155e75`     | `#1f1f28` |
| 900  | `#312e81`        | `#164e63`     | `#12121a` |

### 2.2 Semantic surfaces

| Role                 | Light                    | Dark                     |
| -------------------- | ------------------------ | ------------------------ |
| Page plane           | `#f9f9fb`                | `#0b0b10`                |
| Chart / card surface | `#fbfbfd`                | `#12121a`                |
| Elevated surface     | `#ffffff`                | `#1a1a24`                |
| Glass surface        | `rgba(255,255,255,0.65)` | `rgba(26,26,36,0.55)`    |
| Hairline border      | `rgba(11,11,11,0.10)`    | `rgba(255,255,255,0.10)` |
| Primary ink          | `#0b0b0f`                | `#ffffff`                |
| Secondary ink        | `#52525e`                | `#c4c4cf`                |
| Muted ink            | `#89898f`                | `#89898f`                |

### 2.3 Status colors — reserved

Never reused as a chart series. Always shipped with an icon **and** a text label, because
several are sub-3:1 on the light surface by design and colour must never carry meaning alone.

| Role     | Hex       | Meaning in product                    |
| -------- | --------- | ------------------------------------- |
| good     | `#0ca30c` | ATS ≥ 85, rule passed, offer received |
| warning  | `#fab219` | ATS 60–84, rule partially met         |
| serious  | `#ec835a` | ATS 40–59, important rule failed      |
| critical | `#d03b3b` | ATS < 40, parse failure, rejection    |

### 2.4 Data visualisation palette

Adopted from the validated reference palette, **re-validated against our own chart
surfaces** (`#fbfbfd` light, `#12121a` dark) rather than assumed to carry over.

| Slot | Hue     | Light     | Dark      | Typical use                          |
| ---- | ------- | --------- | --------- | ------------------------------------ |
| 1    | blue    | `#2a78d6` | `#3987e5` | Primary series — ATS score over time |
| 2    | orange  | `#eb6834` | `#d95926` | Comparison series — Resume B         |
| 3    | aqua    | `#1baf7a` | `#199e70` | Applications sent                    |
| 4    | yellow  | `#eda100` | `#c98500` | Interviews                           |
| 5    | magenta | `#e87ba4` | `#d55181` | Offers                               |
| 6    | green   | `#008300` | `#008300` |                                      |
| 7    | violet  | `#4a3aa7` | `#9085e9` |                                      |
| 8    | red     | `#e34948` | `#e66767` |                                      |

**Validator results (run, not estimated):**

- Light on `#fbfbfd`: lightness band PASS, chroma PASS, CVD separation PASS (worst adjacent
  `#eda100`↔`#1baf7a` ΔE 9.1 protan), normal-vision floor PASS (worst 19.6), **contrast
  WARN** — aqua (2.72), yellow (2.09), and magenta (2.60) fall below 3:1.
- Dark on `#12121a`: all six checks PASS, worst adjacent CVD ΔE 8.4, all slots ≥ 3:1.

**The light-mode WARN is not dismissable.** Wherever slots 3, 4, or 5 render on the light
surface, the chart must carry relief: visible direct labels on those series, or an available
table view. This is a build requirement, not a suggestion.

**Rules that are not negotiable:**

- Assign slots in fixed order, never cycled. A ninth series folds into "Other" or becomes
  small multiples — a generated hue is never acceptable.
- Colour follows the entity. Filtering out a series must not repaint the survivors.
- **Never a dual-axis chart.** Two measures at different scales become two charts, small
  multiples, or an index to a common base.
- Scatter, bubble, and small-multiple forms use **at most three slots** — beyond three the
  all-pairs floors fail (slot 4 puts yellow beside orange).
- Text always wears ink tokens, never the series colour.

**Sequential (magnitude — keyword-density heatmap, skill-coverage cells):** one hue, blue,
light→dark: `#cde2fb` `#b7d3f6` `#9ec5f4` `#86b6ef` `#6da7ec` `#5598e7` `#3987e5` `#2a78d6`
`#256abf` `#1c5cab` `#184f95` `#104281` `#0d366b`.

**Ordinal (discrete ordered stages — the application funnel):** the step nearest the surface
must still clear 2:1, so start no lighter than `#86b6ef` on light and go no darker than
`#184f95` on dark.

**Diverging (polarity — score delta between two resume versions):** blue ↔ red with a neutral
gray midpoint (`#f0efec` light, `#383835` dark). Equal steps per arm. Never a hue at the midpoint.

### 2.5 Aurora gradients

Decorative only. Never behind body text, and always beneath a glass layer that restores contrast.

```css
--aurora-1: radial-gradient(at 20% 20%, #6366f1 0%, transparent 55%);
--aurora-2: radial-gradient(at 80% 10%, #06b6d4 0%, transparent 50%);
--aurora-3: radial-gradient(at 50% 85%, #a855f7 0%, transparent 55%);
```

Animated by slow transform drift (40 s+), disabled entirely under `prefers-reduced-motion`.

---

## 3. Typography

System sans throughout — no webfont download, no layout shift, and it matches the OS:

```css
--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-mono: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
```

`--font-mono` is used for the LaTeX/Markdown editor and for diff views only.

| Token     | Size / line-height | Weight | Use                |
| --------- | ------------------ | ------ | ------------------ |
| `display` | 3.5rem / 1.05      | 700    | Landing hero only  |
| `h1`      | 2.25rem / 1.2      | 700    | Page title         |
| `h2`      | 1.75rem / 1.25     | 600    | Section            |
| `h3`      | 1.375rem / 1.3     | 600    | Card title         |
| `body-lg` | 1.125rem / 1.6     | 400    | Lead paragraph     |
| `body`    | 1rem / 1.6         | 400    | Default            |
| `body-sm` | 0.875rem / 1.55    | 400    | Secondary          |
| `caption` | 0.75rem / 1.4      | 500    | Labels, axis ticks |
| `metric`  | 2.75rem / 1        | 700    | Score values       |

Numbers: proportional figures by default; `font-variant-numeric: tabular-nums` only where
digits must align vertically (table columns, axis ticks, version history).

**Resume preview typography is separate.** It is governed by the selected template, not by
app tokens — a resume must look like a resume, not like our UI.

---

## 4. Spacing, radius, elevation

4 px base scale: `0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24` (× 4 px).

| Radius | Value  | Use                   |
| ------ | ------ | --------------------- |
| `sm`   | 6px    | Inputs, chips         |
| `md`   | 10px   | Buttons, small cards  |
| `lg`   | 16px   | Cards, panels         |
| `xl`   | 24px   | Modals, hero surfaces |
| `full` | 9999px | Pills, avatars        |

Elevation is a paired shadow plus a hairline border — in dark mode shadow alone is invisible,
so the border is what actually conveys lift.

```css
--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05);
--shadow-lg: 0 12px 20px -6px rgb(0 0 0 / 0.12), 0 4px 8px -4px rgb(0 0 0 / 0.06);
--shadow-glass: 0 8px 32px rgb(31 38 135 / 0.1);
```

### Glassmorphism recipe

```css
.glass {
  background: var(--surface-glass);
  backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--border-hairline);
  box-shadow: var(--shadow-glass);
}
```

Constraints, because glass is where accessibility usually dies:

- Text on glass must measure ≥ 4.5:1 against the **effective composited** background, not the
  glass colour in isolation.
- Never stack more than two glass layers; blur compounds into mud.
- Always provide a `@supports not (backdrop-filter: blur(1px))` fallback to an opaque surface.
- Never place glass directly over a moving aurora behind body copy.

---

## 5. Motion

| Token        | Duration | Easing                             | Use                               |
| ------------ | -------- | ---------------------------------- | --------------------------------- |
| `instant`    | 100ms    | ease-out                           | Hover, focus                      |
| `fast`       | 150ms    | ease-out                           | Buttons, toggles                  |
| `base`       | 250ms    | `cubic-bezier(0.4,0,0.2,1)`        | Cards, dropdowns                  |
| `slow`       | 400ms    | `cubic-bezier(0.16,1,0.3,1)`       | Modals, drawers, page transitions |
| `deliberate` | 700ms    | spring (stiffness 120, damping 18) | Score meter fill, hero            |

Signature moments:

- **Score meter** — arc sweeps from 0 to value over 700 ms while the number counts up. It
  animates only on first reveal and on genuine change, never on every re-render.
- **AI suggestion** — before text crossfades to after over 250 ms with a subtle highlight
  sweep, so the eye tracks exactly what changed.
- **Version restore** — the preview cross-dissolves while a timeline marker slides.
- **Landing hero** — a plain-text resume visibly reorganises into a formatted one. This is
  the product thesis in five seconds.

**`prefers-reduced-motion: reduce` disables all of it.** Transforms and opacity transitions
become instant state changes; the aurora stops; the score meter renders at its final value.
This is enforced globally in `tokens.css`, not per-component, so a new component cannot forget.

---

## 6. Layout

| Breakpoint | Width  | Behaviour                                      |
| ---------- | ------ | ---------------------------------------------- |
| `sm`       | 640px  | Single column, bottom tab bar                  |
| `md`       | 768px  | Two-column forms                               |
| `lg`       | 1024px | **Split editor activates**; sidebar appears    |
| `xl`       | 1280px | Editor + preview + AI panel, all three visible |
| `2xl`      | 1536px | Max content width 1440px, centred              |

Below `lg` the split editor collapses to tabs (Edit | Preview | AI). Side-by-side editing
below 1024 px would make both panes useless.

Grid: 12 columns, 24 px gutters, 24 px page padding (16 px on mobile).

---

## 7. Component states

Every interactive component implements all of these. A PR missing any of them is incomplete:

`default · hover · focus-visible · active · disabled · loading · error · empty · success`

- **Focus** is a 2 px ring in primary-500 with a 2 px offset. It is never removed — only
  restyled. `:focus-visible`, so pointer users do not see rings on click.
- **Loading** is a skeleton matching the final content's dimensions, never a centred spinner
  that collapses layout.
- **Empty** states carry an illustration, one sentence explaining what goes here, and a
  primary action. "No data" alone is a dead end.
- **Error** states say what failed, why, and what to do next.
- **Disabled** carries a tooltip explaining the precondition. A disabled button with no
  explanation is a bug report waiting to happen.

---

## 8. Accessibility requirements

- WCAG 2.1 AA. Body text ≥ 4.5:1, large text and UI boundaries ≥ 3:1.
- Every flow completable by keyboard alone. Logical tab order, skip-to-content link.
- Drag-and-drop section reordering has a keyboard equivalent (select, then arrow keys) and a
  menu alternative. Drag-only interaction is an accessibility failure.
- Live regions announce autosave, score updates, and AI completion.
- All images and icon-only buttons have accessible names.
- Forms: label every input, associate errors with `aria-describedby`, never rely on
  placeholder as label.
- Charts ship a table view toggle — and it is **mandatory** for any light-mode chart using
  the aqua, yellow, or magenta slots (see §2.4).
- Target size ≥ 44 × 44 px on touch.
- Tested with VoiceOver and NVDA before a release, and axe runs in CI.
