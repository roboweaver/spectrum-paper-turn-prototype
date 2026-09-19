# Implementation Plan: Position-Based Grab Anchor

## Overview

The work lands in dependency order: shared types first, then the two independent
computational cores — the new pure resolution module `grab-anchor.ts` and the widened
`geometry.ts` — then the three DOM-owning modules that consume them, then the browser and
visual suites, then the two governing documents.

Language is TypeScript throughout, matching the existing codebase and the design's stated
notation. No new runtime or development dependency is added: the design's correctness
properties P1–P14 are established by exhaustive enumeration over the 8 anchors and the 64
grid shapes with `rowCount, columnCount ∈ [1, 8]`, with a seeded LCG helper used only for
the arbitrary-aspect-ratio property **P6**. `fast-check` is deliberately not introduced.

Two renames ripple across four test suites and are mechanical: `cornerUv`/`oppositeCorner`/
`cornerPoint` become `anchorUv`/`oppositeAnchor`/`anchorPoint`, and the public
`grabbedCorner` field becomes `grabAnchor`. `Corner` itself is retained as a four-value
type for genuine rectangle corners, so the reveal polygon's winding-order list cannot grow
to eight members and the existing four-corner literals in the test suites keep compiling.

## Tasks

- [x] 1. Widen the shared type vocabulary
  - [x] 1.1 Add the anchor, fold-axis, and grid-position types to `src/transition/types.ts`
    - Add `EdgeMidpoint = 'top-center' | 'middle-right' | 'bottom-center' | 'middle-left'`
      and `GrabAnchor = Corner | EdgeMidpoint`, leaving `Corner` a four-value union that
      admits no edge midpoint
    - Add `FoldAxisKind = 'diagonal' | 'midline'` and `FoldAxis { kind; origin; far }`
      with both endpoints in unit-square coordinates
    - Add `GridPosition { rowIndex; rowCount; columnIndex; columnCount }`,
      `RowBand = 'top' | 'middle' | 'bottom'`, and
      `ColumnBand = 'left' | 'center' | 'right'`
    - Document on `GridPosition` that indices are 0-based, ordered top to bottom and left
      to right, and that counts are integers of at least `1`
    - Additive only: no existing declaration changes in this sub-task, so the project keeps
      compiling
    - _Requirements: 1.1, 1.7, 9.1_

  - [x] 1.2 Rename the public anchor field to `grabAnchor` and widen it to `GrabAnchor`
    - Rename `grabbedCorner` → `grabAnchor` on `TransitionOpenRequest` and `RendererInput`
      in `src/transition/types.ts`, typed `GrabAnchor` rather than `Corner`
    - Update the reading call sites in `src/transition/transition-coordinator.ts`
      (`closedClipForCorner(request.grabbedCorner)` in `open()` and `settleIdle()`, and the
      `createRenderer` input), `src/transition/paper-turn-renderer.ts` (`backFaceUvs` and
      `buildPaperFrame` arguments), and `src/main.ts` (the `coordinator.open` literal)
    - Update the field name in `tests/unit/transition-coordinator.test.ts` and
      `tests/unit/paper-turn-renderer.test.ts`
    - Leave `resolveGrabbedCorner()` in place for now — it still returns a `Corner`, which
      is assignable to `GrabAnchor`, so `npm run typecheck` stays green until task 10.1
      deletes it
    - _Requirements: 8.5_

- [x] 2. Build the live grid resolution module
  - [x] 2.1 Create `src/transition/grab-anchor.ts` with the tolerance constant and `clusterAxis`
    - Export `GRID_CLUSTER_TOLERANCE_PX = 2` and `SINGLE_TILE_ANCHOR: GrabAnchor = 'bottom-right'`,
      with a comment recording that the tolerance is a measurement artifact and therefore
      deliberately not a `MotionProfile` field
    - Implement `clusterAxis(values, tolerance)` per the design's algorithm: sort indices by
      value ascending, compare each candidate against the **smallest** value of the cluster
      under construction, and open a new cluster only when the difference is strictly
      greater than the tolerance
    - Comparing against the cluster's first value rather than the previous value is
      load-bearing: chaining off the previous value lets a run of tiles each drifting by
      `tolerance` merge into one cluster
    - Return `{ clusterIndex, clusterCount }` with cluster `0` holding the smallest value,
      every index in `[0, clusterCount)`, and `clusterCount >= 1`
    - Reject a non-finite or negative tolerance; default to `GRID_CLUSTER_TOLERANCE_PX`
      when the argument is omitted
    - Exactly one sort per call, no module state, no DOM reference, no clock read
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.10, 16.4_

  - [x] 2.2 Add `gridPositionFromRects` to `src/transition/grab-anchor.ts`
    - Filter to visible tiles — `width > 0`, `height > 0`, finite `top`, finite `left` — so
      collapsed tiles invent no phantom rows or columns
    - Return the single-tile position `{ rowIndex: 0, rowCount: 1, columnIndex: 0, columnCount: 1 }`
      when the target index is absent from the visible set, including an empty rect list and
      a negative, non-integer, or out-of-range index
    - Cluster the visible `top` values for `rowIndex`/`rowCount` and the visible `left`
      values for `columnIndex`/`columnCount`, reading no other rect member, and take the
      target's position among the retained tiles
    - Total: never throws, and always returns a position satisfying every `GridPosition`
      validation rule
    - _Requirements: 5.3, 5.4, 5.5, 6.2, 6.7_

  - [x] 2.3 Add band classification, `anchorForGridPosition`, and `resolveGrabAnchor`
    - Implement module-private `rowBand` (test `top` before `bottom`, so `rowCount === 1`
      classifies index `0` as `top`) and `columnBand` (a `center` band exists only for an odd
      `columnCount`; an even count assigns `index < columnCount / 2` to `left` and the rest
      to `right`)
    - Implement `anchorForGridPosition`: well-formedness check first, collapsing any
      non-finite, non-integer, negative, or out-of-range member to `SINGLE_TILE_ANCHOR`;
      then the degenerate rules (`1 × 1` → `bottom-right`; single column →
      `top-right` / `top-center` / `bottom-right`; single row → `bottom-left` /
      `middle-left` / `bottom-right`); then the band table
    - Band table: `top` row → `top-left` / `top-center` / `top-right`; `middle` row →
      `middle-left` / `top-center` / `middle-right`; `bottom` row → `bottom-left` /
      `bottom-center` / `bottom-right`. The fully centered tile grabbing `top-center` is the
      one intentional break in vertical-mirror symmetry
    - Implement `resolveGrabAnchor(tileRects, targetIndex, tolerance?)` as
      `anchorForGridPosition(gridPositionFromRects(...))`
    - Total by construction, pure, and mutating none of its arguments
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.1, 5.2, 5.7_

  - [x] 2.4 Write the resolution-table property test in `tests/unit/grab-anchor.test.ts`
    - **Property 8: Resolution agrees with the table**
    - Enumerate all 64 grid shapes with `rowCount, columnCount ∈ [1, 8]` and every cell of
      every shape — 1,296 shape-and-cell combinations — with no randomized sampling
    - Compare against an independently written expected-anchor table in the test, covering
      the non-degenerate band table, the even-column tie-break, and all three degenerate rows
    - On failure, report the grab anchor and the grid shape as supplied, so the case is
      reproducible from the report alone
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 16.7, 16.9**
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 16.7, 16.9_
    - _Properties: P8_

  - [x] 2.5 Write the totality property test in `tests/unit/grab-anchor.test.ts`
    - **Property 7: Resolution is total**
    - Sweep `NaN`, `±Infinity`, non-integer, negative, and out-of-range members across all
      four `GridPosition` fields and assert one of the eight anchors is returned, never a
      throw and never `null`/`undefined`
    - Assert malformed positions and unmeasurable target rects collapse specifically to
      `bottom-right`, and that `gridPositionFromRects` returns the single-tile position for an
      empty list, an out-of-range index, and a zero-area or non-finite target rect
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
    - _Properties: P7_

  - [x] 2.6 Write the mirror-symmetry property test in `tests/unit/grab-anchor.test.ts`
    - **Property 9: Mirror symmetry, with stated exceptions**
    - Over every non-degenerate shape and cell, assert the column reflection
      `c → columnCount − 1 − c` maps the resolved anchor by the horizontal mirror, and the
      row reflection maps it by the vertical mirror
    - Assert the two documented exemptions explicitly: the fully centered tile always grabs
      `top-center`, and the degenerate single-row/single-column shapes are exempt because
      their constants bias toward right/bottom
    - Assert the transpose relation between the degenerate families —
      `top-right → bottom-left`, `top-center → middle-left`, `bottom-right → bottom-right`
    - **Validates: Requirements 2.6, 2.7, 2.8, 4.9**
    - _Requirements: 2.6, 2.7, 2.8, 4.9_
    - _Properties: P9_

  - [x] 2.7 Write the clustering property test in `tests/unit/grab-anchor.test.ts`
    - **Property 10: Clustering recovers the grid**
    - Synthesize `R × C` rect grids for `R, C ∈ [1, 8]` with per-tile jitter strictly below
      the tolerance and row/column separation above it, and assert `rowCount === R`,
      `columnCount === C`, and each tile's authored indices
    - Assert stability under uniform translation and under uniform positive scaling of the
      whole grid, which is the responsive-layout invariant
    - Assert zero-width, zero-height, and non-finite tiles are excluded from clustering and
      contribute no rows or columns
    - **Validates: Requirements 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9**
    - _Requirements: 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
    - _Properties: P10_

  - [x] 2.8 Write the clustering edge-case unit tests in `tests/unit/grab-anchor.test.ts`
    - Tolerance boundary: values `0`, `2`, `4` at tolerance `2` form exactly two clusters,
      not one merged cluster
    - No-drift chaining: a long run of values each `2` apart does not collapse into a single
      cluster
    - `GRID_CLUSTER_TOLERANCE_PX === 2` is applied when no tolerance argument is supplied,
      and a non-finite or negative tolerance is rejected
    - Purity: repeated invocations with equal inputs return equal anchors, and the supplied
      rect array and its members are unmutated
    - _Requirements: 5.7, 6.3, 6.10, 16.4_

- [x] 3. Checkpoint - resolution module complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Generalize the anchor tables and fold-axis selection in `src/transition/geometry.ts`
  - [x] 4.1 Rename and widen the anchor tables to eight anchors
    - `cornerUv` → `anchorUv: Record<GrabAnchor, Point>` with the four corners plus
      `top-center (0.5, 0)`, `middle-right (1, 0.5)`, `bottom-center (0.5, 1)`,
      `middle-left (0, 0.5)`; every component exactly `0`, `0.5`, or `1`, and `(0.5, 0.5)`
      assigned to no anchor
    - `oppositeCorner` → `oppositeAnchor(anchor: GrabAnchor): GrabAnchor` as the point
      reflection through `(0.5, 0.5)`, pairing corners with corners and edge midpoints with
      edge midpoints
    - `cornerPoint` → `anchorPoint(rect: Rect, anchor: GrabAnchor): Point`
    - Keep `orderedCorners()` and `orderedCornerKeys` typed over `readonly Corner[]` so the
      reveal polygon's winding list stays four members
    - Throw naming the offending value when a non-member is supplied where a `GrabAnchor` is
      required
    - Update the import list and identifiers in `tests/unit/geometry.test.ts` to the new
      names, leaving assertions unchanged in this sub-task
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 4.2 Add the module-private `FOLD_AXIS` table and generalize `foldBasis`
    - Add `const FOLD_AXIS: Record<GrabAnchor, FoldAxis>`: main diagonal `(0,0)–(1,1)` for
      `top-right`/`bottom-left`, anti-diagonal `(0,1)–(1,0)` for `top-left`/`bottom-right`,
      horizontal midline `(0,0.5)–(1,0.5)` for `top-center`/`bottom-center`, vertical
      midline `(0.5,0)–(0.5,1)` for `middle-left`/`middle-right`
    - Change `foldBasis(grabbed: GrabAnchor): FoldBasis` to read `origin`/`far` from the
      table instead of computing them from the grabbed corner's uv; keep the existing
      normal auto-orientation (`dot(candidate, toGrabbed) >= 0`), which is what lets an
      opposite pair share one table entry with opposite normals
    - Leave `axisLength` and `maxPerp` derived as today: `√2` and `1/√2` fall out for the
      diagonal family, `1` and `0.5` for the midline family
    - Freeze the table and keep the module pure — no new state beyond it
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.13, 9.14, 9.15_

  - [x] 4.3 Write the opposite/fold-axis property test in `tests/unit/geometry.test.ts`
    - **Property 13: Opposite is an involution and family-preserving**
    - Over all eight anchors: `oppositeAnchor(oppositeAnchor(a)) === a`, corners map to
      corners and edge midpoints to edge midpoints, `anchorUv[opposite(a)] === (1 − x, 1 − y)`
    - Assert an anchor and its opposite resolve the same fold-axis kind and identical
      endpoint coordinates, and that their fold-basis normals are exact negations within
      `1e-6` per component
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
    - _Properties: P13_

  - [x] 4.4 Write the fold-basis postcondition unit tests in `tests/unit/geometry.test.ts`
    - For all eight anchors: `|axis| = |normal| = 1` and `axis · normal = 0` within `1e-6`,
      `origin` on the fold line, `axisLength` of `√2` (diagonal) or `1` (midline), `maxPerp`
      of `1/√2` (diagonal) or `0.5` (midline), and the normal oriented toward the grab
      anchor so `normal · (grabUv − origin) === maxPerp`
    - Assert the induced reflection `p ↦ p − 2·((p − origin)·normal)·normal` agrees with each
      anchor's closed form from the design's anchor table within `1e-6`
    - Endpoint-swap invariance: swapping `origin` and `far` for one anchor leaves every
      vertex position at every progress in `[0, 1]` equal within `1e-4` CSS pixels
    - Determinism: repeated calls return component-for-component equal values and mutate
      nothing
    - _Requirements: 9.7, 9.8, 9.9, 9.13, 9.14, 9.15_

  - [x] 4.5 Add even-mesh validation to `validateProfile` and `vertexIndex`
    - Extend `validateProfile()` with an unconditional rule that `meshColumns` and
      `meshRows` are both even integers of at least `2`, alongside the existing
      positive-integer checks, throwing synchronously and naming each odd field — both when
      both are odd. The rule is unconditional because any of the eight anchors may be
      resolved at runtime
    - Widen `vertexIndex(anchor: GrabAnchor, columns, rows)` and add the half-step rejection:
      when `uv.x * columns` or `uv.y * rows` is not an integer, throw naming the anchor and
      the offending dimension; corner anchors stay valid at any positive integer dimensions
    - Keep `validateProfile()` running in `buildPaperFrame()` before any vertex is computed,
      so a throw leaves the profile and both rects unmutated and writes no position or shade
      entry
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.9, 12.10, 12.11_

  - [x] 4.6 Write the even-mesh validation property test in `tests/unit/geometry.test.ts`
    - **Property 14: Even-mesh validation fails loudly**
    - Sweep odd `meshColumns`, odd `meshRows`, and both odd, asserting the throw names each
      odd field; keep the existing zero/non-integer/non-finite profile cases passing
    - Enumerate all eight anchors against even dimensions and assert an integer index within
      `[0, (columns + 1) · (rows + 1))`; enumerate the four edge midpoints against odd
      dimensions and assert a throw naming the anchor and the dimension; assert the four
      corners succeed at odd dimensions
    - Assert `vertexIndex` throws naming the dimension for a non-integer or `< 1` column or
      row count
    - **Validates: Requirements 12.1, 12.2, 12.5, 12.6, 12.7, 12.9, 12.10**
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.9, 12.10_
    - _Properties: P14_

  - [x] 4.7 Generalize `backFaceUvs` to eight anchors
    - Widen the signature to `backFaceUvs(grabbed: GrabAnchor, columns, rows)`; the body
      already consumes only the fold basis, so the reflection generalizes with the table
    - Keep evenness out of the preconditions — the reflection is defined at every vertex
      regardless of whether the anchor itself is sampled — while still rejecting a
      non-integer or `< 1` dimension by name with no partial data returned
    - Confirm the output stays `(columns + 1) · (rows + 1) · 2` finite entries within
      `[0, 1]`, in front-face vertex order, and is its own inverse
    - _Requirements: 10.1, 10.2, 10.5, 10.7, 10.8, 10.9_
    - _Properties: P1_

  - [x] 4.8 Rework the back-face uv tests for eight anchors in `tests/unit/geometry.test.ts`
    - **Property 1: Destination-frame reflection (uv form)**
    - Replace the existing back-face `holds the fold-axis corners still for %s` assertion,
      which is a corner-fold-only claim: under a `top-center` fold the `top-left` uv maps to
      `bottom-left`, not to itself. The fold-axis *endpoints* for a midline anchor are edge
      midpoints, so assert those hold still instead
    - Add the closed-form checks `(u, v) → (u, 1 − v)` for `top-center`/`bottom-center` and
      `(u, v) → (1 − u, v)` for `middle-left`/`middle-right`, each within `1e-6`
    - Assert double application is the identity within `1e-6`, and extend the unit-square
      containment and size assertions to all eight anchors
    - **Validates: Requirements 10.1, 10.2, 10.7, 10.8, 10.9**
    - _Requirements: 10.1, 10.2, 10.7, 10.8, 10.9_
    - _Properties: P1_

- [x] 5. Checkpoint - anchor tables and fold axes complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Make the deformation and reveal sweep basis-driven
  - [x] 6.1 Widen `buildPaperFrame` to `GrabAnchor` and keep the deformation body basis-only
    - Change the `grabbed` parameter type to `GrabAnchor`; the per-vertex loop consumes only
      the fold basis, so no deformation term may read the fold-axis kind
    - Verify `acrossFold = perp / maxPerp ∈ [−1, 1]` and `along / axisLength ∈ [0, 1]` hold
      for the midline family as they do for the diagonal family, and that no branch depends
      on `sign(acrossFold)` — the `sin(π/2 · acrossFold)` form stays as written
    - Leave `PERSPECTIVE_STRENGTH`, `FACING_FLOOR`, `ARC_BULGE`, every `MotionProfile` value,
      `lerpRect`, `easedProgress`, and `revealProgress` untouched, so `baseRect` stays
      anchor-independent and the sheet footprint stays a growing rectangle
    - _Requirements: 9.10, 9.11, 9.12, 11.9, 11.10, 11.11, 11.12, 11.13, 15.5, 15.6_

  - [x] 6.2 Add `frontDistance` and rebuild the reveal sweep on it
    - Add module-private `frontDistance(basis, u, v) = (maxPerp − perp) / maxPerp`, which is
      `0` at the grab anchor, `1` on the fold axis, `2` at the pivot anchor, and constant
      along every line parallel to the fold
    - Replace the L1 metric `|u − gx| + |v − gy|` in `clipViewport()` with `frontDistance`,
      keeping the `threshold = progress * 2` comparison and the adjacent-corner crossing
      interpolation (whose denominator is non-zero exactly because the two corners differ in
      `frontDistance`)
    - Widen `clipViewport`, `clipPathBetween`, and `revealClipPath` to `GrabAnchor`, and
      clamp a non-finite or out-of-range progress into `[0, 1]` rather than throwing
    - This restatement must land before any test exercises `revealClipPath` at intermediate
      progress for an edge-midpoint anchor: the old L1 metric emits `polygon()` with no
      points for `top-center` at any `0 < progress < 0.25`, which is invalid CSS
    - For every corner anchor the new metric is algebraically identical to the old L1
      expression, so corner reveal output is unchanged
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.13, 15.1_

  - [x] 6.3 Write the reveal sweep property test in `tests/unit/geometry.test.ts`
    - **Property 12: Reveal sweep is total and monotone**
    - For all eight anchors and a dense progress sweep in `(0, 1]`: between `3` and `5`
      finite points, including edge-midpoint anchors at progress inside `(0, 0.25)` where no
      rect corner is inside the front
    - Assert non-decreasing covered area with containment of the earlier region, exactly the
      four rect corners at progress `1`, three coincident points at the grab anchor at
      progress `0`, and the `top-center` band reaching `progress · height` down from the top
      edge
    - Assert a non-finite or out-of-range progress clamps into `[0, 1]` without throwing
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10**
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_
    - _Properties: P12_

  - [x] 6.4 Replace the "fold axis corners stay put" test with the reflection property in `tests/unit/geometry.test.ts`
    - **Property 1: Destination-frame reflection**
    - **Delete** the existing `holds the fold axis corners still for %s` test in the
      `paper geometry` describe block. It is FALSE for a midline fold — under a `top-center`
      fold the `top-left` vertex lands on `bottom-left`, not on itself — so it must be
      REPLACED by this property, not extended to eight anchors
    - Over all eight anchors and every mesh vertex: at `progress = 1` the vertex lands at
      `reflect_anchor(u, v)` mapped into the destination rect, within `1e-6` CSS pixels per
      component. This single property subsumes anchor exchange, fold-axis points held still,
      and the deleted "other corners stay put" claim
    - Include the corner case that the reflection is the unit-square reflection mapped
      through a non-square destination rect, which is a position other than the pixel-space
      mirror about that rect's diagonal
    - **Validates: Requirements 10.5, 10.6, 11.1**
    - _Requirements: 10.5, 10.6, 11.1_
    - _Properties: P1_

  - [x] 6.5 Write the anchor-exchange property test in `tests/unit/geometry.test.ts`
    - **Property 2: Anchor exchange**
    - Over all eight anchors at `progress = 1`: the vertex at the grab anchor lands on
      `anchorPoint(destination, oppositeAnchor(a))` and the vertex at the pivot lands on
      `anchorPoint(destination, a)`, within `1e-6` CSS pixels per component
    - Use an even mesh so the edge-midpoint vertices are addressable, and generalize the
      existing `exchanges diagonal positions within the destination` test to all eight
    - **Validates: Requirements 1.3, 1.6, 11.2**
    - _Requirements: 1.3, 1.6, 11.2_
    - _Properties: P2_

  - [x] 6.6 Write the stationary-fold-axis property test in `tests/unit/geometry.test.ts`
    - **Property 3: Fold axis stationary in the growing frame**
    - Over all eight anchors and a progress sweep in `[0, 1]`: the two fold-axis endpoint
      vertices sit at their corresponding `anchorPoint(lerpRect(source, destination, eased), …)`
      with `z = 0`, within `1e-6` CSS pixels in `x`, `y`, and `z`
    - Note in the test that midline endpoints are edge midpoints, which is why the mesh
      dimensions must be even for this property to be sampled at all
    - **Validates: Requirements 11.3, 12.5**
    - _Requirements: 11.3, 12.5_
    - _Properties: P3_

  - [x] 6.7 Write the endpoint flatness property test in `tests/unit/geometry.test.ts`
    - **Property 4: Flatness and exactness at both endpoints**
    - Over all eight anchors: at `progress = 0` every vertex lies on the source rect with
      `z = 0`, at `progress = 1` every vertex lies on the destination rect with `z = 0`,
      within `1e-6`
    - Assert `lift = sin(π · eased)` — exactly `0` at both endpoints, `1` at the midpoint —
      `alpha === 1` throughout, and reveal progress exactly `0` below `eased = 1` and exactly
      `1` at it
    - **Validates: Requirements 11.4, 11.5, 15.1**
    - _Requirements: 11.4, 11.5, 15.1_
    - _Properties: P4_

  - [x] 6.8 Write the fold-axis continuity property test in `tests/unit/geometry.test.ts`
    - **Property 5: Continuity across the fold axis**
    - Over all eight anchors and a progress sweep: bound the maximum position delta between
      mesh-adjacent vertices straddling `perp = 0` against the maximum delta among adjacent
      vertices on the same side of the axis, establishing `C / min(meshColumns, meshRows)`
      for a constant independent of progress, anchor, and mesh position
    - Assert `acrossFold ∈ [−1, 1]` and `along / axisLength ∈ [0, 1]` for every vertex
      written, allowing `1e-9` of floating-point slack
    - **Validates: Requirements 11.6, 11.7, 11.8, 15.6**
    - _Requirements: 11.6, 11.7, 11.8, 15.6_
    - _Properties: P5_

  - [x] 6.9 Create `tests/unit/geometry.aspect.test.ts` for the aspect-ratio sweep
    - **Property 6: Midline reflection is exact at arbitrary aspect ratios**
    - Add a small seeded LCG helper local to the suite — fixed seed, fixed iteration count of
      at least `200` rect pairs, widths and heights independently sampled from `[1, 4096]`
      CSS pixels — so a repeated run evaluates the identical sequence. No generator library
    - For `top-center`/`bottom-center` at `progress = 1`, assert every vertex is within
      `1e-6` CSS pixels of its mirror about the destination rect's horizontal centerline;
      for `middle-left`/`middle-right`, about the vertical centerline
    - Assert corner anchors are deliberately exempt in pixel space — that is the bowtie the
      contract rules out — and report the failing anchor and rect pair on failure
    - **Validates: Requirements 10.3, 10.4, 16.8, 16.9**
    - _Requirements: 10.3, 10.4, 16.8, 16.9_
    - _Properties: P6_

  - [x] 6.10 Write the corner-parity and bulge-parity tests in `tests/unit/geometry.test.ts`
    - Capture pre-feature corner output as golden values and assert every corner anchor's
      vertex positions agree within `1e-4` CSS pixels across a progress sweep, and that the
      corner reveal polygon's point count and coordinates agree within `1e-6`
    - Metamorphic bulge check: at the eased midpoint, peak perpendicular displacement divided
      by `maxPerp` is equal for a midline fold and a diagonal fold within floating-point
      tolerance, so `ARC_BULGE` needs no retuning
    - Keep the existing peak-curl, spread, growth, opacity, easing-clamp, and rect-validation
      tests passing unchanged
    - _Requirements: 9.9, 9.12, 13.6, 15.5_

- [x] 7. Checkpoint - geometry complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Make the coordinator's closed clip table-driven
  - [x] 8.1 Replace `closedClipForCorner` with `closedClipForAnchor` in `src/transition/transition-coordinator.ts`
    - Delete the four-arm `switch` and derive the degenerate three-point `polygon()` from
      `anchorUv[anchor]` scaled to percentages — `50% 0%` for `top-center`, `0% 50%` for
      `middle-left`, and so on — so it is total over the eight anchors by construction
    - Keep both call sites (`open()`'s `preparing` clip and `settleIdle()`) reading the single
      retained `request.grabAnchor`; the coordinator never resolves an anchor itself
    - Leave the state set, transitions, cleanup steps, and fallback paths unchanged
    - _Requirements: 7.6, 13.11, 15.13_

  - [x] 8.2 Write the closed-clip agreement property test in `tests/unit/transition-coordinator.test.ts`
    - **Property 11: Closed clip agrees with the first frame**
    - For all eight anchors: `closedClipForAnchor(a)` equals `revealClipPath(destination, a, 0)`,
      with the three points coinciding within `1e-6` CSS pixels when resolved against the
      destination rect
    - Assert the frame's reveal clip is three coincident points at the grab anchor on the base
      rect below progress `1` and the four destination corners at progress `1`
    - **Validates: Requirements 13.11, 13.12, 13.13**
    - _Requirements: 13.11, 13.12, 13.13_
    - _Properties: P11_

  - [x] 8.3 Extend the coordinator unit tests in `tests/unit/transition-coordinator.test.ts`
    - Assert the open request's `grabAnchor` is passed through to `createRenderer` unchanged
      and reused for the settle-to-idle clip, with no resolver invocation from the coordinator
    - Assert a `validateProfile` throw during renderer construction disposes every resource
      allocated for that activation, completes through the existing full-motion fallback
      without rethrowing to the activation path, and leaves no hidden card and no orphaned
      overlay
    - Assert the viewport-change path settles using the anchor resolved at activation without
      re-measuring or re-resolving, and that the reduced-motion and fallback paths read no
      anchor
    - _Requirements: 7.6, 7.7, 8.5, 12.4, 15.10, 15.11, 15.13_

- [x] 9. Renderer validation, diagnostics, and profile documentation
  - [x] 9.1 Validate first and publish the anchor in `src/transition/paper-turn-renderer.ts`
    - Run `validateProfile()` at the top of the constructor, before allocating any mesh,
      texture, or overlay resource, so an odd mesh dimension fails into the existing
      full-motion fallback rather than mid-animation
    - Compute `backFaceUvs(input.grabAnchor, …)` exactly once at construction and pass
      `input.grabAnchor` to `buildPaperFrame` per frame
    - Set `overlay.dataset.grabAnchor` to the resolved anchor when the overlay is created,
      before the first animation frame, alongside the existing `data-mesh-vertices` and
      `data-progress`; keep it constant as progress advances and on viewport change
    - Publish through the overlay dataset only — no debug-panel UI, no second element or
      attribute — and publish nothing when the fallback path creates no overlay
    - Leave mesh density, texture DPR handling, pixel caps, shadow lift gating, and back
      texture mix untouched
    - _Requirements: 10.10, 12.3, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 15.4, 15.7, 16.5_

  - [x] 9.2 Extend `tests/unit/paper-turn-renderer.test.ts`
    - Assert `backFaceUvs` is called exactly once with the resolved anchor for the lifetime of
      the instance, and that `buildPaperFrame` receives the same anchor each frame
    - Assert `overlay.dataset.grabAnchor` is one of the eight literals with no surrounding
      whitespace, is set before the first frame, is unchanged as progress advances, and is
      the only DOM carrier of the anchor
    - Assert `bottom-right` is published when the anchor collapsed to the single-tile value
    - Assert construction throws before allocating resources for an odd `meshColumns` or
      `meshRows`, and that the mobile mesh budget of `315` vertices and the twice-viewport
      canvas cap still hold
    - _Requirements: 5.8, 10.10, 12.3, 14.1, 14.2, 14.3, 14.5, 14.6, 15.12, 16.5_

  - [x] 9.3 Document the even-mesh constraint in `src/transition/motion-profile.ts`
    - Add doc comments on `meshColumns` and `meshRows` recording that both are constrained to
      even numbers because an edge-midpoint anchor's `uv` component of `0.5` only lands on a
      real mesh vertex when the corresponding dimension is even, enforced by `validateProfile()`
    - Values stay `20 × 14` — both already even — and no other profile field changes
    - _Requirements: 12.8, 16.5_

  - [x] 9.4 Assert the shipped mesh is even in `tests/unit/motion-profile.test.ts`
    - Assert `meshColumns === 20`, `meshRows === 14`, both even, and that
      `defaultMotionProfile` passes `validateProfile()` without throwing, so a future tuning
      change trips a named test rather than a runtime throw
    - _Requirements: 12.8, 16.5_

- [x] 10. Resolve the anchor at activation in `src/main.ts`
  - [x] 10.1 Measure tiles and resolve the anchor on the activation path
    - Add `measureTiles(root): { triggers: HTMLElement[]; rects: Rect[] }`, reading each
      `[data-card-trigger]` element's bounding rect exactly once in document order
    - In the click handler, call `resolveGrabAnchor(rects, triggers.indexOf(trigger))` and
      pass the result as `grabAnchor` on the single `coordinator.open` request, completing
      measurement and resolution synchronously before the first animation frame
    - Delete `DEFAULT_CORNER`, `resolveGrabbedCorner()`, the `data-grabbed-corner` attribute
      contract, and the now-unused `Corner` import — outright deletion, not deprecation, and
      re-exported under no other name
    - Leave no attribute, configuration value, or runtime parameter able to override the
      resolved anchor; perform no further measurement pass while the transition runs
    - _Requirements: 6.1, 7.1, 7.2, 7.5, 8.1, 8.4, 8.6, 8.7, 16.1, 16.2, 16.3_

  - [x] 10.2 Add viewport-driven anchor assertions to `tests/e2e/interaction.spec.ts`
    - At desktop width, assert `overlay.dataset.grabAnchor` for the first tile is the
      `top-left`-family anchor its measured position implies, and that a middle-row edge tile
      resolves `middle-left`/`middle-right`
    - At the mobile breakpoint where the grid collapses to a single column, assert the first,
      an interior, and the last tile resolve `top-right`, `top-center`, and `bottom-right`
    - Assert an authored `data-grabbed-corner` value is inert: sweeping all eight anchor names
      plus an empty and an unrecognized string leaves the published anchor unchanged, with no
      error and no warning attributable to the attribute
    - Read the dataset attribute rather than pixels; leave the existing Escape, resize,
      successive-card, inertness, focus, reduced-motion, and mesh-budget tests unchanged
    - _Requirements: 7.3, 7.4, 7.8, 7.9, 7.10, 8.2, 8.3, 14.4_

- [x] 11. Visual baselines for the midline fold
  - [x] 11.1 Add the two midline checkpoints to `tests/e2e/visual.spec.ts`
    - Add exactly two Chromium-desktop checkpoints for a `top-center` grab — one at peak curl
      and one at mid-turn — driving them through the same deterministic scrub the existing
      checkpoints use, and comparing at the suite's existing pixel tolerance
    - Keep the four existing corner checkpoints and their names unchanged, and keep the suite
      skipping outside Chromium-desktop on Darwin
    - _Requirements: 16.10_

  - [x] 11.2 Generate and review the new Darwin baselines
    - Generate the two new midline snapshots under
      `tests/e2e/visual.spec.ts-snapshots/` for `chromium-desktop-darwin`, and review them by
      eye rather than merely accepting them: a midline fold is the case the eye has never seen
    - Regenerate the corner baselines that the resolved anchor changes, and review each by eye
      as a coherent fold at the resolved anchor: tile 0 at the corner suite's 1280x900 viewport
      measures into a 1 x 3 grid and resolves `bottom-left`, where `main.ts` used to hardcode
      `top-right`, so `paper-turn-peak-curl` and `paper-turn-diagonal-midpoint` change while
      `paper-turn-start` and `paper-turn-settled` are confirmed byte-unchanged. Leave the
      checkpoint driving the production activation path; pin no anchor
    - The evidence that corner *geometry* is unchanged is the task 6.10 golden comparison plus
      the fixed-anchor frame comparison, not a baseline byte comparison
    - Delete the Linux corner baselines the anchor change invalidates; they can only be
      regenerated by the `update-visual-baselines` workflow on an ubuntu runner, and CI's
      "Require committed linux baselines" guard fails loudly with that instruction until the
      artifact is committed
    - _Requirements: 9.12, 16.10_

- [x] 12. Revise the governing documents
  - [x] 12.1 Update `docs/superpowers/specs/2026-08-27-spectrum-paper-turn-design.md`
    - **Scope**: a configurable grabbed corner becomes a grab anchor derived from the tile's
      live grid position, with geometry generalized to four corners and four edge midpoints
    - **Experience and Interaction Geometry**: generalize "two diagonally opposite corners" to
      an anchor and its geometric opposite, and record the midline family — exact in pixel
      space at any aspect ratio, while the diagonal case still needs normalized card space
    - **Success Criteria**: replace "the grabbed corner and its diagonal opposite visibly
      exchange positions" with the anchor-exchange property, since the literal wording is
      false for a midline fold
    - **Testing**: generalized corner selection becomes position-based anchor resolution and
      anchor exchange across all eight anchors
    - **Revision history**: add an entry recording the eight-anchor model, the two axis
      families, the accepted three-fold-behaviors-in-one-row consequence of a 5-column grid,
      and the removal of the authoring override
    - _Requirements: 8.1, 9.1, 11.2, 16.7_

  - [x] 12.2 Update `docs/architecture.md`
    - Module table: `geometry.ts` takes an anchor rather than a corner; add `grab-anchor.ts`
    - *The geometry model*: keep the normalized-card-space explanation for diagonals and add
      the midline family beside it, including why the midline case does not need the
      normalization and stays in the same space only to keep one deformation path
    - *Per-vertex deformation*: note that `maxPerp` and `axisLength` differ by axis family and
      that no tunable needs retuning as a result
    - *The sheet carries the reveal*: record the `frontDistance` restatement and the
      empty-polygon defect it removes
    - *Constants*: add `GRID_CLUSTER_TOLERANCE_PX` to the shape-of-the-model constants that
      deliberately stay out of `MotionProfile`
    - New short section on live grid resolution: clustering rather than parsing
      `grid-template-columns`, the even-mesh constraint on `meshColumns`/`meshRows`, and the
      `overlay.dataset.grabAnchor` diagnostic
    - *Test strategy*: replace corner exchange in destination space with the reflection
      property, and note the new midline visual baseline
    - _Requirements: 6.3, 12.8, 13.1, 14.1, 16.6, 16.10_

- [x] 13. Final verification
  - [x] 13.1 Run the full test suite
    - `npm run test:unit`, then `npm run test:e2e`, then `npm run test:visual`
    - Confirm the eight-anchor enumeration and the 1,296 shape-and-cell combinations run, the
      seeded aspect sweep runs its fixed iteration count, and every failure report names the
      anchor and the shape or rect pair
    - Fix any failure before proceeding; clean up any scratch files created while debugging
    - _Requirements: 15.11, 16.7, 16.8, 16.9, 16.10_

  - [x] 13.2 Run the build and lint gates and confirm the dependency budget
    - `npm run lint`, `npm run typecheck`, and `npm run build`
    - Confirm `package.json` and the lockfile declare exactly the same runtime and development
      dependencies at the same pinned versions as before this feature — no property-testing
      library and no other new package
    - Grep the source tree to confirm no `grabbedCorner`, `DEFAULT_CORNER`,
      `resolveGrabbedCorner`, `closedClipForCorner`, `cornerUv`, `oppositeCorner`, or
      `cornerPoint` identifier survives, and that `Corner` remains a four-value type used only
      for genuine rect corners
    - _Requirements: 8.4, 8.5, 15.13, 16.6_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; the
  core implementation sub-tasks are never optional.
- Task 6.4 **deletes** an existing test rather than extending it. `holds the fold axis corners
  still for %s` in `tests/unit/geometry.test.ts` is a corner-fold-only claim and is false for a
  midline fold, so **P1** replaces it.
- `grab-anchor.ts` (task 2) and the `geometry.ts` generalization (tasks 4 and 6) are
  independent and can proceed in parallel once the types land in task 1.1.
- Task 6.2 must land before task 6.3, and before any other test exercising `revealClipPath` at
  intermediate progress for an edge-midpoint anchor.
- Visual baselines are Chromium-desktop on Darwin only. The two new midline baselines are
  generated and reviewed by eye in task 11.2; the existing corner baselines must stay unchanged.
- No new dependency: properties are established by exhaustive enumeration over the 8 anchors
  and 64 grid shapes, with a seeded LCG only for **P6**.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3", "4.1"] },
    { "id": 3, "tasks": ["2.4", "4.2"] },
    { "id": 4, "tasks": ["2.5", "4.3"] },
    { "id": 5, "tasks": ["2.6", "4.5"] },
    { "id": 6, "tasks": ["2.7", "4.4"] },
    { "id": 7, "tasks": ["2.8", "4.7"] },
    { "id": 8, "tasks": ["4.6", "6.1"] },
    { "id": 9, "tasks": ["4.8", "6.2"] },
    { "id": 10, "tasks": ["6.3", "8.1"] },
    { "id": 11, "tasks": ["6.4", "8.2", "9.1"] },
    { "id": 12, "tasks": ["6.5", "8.3", "9.2", "9.3"] },
    { "id": 13, "tasks": ["6.6", "9.4", "10.1"] },
    { "id": 14, "tasks": ["6.7", "6.9", "10.2"] },
    { "id": 15, "tasks": ["6.8", "11.1"] },
    { "id": 16, "tasks": ["6.10", "11.2"] },
    { "id": 17, "tasks": ["12.1", "12.2"] },
    { "id": 18, "tasks": ["13.1"] },
    { "id": 19, "tasks": ["13.2"] }
  ]
}
```
