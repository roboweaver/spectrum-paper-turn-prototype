# Spectrum Paper-Turn Transition Prototype

## ▶ [Try the live demo](https://roboweaver.github.io/spectrum-paper-turn-prototype/)

**No install, no build — it runs in the browser, and the controls are already on
screen.** This repo exists to be played with, so the debug panel ships on by
default and the whole point is to poke at the motion rather than read about it.

A proof of concept: can a Spectrum Web Components card animate into a
full-viewport detail surface as a realistic sheet-of-paper turn?

Clicking a card lifts one corner or edge of it, turns the sheet about the axis
through the two points that stay put, and grows it into the full page while the
opposite side tucks underneath. The detail page beneath is uncovered
progressively along the moving fold. Closing runs the same motion in reverse,
back into the card.

Which corner or edge gets lifted is not authored. It comes from where the tile
sits in the grid, so a top-left card peels from its top-left corner and a
middle-row edge card folds about a midline. There are eight such anchors, and the
demo lets you reach all of them.

The list and detail views are ordinary, accessible Spectrum DOM. WebGL exists
only for the few hundred milliseconds the sheet is turning.

## Play with it

The control strip sits at the bottom of the page:

| Control | What it does |
| --- | --- |
| **Tiles** | How many cards the grid lays out, 1 to 16. This is what changes the fold, because the anchor follows grid position. The readout names the shape that laid out, like `10 tiles · 2 × 5`. |
| **Anchors** | Labels every tile with the anchor it *will* be grabbed by, so you can predict the fold before clicking. Read from the same resolver the turn uses, so a label cannot disagree with the motion. |
| **Speed** | Retimes the next turn, 0.07x to 4x. `Reset 1x` returns to the shipped 720 ms. |
| **Pause / ◀ ▶ / scrub** | Freeze a turn mid-flight and walk it frame by frame. `Space` and the arrow keys do the same. |
| **Hide** | Collapses the panel to a small chip, which brings it back. |

### Things worth trying

- **Set Tiles to 9.** A 3 × 3 is the one shape that reaches all eight anchors at
  once, because it is the smallest grid with both a middle row and a true centre
  column. Click the centre tile: it folds about the horizontal midline instead of
  a diagonal, which is visibly a different motion.
- **Set Tiles to 16** for a 4 × 4 — corners and edge midpoints, but no centre
  column, so six of the eight.
- **Set Tiles to 1, 2, or 3** for the degenerate shapes, where a lone tile and the
  ends of a single row take their own rules.
- **Pull Speed down to 0.2x, then pause and scrub.** The fold, the tuck
  underneath, and the reveal creeping along the moving crease are all far easier
  to see one frame at a time than at full speed.
- **Turn Anchors on and resize the window.** Columns fold down as width runs out
  and every label rewrites itself as tiles land in new grid positions.

### Deep links

Every control has a URL, so a particular setup can be shared:

| Link | Effect |
| --- | --- |
| [`?tiles=9`](https://roboweaver.github.io/spectrum-paper-turn-prototype/?tiles=9) | Open with this many tiles, 1 to 16. |
| [`?duration=3000`](https://roboweaver.github.io/spectrum-paper-turn-prototype/?duration=3000) | Full-motion duration in milliseconds. |
| [`?tiles=16&duration=3000`](https://roboweaver.github.io/spectrum-paper-turn-prototype/?tiles=16&duration=3000) | A slow 4 × 4, which is the best single starting point. |
| [`?fallback=1`](https://roboweaver.github.io/spectrum-paper-turn-prototype/?fallback=1) | Force the reduced-motion opacity/scale path. |
| [`?debug=0`](https://roboweaver.github.io/spectrum-paper-turn-prototype/?debug=0) | Hide the panel, leaving the chip to bring it back. |

Both `?tiles=` and `?duration=` only *seed* their controls and are never rewritten
as you drag, so a link keeps meaning exactly what it says.

## How the tile count picks a shape

The column count comes from the tile count as the balanced factor pair, then is
capped by how many columns the window can actually hold:

| Tiles | Shape | Tiles | Shape |
| --- | --- | --- | --- |
| 1 | 1 × 1 | 9 | 3 × 3 |
| 2 | 1 × 2 | 10 | 2 × 5 |
| 3 | 1 × 3 | 12 | 3 × 4 |
| 4 | 2 × 2 | 15 | 3 × 5 |
| 6 | 2 × 3 | 16 | 4 × 4 |

A narrow window folds any requested shape down — 16 tiles on a phone is a
legitimate 16 × 1, and one of the cases worth inspecting — so the readout always
states the shape that laid out rather than the one that was asked for.

The demo opens with three tiles, which is the layout every browser and visual test
measures. See [Architecture](docs/architecture.md) for why that default is
load-bearing and how the anchor is resolved from measured rects rather than from
CSS.

## Running it locally

```bash
npm install
npm run dev
```

The debug panel is **on by default** — this demo is published so the turn can be
inspected, so the controls are the point rather than a hidden extra. Only
`debug=0`, `false`, `off`, or `no` (any case) hide it. Every other value,
including `?debug`, `?debug=1`, and anything unrecognised, shows it, so a typo
can never quietly remove the controls the page exists to show. `Hide` and the
chip rewrite that parameter with `history.replaceState`, so the address bar stays
copy-pasteable while the page — and any turn mid-flight — is left alone.

Because the panel is always mounted, its speed slider starts wherever
`?duration=` put it. Seeding is read-only: `?duration=` still means exactly what
it says — an override for the full-motion duration — and neither it nor
`fallbackDurationMs` is rewritten until the slider is actually moved. Durations
outside the slider's 180 ms – 10000 ms track still run at the value asked for;
only the readout shows the nearest reachable speed. `?tiles=` seeds the tile
control the same way.

`window.__paperTurn` exposes `{ coordinator, profile, tiles }` for poking at it
from the console — `__paperTurn.tiles.setTileCount(9)` is the slider, and
`__paperTurn.profile.durationMs` is live for the next turn.

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

The Playwright suites serve the app on port 4173, the same port `npm run dev`
uses. Locally `reuseExistingServer` is on, so a dev server already listening there
is reused rather than fought over — which also means the suites then run against
whatever that server is serving, including any uncommitted edit.

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
