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
| `?tiles=16` | Open with this many tiles in the grid, 1 to 16. |
| `?fallback=1` | Force the reduced-motion opacity/scale path. |
| `?debug=0` | Hide the debug panel, leaving a small chip to bring it back. |

## Seeing all eight grab anchors

Which corner or edge the sheet is grabbed by is not authored — it is resolved from
where the tile sits in the grid at the moment it is clicked. So the way to see the
whole behaviour is to change the grid, and the panel's **Tiles** slider does that
from 1 to 16.

The column count comes from the tile count, as the balanced factor pair, then is
capped by how many columns the window can actually hold:

| Tiles | Shape | Tiles | Shape |
| --- | --- | --- | --- |
| 1 | 1 × 1 | 9 | 3 × 3 |
| 2 | 1 × 2 | 10 | 2 × 5 |
| 3 | 1 × 3 | 12 | 3 × 4 |
| 4 | 2 × 2 | 15 | 3 × 5 |
| 6 | 2 × 3 | 16 | 4 × 4 |

**3 × 3 is the one shape that reaches all eight anchors at once**, because it is
the smallest grid with a middle row and a true centre column. 4 × 4 reaches the
six a grid with no centre column can. A single row or column exercises the
degenerate rules, and a narrow window folds any requested shape down — 16 tiles on
a phone is a legitimate 16 × 1 — so the readout always states the shape that laid
out rather than the one that was asked for.

**Anchors** draws each tile's resolved anchor over it, read from the same resolver
the activation path calls, so the labels cannot claim one thing while the turn does
another. Resize the window with them on and watch them change as the columns
reflow. The labels are debug chrome: they sit outside the tile's trigger, so they
are absent from both the captured texture and the visual baselines.

The demo opens with three tiles, which is the layout every browser and visual test
measures. `tests/unit/tile-grid.test.ts` pins that default to the three shapes
those suites expect at their own viewport widths, so changing the layout rule fails
a named test rather than six screenshots.

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
npm run test:visual # chromium-desktop only; skips the two mobile projects
npm run test:all
```

CI runs all of the above on `ubuntu-latest`: lint, typecheck, unit tests with
coverage and build in one job, the functional Playwright suite in a second, and
the visual-regression suite in a third. The visual job **fails** if the Linux
baselines are missing, so a green check always means screenshots were actually
compared rather than silently skipped.

### Visual baselines

`toHaveScreenshot` baselines live in `tests/e2e/visual.spec.ts-snapshots/` and
Playwright suffixes each file with its project and platform, so the macOS and
Linux sets coexist:

```
paper-turn-start-chromium-desktop-darwin.png
paper-turn-start-chromium-desktop-linux.png
```

Only `chromium-desktop` is baselined; `chromium-mobile` and `webkit-mobile` skip
the visual test by design.

Refresh the **macOS** baselines locally:

```bash
npm run test:visual -- --update-snapshots
```

Refresh the **Linux** baselines with the `Update visual baselines` workflow —
never locally. Headless Chromium renders WebGL through SwiftShader, which is
deterministic on a given CPU architecture but can differ between architectures,
so baselines produced on an Apple Silicon (arm64) Mac are not guaranteed to
match the amd64 runner that verifies them. Generating them on the runner keeps
producer and verifier identical.

```bash
gh workflow run update-visual-baselines.yml --ref <your-branch>
gh run download <run-id> -n visual-baselines-linux -D tests/e2e/visual.spec.ts-snapshots
git add tests/e2e/visual.spec.ts-snapshots && git commit -m 'Refresh linux visual baselines'
```

`workflow_dispatch` is only available for workflows that already exist on the
default branch. Before that — or for any branch that needs baselines ahead of a
merge — push the branch under `update-visual-baselines/` instead and the run
starts on its own:

```bash
git push origin HEAD:update-visual-baselines/my-change
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
