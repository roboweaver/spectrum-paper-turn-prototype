# Spectrum Paper-Turn Transition Prototype

**Status:** Approved
**Date:** 2026-08-27

## Purpose

This prototype will demonstrate whether a Spectrum-style card can animate into a full-viewport detail surface as a realistic diagonal sheet-of-paper turn. It is an interaction and rendering proof of concept, not a replacement for Spectrum components or application navigation.

The prototype succeeds only if the transition reads as one continuous paper sheet changing shape while the underlying detail page is progressively revealed. The settled list and detail states must remain normal, accessible Spectrum Web Components DOM rather than WebGL-rendered application UI.

## Scope

The prototype covers:

- Opening a detail surface from a card with mouse, touch, or keyboard activation.
- Reversing the same transition to close the detail surface.
- A configurable grabbed corner, with geometry generalized to all four corners.
- A lightweight WebGL paper mesh used only during the transition.
- An accessible DOM fallback when full motion is unavailable or inappropriate.
- Focus, scroll, interruption, resize, failure recovery, and reduced-motion behavior.

The prototype does not define production navigation, data loading, deep linking, browser history, shared-element transitions beyond the card-to-detail interaction, or a general-purpose page-curl library.

## Experience and Interaction Geometry

When a card is activated, its visual appearance becomes a temporary turning sheet above the destination detail DOM.

The transition is defined by two diagonally opposite corners:

- The **grabbed corner** begins at the configured source-card corner, curls across the sheet, and finishes at the diagonally opposite corner of the full-viewport destination.
- The **original opposite corner** tucks underneath the fold and finishes at the grabbed corner's original source-card position.
- At the end of the turn, those diagonal corners have visibly exchanged positions.

This corner exchange is a required geometric property, not an incidental visual effect. The renderer must derive orientation, fold direction, and corner trajectories from the configured grabbed corner rather than hard-coding top-right behavior.

The stationary full-page detail DOM is placed beneath the turning sheet before animation begins. As the fold advances, the destination is progressively exposed along the moving diagonal fold. The reveal must track the fold rather than appearing as an unrelated cross-fade or rectangular wipe.

To read as paper, the turning surface includes:

- Curved side edges produced by mesh deformation.
- A visible reverse face while the sheet curls.
- Highlights and shadows that change with bend and orientation.
- A contact or cast shadow near the fold and underlying page.
- Sufficient depth and non-linear deformation to avoid looking like a rigid rotating card.

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
- The configured grabbed corner.
- Normalized progress from `0` to `1`.
- Texture and motion parameters supplied by `MotionProfile`.

It maps a capture of the source card onto a modest subdivided mesh and computes the sheet deformation, moving diagonal fold, corner exchange, curved boundaries, front and reverse faces, changing illumination, cast shadow, and destination reveal mask. The renderer is short-lived: it is created for a transition and disposed when the transition settles or falls back.

### `MotionProfile`

`MotionProfile` centralizes tunable behavior rather than scattering visual constants across coordinator and renderer code. It defines:

- Full-motion and fallback durations and easing.
- Bend depth, fold softness, edge curvature, and shadow strength.
- Mesh density and texture size/DPR limits.
- Reduced-motion behavior.

The initial full-motion target is approximately 650-800 ms, long enough for the diagonal exchange and reverse face to be legible without making navigation feel stalled. The fallback target is 180-220 ms.

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
- Opening/closing timeline symmetry and corner-path reversal.
- Generalized corner selection and diagonal corner exchange.
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
- Diagonal midpoint: the destination is revealed along the moving fold and the corner exchange is legible.
- Settled page: no overlay remains and the detail surface is ordinary Spectrum DOM.

## Success Criteria

The prototype is successful when all of the following are true:

- The grabbed corner and its diagonal opposite visibly exchange positions.
- Full-page content is progressively revealed beneath the moving diagonal fold.
- Curvature, reverse-face treatment, deformation, highlights, and shadows create a plausible paper-like turn.
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
