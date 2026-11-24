---
name: SATB Master
description: Warm Paper Desk & Charcoal Studio design system for four-part harmony editing, analysis, and pedagogy.
colors:
  sage-pine: "#276d59"
  sage-pine-hover: "#1f5948"
  sage-pine-soft: "#e3efe9"
  sage-pine-ink: "#1c5444"
  paper-desk: "#ecece8"
  paper-surface: "#f6f6f2"
  paper-toolbar: "#efefea"
  paper-elevated: "#fbfbf9"
  paper-control: "#ffffff"
  charcoal-desk: "#171a17"
  charcoal-surface: "#1e221e"
  charcoal-elevated: "#252a25"
  ink-primary: "#1f231d"
  ink-secondary: "#3f443b"
  ink-muted: "#565b51"
  ink-dark-primary: "#ecefe9"
  border-subtle: "#e0e2db"
  border-default: "#cfd1ca"
  border-strong: "#b9bcb3"
  status-success: "#247853"
  status-warning: "#b06f10"
  status-danger: "#c03c32"
  status-info: "#3f6799"
  voice-soprano: "#7552a3"
  voice-alto: "#2d7a68"
  voice-tenor: "#3f6fa8"
  voice-bass: "#87643d"
  score-paper: "#fffef9"
typography:
  display:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.35
  title:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.35
  chord:
    fontFamily: "Georgia, Times New Roman, serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "Cascadia Mono, Consolas, SFMono-Regular, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: "3px"
  sm: "5px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.sage-pine}"
    textColor: "{colors.paper-control}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.sage-pine-hover}"
    textColor: "{colors.paper-control}"
  button-secondary:
    backgroundColor: "{colors.paper-control}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "34px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    width: "32px"
    height: "32px"
  input-field:
    backgroundColor: "{colors.paper-control}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "34px"
  dialog-shell:
    backgroundColor: "{colors.paper-elevated}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.lg}"
---

# Design System: SATB Master

## Overview

**Creative North Star: "The Conservatory Desk"**

SATB Master is a desktop Operate-mode workstation for four-part harmony editing, rule checking, score preview, and textbook auditing. Its visual identity pairs the calm legibility of warm manuscript paper in light mode with a warm charcoal-olive nocturnal studio in dark mode, keeping interface chrome quiet so voice leading, chord progressions, and VexFlow notation remain the focal point.

Every surface, dialog, and specialized workbench (main editor, settings, rule testing, textbook audit) resolves through one semantic CSS custom property layer in `src/styles/tokens.css`, switched via `data-theme="light" | "dark"` on `<html>`. Persistent workstation controls stay compact and precise while modal dialogs and floating palettes carry softer elevation and generous breathing room.

**Key Characteristics:**
- Warm paper light surfaces and warm charcoal dark surfaces with zero cold blue-gray cast.
- Single canonical deep sage-pine accent used strictly for primary actions, active states, and focus rings.
- Four dedicated, muted SATB voice colors shared consistently across sidebar tracks, piano roll canvas, and VexFlow notehead highlighting.
- Low-glare warm parchment score paper preserved across both themes so black engraving ink and voice-colored noteheads remain crisp.
- Compact persistent workspace geometry paired with softer, clearly framed modal dialogs.

## Colors

The palette is restrained, warm-neutral, and semantic—designed for multi-hour harmony study with WCAG AA (≥ 4.5:1) legibility for all body and metadata text in both light and dark modes.

### Primary
- **Sage Pine** (`--accent`): Primary filled action buttons, active tab indicators, checked switches, active loop ranges, and selection marquees.
- **Sage Pine Hover** (`--accent-hover`): Hover state for primary buttons.
- **Sage Pine Soft** (`--accent-soft`): Subtle tinted fill for active toolbar icons, selected list rows, and highlighted option cards.
- **Sage Pine Ink** (`--accent-ink`): High-contrast foreground accent for links, active tab text, badges, and icons on both light and dark surfaces.

### Secondary
- **SATB Voice Quartet** (`--voice-s`, `--voice-a`, `--voice-t`, `--voice-b`): Soprano plum, Alto teal-green, Tenor slate-blue, and Bass ochre-brown. Tuned slightly brighter in dark mode to hold contrast against dark piano-roll lanes.
- **Semantic Status Quartet** (`--success`, `--warning`, `--danger`, `--info` with `-soft`, `-border`, `-ink` triplets): Used exclusively for diagnostic severity, test pass/fail states, audio clipping, and audit verdicts.

### Neutral
- **App Desk & Surfaces** (`--bg-app`, `--bg-surface`, `--bg-surface-2`, `--bg-surface-3`, `--bg-elevated`, `--bg-control`): Stepped warm-neutral hierarchy separating window shell, toolbars, side panels, controls, and dialogs.
- **Ink Hierarchy** (`--text-primary`, `--text-secondary`, `--text-muted`, `--text-faint`): Four calibrated contrast tiers all verified ≥ 4.5:1 against surface and control fills.
- **Borders** (`--border-subtle`, `--border-default`, `--border-strong`, `--border-focus`): Hairline 1px structural framing that replaces heavy shadows in persistent workspaces.
- **Score Paper** (`--score-paper`): Warm ivory in light mode (`#fffef9`) and softened parchment in dark mode (`#e6e4dc`) so engraved black VexFlow notation never suffers glare or color inversion.

### Named Rules
- **The Single Accent Source Rule.** Never hardcode variant green hex codes in feature CSS; always bind to `--accent`, `--accent-hover`, `--accent-soft`, or `--accent-ink`.
- **The Explicit Theme Switch Rule.** Never use `light-dark()` inside isolated components; all surfaces inherit theme state from `:root[data-theme="light" | "dark"]`.
- **The Voice Color Sovereignty Rule.** Purple, teal, blue, and ochre are reserved for Soprano, Alto, Tenor, and Bass data—never reuse them for decorative chrome.

## Typography

**UI Sans Font:** `Inter, "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif` (`--font-sans`)
**Musical / Chord Font:** `Georgia, "Times New Roman", serif` (`--font-serif`)
**Technical / Position Font:** `"Cascadia Mono", Consolas, "SFMono-Regular", monospace` (`--font-mono`)

**Character:** Crisp CJK-friendly sans handles dense desktop controls, classic serif lends academic authority to functional harmony labels (`T`, `D₇`, `K₄₆`), and tabular monospace keeps measure:beat:tick positions and rule catalog codes aligned.

### Hierarchy
- **Display** (`700`, `20px`, `1.25`): Rule detail page titles and empty-state workspace headings (`--text-xl`).
- **Headline** (`650`, `16px`, `1.35`): Confirmation dialog titles and prominent chord readouts (`--text-lg`).
- **Title** (`700`, `14px`, `1.4`): Modal dialog headers and settings card headings (`--text-base`).
- **Body** (`400–500`, `13px`, `1.55`): Dialog prose, audit analysis, rule descriptions, and form inputs (`--text-md`).
- **Compact Control** (`500–600`, `12px`, `1.45`): Persistent workspace controls, diagnostic rows, and track titles (`--text-sm`).
- **Label / Metadata** (`600–700`, `11px`, `1.35`): Inspector field labels, section headers, and status summaries (`--text-xs`).
- **Micro / Canvas Tick** (`500–700`, `10px`, `1.2`): Piano keys, measure numbers, and compact numeric pills (`--text-2xs`).

### Named Rules
- **The Tabular Measure Rule.** Every time readout, measure count, beat counter, zoom level, and diagnostic count must set `font-variant-numeric: tabular-nums` to prevent layout jitter during playback.

## Layout

SATB Master uses a full-viewport desktop grid (`100vh`, `min-width: 760px`, `min-height: 520px`) with a `42px` frameless custom titlebar, a `50px` wrapping main toolbar, and a resizable three-column workspace (`TrackSidebar` · `PianoRoll + BottomPanel` · `Inspector`) separated by `6px` interactive resizer handles.

Spacing follows a 4px rhythm (`4px`, `8px`, `12px`, `16px`, `20px`). Persistent side panels use `10px–12px` padding for high scanability; modal dialogs use `12px 18px` headers/footers and `16px 18px` body padding. Responsive rules collapse secondary metadata below `980px`, slide the audit directory into a left drawer below `1120px`, and stack dual-pane rule settings vertically below `760px`.

## Elevation & Depth

Persistent workspace panels rely on tonal stepping and `1px` hairline borders rather than drop shadows. Elevation shadows appear only on layers that float above the workspace: dropdown menus, tooltips, floating chord palettes, toast notices, and modal dialogs.

### Shadow Vocabulary
- **Subtle Control Lift** (`--shadow-xs`): Active segmented tab pills and subtle settings cards.
- **Card / Active Row** (`--shadow-sm`): Selected directory items and floating source images.
- **Popover / Floating Menu** (`--shadow-popover`): Context menus, diagnostic tooltips, rule search dropdowns, and toast notifications.
- **Modal Dialog** (`--shadow-dialog`): Settings, export, chord inference, auto-harmonization, score preview, and confirmation dialogs over a dimmed blurred backdrop (`--bg-backdrop` + `blur(3px)`).

### Named Rules
- **The Flat-Workspace Rule.** Docked panels never cast shadows onto neighboring panes; reserve blur and drop shadows strictly for overlays and dialogs.

## Shapes

SATB Master follows a balanced shape hierarchy: compact and crisp inside persistent editing chrome, gently softened on cards and modal windows.

- **Micro Tags & Keycaps** (`--radius-xs: 3px`): Rule catalog badges, log level chips, keyboard shortcuts.
- **Workspace Controls** (`--radius-sm: 5px`): Toolbar icon buttons, `.command-button`, inputs, selects, chord blocks, and list items.
- **Cards & Segmented Tracks** (`--radius-md: 8px`): Settings cards, segmented tab containers, progression candidate cards, and dropdown menus.
- **Dialogs & Floating Palettes** (`--radius-lg: 10px`): All modal dialogs (`Settings`, `AutoHarmonization`, `ChordInference`, `Export`, `MidiOut`, `ScorePreview`, `Confirm`, `Sponsor`) and floating chord/timing editors.
- **Status Pills & Switches** (`--radius-pill: 999px`): Unread/error count badges, audit state tags, and toggle tracks.

## Components

### Buttons
- **Shape:** Compact workspace corners (`5px` / `--radius-sm`), smooth `120ms` color/border transitions, unified `0.42` disabled opacity.
- **Primary:** Filled `--accent` background with `--text-on-accent` text, `600` weight, `34px` height in dialogs (`31px` in compact inspector). Hover transitions to `--accent-hover`.
- **Secondary:** `--bg-control` surface with `1px solid var(--border-strong)` border and `--text-primary` ink. Hover tints softly to `--accent-soft` with `--accent-border` and `--accent-ink`.
- **Icon Button:** `32px × 32px` transparent hit target (`28px` inside dense toolbars/rows). Hover reveals `--bg-control` with `--border-default`; `.is-active` applies `--accent-soft`, `--accent-border`, and `--accent-ink`.
- **Danger:** `--danger-ink` text; hover switches to `--danger-soft` fill and `--danger-border`.

### Inputs & Selects
- **Style:** `1px solid var(--border-default)`, `--bg-control` background, `5px` radius, `28px` height in dense inspector/editor popovers and `34px` height in dialogs.
- **Focus:** `--border-focus` border paired with `--focus-ring` (`0 0 0 2px var(--accent-ring)`).
- **Native Options:** `<option>` elements explicitly style `background: var(--bg-elevated)` and `color: var(--text-primary)` for clean dark-mode rendering on Windows Chromium/Electron.

### Segmented Controls & Tabs
- **Segmented Track:** `--bg-surface-3` track with `3px` padding and `--radius-md` (`8px`). Active segment sits on `--bg-control` with `--accent-ink` and `--shadow-xs`.
- **Panel Tabs:** Flat tab strip on `--bg-surface-2` with `2px solid var(--accent)` bottom bar on active tabs (Inspector, Bottom Panel, Rule Test panels).

### Modal Dialogs
- **Structure:** Unified `10px` radius (`--radius-lg`), `1px solid var(--border-strong)`, `--bg-elevated` body, `--bg-surface-2` header/footer separated by `1px solid var(--border-subtle)`, `--shadow-dialog`, and a `180ms` entrance transition (`dialogEnter`) over `--bg-backdrop` with `backdrop-filter: blur(3px)`.

### Piano Roll & Chord Track (Signature Component)
- **Canvas Sync:** `NoteLayer.tsx` reads `--roll-*` and `--voice-*` tokens from computed root styles and subscribes to `THEME_CHANGE_EVENT` to redraw grid lines, non-diatonic rows, locked regions, selection strokes, and diagnostic underlines synchronously on theme change.
- **Chord & Cadence Blocks:** Serif functional labels on tonal `--chord-*` and `--cadence-*` palettes with 3px bottom severity bars (`--danger`, `--warning`, `--accent`).

## Do's and Don'ts

### Do:
- **Do** consume semantic tokens (`--bg-*`, `--text-*`, `--border-*`, `--accent*`, `--radius-*`) from `src/styles/tokens.css` for every new UI element.
- **Do** use `--score-paper` for any VexFlow notation container so dark mode preserves legible engraving ink and voice notehead colors.
- **Do** preserve `:focus-visible` keyboard rings and `tabular-nums` on dynamic counters and time readouts.
- **Do** mirror modal chrome (`--radius-lg`, `--bg-surface-2` header/footer, `34px` action buttons) for every new dialog.

### Don't:
- **Don't** introduce raw hex colors in feature CSS files or redefine `.command-button` inside feature stylesheets.
- **Don't** add component-local `color-scheme: light dark` or `light-dark()` overrides that bypass the global theme toggle.
- **Don't** use decorative thick left borders (`border-left: 4px`) on informational callouts—use clean `1px` full borders with semantic soft fills.
- **Don't** drop text contrast below 4.5:1 by introducing arbitrary light gray hex values for secondary labels.
