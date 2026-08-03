# Component Specification — Career Copilot

**Last updated:** 2026-08-03

Every component here specifies its props, its states, its accessibility contract, and the
decisions that are easy to get wrong. A component is not built until all its states exist.

---

## 1. Primitives (`components/ui/`)

### `Button`

```ts
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}
```

- `loading` sets `aria-busy`, disables interaction, and swaps the left icon for a spinner
  **while preserving the button's width** — a button that shrinks mid-click moves the target
  out from under the cursor.
- Disabled buttons keep `aria-disabled` and stay focusable so screen readers can reach the
  explanatory tooltip. A `pointer-events: none` button is invisible to assistive tech.
- Minimum touch target 44 × 44 px, achieved with padding rather than a larger font.

### `Input` / `Textarea` / `Select`

```ts
interface InputProps {
  label: string; // required — there is no unlabelled input
  error?: string;
  hint?: string;
  required?: boolean;
  leftAddon?: ReactNode;
  charLimit?: number;
}
```

- `label` is a required prop, deliberately. Making it optional guarantees someone ships a
  placeholder-only field.
- Errors render below, linked with `aria-describedby`, and set `aria-invalid`.
- Character counter appears at 80% of `charLimit` and turns `status-warning` at 100%.

### `Dialog`

Focus trapped on open, focus restored to the trigger on close, `Escape` closes, backdrop
click closes unless `dismissible={false}`. `aria-modal`, labelled by its title. Body scroll
locked without layout shift (scrollbar-gutter compensation).

### `Toast`

```ts
interface ToastOptions {
  variant: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration?: number; // default 5000; errors default to Infinity
}
```

Rendered in an `aria-live="polite"` region (`assertive` for errors). Error toasts do not
auto-dismiss — a message the user never read is not a message.

### Others

`Card`, `Badge`, `Tabs`, `Tooltip`, `Popover`, `DropdownMenu`, `Switch`, `Checkbox`,
`RadioGroup`, `Slider`, `Progress`, `Avatar`, `Skeleton`, `Separator`, `ScrollArea`.
All built on Radix UI primitives for behaviour and accessibility, styled with Tailwind — we
own the appearance, not the focus-management edge cases.

---

## 2. Feedback components

### `EmptyState`

```ts
interface EmptyStateProps {
  illustration?: 'resume' | 'search' | 'applications' | 'error';
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}
```

Never renders a bare "No data". Every empty state explains what belongs here and offers the
action that creates it.

### `ErrorState`

Shows a human message, the correlation ID (copyable), a retry button, and a support link.
Never a stack trace.

### `Skeleton`

Matches the final content's exact dimensions so nothing shifts on load — this is the main
defence for the CLS < 0.1 budget. Animation disabled under `prefers-reduced-motion`.

---

## 3. Chart components (`components/charts/`)

All charts obey [Design System §2.4](./04-ui-ux-design-system.md#24-data-visualisation-palette).
Common contract:

```ts
interface ChartBaseProps {
  title: string;
  description?: string;
  loading?: boolean;
  emptyMessage?: string;
  showTable?: boolean; // table view toggle — mandatory for light-mode aqua/yellow/magenta series
}
```

**Non-negotiable across every chart:** never a dual y-axis; categorical hues assigned in fixed
order and never cycled; colour follows the entity so filtering does not repaint survivors;
text wears ink tokens, never the series colour; a legend whenever there are ≥ 2 series, with
selective direct labels (never a number on every point).

### `ScoreMeter`

```ts
interface ScoreMeterProps {
  score: number; // 0–100
  previousScore?: number; // renders a delta
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  breakdown?: ScoreComponent[]; // expandable
}
```

- A radial arc, 270° sweep, 12 px stroke, rounded caps.
- Arc colour comes from the **status** palette by band — critical < 40, serious 40–59,
  warning 60–84, good ≥ 85 — and always ships with the numeric value and a text band label,
  never colour alone.
- Animates 0 → value over 700 ms on first reveal and on genuine change only. Under
  `prefers-reduced-motion` it renders at the final value immediately.
- The number is the hero (`metric` token). Clicking expands into the per-rule breakdown, which
  is the entire point — a score with no explanation is not trustworthy.
- `role="img"` with an `aria-label` of the form "ATS score 78 out of 100, warning band".

### `TrendLine`

Score or application volume over time. 2 px stroke, ≥ 8 px markers, crosshair + tooltip on
hover, gaps rendered as gaps (never interpolated across missing data). Vertical rubric-change
markers so a scoring-rule change is never mistaken for a score change.

### `ApplicationFunnel`

Horizontal stages: Applied → OA → Interview → HR → Offer. Uses the **ordinal** blue ramp,
starting no lighter than `#86b6ef` on light and no darker than `#184f95` on dark so every
stage clears 2:1 against the surface. 2 px surface gap between segments. Each stage carries a
direct label with count and conversion percentage.

### `KeywordCloud`

Font size encodes frequency; **colour encodes match status only** (matched / missing /
partial) drawn from the status palette, each with an icon in the legend. Deterministic layout
seeded by content hash, so the same data always renders identically — a cloud that reshuffles
on every render is unreadable. Always accompanied by a sortable table view.

### `SkillGapChart`

Diverging bars: required-by-JD versus evidenced-in-resume. Blue ↔ red with a neutral gray
midpoint, equal steps per arm, no hue at the midpoint.

---

## 4. Resume editor components

### `EditorLayout`

Three panes at `xl` (form | preview | AI), two at `lg` (form | preview), tabbed below `lg`.
Panes are resizable with drag handles that persist to `localStorage` and have keyboard
equivalents.

### `SectionForm`

```ts
interface SectionFormProps {
  section: ResumeSection;
  onChange: (patch: SectionPatch) => void;
  errors?: FieldErrors;
  aiSuggestions?: Suggestion[];
}
```

React Hook Form + Zod, uncontrolled inputs so a keystroke re-renders one field rather than the
form. Each section is collapsible, reorderable, and hideable. Changes flow up as patches, not
whole-object replacements, so the version diff stays meaningful.

### `SectionReorder`

Drag-and-drop via `@dnd-kit`. **Keyboard equivalent is mandatory**: `Space` to lift, arrows to
move, `Space` to drop, `Escape` to cancel, with an `aria-live` announcement at each step. A
"Move up / Move down" menu on each section header serves users who want neither drag nor the
keyboard protocol. Drag-only reordering is an accessibility failure, not a nice-to-have gap.

### `PreviewPane`

Renders the selected template against resume data in an isolated stacking context so template
CSS cannot leak into app styles. Updates within 100 ms of a keystroke via a debounced local
render — **no network round trip**. Zoom 50–200%, page-break indicators, and a "print view"
toggle showing exactly what exports.

### `AiPanel`

Grouped suggestion list (Errors → Warnings → Improvements), each rendering a `SuggestionCard`.
Shows remaining quota. Degrades to an explicit unavailable state when the provider is down —
the rest of the editor keeps working.

### `SuggestionCard`

```ts
interface SuggestionCardProps {
  suggestion: {
    id: string;
    type: 'BULLET_REWRITE' | 'ADD_SKILL' | 'ADD_SECTION' | 'FORMATTING';
    before?: string;
    after: string;
    rationale: string;
    confidence: number;
    placeholders?: string[];
  };
  onAccept: (edited: string) => void;
  onReject: (reason?: string) => void;
}
```

- Before → after crossfade over 250 ms with a highlight sweep, so the eye lands on what changed.
- **Placeholders are rendered as editable inline chips, and `Accept` stays disabled until every
  one is confirmed or corrected.** The model cannot know the user's real numbers; shipping an
  invented metric onto a resume sets up an interview question the candidate cannot answer.
- Rejection optionally captures a reason, which feeds prompt-template evaluation.

### `VersionTimeline`

Vertical timeline, newest first, each entry showing version number, relative time, change
summary, and ATS score. Actions: preview, compare, restore. Restore requires confirmation and
creates a **new** version — history is append-only.

### `DiffViewer`

Field-level structural diff, not text diff — text diffing a reordered bullet list produces
noise. Additions in `status-good`, removals in `status-critical`, edits in `status-warning`,
each also carrying an icon and a text label so colour is never the only channel. Toggle
between unified and side-by-side.

---

## 5. Composition rules

1. **Presentational components take data, not queries.** A component that calls
   `useQuery` internally cannot be reused, storybooked, or tested without a network mock.
   Containers fetch; presentational components render.
2. **Compound components over prop explosions.** `<Card><Card.Header/><Card.Body/></Card>`
   rather than fifteen boolean props.
3. **No component exceeds ~200 lines.** Past that, it is doing more than one thing.
4. **Every component handles `loading`, `empty`, and `error`.** Not eventually — in the same PR.
5. **`className` is always forwarded and merged** (`cn()` / `tailwind-merge`) so callers can
   adjust spacing without a wrapper div.
6. **`ref` is forwarded on every primitive**, because focus management and positioning
   libraries need it.
7. **No inline object or function props on hot paths** — `sx={{...}}` in an editor render loop
   is a re-render on every keystroke.
