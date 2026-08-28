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
  └── app.ts ─────────────── builds the Spectrum list + detail DOM
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
| `geometry.ts` | Pure functions. Given two rects, a corner, and progress, returns a `PaperFrame`. No DOM, no WebGL, no time. |
| `paper-turn-renderer.ts` | Three.js overlay lifecycle: canvas, camera, mesh, texture, shadow, disposal. Translates a `PaperFrame` into GPU state. |
| `paper-shaders.ts` | Front/reverse face selection, both printed faces, facing-based highlight, sheet fade. |
| `capture.ts` | `html-to-image` capture with DPR and pixel-area caps from the profile, and Spectrum token inlining so the detached clone keeps its theme. |
| `capabilities.ts` | Reduced-motion preference and WebGL/texture prerequisites. |
| `timeline.ts` | One `requestAnimationFrame` loop producing normalized progress. |
| `motion-profile.ts` | Durations, easing, bend depth, fold softness, mesh density, texture caps. |

Dependencies are deliberately few: `three` for the mesh, `html-to-image` for the
texture, and Spectrum Web Components for the UI. Nothing else.

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
takes only a `Corner`; it never sees a rectangle.

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
`geometry.ts`; `SHADOW_LIFT_SCALE` is one in the renderer. They describe the *shape of the
motion model* rather than a design-tunable knob, and promoting them to
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

For `top-right` this reduces to `(u, v) → (v, u)`. Sanity check: the card's
top-right UV `(1, 0)` maps to the page's bottom-left `(0, 1)`, which is exactly
where that vertex lands at progress 1. The reflection depends only on the grabbed
corner, so it is computed **once at construction**, not per frame.

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
| Visual | `npm run test:visual` | Start, peak curl, diagonal midpoint, settled page. |

Geometry is tested as pure functions on invariants — corner exchange in
destination space, fold-axis corners held still, flatness at both endpoints,
monotonic growth, the destination staying covered until the sheet lands — rather than by
snapshotting coordinates. That keeps the suite meaningful while the motion is
still being tuned.

Visual baselines are Chromium-desktop on Darwin only; the visual suite skips
elsewhere. They must be regenerated whenever the intended motion changes, and
reviewed by eye rather than merely accepted.
