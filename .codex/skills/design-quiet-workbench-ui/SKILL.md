---
name: design-quiet-workbench-ui
description: Design or refine professional desktop editors, DAWs, IDE-like tools, operational dashboards, and other information-dense applications in a quiet modern workbench style. Use when building or reviewing React/Electron or web interfaces that should feel restrained, precise, compact, domain-focused, comfortable for long sessions, and visually consistent with SATB Master's UI rather than a marketing site or card-heavy consumer app.
---

# Design Quiet Workbench UI

Create a calm, precise workspace in which the user's material is visually stronger than the application chrome. Favor continuity, hierarchy, and repeated-action efficiency over decoration.

## Establish the product frame

1. Inspect the existing interface, design tokens, component library, domain objects, and primary workflows before changing styles.
2. Identify the permanent work areas: command bar, navigation or track list, central canvas/table/timeline, inspector, diagnostics, and status surfaces.
3. Make the actual working experience the first screen. Do not replace it with a landing page, hero, onboarding card wall, or feature explanation.
4. Preserve established interaction patterns unless the task explicitly requires changing them.

## Build the visual hierarchy

- Use a continuous application frame. Separate major areas with spacing, one-pixel borders, and small surface shifts.
- Keep the central canvas, document, table, or timeline visually dominant and as uninterrupted as possible.
- Use cards only for repeated independent objects, dialogs, popovers, or genuinely framed tools. Do not wrap page sections in floating cards or nest cards.
- Keep permanent controls compact. Target roughly 28-32 px control heights and 16-18 px toolbar icons unless the existing system dictates otherwise.
- Use radii of 3-6 px for controls, popovers, and selections. Avoid pill shapes except for compact statuses or established toggle patterns.
- Reserve shadows for transient elevation such as menus, dialogs, and tooltips. Use borders for permanent structure.
- Keep toolbars, grids, counters, and editor tracks dimensionally stable so hover, selection, labels, and dynamic values do not shift the layout.

## Use a quiet color system

Start with warm neutral surfaces and charcoal text. Use hue mainly to communicate identity or state.

For a close SATB Master treatment, use these values as seed tokens rather than mandatory colors:

```css
--surface-main: #f7f7f3;
--surface-subtle: #eeeee9;
--surface-raised: #ffffff;
--border: #c7c8c1;
--text: #30332f;
--text-muted: #696b63;
--accent: #2f7764;
--error: #c93f34;
--warning: #d49324;
--suggestion: #4d7469;
```

- Keep the neutral system dominant. Do not tint the entire product with one hue family.
- Give domain categories a restrained set of distinct accents, such as purple, green, blue, and brown.
- Keep semantic colors separate from category colors. Never assign an ordinary track, team, or object the same color used for errors.
- Use saturation sparingly. Increase contrast for selection, active tools, warnings, and playback state rather than decorating idle surfaces.
- Avoid gradients, decorative orbs, bokeh, glass effects, and large atmospheric color fields.

## Set typography and iconography

- Use the platform UI sans serif or the product's established family. Prefer Segoe UI on Windows desktop applications.
- Keep routine interface text around 11-13 px, section headings around 13-16 px, and reserve larger display type for genuinely prominent content.
- Use regular or semibold weight to establish hierarchy. Do not compensate for weak hierarchy with oversized headings.
- Set letter spacing to `0` and do not scale font size with viewport width.
- Use tabular or monospace numerals for timecodes, ticks, coordinates, measures, and other aligned technical values.
- Use the existing icon library, preferably Lucide when present. Use familiar symbols for editing tools and add concise tooltips to unfamiliar icon buttons.

## Design controls for repeated work

- Use icons for tools, segmented controls for modes, tabs for views, toggles or checkboxes for binary state, and select menus for option sets.
- Give active, hovered, focused, disabled, locked, and destructive states clearly different treatments.
- Keep focus rings visible but quiet. Do not remove keyboard focus without supplying an equivalent indicator.
- Place controls near the object or context they affect. Put secondary configuration in an inspector or compact popover.
- Favor direct manipulation on the canvas while retaining exact numeric editing in the inspector.
- Make panel seams draggable when users benefit from changing workspace proportions. Keep the resting divider subtle; reveal resize intent through cursor and hover feedback instead of a permanent thick bar.
- Preserve useful keyboard shortcuts and expose them in tooltips or menus without placing tutorial prose in the workspace.

## Treat timelines and canvases as one system

- Derive rulers, tracks, overlays, selections, loop regions, and playheads from the same coordinate conversion.
- Continue meaningful guides across related lanes. A measure line or playhead should not stop arbitrarily at a header boundary.
- Keep sticky labels and rulers aligned during zooming and scrolling.
- Use category color for object identity and semantic stripes, outlines, or badges for diagnostics.
- Attach a diagnostic to the object that owns the problem. Show region-level problems on the region, not redundantly on every child object.
- Aggregate all diagnostics for an object in its hover or focus tooltip while using the highest severity for its compact persistent marker.

## Adapt without losing density

- Design desktop-first for professional tools, then define explicit minimum widths and heights for each panel.
- Allow side and bottom panels to resize; collapse or hide secondary areas before compressing the primary workspace beyond usability.
- Let text wrap where appropriate and use ellipsis only when the full value remains available through a tooltip or inspector.
- Prevent controls, labels, and panels from overlapping at the minimum supported viewport.
- Do not transform a dense workbench into a decorative mobile card feed. Create a focused compact mode if narrow-screen support is required.

## Write interface copy

- Use short domain terms and direct commands.
- Prefer labels such as `音源`, `属性`, `锁定`, and `导出 MIDI` over explanatory sentences.
- Put instructions in documentation, onboarding, or contextual help rather than permanently visible workspace text.
- Distinguish error, warning, suggestion, loading, empty, and success states with precise language.

## Avoid common drift

Do not introduce:

- oversized marketing headings inside the application;
- decorative card grids for ordinary settings or sections;
- excessive rounding, shadows, or floating containers;
- monochromatic purple, blue, beige, or dark-slate themes;
- category colors that collide with error or warning colors;
- thick permanent resize bars;
- controls that change size when their state or label changes;
- visible prose explaining obvious controls;
- decoration that competes with the user's score, timeline, data, or document.

## Verify the result

1. Exercise the primary workflow at the minimum supported window size and a wide desktop size.
2. Check empty, populated, selected, hovered, focused, disabled, loading, warning, error, and overflow states.
3. Confirm that text fits, panels remain usable, and no controls overlap.
4. Verify keyboard navigation and resize handles.
5. Inspect screenshots at normal scale; the work content should attract attention before the application frame.
6. Scan the final color tokens. Confirm that neutrals dominate, accents remain purposeful, and semantic colors are unambiguous.
