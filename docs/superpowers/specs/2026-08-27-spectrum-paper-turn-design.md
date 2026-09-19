# Spectrum Paper-Turn Transition Prototype

**Status:** Approved
**Date:** 2026-08-27
**Revised:** 2026-08-30 — the grabbed corner became a position-derived grab anchor over
eight anchors and two fold-axis families. See [Revision history](#revision-history).

## Purpose

This prototype will demonstrate whether a Spectrum-style card can animate into a full-viewport detail surface as a realistic sheet-of-paper turn. It is an interaction and rendering proof of concept, not a replacement for Spectrum components or application navigation.

The prototype succeeds only if the transition reads as one continuous paper sheet changing shape while the underlying detail page is progressively revealed. The settled list and detail states must remain normal, accessible Spectrum Web Components DOM rather than WebGL-rendered application UI.

## Scope

The prototype covers:

- Opening a detail surface from a card with mouse, touch, or keyboard activation.
- Reversing the same transition to close the detail surface.
- A grab anchor derived from the tile's live measured position in the card grid, with
  geometry generalized to all four corners and all four edge midpoints.
- A lightweight WebGL paper mesh used only during the transition.
- An accessible DOM fallback when full motion is unavailable or inappropriate.
- Focus, scroll, interruption, resize, failure recovery, and reduced-motion behavior.

The prototype does not define production navigation, data loading, deep linking, browser history, shared-element transitions beyond the card-to-detail interaction, or a general-purpose page-curl library.

## Experience and Interaction Geometry

When a card is activated, its visual appearance becomes a temporary turning sheet above the destination detail DOM.

The transition is defined by an anchor and its geometric opposite:

- The **grab anchor** begins at the source-card anchor resolved for that tile, is pulled
  forward as though lifted off the surface, and travels across the sheet to finish at the
  opposite anchor of the full-viewport destination.
- The **pivot anchor** — the grab anchor's point reflection through the rectangle center —
  tucks underneath the leading half and finishes at the destination position corresponding
  to the grab anchor.
- At the end of the turn, that pair has visibly exchanged positions.

The anchor vocabulary is eight values: the four corners `top-left`, `top-right`,
`bottom-right`, `bottom-left`, and the four edge midpoints `top-center`, `middle-right`,
`bottom-center`, `middle-left`. The rectangle center `(0.5, 0.5)` is deliberately assigned
to no anchor: a sheet grabbed at its own center has no fold axis to turn about. Which
anchor a tile uses is not authored. It is derived at activation time from the tile's live
measured position in the grid, so the same markup grabs differently as the grid reflows.

The exchange is expressed as a **single coherent rotation of a growing sheet**, not as an
interpolation toward a hand-built end quad. Throughout the turn the sheet's footprint remains
a proper, non-self-intersecting rectangle that grows from the source card to the destination
viewport, so the sheet becomes the page rather than being swapped for it. The two anchors on
the fold axis stay put in that growing frame while the grab and pivot pair rotate past each
other.

The fold axis is the line joining the two anchors of the grab anchor's own family that are
neither the grab anchor nor the pivot, which gives two axis families:

- A **diagonal fold** for a corner anchor, about the main diagonal `u = v` or the
  anti-diagonal `u + v = 1` of the normalized card square.
- A **midline fold** for an edge-midpoint anchor, about the horizontal midline `v = 0.5` or
  the vertical midline `u = 0.5`.

Because a half-turn about a rectangle's diagonal only exchanges the off-diagonal corners when
the rectangle is square, the diagonal family is defined in normalized card space and mapped
back into viewport pixels. Implementations must not reflect across the pixel-space diagonal;
doing so produces a self-intersecting sheet that stalls partway through and never resolves
into the destination rectangle.

The midline family carries no such hazard. Mirroring about a rectangle's horizontal or
vertical centerline is exact in pixel space at every aspect ratio, so a midline fold would be
correct computed either way. It is kept in normalized card space regardless, so that both
families share one deformation path rather than two.

Anchor exchange is a required geometric property, not an incidental visual effect, and it
holds for all eight anchors. The renderer must derive orientation, fold direction, and anchor
trajectories from the resolved grab anchor rather than hard-coding top-right behavior. Only
the choice of fold-axis endpoints varies with the anchor: the per-vertex deformation reads the
fold basis alone and never branches on the axis family.

The stationary full-page detail DOM is placed beneath the turning sheet before animation
begins. Because the sheet is printed with the destination page on its reverse face, the sheet
itself performs the reveal: the page becomes progressively visible as the turn exposes more of
that reverse face along the moving fold.

The live destination DOM stays fully covered for the duration of the turn and is uncovered only
when the sheet lands, where the sheet's geometry matches the destination rectangle exactly and
the handoff from texture to DOM is imperceptible. No region of the destination — and no
full-viewport region of page background — may become visible independently of the turning
surface. Any reveal that paints a shape other than the fold itself, whether a cross-fade, a
rectangular wipe, or a rectangle interpolated between the card and viewport bounds, is a defect:
it draws the page twice in two different shapes.

To make the reverse face legible mid-turn, detail pages must carry content that reaches both the
top and the bottom of the page. A page whose content clusters at the top leaves the reverse
reading as an anonymous field, which makes the direction of the turn ambiguous.

To read as paper, the turning surface includes:

- Curved side edges produced by mesh deformation.
- A visible reverse face while the sheet curls. The reverse is not blank paper: the sheet is
  printed on both sides, with the source card on the front and the destination page on the
  back, so the turn reveals the page itself rather than an anonymous backing.
- Highlights and shadows that change with bend and orientation.
- A contact or cast shadow near the fold and underlying page. The shadow must be tied to how
  far the sheet is lifted, so it is absent at both endpoints and never reads as a flat slab
  travelling with the sheet.
- Sufficient depth and non-linear deformation to avoid looking like a rigid rotating card. The
  sheet must retain a curved cross-section at peak curl rather than projecting to a
  zero-width sliver as it passes edge-on.
- Continuous deformation across the fold axis. Discontinuous per-vertex terms are not
  acceptable; they tear the mesh into visible steps.

The settled detail page is never the deformed mesh. Once opening completes, the overlay is removed and the already-rendered Spectrum detail DOM becomes the only visible surface. Closing reconstructs the temporary sheet and reverses the same geometric timeline back into the originating card.

## Chosen Architecture

The recommended architecture is a **hybrid DOM plus lightweight WebGL mesh**.

### Spectrum DOM surfaces

The card list and full detail view remain accessible real DOM built with Spectrum Web Components. They retain responsive layout, semantics, text rendering, focus behavior, and assistive-technology support. The destination detail DOM is rendered beneath the transition overlay before opening, but remains inert until the animation completes.

### `TransitionCoordinator`

`TransitionCoordinator` owns the transition lifecycle:

- `idle`: the card list is interactive and no transition resources exist.
- `preparing`: geometry is measured, the inert destination is rendered, and full or fallback motion is selected.
- `opening`: the temporary sheet animates from the card to the detail surface.
- `open`: the overlay has been removed and the detail DOM is active.
- `closing`: the same timeline runs in reverse toward the source card.

Only valid state transitions are accepted. The coordinator prevents overlapping opens or closes, blocks normal pointer and keyboard interaction during motion, permits Escape cancellation, freezes and restores document scrolling, and records the activation target for focus restoration. It also owns cleanup so capture, rendering, cancellation, or interruption cannot leave a hidden card, inert page, frozen scroll position, or orphaned overlay.

### `PaperTurnRenderer`

`PaperTurnRenderer` owns the temporary WebGL overlay. It accepts:

- Source and destination rectangles in viewport coordinates.
- The resolved grab anchor, one of the eight anchor values.
- Normalized progress from `0` to `1`.
- Texture and motion parameters supplied by `MotionProfile`.

It maps a capture of the source card onto a modest subdivided mesh and computes the sheet deformation, moving fold, anchor exchange, curved boundaries, front and reverse faces, changing illumination, cast shadow, and destination reveal mask. The renderer is short-lived: it is created for a transition and disposed when the transition settles or falls back.

### Source capture fidelity

The captured texture must reproduce the card as the user sees it, including its text. Card
content therefore has to survive whatever DOM flattening the capture step performs. Shadow-DOM
slot fallback content is not reliably captured, so card headings are authored as real slotted
light-DOM children rather than relying on attribute-driven fallbacks. A capture that silently
drops card text is a defect, not a cosmetic difference: the card visibly loses its label for
the duration of the turn.

### `MotionProfile`

`MotionProfile` centralizes tunable behavior rather than scattering visual constants across coordinator and renderer code. It defines:

- Full-motion and fallback durations and easing.
- Bend depth, fold softness, edge curvature, and shadow strength.
- Mesh density and texture size/DPR limits.
- Reduced-motion behavior.

The initial full-motion target is approximately 650-800 ms, long enough for the anchor exchange and reverse face to be legible without making navigation feel stalled. The fallback target is 180-220 ms.

`MotionProfile` holds values a designer would plausibly retune. Constants that define the
*shape* of the motion model itself — perspective strength, facing floor, arc bulge, shadow lift
scaling — belong with the geometry and
rendering code they describe, and are documented in the architecture notes rather than exposed
as profile fields.

## Transition Lifecycle

### Opening

1. The user activates a card.
2. The coordinator enters `preparing`, records the activation target, and measures source and destination geometry before any animation frame.
3. The destination detail DOM is rendered beneath the overlay and marked inert.
4. The coordinator evaluates reduced-motion preference and WebGL, capture, and texture prerequisites.
5. For full motion, the source card is captured as a texture, the overlay and mesh are created, and only the originating card is visually hidden.
6. The normalized timeline animates for approximately 650-800 ms while the mesh turns and progressively reveals the destination.
7. The overlay is removed, the source texture and WebGL resources are released, the destination becomes interactive, and focus moves to the detail heading.

If full-motion prerequisites fail before or during setup, the coordinator cleans up partial resources and uses the fallback transition without exposing an intermediate or half-transition state.

### Closing

Closing uses the current viewport bounds of the originating card, not stale opening measurements. The coordinator makes the destination inert, reconstructs the transient overlay if full motion remains available, and runs the same timeline in reverse. On completion it removes the overlay, restores the list and scroll state, unhides the source card, and returns focus to the original activation target.

If the originating card or activation target no longer exists, focus moves to the list container. This is a defined recovery path rather than an error.

### Cancellation and interruption

During `opening` or `closing`, ordinary controls remain disabled. Escape is the only supported cancellation input. Cancellation settles to the nearest valid endpoint through coordinator-owned cleanup; it must not expose both interactive surfaces or leave both inert.

A resize or orientation change during motion invalidates the measured geometry. Rather than recomputing an unstable mesh mid-turn, the coordinator disposes the overlay and completes the transition using the opacity/scale fallback toward the intended endpoint.

## Accessibility, Resilience, and Performance

### Motion selection

Full paper-turn motion is used only when:

- The user has not requested reduced motion.
- WebGL initialization succeeds.
- The source appearance can be captured within texture constraints.
- Required texture and rendering capabilities pass.

Otherwise, opening and closing use a 180-220 ms opacity/scale transition between the same real DOM endpoints. Reduced motion always selects the fallback.

### Input, focus, and scroll

- The destination remains inert throughout opening and closing.
- Pointer and keyboard activation are blocked during motion, except Escape cancellation.
- Scroll is frozen without losing the previous position and restored at the appropriate endpoint.
- Opening focus lands on the detail heading after the overlay is removed.
- Closing focus returns to the activation target, or to the list container if that target no longer exists.
- End states expose only ordinary Spectrum DOM to accessibility APIs.

### Failure recovery

WebGL initialization, texture capture, resource allocation, and animation failures are explicit transition outcomes. Each failure path disposes temporary resources, restores card visibility and scroll state, resolves inertness consistently, and completes through the fallback or a stable endpoint. Failures must never be converted into silent success while leaving partial transition state behind.

### Performance envelope

- Use a small mesh near 20 columns by 14 rows, adjusted only through `MotionProfile`.
- Cap captured texture device-pixel ratio and dimensions to avoid excessive memory use.
- Use one `requestAnimationFrame` loop for deformation, shading, shadow, and reveal updates.
- Complete layout measurement before animation frames and avoid layout reads inside the frame loop.
- Target smooth frame rates on modern desktop and mobile browsers.
- Treat the overlay as disposable and release GPU and texture resources immediately after settling.

## Testing

### Unit tests

Unit coverage will verify:

- Valid coordinator state transitions and rejection of overlap.
- Opening/closing timeline symmetry and anchor-path reversal.
- Position-based anchor resolution, exhaustively over the grid shapes and cells it can be
  asked about, including the degenerate single-row, single-column, and single-tile shapes and
  malformed input that has to resolve to something rather than throw.
- Anchor exchange across all eight anchors, plus the destination-frame reflection it follows
  from, both axis families sharing one deformation path, and midline exactness swept over
  independently varying aspect ratios.
- Focus restoration to the source or list-container fallback.
- Full-motion versus fallback selection, including reduced motion.
- Capture and WebGL failure cleanup.
- Escape cancellation, interruption, and resize/orientation fallback completion.

### Browser interaction tests

Browser tests will cover:

- Opening and closing with mouse, touch, and keyboard.
- Escape during opening and closing.
- Resize and orientation changes during motion.
- Opening different cards in succession without stale texture, geometry, or focus state.
- Disabled pointer and keyboard controls while a transition is active.
- Correct activation and inertness of list and detail surfaces at each endpoint.

### Visual regression checkpoints

Visual comparisons will capture:

- Start: the sheet aligns with the originating card.
- Peak curl: curved edges, reverse face, highlights, and shadows are visible.
- Turn midpoint: the destination reads on the sheet's reverse face along the moving fold, the rest of the card list is still visible behind the sheet, and the anchor exchange is legible.
- Midline fold: peak curl and mid-turn for an edge-midpoint grab, which curls about a
  centerline rather than a diagonal and is the case no corner baseline covers.
- Settled page: no overlay remains and the detail surface is ordinary Spectrum DOM.

## Success Criteria

The prototype is successful when all of the following are true:

- The grab anchor and its opposite anchor exchange positions in the destination frame: the
  vertex at the grab anchor lands on the destination's pivot anchor and the vertex at the pivot
  lands on the destination's grab anchor. This holds for all eight anchors, and it is the
  general statement of what a diagonal corner exchange is a special case of.
- The sheet grows continuously from the card to the full viewport without stalling, folding
  through itself, or popping to its end state.
- Full-page content is revealed by the sheet's own reverse face along the moving fold — the
  diagonal for a corner grab, the centerline for an edge-midpoint grab — with no independent
  background wipe and no flat panel of page content outside the fold.
- Curvature, reverse-face treatment, deformation, highlights, and shadows create a plausible paper-like turn.
- The captured sheet reproduces the source card faithfully, including its text.
- Opening settles into normal Spectrum detail DOM with no transition overlay.
- Closing correctly reverses the same motion into the current source-card bounds.
- Controls remain disabled during motion except for Escape cancellation.
- Focus, inertness, scrolling, interruption, and failure recovery end in a valid coordinator state.
- The reduced-motion and capability fallback remains fully functional.
- The interaction runs smoothly on targeted modern desktop and mobile browsers.

## Alternatives Considered

### SVG/CSS approximation

An SVG- or CSS-only approach would be lighter, easier to inspect, and simpler to integrate with DOM layout. It can support clipping, gradients, and basic 3D transforms, but it cannot reproduce the required changing surface curvature, tucked corner, reverse face, and smoothly deforming diagonal fold with comparable fidelity. The likely result would read as a folded polygon or rotating panel rather than paper.

### Full WebGL scene

A full WebGL scene would offer maximum rendering control and visual fidelity. However, it would require duplicating or rasterizing the list and detail experiences, complicate text quality and responsive Spectrum layouts, and create substantial accessibility and focus-management work. It would also make ordinary application state dependent on the renderer.

### Recommendation

The hybrid approach preserves accessible, responsive Spectrum DOM as the source of truth while using WebGL only where it provides unique value: the short-lived deforming sheet. It provides enough geometric and shading control to evaluate the paper-turn concept without committing the application UI to a canvas-based architecture.

## Revision history

### 2026-08-30 — the grabbed corner becomes a position-derived grab anchor

A corner chosen at authoring time made every tile turn identically. A card in the middle of
the grid was grabbed from the same corner as a card on the edge, which reads as a property of
the renderer rather than a property of the card. The anchor is now derived at activation from
the tile's live measured position, so a left-edge tile is grabbed from its left, a top-row tile
from its top, and a tile with no edge affinity from its top edge midpoint.

Deriving the anchor from position forces the vocabulary open. Four corners cannot express "the
left side of this tile," so the vocabulary widens to eight anchors: the four corners plus the
four edge midpoints. The rectangle center is assigned to no anchor, because a sheet grabbed at
its center has no fold axis. The pivot stays derived rather than configured — it is the point
reflection of the grab anchor through the rectangle center — so every anchor has exactly one
opposite and exactly one fold axis.

That second half of the vocabulary brings a second fold-axis family. A corner anchor folds
about a diagonal; an edge-midpoint anchor folds about a centerline. Notably, the hazard the
2026-08-28 revision recorded does not apply to the new family: a centerline mirror is exact in
pixel space at any aspect ratio, where a diagonal mirror is exact only for a square. The
midline family is kept in normalized card space anyway, purely so both families share one
deformation path. Only the fold-axis endpoints vary with the anchor, and the per-vertex
deformation reads the fold basis alone, so no motion tunable needed retuning and corner output
moved by less than a pixel.

Two consequences were accepted rather than designed away:

- **Three fold behaviors in one row.** A five-column grid has a genuine center column, so its
  top row shows a diagonal fold from the left corner, a midline fold from the top edge
  midpoint, and a diagonal fold from the right corner, side by side. That is what
  position-derived anchors mean; it is not a defect.
- **The mesh must be even in both dimensions.** An edge midpoint's coordinate of `0.5` only
  lands on a real mesh vertex when the corresponding dimension is even. The shipped 20 × 14
  mesh already satisfies this, and the constraint is now validated rather than assumed, so a
  future retune fails loudly instead of sampling the wrong vertex.

Two implementation details are worth recording because they are not obvious from the geometry.
Grid position is recovered by clustering the measured tile rectangles' top and left values
under a small tolerance, not by parsing the CSS grid template: clustering is what makes the
resolution independent of how the layout was authored. And the reveal sweep was restated in
terms of distance from the fold rather than an L1 distance from the grab point. The old metric
was the fold-parallel sweep in disguise for corners, but for an edge midpoint it emitted a clip
path with no points at all early in the turn, which is invalid CSS.

The authoring override was removed outright rather than deprecated. Nothing — no attribute, no
constant, no parameter — can now disagree with the resolved anchor; an authored value is simply
inert. The resolved anchor is published on the overlay element as its single diagnostic
carrier, which is what makes the resolution observable without a debug surface.

Nothing in the architecture, accessibility, resilience, performance, or fallback sections
changed.

### 2026-08-29 — the sheet performs the reveal

Once the reverse face was printed with the destination page, the separate DOM reveal became
redundant — and actively harmful. It drew the destination twice in two different shapes.

Two successive reveal implementations both failed on the running prototype. Clipping the whole
viewport against eased progress read as a grey rectangular wipe sliding behind the card.
Replacing it with a clip interpolated between the card bounds and the viewport tracked the
sheet's *bounds* but not its *shape*, so mid-turn a flat pale panel of page content sat outside
the fold and hid the rest of the card list behind it. Fading the sheet out over the same window
compounded both, since the page was then visible through the sheet that was also printing it.

The corrected model removes the class of defect rather than tuning it. The sheet keeps constant
opacity, and the live destination DOM stays covered for the entire turn, uncovering only at the
final frame where the sheet's geometry already equals the destination rectangle. Closing is
symmetric: its first frame has the sheet flat over the viewport showing the page, so clipping
the DOM shut at that instant is equally invisible.

This revision also adds a content requirement. The reverse face can only communicate the page if
the page has content at both ends, so detail pages now carry body sections and a bottom-pinned
footer.

Nothing in the scope, architecture, accessibility, resilience, or fallback sections changed.

### 2026-08-28 — reverse face prints the destination page

The original wording asked only for "a visible reverse face," which the first implementation
satisfied with a warm paper white. Review of the running prototype showed that this reads as a
blank grey wipe: the sheet turns over to reveal nothing, so the destination page still appears
to pop in at the end rather than arriving on the sheet.

The clarified model is that the sheet is a single physical page printed on both sides. The
front is the source card and the reverse is the destination page. At rest the reverse is the
page mirrored and shrunk onto the tile; at the end of the turn the front is the tile mirrored
and stretched across the page. Because both faces stretch to the sheet's current rect, the
reverse needs only its own UV set — the reflection of each vertex UV across the fold axis —
rather than separate geometry, and that reflection is fixed for a given grabbed corner.

The coordinator now captures the destination alongside the source. If that capture fails the
reverse falls back to the previous paper white, so the failure degrades the finish rather than
aborting the transition.

### 2026-08-28 — corner-exchange geometry clarified

The original wording said the tucked corner "finishes at the grabbed corner's original
position." That admitted two readings. The first implementation took it literally, built the
end quad by swapping corner coordinates in pixel space, and interpolated toward it. Because a
rectangle's pixel-space diagonal is not a symmetry axis unless the rectangle is square, that
end quad is self-intersecting: the sheet appeared to stall at the halfway point and then
popped to the finished page.

The intended reading — confirmed on review of the running prototype — is the page-space one:
one coherent rotation of a sheet that grows into the destination, with the corners exchanging
positions *in the destination frame*. This revision states that explicitly and rules out the
pixel-space construction.

The same review surfaced three further requirements now recorded above: the reveal must be
bounded by the sheet rather than wiping the viewport (superseded by the 2026-08-29 revision,
which makes the sheet perform the reveal outright), the contact shadow must be
gated on how far the sheet is lifted, and the sheet must keep a curved cross-section at peak
curl instead of collapsing edge-on. A capture-fidelity requirement was added after the source
texture was found to be losing card text.

Nothing in the scope, architecture, accessibility, resilience, or fallback sections changed.
