# Spectrum Paper-Turn Transition Prototype

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
