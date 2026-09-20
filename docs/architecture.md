# Paper-Turn Architecture

**Status:** Current as of the rotating-peel rebuild
**Design contract:** [`docs/superpowers/specs/2026-08-27-spectrum-paper-turn-design.md`](./superpowers/specs/2026-08-27-spectrum-paper-turn-design.md)

This document describes how the prototype is actually built. The spec defines
*what* the transition must do; this describes *how* the code does it, and why
the non-obvious parts are shaped the way they are.

## Shape of the system

The application is ordinary Spectrum Web Components DOM. WebGL exists only for
the few hundred milliseconds a card is turning into a page.

```
main.ts
  ├── content-resolver ───── tile url → an adoptable fragment  (the network lives here)
  │     ├── fragment ─────── page html → fragment, or a named contract failure
  │     └── capture-readiness  fonts + image decode, bounded
  ├── grab-anchor ────────── measured tile rects → the grab anchor
  ├── tile-grid ─────────── tile count → grid shape
  └── app.ts ─────────────── builds the Spectrum list + detail shell, adopts fragments
        └── TransitionCoordinator ── owns the lifecycle and all cleanup
              ├── DomTransitionView ─ every DOM mutation the transition makes
              ├── capabilities ────── decides full motion vs. fallback
              ├── capture ─────────── card + page → canvas textures
              ├── PaperTurnRenderer ─ the short-lived WebGL overlay
              │     ├── geometry ──── the deformation math
              │     └── paper-shaders  front/reverse face shading
              ├── timeline ────────── rAF driver, normalized 0→1
              ├── fallback-transition  opacity/scale WAAPI path
              └── MotionProfile ───── every tunable constant
```

| Module | Responsibility |
| --- | --- |
| `transition-coordinator.ts` | State machine, overlap prevention, scroll freeze, focus, inertness, failure recovery. The only module allowed to decide *what happens next*. |
| `dom-transition-view.ts` | The single seam through which the transition touches the DOM. Keeps the coordinator testable without a browser. |
| `grab-anchor.ts` | Pure functions. Given the measured tile rects and the index of the activated tile, returns the anchor the sheet is grabbed by — one of four corners or four edge midpoints. No DOM, no clock, never throws. |
| `tile-grid.ts` | Pure functions. How many tiles the demo shows, and the grid shape that many lay out in at a given width. The demo's only way to reach all eight anchors, since the anchor follows grid position. |
| `geometry.ts` | Pure functions. Given two rects, an anchor, and progress, returns a `PaperFrame`. No DOM, no WebGL, no time. |
| `paper-turn-renderer.ts` | Three.js overlay lifecycle: canvas, camera, mesh, texture, shadow, disposal. Translates a `PaperFrame` into GPU state. |
| `paper-shaders.ts` | Front/reverse face selection, both printed faces, facing-based highlight, sheet fade. |
| `capture.ts` | `html-to-image` capture with DPR and pixel-area caps from the profile, and Spectrum token inlining so the detached clone keeps its theme. |
| `capabilities.ts` | Reduced-motion preference and WebGL/texture prerequisites. |
| `timeline.ts` | One `requestAnimationFrame` loop producing normalized progress. |
| `motion-profile.ts` | Durations, easing, bend depth, fold softness, mesh density, texture caps. |
| `content/fragment.ts` | Pure functions. Page HTML in, an adoptable `DocumentFragment` or a named contract failure out. No network, no live-document mutation, never throws. |
| `content/content-resolver.ts` | The only module that touches the network. Owns the fetch, the same-origin check, single-flight, and supersession. Reads no geometry and calls no coordinator method. |
| `content/capture-readiness.ts` | Awaits fonts and image decoding for adopted content, bounded. Total: a failed decode or an elapsed bound reports and continues. |
| `content/resolver-config.ts` | Resolution's tunables, kept deliberately out of `MotionProfile`. |

Dependencies are deliberately few: `three` for the mesh, `html-to-image` for the
texture, and Spectrum Web Components for the UI. Nothing else — content resolution
added no package, using `fetch` and `DOMParser`.

## Where the detail content comes from

The detail surface used to be a five-field skeleton filled from a frozen
`CardRecord[]` with `textContent`. It is now whatever a fetched same-origin page
says it is. [`docs/fragment-contract.md`](./fragment-contract.md) is the authoring
contract; this section is the shape of the change.

### The network wait lives outside the state machine

```
click ─▶ guard modified clicks ─▶ preventDefault
           │
           ▼
         resolver.resolve(url) ──────────── async, supersedable
           │
           ├─ failed     ─▶ ordinary navigation to the href
           ├─ superseded ─▶ do nothing at all
           │
           ▼  resolved
         setPendingDetail ─▶ renderDetail (adopt) ─▶ await capture readiness
           │
           ▼
         measure tiles ─▶ resolveGrabAnchor ─▶ coordinator.open()
```

The ordering is the load-bearing decision. Awaiting inside `open()` looked like a
two-line change — it is already `async`, and the `catch` around `prepareDetail`
already recovers — but it would have put an unbounded network wait *inside* the
coordinator, between `freezeScroll()` and the first frame. `preparing` would stop
being transient bookkeeping and become a long-lived, user-visible state needing its
own cancellation semantics for Escape, re-activation, and resize, in the most
intricate and most heavily tested module here. It would also freeze scroll with
nothing on screen to explain why, and break the measured-before-committed invariant,
since measurement happens before `open()` and a round trip after it can leave the
rects stale.

Resolving ahead of the coordinator leaves `TransitionCoordinator`,
`DomTransitionView`, the geometry, the renderer, the timeline, and the fallback
untouched, along with their tests. Cancelling becomes "do not call `open()`".

The cost is one new guard. The coordinator refuses `open()` unless its state is
`idle`, but during a pending fetch the state *is* `idle`, so a second click would
slip past it. The resolver owns single-flight and supersession instead.

### Supersession discards failures too

A superseded activation's outcome is owed to nobody — success *and* failure. Treating
a superseded failure as a failure would fall through to navigation on behalf of a
click the reader already abandoned, taking the page out from under the activation
they are watching. The resolver returns a three-way outcome rather than an `ok`
boolean so that a caller cannot conflate the two by accident.

### Adoption happens twice, and must only count once

Nothing in a parsed fragment loads until it is in the live document, and both
adoption and the capture happen inside `open()`. So the activation path adopts
first — that is what lets image decoding be awaited before rasterisation — and
`prepareDetail` then calls `renderDetail` again. It is idempotent per activation for
exactly that reason: re-adopting would replace the nodes with fresh ones and restart
the loading the readiness wait had just paid for.

### `.detail-content` is the region, not its container

The fragment's top-level nodes become direct children of `.detail-content`. That is
not incidental: it is a column flex container and `.detail-footer` pins itself to the
bottom with `margin: auto 0 0`, which only works while the footer is a direct child.
An extra wrapper element would break the pin and move the settled visual baseline
with no error anywhere. It must also stay inside `<sp-theme>`, or `themeTokenCss`
stops finding a theme ancestor by `closest()` and the capture loses its tokens — see
[The clone is detached from `<sp-theme>`](#the-clone-is-detached-from-sp-theme).

### Tiles are anchors

`createCardItem` builds an `<a href>` rather than a `<button>`. That gives the
fall-through a real destination, makes cmd-click, middle-click and open-in-new-tab
work natively, and gives assistive technology correct link semantics. The delegated
handler returns before `preventDefault()` for any modified or non-primary click.

Two caveats. The UA link underline needed removing explicitly — `color: inherit` was
already there but `text-decoration` is separate, and it inherits into `sp-card`'s
slotted text, so omitting it underlines every tile. And the often-claimed
"works without JavaScript" benefit does **not** apply here: `index.html` is an empty
`<div id="app">` and `createDemoApp` builds the whole grid at runtime, so blocking
the module leaves no tiles at all. That benefit belongs to a server-rendered host.

### The demo generates its own pages

`scripts/generate-detail-pages.ts` emits one page per `CardRecord` into
`public/detail/`, on the `predev` and `prebuild` hooks. Generated rather than
hand-authored for one reason: five of the six committed visual frames carry
*captured detail content* — only `paper-turn-start` is grid-only — so the emitted
markup has to reproduce what `renderDetail` produced before this change, or ten
reference images across two platforms move. Emitting from the same records the tiles
are built from is what guarantees it, and
`tests/unit/detail-content.golden.json` holds the pre-change structures the
generator is checked against.

The output is gitignored build output. The hand-authored contract fixtures under
`public/fixtures/` are committed source, in a sibling directory so the generator's
wipe cannot reach them, and are referenced by no visual spec.

## Resolving the grab anchor

Which anchor a card is grabbed by is not authored. It is derived from where the
tile actually sits in the grid at the moment of activation: a top-left tile is
grabbed by its top-left corner, a middle-row edge tile by the edge midpoint on
its own side, and so on across the eight anchors. `main.ts` measures every
`[data-card-trigger]` rect once and calls `resolveGrabAnchor(rects, index)`
before the first frame; nothing re-measures while the transition runs.

**The grid shape comes from clustering, not from CSS.** The layout is
`repeat(var(--grid-columns), minmax(0, 1fr))`, and `--grid-columns` is written by
`app.ts` from the tile count and the width available — the ideal shape for that
many tiles, capped by how many columns fit. Reading that variable back would be
trusting a second source of truth for something the browser has already decided:
it says how many tracks were *asked for*, not where the tiles *are*, and a tile
below the fold, a partial last row, or a collapsed tile would all still have to be
accounted for. Instead `gridPositionFromRects()` clusters the measured `top`
values into rows and the `left` values into columns.
Unmeasurable tiles — zero width or height, non-finite edges — are filtered out
first so they invent no phantom rows.

`clusterAxis()` compares each candidate against the **smallest** value of the
cluster under construction, not against the previous value. Chaining off the
previous value lets a long run of tiles each drifting by the tolerance merge
into one cluster, which would collapse a real grid into a single row.

The module is total by construction: an empty rect list, an out-of-range index,
or an unmeasurable activated rect collapses to `SINGLE_TILE_ANCHOR`
(`bottom-right`) rather than failing the activation.

**Even mesh dimensions are now a constraint, not a coincidence.** An edge
midpoint has a `uv` component of exactly `0.5`, which only lands on a real mesh
vertex when the corresponding dimension is even. `meshColumns` and `meshRows` are
therefore required to be even integers of at least `2`, and `validateProfile()`
enforces it unconditionally — any of the eight anchors may be resolved at
runtime, so the check cannot wait for one. The shipped `20 × 14` already
satisfies it; a unit test asserts that, so a future tuning change trips a named
test rather than a runtime throw.

**Diagnostic.** The renderer writes the resolved anchor to
`overlay.dataset.grabAnchor` once, before the first frame, alongside the existing
`data-mesh-vertices` and `data-progress`. That is the only DOM carrier of the
anchor and exists so browser and visual tests can assert the resolution without
inspecting pixels — the midline visual checkpoints read it to prove they are
still covering a midline fold at all.

## The geometry model

This is the part worth understanding, because the obvious implementation is
wrong and the prototype shipped that wrong version first.

### Why the turn happens in normalized card space

The sheet turns about the diagonal joining the two corners that stay put. The
tempting approach is to build the end quad directly, by swapping the grabbed
corner with its diagonal opposite in pixel space and interpolating toward it.

**That does not work.** A half-turn about a rectangle's diagonal only maps the
off-diagonal corners onto each other when the rectangle is square. Reflecting
`(1000, 0)` across the line from `(0, 0)` to `(1000, 700)` lands nowhere near
`(0, 700)`. Interpolating toward a hand-swapped quad produces a
self-intersecting bowtie: the mesh folds through itself, appears to stall at the
halfway point, and can never resolve into the destination rectangle.

So `foldBasis()` works entirely in **normalized card space** — the unit square —
where reflection across the diagonal maps `(u, v) → (v, u)` exactly. The rotated
result is mapped back out through `baseRect`. Because of this, `foldBasis()`
takes only a `GrabAnchor`; it never sees a rectangle.

### Two axis families

There are two kinds of fold axis, held in a frozen `FOLD_AXIS` table keyed by
anchor:

| Family | Anchors | Axis in unit-square coordinates |
| --- | --- | --- |
| Diagonal | the four corners | main diagonal `(0,0)–(1,1)` or anti-diagonal `(0,1)–(1,0)` |
| Midline | the four edge midpoints | horizontal `(0,0.5)–(1,0.5)` or vertical `(0.5,0)–(0.5,1)` |

An anchor and its opposite share one table entry; the normal's
auto-orientation toward the grabbed anchor is what gives them opposite normals.

The normalization argument above is specifically a *diagonal* problem. A midline
**is** a symmetry axis of any rectangle, so a half-turn about it maps
`(u, v) → (u, 1 − v)` and lands exactly on the mirrored position in pixel space
too, at any aspect ratio — there is no bowtie to avoid. The midline case runs in
normalized card space anyway, purely so there is **one** deformation path rather
than two: every anchor produces the same `FoldBasis` shape, and the per-vertex
loop reads only that basis and never the axis kind.

`baseRect` is `lerpRect(source, destination, eased)` — always a proper
rectangle, growing from the card to the viewport. The sheet therefore *becomes*
the page rather than being replaced by it.

### Per-vertex deformation

For each mesh vertex, in unit-square coordinates:

| Quantity | Meaning |
| --- | --- |
| `along` | Distance projected onto the fold axis. |
| `perp` | Signed distance from the fold axis. |
| `acrossFold` | `perp / maxPerp`, in `[-1, 1]`. Positive on the grabbed half. |
| `turn` | `π · eased`. A half-turn over the transition. |
| `lift` | `sin(turn)`. Peaks mid-turn, exactly `0` at both endpoints. |
| `localTurn` | `turn + foldSoftness · lift · acrossFold`. |
| `ridge` | `sin(π · along / axisLength)`. Peaks at the two moving corners. |

`localTurn` is what makes it read as paper rather than a rotating plate: the
grabbed half **leads** and the tucked half **lags**, so the surface is curved
through the whole turn. Because the offset is scaled by `lift`, it vanishes at
both endpoints and the sheet lands flat and exact.

`maxPerp` and `axisLength` differ by axis family — `1/√2` and `√2` for a
diagonal, `0.5` and `1` for a midline — and that is exactly why nothing above
needs a per-family branch. Both are divided out before use: `acrossFold` is
`perp / maxPerp` in `[-1, 1]`, and `ridge` reads `along / axisLength` in `[0, 1]`.
Every downstream term therefore sees the same two ranges whichever axis was
chosen, so `ARC_BULGE`, `foldSoftness`, and the rest of the `MotionProfile`
tunables need no retuning for the midline family. A metamorphic unit test pins
that down: at the eased midpoint, peak perpendicular displacement divided by
`maxPerp` is equal for a midline fold and a diagonal fold.

`depth` is negative on the tucked half, so that corner genuinely curls
*underneath* the leading half rather than swinging around it. A small
depth-driven scale about the rect centre fakes perspective under the
orthographic camera, and also vanishes at the endpoints.

### The arc bulge

A rigid plate rotating past 90° projects to a zero-width line. Early frames
showed exactly that — the sheet collapsed to a sliver mid-turn.

`ARC_BULGE` pushes each half outward along the fold normal, scaled by `lift` and
`ridge`, so the sheet keeps a curved cross-section at peak curl.

The multiplier is `sin(π/2 · acrossFold)`, **not** `sign(acrossFold)`. A `sign()`
step is discontinuous at the fold and tears the mesh into visible stair steps
wherever a triangle straddles the axis. The smooth form removed the artifact
entirely — and made a denser mesh unnecessary, so the mesh stays inside the
spec's 20×14 mobile budget.

### The sheet carries the reveal

The destination is a stationary DOM surface beneath the overlay, uncovered by a
`clip-path` polygon. That polygon stays collapsed to a degenerate point for the
whole turn and opens to the full viewport only at progress 1.

This is deliberate. Because the sheet prints the destination page on its reverse
face, uncovering the live DOM mid-turn draws the page *twice* in two different
shapes. Two earlier versions of the reveal both failed for that reason:

- Clipping the whole viewport against eased progress read as a grey rectangular
  wipe sliding across the screen behind the card.
- Clipping against `baseRect` — the sheet's current footprint — replaced the
  wipe with a flat lerped rectangle. It tracked the sheet's bounds but not its
  *shape*, so it showed as a pale panel that was not part of the fold and that
  hid the rest of the card list behind it.

The sweep itself is stated in terms of the fold basis rather than the anchor's
coordinates. `frontDistance(basis, u, v) = (maxPerp − perp) / maxPerp` is `0` at
the grab anchor, `1` everywhere on the fold axis, and `2` at the pivot anchor,
and is constant along every line parallel to the fold. `clipViewport()` compares
it against `threshold = progress * 2`.

This replaced an L1 metric, `|u − gx| + |v − gy|`. For every corner anchor the two
are algebraically identical — for `top-right` both reduce to `1 − u + v` — so
corner reveal output is unchanged to the bit. For an edge midpoint the L1 form was
outright broken: under `top-center` it left all four rect corners outside the
front for any progress below `0.25` and emitted a `polygon()` with no points,
which is invalid CSS. `frontDistance` reduces to `2v` there, a band growing
downward from the top edge, and always yields between three and five finite
points.

Letting the sheet tell the whole story removes the class of bug rather than
tuning it. At progress 1 the sheet's geometry equals the destination rect
exactly, so the handoff from texture to real DOM lands pixel-for-pixel and is
invisible. Closing is symmetric: the first frame of a close already has the
sheet flat over the viewport showing the page, so clipping the real DOM shut at
that instant is equally imperceptible.

Detail pages carry body sections and a bottom-pinned footer so that the reverse
face has legible content at both ends of the sheet. Without it, the back read as
an anonymous grey field and the direction of the turn was ambiguous.

### Constants

`PERSPECTIVE_STRENGTH`, `FACING_FLOOR`, and `ARC_BULGE` are module constants in
`geometry.ts`; `SHADOW_LIFT_SCALE` is one in the renderer; `GRID_CLUSTER_TOLERANCE_PX`
is one in `grab-anchor.ts`. They describe the *shape of the
motion model* — or, for the tolerance, a measurement artifact of the layout
engine — rather than a design-tunable knob, and promoting them to
`MotionProfile` would widen a required interface that four test suites construct
literals for. `MotionProfile` remains the place for anything a designer would
plausibly want to change.

## Rendering

The renderer builds an orthographic camera in **screen space with y increasing
downward**, matching viewport coordinates so geometry needs no flip.

That choice has one consequence worth recording: Three's `CanvasTexture`
defaults to `flipY = true`, which under a y-down camera samples the captured
card upside down. The renderer sets `texture.flipY = false`.

The fragment shader picks the face from `gl_FrontFacing`. Highlight is driven by
the per-vertex facing term, floored at `FACING_FLOOR` so an edge-on sheet dims
without going muddy grey.

### Two printed faces

The sheet is one physical page printed on both sides: the **front is the source
card**, the **reverse is the destination page**. So at rest the reverse reads as
the page mirrored and shrunk onto the tile, and at the end of the turn the front
reads as the tile mirrored and stretched across the page.

Both faces stretch to the sheet's current rect, so the reverse needs its own UV
set rather than its own geometry. `backFaceUvs()` reflects every vertex UV across
the fold axis returned by `foldBasis(grabbed)`:

```
offset = uv - basis.origin
along  = offset · basis.axis
perp   = offset · basis.normal
backUv = basis.origin + along * axis - perp * normal
```

For `top-right` this reduces to `(u, v) → (v, u)`; for `top-center` to
`(u, v) → (u, 1 − v)`. Sanity check: the card's top-right UV `(1, 0)` maps to the
page's bottom-left `(0, 1)`, which is exactly where that vertex lands at progress
1. The reflection depends only on the grabbed anchor, so it is computed **once at
construction**, not per frame.

The shader carries a second sampler and a `backTextureMix` flag. When the
destination capture fails, `backTextureMix` is `0` and the reverse falls back to
the previous warm paper white, so a capture failure degrades rather than breaks.
Back-face alpha is `max(front.a, backTextureMix * back.a)` so an opaque page
capture does not inherit the card's transparent rounded-corner notches once it is
stretched to viewport size.

Capturing the destination has one trap. During `preparing` the detail element is
already displayed but clipped to a point, and `html-to-image` **clones** the node,
so the clone would inherit that clip and capture nothing. Setting a full clip on
the real element would flash the page. Instead the coordinator passes
`{ clipPath: 'none' }` as a style override, which `html-to-image` applies to the
clone only. Both captures run under a single `Promise.all` so the full-viewport
destination capture does not double click-to-animate latency.

A separate shadow mesh provides ground contact. Its opacity is **gated on
`lift`**, so it is `0` at both endpoints. Before this it was a constant-opacity
black plane sharing the sheet's geometry — a full-sheet grey slab that followed
the rotation across the viewport.

## Lifecycle

```
idle ──activate──▶ preparing ──▶ opening ──▶ open ──close──▶ closing ──▶ idle
                       │            │                          │
                       └────────────┴──── failure / resize ─────┘
                                          settle via fallback
```

**Opening.** Measure both rects before any frame. Render the destination
beneath the overlay and mark it inert. Evaluate capabilities. Capture the source
card, hide only that card, build the overlay, run the timeline. On settle:
remove the overlay, release GPU resources, activate the page, move focus to the
detail heading.

**Closing.** Re-measure the source card — bounds may have changed while the
detail page was open — then run the same timeline in reverse. Restore scroll,
unhide the card, return focus to the activation target, or to the list container
if that element is gone.

**Interruption.** Escape settles to the nearest valid endpoint. A resize
invalidates the measured geometry, so the overlay is disposed and the transition
completes through the fallback rather than recomputing an unstable mesh
mid-turn.

**Failure.** WebGL, capture, and allocation failures are explicit outcomes, not
exceptions that escape. Each disposes temporary resources, restores card
visibility and scroll, and completes through the fallback. No path leaves a
hidden card, an inert page, or an orphaned overlay.

## Capture fidelity

Card headings are slotted light-DOM children rather than only `heading` /
`subheading` attributes.

`html-to-image` flattens `<slot>` elements through `assignedNodes()`, which
returns an empty list when nothing is slotted — so **slot fallback content is
silently discarded**. `sp-card` renders attribute-driven headings as slot
fallbacks, so the captured texture came back with the artwork but no text, and
the card visibly lost its label for the duration of the turn. Providing real
slotted children is valid Spectrum usage and captures correctly.

### The clone is detached from `<sp-theme>`

Spectrum declares its ~3.4k design tokens on the `<sp-theme>` element, not on
`:root` — descendants only resolve them by inheritance. `html-to-image` renders
its clone inside an SVG `foreignObject`, which is detached from the document and
therefore inherits nothing: every `var(--spectrum-*)` in the clone silently fell
back. The texture came back with collapsed component padding, the wrong greys,
and text metrics that no longer matched the box they were measured into, so the
close button's label overflowed its pill on the sheet's reverse face while the
live DOM was correct.

The symptom is invisible on a machine that resolves the same fallbacks on both
sides, which is why it reproduced on a designer's Mac (Adobe Clean installed)
but not in headless Chromium.

`captureElement` therefore inlines the resolved `--spectrum-*` tokens onto the
capture root before handing it to `html-to-image`, and restores the element's
original inline style in a `finally` block. Inline custom properties survive
`cloneNode`, so the clone recovers the entire cascade. Enumeration uses
`computedStyleMap()` and is cached per element; where that API is missing the
capture proceeds untouched rather than failing.

## Performance

- Mesh is 20×14 (`meshColumns` × `meshRows`), a 315-vertex plane.
- Captured texture DPR and total pixel area are capped by `MotionProfile`.
- One `requestAnimationFrame` loop updates deformation, shading, shadow, and
  reveal together.
- All layout measurement happens before the first frame; the loop performs no
  layout reads.
- The overlay is disposable — GPU and texture resources are released as soon as
  the transition settles.

An e2e test asserts the mobile mesh vertex count (315) and that the canvas
backing store stays within 2× the viewport, so raising mesh density or texture
resolution is a deliberate, visible decision rather than a drift.

## Test strategy

| Layer | Command | Covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Geometry invariants, coordinator states, capture caps, capability selection, timeline, fallback, DOM view. |
| Interaction | `npm run test:e2e` | Mouse/touch/keyboard, Escape, resize, successive cards, inertness, focus, reduced motion, mobile budgets. |
| Visual | `npm run test:visual` | Start, peak curl, diagonal midpoint, settled page, plus midline peak curl and midpoint. |

Geometry is tested as pure functions on invariants — rather than by snapshotting
coordinates — which keeps the suite meaningful while the motion is still being
tuned. The load-bearing one is the **destination-frame reflection**: at progress 1
every mesh vertex lands at the unit-square reflection about its fold axis, mapped
through the destination rect. That single property subsumes the older claims it
replaced — anchor exchange in destination space, fold-axis corners held still,
and "the other corners stay put" — and unlike them it is true for both axis
families. The narrower version was not just incomplete but false for a midline
fold: under a `top-center` fold the top-left vertex lands on bottom-left, not on
itself. Alongside it: flatness at both endpoints, monotonic growth, continuity
across the fold axis, the destination staying covered until the sheet lands, and
the resolution table checked against an independently written expectation over
all 64 grid shapes and every cell of each.

Visual baselines are Chromium-desktop on Darwin only; the visual suite skips
elsewhere. They must be regenerated whenever the intended motion changes, and
reviewed by eye rather than merely accepted.

The two midline checkpoints run at a 400px viewport on tile 1, not at the corner
suite's 1280px. With three tiles, a tile resolving `top-center` is reachable in
exactly one shape: the single column of three rows a narrow grid folds down to,
where the interior tile is the row centre. At 1280px the three tiles form a single
row and no tile resolves `top-center` at all. Their screenshots are therefore a
different size from the corner baselines, which is fine — they are new names with
no prior baseline to match.

**The tile count is a control, but three is still the default.** The grid can be
dialled from 1 to 16 tiles, which is how a 3 × 3 — the smallest shape reaching all
eight anchors — gets inspected at all. Every browser and visual expectation is
written against the default, so the layout rule has to reproduce the old
`repeat(auto-fit, minmax(min(100%, 240px), 1fr))` column count exactly for three
tiles at every width: `1 × 3` at 1280px, `2 × 2` at 700px, `3 × 1` at 400px. That
parity is asserted directly in `tests/unit/tile-grid.test.ts`, so breaking it fails
a named unit test in a second rather than six screenshots in a minute. It is also
why the hero copy is unchanged: the hero sits above the grid in every baseline, so
one added sentence reflows all six frames.

The four corner baselines must themselves be regenerated and reviewed by eye.
`main.ts` used to hardcode `top-right` for every tile; tile 0 at the corner
suite's 1280×900 viewport now measures into a 1 × 3 grid and resolves through the
degenerate single-row rule to `bottom-left`. So `paper-turn-peak-curl` and
`paper-turn-diagonal-midpoint` legitimately change — a deliberate
product-behavior change, not geometry drift — while `paper-turn-start` and
`paper-turn-settled` are expected to be unaffected, at zero lift with the overlay
gone, and should be confirmed rather than assumed. The evidence that corner
*geometry* is unchanged is the corner-parity golden test in
`tests/unit/geometry.test.ts` — pre-feature vertex positions within `1e-4` CSS
pixels and the reveal polygon within `1e-6` — not a PNG byte comparison.

The two Linux counterparts of those changed frames were deleted rather than
regenerated: Linux baselines only ever come from the `update-visual-baselines`
workflow on an ubuntu runner, never from a Darwin machine. Until that artifact is
committed, CI's "Require committed linux baselines" step fails with exactly that
instruction, which is the intended loud failure — better than comparing against
bytes that record a fold the demo no longer performs. The two midline checkpoints
have no Linux baseline yet either, and that guard names them too, so one
`update-visual-baselines` run covers all six frames.
