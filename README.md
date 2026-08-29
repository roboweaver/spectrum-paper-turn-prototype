# Spectrum Paper-Turn Transition Prototype

**[▶ Try the live demo](https://roboweaver.github.io/spectrum-paper-turn-prototype/)**

A proof of concept: can a Spectrum Web Components card animate into a
full-viewport detail surface as a realistic diagonal sheet-of-paper turn?

Clicking a card lifts its top-right corner, turns the sheet about its diagonal
while the opposite corner tucks underneath, and grows it into the full page.
The detail page underneath is uncovered progressively along the moving fold.
Closing runs the same motion in reverse, back into the card.

The list and detail views are ordinary, accessible Spectrum DOM. WebGL exists
only for the few hundred milliseconds the sheet is turning.

## Running it

```bash
npm install
npm run dev
```

Query parameters for inspecting the motion:

| Parameter | Effect |
| --- | --- |
| `?duration=1200` | Override full-motion duration in milliseconds. |
| `?fallback=1` | Force the reduced-motion opacity/scale path. |
| `?debug=0` | Hide the debug panel, leaving a small chip to bring it back. |

The debug panel is **on by default** — this demo is published so the turn can be
inspected, so the controls are the point rather than a hidden extra. Only
`debug=0`, `false`, `off`, or `no` (any case) hide it. Every other value,
including `?debug`, `?debug=1`, and anything unrecognised, shows it, so a typo
can never quietly remove the controls the page exists to show. `Hide` and the
chip rewrite that parameter with `history.replaceState`, so the address bar stays
copy-pasteable while the page — and any turn mid-flight — is left alone.

Because the panel is always mounted, its speed slider now starts wherever
`?duration=` put it. Seeding is read-only: `?duration=` still means exactly what
it says — an override for the full-motion duration — and neither it nor
`fallbackDurationMs` is rewritten until the slider is actually moved. Durations
outside the slider's 180 ms – 10000 ms track still run at the value asked for;
only the readout shows the nearest reachable speed.

`window.__paperTurn` exposes `{ coordinator, profile }` for poking at it from
the console.

## Verifying it

```bash
npm run build       # tsc --noEmit && vite build
npm run test:unit
npm run test:e2e
npm run test:visual # Chromium-desktop on macOS only; skips elsewhere
npm run test:all
```

## Documentation

- [Design specification](docs/superpowers/specs/2026-08-27-spectrum-paper-turn-design.md) —
  what the transition must do, the alternatives considered, and why the hybrid
  DOM + WebGL approach was chosen.
- [Architecture](docs/architecture.md) — how it is built, the geometry model,
  and the non-obvious constraints that shaped it.
- [Implementation plan](docs/superpowers/plans/2026-08-27-spectrum-paper-turn.md) —
  the task-by-task plan the prototype was built from.

## Scope

This is an interaction and rendering proof of concept. It is not production
navigation, not a general-purpose page-curl library, and not a replacement for
Spectrum components.
