# Requirements Document

## Introduction

The paper-turn transition currently grabs the turning sheet by a corner chosen at
authoring time: `main.ts` reads a `data-grabbed-corner` attribute off the activated card
and falls back to `top-right`. Every tile therefore turns identically, regardless of
where it sits in the grid.

This feature derives the grab anchor and its pivot from the tile's **live measured
position in the grid** at activation time. A tile on the left edge is grabbed from its
left side, a tile on the top row from its top, a tile with no edge affinity from its top
edge midpoint. The anchor vocabulary widens from four rect corners to eight anchors — the
four corners plus the four edge midpoints — and a second fold-axis family (the midline)
joins the existing diagonal family. The pivot is always the geometric opposite of the
grab anchor.

These requirements are derived from the approved design document
[`design.md`](./design.md) and are traceable to its sections. They restate what the
system shall do; the design remains authoritative for how. Every acceptance criterion
below is consistent with the design's resolution tables, fold geometry, error handling,
and preserved-contract guarantees, and re-decides none of them.

---

## Glossary

- **Tile**: a grid cell rendered by an element carrying the `[data-card-trigger]`
  attribute, and the unit whose position determines the grab anchor.
- **Grab anchor**: the point of a rectangle by which the turning sheet is held. One of
  eight values — the four corners `top-left`, `top-right`, `bottom-right`, `bottom-left`
  and the four edge midpoints `top-center`, `middle-right`, `bottom-center`,
  `middle-left`.
- **Edge midpoint**: the midpoint of one rectangle edge, expressed in unit-square
  coordinates with exactly one component equal to `0.5`.
- **Pivot anchor**: the geometric opposite of the grab anchor, being its point reflection
  through the rectangle center `(0.5, 0.5)`. The pivot is the point the sheet turns
  about at the anchor level.
- **Fold axis**: the line in unit-square coordinates about which the sheet's back face is
  the reflection of its front face. The fold axis joins the two anchors of the grab
  anchor's own family — corner or edge midpoint — that are neither the grab anchor nor
  the pivot anchor.
- **Diagonal fold**: the fold-axis family selected by a corner grab anchor, whose axis is
  the main diagonal `u = v` or the anti-diagonal `u + v = 1` of the unit square.
- **Midline fold**: the fold-axis family selected by an edge-midpoint grab anchor, whose
  axis is the horizontal midline `v = 0.5` or the vertical midline `u = 0.5` of the unit
  square.
- **Row band**: the classification of a tile's row index as `top` (index `0`), `bottom`
  (index `rowCount − 1`), or `middle` (any other index).
- **Column band**: the classification of a tile's column index as `left`, `center`, or
  `right`. A `center` band exists only when `columnCount` is odd.
- **Grid position**: the tuple `{ rowIndex, rowCount, columnIndex, columnCount }`
  describing where a tile sits in the measured grid, with 0-based indices ordered top to
  bottom and left to right.
- **Base rect**: the interpolated sheet footprint `lerpRect(source, destination, eased)`
  at a given progress — the growing rectangle the deformation is applied within.
- **Anchor exchange**: the end-of-turn condition in which the vertex at the grab anchor
  lands on the destination's pivot anchor and the vertex at the pivot anchor lands on the
  destination's grab anchor.
- **Anchor_Resolver**: the pure resolution surface of `grab-anchor.ts` —
  `anchorForGridPosition` and `resolveGrabAnchor` — that maps a grid position to a grab
  anchor.
- **Grid_Position_Resolver**: the pure measurement surface of `grab-anchor.ts` —
  `clusterAxis` and `gridPositionFromRects` — that maps measured tile rects to a grid
  position.
- **Activation_Handler**: the activation path in `main.ts` that measures tile rects and
  opens the transition.
- **Geometry_Module**: `geometry.ts`, owning the anchor tables, fold-axis selection,
  per-vertex deformation, and reveal clip.
- **Profile_Validator**: `validateProfile()` in `geometry.ts`, which checks a
  `MotionProfile` before use.
- **Transition_Coordinator**: `transition-coordinator.ts`, owning the transition state
  machine and the closed-clip contract.
- **Paper_Turn_Renderer**: `paper-turn-renderer.ts`, owning the three.js sheet and the
  overlay element.
- **Motion_Profile**: the designer-tunable profile object exported by
  `motion-profile.ts`, including `meshColumns` and `meshRows`.
- **Build_Configuration**: the project manifest and lockfile that declare runtime and
  development dependencies.
- **Unit_Test_Suite**: the unit and aspect-ratio test suites covering the pure modules.
- **Visual_Regression_Suite**: the Chromium-desktop baseline suite covering the rendered
  sheet.

---

## Requirements

### Requirement 1: Eight-anchor vocabulary and pivot derivation

**User Story:** As a developer of the transition, I want a single closed anchor
vocabulary with a derived pivot, so that every grab point in the system has exactly one
well-defined opposite and one well-defined fold axis.

*Derived from: design — Data Models, Anchor table, Fold geometry.*

#### Acceptance Criteria

1. THE Geometry_Module SHALL accept exactly the eight grab anchor values `top-left`,
   `top-center`, `top-right`, `middle-right`, `bottom-right`, `bottom-center`,
   `bottom-left`, and `middle-left`, and SHALL accept no ninth value as a grab anchor.
2. THE Geometry_Module SHALL assign each grab anchor the unit-square coordinate
   `top-left` `(0, 0)`, `top-center` `(0.5, 0)`, `top-right` `(1, 0)`, `middle-right`
   `(1, 0.5)`, `bottom-right` `(1, 1)`, `bottom-center` `(0.5, 1)`, `bottom-left`
   `(0, 1)`, and `middle-left` `(0, 0.5)`, with `x` increasing left to right and `y`
   increasing top to bottom, each component exactly `0`, `0.5`, or `1`, all eight
   coordinates distinct, and `(0.5, 0.5)` assigned to no anchor.
3. WHEN a grab anchor with unit-square coordinate `(x, y)` is supplied, THE
   Geometry_Module SHALL return as its pivot anchor the anchor whose coordinate is
   exactly `(1 − x, 1 − y)`, pairing `top-left` with `bottom-right`, `top-right` with
   `bottom-left`, `top-center` with `bottom-center`, and `middle-left` with
   `middle-right`.
4. WHEN a pivot anchor is derived twice in succession from any of the eight grab anchors,
   THE Geometry_Module SHALL return the original grab anchor by exact equality of the
   anchor value.
5. WHEN a grab anchor is a member of the corner family `top-left`, `top-right`,
   `bottom-right`, `bottom-left`, THE Geometry_Module SHALL return a member of that same
   four-value family as its pivot anchor, and WHEN a grab anchor is a member of the
   edge-midpoint family `top-center`, `middle-right`, `bottom-center`, `middle-left`, THE
   Geometry_Module SHALL return a member of that same four-value family as its pivot
   anchor, the two families being disjoint and together covering all eight anchors.
6. WHEN a grab anchor and a rectangle whose `left` and `top` are finite and whose `width`
   and `height` are finite and non-negative are supplied, THE Geometry_Module SHALL
   return the finite point `{ left + uv.x · width, top + uv.y · height }` within
   `1 × 10⁻⁹` CSS pixels per component, in which at least one component equals the
   rectangle's `left`, `right`, `top`, or `bottom` edge value, so the point lies on that
   rectangle's boundary.
7. THE Geometry_Module SHALL keep the rect-corner type a four-value type admitting
   exactly `top-left`, `top-right`, `bottom-right`, and `bottom-left` and admitting no
   edge midpoint, so that the reveal polygon's winding-order corner list holds exactly
   four members.
8. IF a value that is not one of the eight grab anchors is supplied where a grab anchor is
   required, THEN THE Geometry_Module SHALL throw an error indicating that the supplied
   value is not a member of the anchor vocabulary and SHALL return no unit-square
   coordinate, no pivot anchor, and no rect point.
9. THE Geometry_Module SHALL derive each anchor's unit-square coordinate, pivot anchor,
   and rect point from its arguments alone, returning identical values on every
   invocation for identical arguments and retaining no state between invocations.

### Requirement 2: Position-based anchor resolution for non-degenerate grids

**User Story:** As a user, I want the tile I touch to be grabbed from the side of the
grid it sits on, so that the turn reads as a physical response to that tile rather than
as a fixed flourish.

*Derived from: design — The resolution table, Non-degenerate grids.*

#### Acceptance Criteria

1. WHERE `rowCount` and `columnCount` are integers of at least `2`, `rowIndex` lies in
   `[0, rowCount)`, and `columnIndex` lies in `[0, columnCount)`, WHEN a grid position is
   resolved, THE Anchor_Resolver SHALL classify the row index into exactly one row band
   and the column index into exactly one column band and SHALL return exactly one of the
   eight grab anchors, being the band-pair entry enumerated in criteria 2 through 4 of
   this requirement.
2. WHERE `rowCount` and `columnCount` are integers of at least `2`, WHEN the row band is
   `top`, THE Anchor_Resolver SHALL return `top-left` for column band `left`,
   `top-center` for column band `center`, and `top-right` for column band `right`.
3. WHERE `rowCount` is an integer of at least `3` and `columnCount` is an integer of at
   least `2`, WHEN the row band is `middle`, THE Anchor_Resolver SHALL return
   `middle-left` for column band `left`, `top-center` for column band `center`, and
   `middle-right` for column band `right`.
4. WHERE `rowCount` and `columnCount` are integers of at least `2`, WHEN the row band is
   `bottom`, THE Anchor_Resolver SHALL return `bottom-left` for column band `left`,
   `bottom-center` for column band `center`, and `bottom-right` for column band `right`.
5. WHERE `rowCount` is an integer of at least `3` and `columnCount` is an integer of at
   least `2`, WHEN the row band is `middle` and the column band is `left` or `right`, THE
   Anchor_Resolver SHALL return the edge midpoint on that side — `middle-left` or
   `middle-right`, whose unit-square coordinate has `y` exactly `0.5` — rather than a
   corner.
6. WHERE `rowCount` is at least `3` and `columnCount` is odd and at least `3`, WHEN the
   tile occupies both the `middle` row band and the `center` column band, THE
   Anchor_Resolver SHALL return `top-center`, whose pivot anchor is `bottom-center`.
7. WHERE `rowCount` and `columnCount` are integers of at least `2` and both indices lie
   within range, WHEN the column index is reflected to `columnCount − 1 − columnIndex`,
   THE Anchor_Resolver SHALL return the horizontal mirror of the anchor returned for the
   original position, under which `top-left` pairs with `top-right`, `bottom-left` pairs
   with `bottom-right`, `middle-left` pairs with `middle-right`, and `top-center` and
   `bottom-center` are fixed.
8. WHERE `rowCount` and `columnCount` are integers of at least `2` and the tile is
   outside the combination of the `middle` row band and the `center` column band, WHEN
   the row index is reflected to `rowCount − 1 − rowIndex`, THE Anchor_Resolver SHALL
   return the vertical mirror of the anchor returned for the original position, under
   which `top-left` pairs with `bottom-left`, `top-right` pairs with `bottom-right`,
   `top-center` pairs with `bottom-center`, and `middle-left` and `middle-right` are
   fixed.
9. THE Anchor_Resolver SHALL return the same grab anchor for any two grid positions whose
   four members are equal, deriving the result from its argument alone, with no dependence
   on invocation order, on elapsed time, or on the magnitudes of `rowCount` and
   `columnCount` beyond the band classification of the supplied indices.
10. WHERE `rowCount` and `columnCount` are integers of at least `2`, WHEN the row band is
    `top` or `bottom` and the column band is `left` or `right`, THE Anchor_Resolver SHALL
    return a corner anchor whose unit-square coordinate has `x` exactly `0` for column
    band `left` and exactly `1` for column band `right`, and `y` exactly `0` for row band
    `top` and exactly `1` for row band `bottom`.
11. WHERE `rowCount` is `2` and `columnCount` is an integer of at least `2`, WHEN a grid
    position is resolved, THE Anchor_Resolver SHALL classify row index `0` as row band
    `top` and row index `1` as row band `bottom`, so that no cell of a two-row grid
    resolves to `middle-left` or `middle-right`.

### Requirement 3: Column band tie-break

**User Story:** As a designer, I want a stated rule for grids with an even number of
columns, so that a tile that sits near the middle of such a grid is assigned to a side
rather than to an invented center.

*Derived from: design — Band classification.*

#### Acceptance Criteria

1. WHERE `columnCount` is an odd integer, WHEN the column band of a column index is
   classified, THE Anchor_Resolver SHALL classify the index `(columnCount − 1) / 2`, and
   only that index, as column band `center`.
2. WHERE `columnCount` is an even integer, WHEN the column band of a column index is
   classified, THE Anchor_Resolver SHALL classify every index in `[0, columnCount)` as
   column band `left` or `right`, SHALL classify no index as `center`, and SHALL place
   exactly `columnCount / 2` indices in each of `left` and `right`, being the half nearer
   that grid edge.
3. WHERE `columnCount` is an even integer, WHEN the column index is less than
   `columnCount / 2`, THE Anchor_Resolver SHALL classify that index as column band
   `left`.
4. WHERE `columnCount` is an even integer, WHEN the column index is at least
   `columnCount / 2`, THE Anchor_Resolver SHALL classify that index as column band
   `right`.
5. WHERE `columnCount` is `4`, WHEN column bands are classified, THE Anchor_Resolver
   SHALL classify column indices `0` and `1` as `left` and column indices `2` and `3` as
   `right`.
6. WHERE `columnCount` is `5`, WHEN column bands are classified, THE Anchor_Resolver
   SHALL classify column indices `0` and `1` as `left`, column index `2` as `center`, and
   column indices `3` and `4` as `right`.
7. WHERE `columnCount` is `5` and `rowCount` is at least `2`, WHEN the grab anchor is
   resolved for each of the five tiles of one row, THE Anchor_Resolver SHALL return
   exactly three distinct anchors — one shared left-side anchor for columns `0` and `1`,
   one edge-midpoint anchor for column `2`, and one shared right-side anchor for columns
   `3` and `4` — which is the accepted visual consequence recorded in the design and not a
   defect.
8. WHEN the row band of a row index is classified, THE Anchor_Resolver SHALL classify
   index `0` as row band `top`, index `rowCount − 1` as row band `bottom`, and every other
   index as row band `middle`, evaluating the `top` test before the `bottom` test so that
   a `rowCount` of `1` classifies index `0` as `top`.
9. WHERE `columnCount` is an odd integer of at least `3`, WHEN the column index is less
   than `(columnCount − 1) / 2`, THE Anchor_Resolver SHALL classify that index as column
   band `left`.
10. WHERE `columnCount` is an odd integer of at least `3`, WHEN the column index is
    greater than `(columnCount − 1) / 2`, THE Anchor_Resolver SHALL classify that index as
    column band `right`.
11. WHERE `columnCount` is an integer of at least `1` and the column index is an integer
    in `[0, columnCount)`, WHEN the column band is classified, THE Anchor_Resolver SHALL
    assign that index exactly one of the column bands `left`, `center`, or `right`.

### Requirement 4: Degenerate grid shapes

**User Story:** As a user on a narrow viewport where the grid collapses to a single
column, I want the turn to keep a sensible grab point, so that the transition still reads
correctly when the grid has no left/right or no top/bottom distinction.

*Derived from: design — Degenerate grids.*

#### Acceptance Criteria

1. WHEN a grid position whose `rowCount` is `1` or whose `columnCount` is `1` is
   resolved, THE Anchor_Resolver SHALL return an anchor from the degenerate rules of this
   requirement without classifying the row index into a row band or the column index into
   a column band.
2. WHEN `rowCount` is `1` and `columnCount` is `1`, THE Anchor_Resolver SHALL return
   `bottom-right`, whose pivot anchor is `top-left`, in precedence over the single-column
   and single-row rules, the only valid index pair being `rowIndex` `0` and `columnIndex`
   `0`.
3. WHERE `columnCount` is `1` and `rowCount` is at least `2`, WHEN the row index is `0`,
   THE Anchor_Resolver SHALL return `top-right`, whose pivot anchor is `bottom-left`.
4. WHERE `columnCount` is `1` and `rowCount` is at least `2`, WHEN the row index is
   `rowCount − 1`, THE Anchor_Resolver SHALL return `bottom-right`, whose pivot anchor is
   `top-left`.
5. WHERE `columnCount` is `1` and `rowCount` is at least `3`, WHEN the row index is
   greater than `0` and less than `rowCount − 1`, THE Anchor_Resolver SHALL return
   `top-center`, whose pivot anchor is `bottom-center`, for every such row index and
   independently of the magnitude of that index and of `rowCount`.
6. WHERE `rowCount` is `1` and `columnCount` is at least `2`, WHEN the column index is
   `0`, THE Anchor_Resolver SHALL return `bottom-left`, whose pivot anchor is
   `top-right`.
7. WHERE `rowCount` is `1` and `columnCount` is at least `2`, WHEN the column index is
   `columnCount − 1`, THE Anchor_Resolver SHALL return `bottom-right`, whose pivot anchor
   is `top-left`.
8. WHERE `rowCount` is `1` and `columnCount` is at least `3`, WHEN the column index is
   greater than `0` and less than `columnCount − 1`, THE Anchor_Resolver SHALL return
   `middle-left`, whose pivot anchor is `middle-right`, for every such column index and
   independently of the magnitude of that index and of `columnCount`.
9. WHEN the unit-square coordinate of the single-column anchor for the first, interior, or
   last position is transposed by `(u, v) → (v, u)`, THE Anchor_Resolver SHALL return for
   the corresponding first, interior, or last single-row position the anchor whose
   unit-square coordinate equals that transpose, mapping `top-right` to `bottom-left`,
   `top-center` to `middle-left`, and `bottom-right` to `bottom-right`.
10. WHERE `columnCount` is `1`, WHEN the row index is any integer within `[0, rowCount)`
    for any `rowCount` of at least `1`, THE Anchor_Resolver SHALL return exactly one of
    `top-right`, `top-center`, or `bottom-right`, and SHALL return that same anchor on
    every invocation with the same grid position.
11. WHERE `rowCount` is `1`, WHEN the column index is any integer within
    `[0, columnCount)` for any `columnCount` of at least `1`, THE Anchor_Resolver SHALL
    return exactly one of `bottom-left`, `middle-left`, or `bottom-right`, and SHALL
    return that same anchor on every invocation with the same grid position.

### Requirement 5: Total resolution over malformed input

**User Story:** As a user, I want a tile activation to complete even when layout
measurement yields unusable numbers, so that a measurement anomaly costs at most an
oddly-placed fold rather than a broken transition.

*Derived from: design — Grid position validation rules, Error handling: Resolution cannot
fail.*

#### Acceptance Criteria

1. THE Anchor_Resolver SHALL return exactly one of the eight grab anchors for every grid
   position value supplied — including values whose members are non-finite (`NaN`,
   `+Infinity`, `−Infinity`), non-integer, negative, or out of range — completing without
   throwing and without returning a null, undefined, or empty result.
2. IF a supplied grid position has a `rowCount` or `columnCount` that is not an integer of
   at least `1`, or a `rowIndex` that is not an integer within `[0, rowCount)`, or a
   `columnIndex` that is not an integer within `[0, columnCount)`, or any non-finite
   member, THEN THE Anchor_Resolver SHALL disregard the remaining members of that position
   and SHALL return the single-tile anchor `bottom-right`, whose pivot anchor is
   `top-left`.
3. IF the activated trigger is absent from the measured tile list — because the tile list
   is empty, or the trigger's index is negative, non-integer, or at least the tile count —
   THEN THE Grid_Position_Resolver SHALL return the single-tile grid position
   `{ rowIndex: 0, rowCount: 1, columnIndex: 0, columnCount: 1 }`, from which the
   Anchor_Resolver SHALL resolve `bottom-right`.
4. IF the activated tile's measured rect has a `width` or `height` that is not a finite
   number greater than `0`, or a non-finite `top` or `left`, THEN THE
   Grid_Position_Resolver SHALL return the single-tile grid position, regardless of how
   many other measured tiles remain usable.
5. THE Grid_Position_Resolver SHALL return, for every input it is given including the
   malformed inputs of criteria 3 and 4, a grid position in which `rowCount` and
   `columnCount` are integers of at least `1`, `rowIndex` lies in `[0, rowCount)`, and
   `columnIndex` lies in `[0, columnCount)`, completing without throwing.
6. IF clustering assigns each tile to its own row or column because measured edges differ
   by more than the cluster tolerance, THEN THE Anchor_Resolver SHALL return a well-formed
   grab anchor from the resulting grid position — one of the eight anchors, satisfying
   criterion 1 — and THE Paper_Turn_Renderer SHALL publish that anchor for observation,
   with the turn proceeding through the normal turn path and no fallback path taken.
7. THE Anchor_Resolver SHALL hold no DOM reference, read no clock, retain no state between
   invocations, and mutate none of the values supplied to it, so that repeated invocations
   with equal inputs return equal anchors.
8. WHERE the resolved grab anchor is the single-tile anchor `bottom-right` because of a
   malformed grid position or an unmeasurable activated rect, WHEN the overlay is created,
   THE Paper_Turn_Renderer SHALL publish `bottom-right` as the overlay dataset anchor
   value, so that the collapse is observable without inspecting pixels.

### Requirement 6: Grid position from live measured layout

**User Story:** As a developer, I want the grid position derived from measured tile rects
rather than from parsed CSS track definitions, so that resolution survives any layout
mechanism that produces a visually rectangular arrangement.

*Derived from: design — Grid position from live layout, Clustering algorithm, Tolerance.*

#### Acceptance Criteria

1. WHEN an activation occurs, THE Activation_Handler SHALL measure the bounding rect of
   every `[data-card-trigger]` element within the grid root, SHALL collect those rects in
   document order, and SHALL identify the activated tile by its `0`-based position in
   that ordered list.
2. THE Grid_Position_Resolver SHALL derive `rowIndex` and `rowCount` by clustering the
   measured `top` values and SHALL derive `columnIndex` and `columnCount` by clustering
   the measured `left` values, reading no other rect member for clustering.
3. THE Grid_Position_Resolver SHALL cluster with a tolerance of `2` CSS pixels, exposed
   as a module constant of the resolution module, SHALL apply that constant when the
   caller supplies no tolerance argument, and SHALL require any supplied tolerance to be
   finite and at least `0`.
4. WHEN clustering a set of values, THE Grid_Position_Resolver SHALL sort the values
   ascending, SHALL compare each candidate value against the smallest value of the
   cluster under construction, and SHALL open a new cluster only when that difference is
   strictly greater than the tolerance, so that the values `0`, `2`, and `4` CSS pixels
   form exactly two clusters at a tolerance of `2` rather than one merged cluster.
5. WHEN clustering a set of values, THE Grid_Position_Resolver SHALL assign equal values
   equal cluster indices and SHALL assign cluster indices that are non-decreasing in
   value.
6. WHEN clustering a set of values, THE Grid_Position_Resolver SHALL assign exactly one
   cluster index to every supplied value, SHALL return cluster indices within
   `[0, clusterCount)` and a `clusterCount` of at least `1`, and SHALL keep every member
   of a cluster within the tolerance of that cluster's smallest member.
7. WHEN measured rects include tiles of zero width, zero height, a non-finite `top`, or a
   non-finite `left`, THE Grid_Position_Resolver SHALL exclude those tiles from
   clustering, so that collapsed tiles contribute no rows or columns, and SHALL derive
   the activated tile's `rowIndex` and `columnIndex` from its position among the retained
   tiles alone.
8. WHERE `R` and `C` are each within `[1, 8]`, WHEN tiles are laid out as an `R × C` grid
   in which every tile's `top` lies strictly within `2` CSS pixels of the smallest `top`
   of its authored row, every tile's `left` lies strictly within `2` CSS pixels of the
   smallest `left` of its authored column, and consecutive rows and columns are separated
   by more than `2` CSS pixels, THE Grid_Position_Resolver SHALL return `rowCount` equal
   to `R`, `columnCount` equal to `C`, and each tile's authored row and column indices.
9. WHERE the whole measured grid is uniformly translated by a finite offset or uniformly
   scaled by a positive finite factor, WHILE every transformed rect keeps a non-zero
   width and height, finite `top` and `left`, and a separation between consecutive rows
   and columns greater than the tolerance, THE Grid_Position_Resolver SHALL return the
   same grid position for each tile as before the transformation.
10. WHEN clustering a set of values, THE Grid_Position_Resolver SHALL assign cluster index
    `0` to the cluster holding the smallest value, so that `rowIndex` `0` denotes the
    topmost measured row and `columnIndex` `0` denotes the leftmost measured column.

### Requirement 7: Per-activation resolution and responsive adaptation

**User Story:** As a user resizing the window across a breakpoint, I want the grab anchor
to follow the layout I can see, so that a tile that has become the only tile in its row
is grabbed accordingly without any authoring change.

*Derived from: design — Activation sequence, Wiring in `main.ts`, Non-goals.*

#### Acceptance Criteria

1. WHEN a tile is activated by a click or by an Enter key press, THE Activation_Handler
   SHALL resolve the grab anchor exactly once, from tile rects measured during that same
   activation, and SHALL perform no further resolution for that transition.
2. WHEN a tile is activated, THE Activation_Handler SHALL complete measurement of every
   tile rect and resolution of the grab anchor within the synchronous execution of that
   activation, before the Transition_Coordinator renders the first animation frame, so
   that no layout measurement is attributable to the frame loop.
3. WHEN the viewport width changes between activations such that the measured column count
   or row count differs from the count measured at the previous activation, THE
   Activation_Handler SHALL resolve the anchor for the next activation from the layout
   measured at that next activation, and SHALL perform no measurement and no resolution in
   response to the viewport change itself.
4. WHERE the mobile media query collapses the grid to a single column, WHEN the tile whose
   measured row index is `0` is activated, THE Activation_Handler SHALL resolve
   `top-right`.
5. WHEN the anchor has been resolved, THE Activation_Handler SHALL pass that anchor as the
   `grabAnchor` field of exactly one open request to the Transition_Coordinator, and SHALL
   pass no other anchor value for that transition.
6. THE Transition_Coordinator SHALL consume the anchor supplied on the open request
   without invoking the Anchor_Resolver, SHALL retain that single anchor value for the
   lifetime of the transition, and SHALL reuse the retained anchor for the settle-to-idle
   path.
7. IF the viewport changes while a turn is in progress, THEN THE Transition_Coordinator
   SHALL settle the turn through the existing viewport-change fallback using the anchor
   resolved at activation, and SHALL neither re-measure tile rects nor re-resolve the
   anchor.
8. WHERE the mobile media query collapses the grid to a single column, WHEN a tile whose
   measured row index is greater than `0` and less than `rowCount − 1` is activated, THE
   Activation_Handler SHALL resolve `top-center`.
9. WHERE the mobile media query collapses the grid to a single column and `rowCount` is at
   least `2`, WHEN the tile whose measured row index is `rowCount − 1` is activated, THE
   Activation_Handler SHALL resolve `bottom-right`.
10. WHEN the same tile is activated on successive occasions with no intervening change to
    the measured row count, column count, or that tile's measured row and column indices,
    THE Activation_Handler SHALL resolve the same grab anchor on every one of those
    activations.

### Requirement 8: Removal of the authoring override

**User Story:** As a maintainer, I want a single source of truth for the grab anchor, so
that a tile's turn cannot disagree with its position in the grid.

*Derived from: design — Wiring in `main.ts`, Non-goals, Migration notes.*

#### Acceptance Criteria

1. THE Activation_Handler SHALL derive the grab anchor solely from the measured grid
   position of the activated tile, consulting no element attribute, no default constant,
   and no anchor value carried over from a previous activation.
2. WHERE a tile carries a `data-grabbed-corner` attribute, WHEN that tile is activated,
   THE Activation_Handler SHALL resolve the grab anchor from the measured grid position,
   and that anchor SHALL equal the anchor resolved for a tile at the same grid position
   carrying no such attribute.
3. IF a `data-grabbed-corner` attribute value is any of the eight grab anchor names, any
   of the four rect-corner names, an empty string, or any unrecognized string, THEN THE
   Activation_Handler SHALL leave the resolved anchor unchanged and SHALL complete the
   activation without raising an error and without emitting a warning attributable to
   that attribute.
4. THE Activation_Handler SHALL expose no `DEFAULT_CORNER` constant and no
   `resolveGrabbedCorner()` function, both being deleted outright rather than deprecated,
   and SHALL re-export neither under any other name.
5. THE Transition_Coordinator and THE Paper_Turn_Renderer SHALL name their public anchor
   input `grabAnchor`, SHALL type it as one of the eight grab anchors rather than as a
   four-value rect corner, and SHALL expose no public field, option, or parameter named
   `grabbedCorner`.
6. THE Activation_Handler SHALL provide no attribute, configuration value, or runtime
   parameter by which an authored value can override the resolved grab anchor.
7. THE Activation_Handler SHALL resolve a grab anchor for every tile whose markup carries
   no anchor-related attribute, so that removing the override requires no markup change
   to any existing tile.

### Requirement 9: Fold axis selection across two axis families

**User Story:** As a developer of the geometry, I want the fold axis selected from a
table keyed by anchor, so that corner grabs keep their diagonal fold and edge-midpoint
grabs fold about a midline through one shared deformation path.

*Derived from: design — Two axis families, one basis; Consequences for the existing
tunables.*

#### Acceptance Criteria

1. WHEN a grab anchor is supplied, THE Geometry_Module SHALL select the fold axis that
   joins the two anchors of the grab anchor's own family that are neither the grab anchor
   nor the pivot anchor.
2. WHEN the grab anchor is `top-right` or `bottom-left`, THE Geometry_Module SHALL select
   the main diagonal `u = v` as the fold axis, of kind `diagonal`.
3. WHEN the grab anchor is `top-left` or `bottom-right`, THE Geometry_Module SHALL select
   the anti-diagonal `u + v = 1` as the fold axis, of kind `diagonal`.
4. WHEN the grab anchor is `top-center` or `bottom-center`, THE Geometry_Module SHALL
   select the horizontal midline `v = 0.5` as the fold axis, of kind `midline`.
5. WHEN the grab anchor is `middle-left` or `middle-right`, THE Geometry_Module SHALL
   select the vertical midline `u = 0.5` as the fold axis, of kind `midline`.
6. THE Geometry_Module SHALL assign a grab anchor and its pivot anchor the same fold-axis
   table entry.
7. WHEN a fold basis is constructed, THE Geometry_Module SHALL return a unit axis vector
   along the fold line, a unit normal orthogonal to that axis oriented toward the grab
   anchor, an origin lying on the fold line, a positive `axisLength`, and a positive
   `maxPerp` equal to the perpendicular distance from the grab anchor to the fold line.
8. WHEN a fold basis is constructed, THE Geometry_Module SHALL produce a reflection
   `p ↦ p − 2 · ((p − origin) · normal) · normal` equal to the closed-form reflection
   recorded for that anchor in the design's anchor table.
9. WHEN the fold-axis endpoints for one anchor are exchanged, THE Geometry_Module SHALL
   produce the same vertex positions within floating-point tolerance, since the turned
   position is independent of which point on the line is the origin and the ridge term
   satisfies `sin(π t) = sin(π (1 − t))`.
10. THE Geometry_Module SHALL apply the same per-vertex deformation body to both axis
    families, consuming only the fold basis.
11. THE Geometry_Module SHALL keep every motion-profile value and the
    `PERSPECTIVE_STRENGTH`, `FACING_FLOOR`, and `ARC_BULGE` constants at their current
    values, since `acrossFold` and `along / axisLength` are normalized in both families.
12. WHEN a corner grab anchor is supplied, THE Geometry_Module SHALL produce vertex
    positions equal to the current corner behavior within floating-point tolerance.

### Requirement 10: Midline reflection exactness at arbitrary aspect ratios

**User Story:** As a user, I want a midline fold to mirror cleanly on tiles of any shape,
so that an edge-midpoint grab never produces the self-intersecting artifact the contract
rules out for pixel-space diagonals.

*Derived from: design — Why the diagonal case needs unit-square space and the midline
case does not.*

#### Acceptance Criteria

1. WHEN the grab anchor is `top-center` or `bottom-center`, THE Geometry_Module SHALL map
   each vertex's back-face coordinate by `(u, v) → (u, 1 − v)`.
2. WHEN the grab anchor is `middle-left` or `middle-right`, THE Geometry_Module SHALL map
   each vertex's back-face coordinate by `(u, v) → (1 − u, v)`.
3. WHERE the grab anchor is an edge midpoint, WHEN source and destination rects have
   independently varied widths and heights, THE Geometry_Module SHALL place the
   `progress = 1` vertex positions at the pixel-space mirror about the destination rect's
   corresponding centerline within floating-point tolerance.
4. THE Geometry_Module SHALL compute both axis families in unit-square coordinates and
   SHALL map the result out through the base rect, so that a corner reflection stays
   exact for non-square rects.
5. WHEN back-face coordinates are computed, THE Geometry_Module SHALL return
   `(columns + 1) · (rows + 1) · 2` entries, each within `[0, 1]`, and SHALL return the
   original coordinates when the computation is applied twice.
6. THE Geometry_Module SHALL compute back-face coordinates for any integer `columns` and
   `rows` of at least `1`, independent of whether those dimensions are even.
7. THE Paper_Turn_Renderer SHALL compute back-face coordinates once at construction from
   the resolved grab anchor.

### Requirement 11: Anchor exchange and destination-frame reflection

**User Story:** As a user, I want the point I grabbed and its opposite to visibly trade
places by the end of the turn, so that the motion reads as one coherent half-rotation for
every one of the eight anchors.

*Derived from: design — Key functions with formal specifications, Correctness properties
P1–P5.*

#### Acceptance Criteria

1. WHERE any of the eight grab anchors is in effect, WHEN progress reaches `1`, THE
   Geometry_Module SHALL place each vertex at the reflection of its front-face coordinate
   across that anchor's fold axis, mapped into the destination rect.
2. WHERE any of the eight grab anchors is in effect, WHEN progress reaches `1`, THE
   Geometry_Module SHALL place the vertex at the grab anchor on the destination's pivot
   anchor and the vertex at the pivot anchor on the destination's grab anchor.
3. WHERE any of the eight grab anchors is in effect, WHILE progress lies within `[0, 1]`,
   THE Geometry_Module SHALL place the two fold-axis endpoint vertices at their
   corresponding anchor points on the base rect.
4. WHEN progress is `0`, THE Geometry_Module SHALL place every vertex on the source rect
   with `z = 0`, and WHEN progress is `1`, THE Geometry_Module SHALL place every vertex
   on the destination rect with `z = 0`.
5. THE Geometry_Module SHALL compute `lift` as `sin(π · eased)`, yielding exactly `0` at
   progress `0` and `1`, and `1` at the midpoint, and SHALL hold `alpha` at `1`
   throughout.
6. WHERE any of the eight grab anchors is in effect, WHILE progress lies within `[0, 1]`,
   THE Geometry_Module SHALL bound the position delta between adjacent mesh vertices that
   straddle the fold axis by `C / min(meshColumns, meshRows)` for a constant `C`
   independent of progress.
7. THE Geometry_Module SHALL compute every deformation term from `acrossFold` and the
   ridge value alone, so that no branch of the per-vertex loop depends on the sign of
   `acrossFold`.
8. WHILE the per-vertex loop runs, THE Geometry_Module SHALL keep `acrossFold` within
   `[−1, 1]` and `along / axisLength` within `[0, 1]` for every vertex written.
9. THE Geometry_Module SHALL return `(meshColumns + 1) · (meshRows + 1) · 3` finite
   position entries and one shade entry per vertex within `[FACING_FLOOR, 1]`.
10. IF progress lies outside `[0, 1]`, THEN THE Geometry_Module SHALL clamp it into
    `[0, 1]` and SHALL complete the frame.
11. THE Geometry_Module SHALL leave the supplied source rect, destination rect, and
    motion profile unmutated.
12. THE Geometry_Module SHALL compute the base rect as `lerpRect(source, destination,
    eased)` independently of the grab anchor, so the sheet footprint stays a growing
    rectangle.

### Requirement 12: Even-mesh validation

**User Story:** As a designer tuning mesh density, I want an odd mesh dimension to fail
by name, so that an edge-midpoint grab can never silently land half a cell off the edge
center.

*Derived from: design — Even-mesh constraint, Error handling: Validation failures are
loud.*

#### Acceptance Criteria

1. THE Profile_Validator SHALL require both `meshColumns` and `meshRows` to be even
   integers, in addition to the existing positive-integer checks.
2. IF `meshColumns` or `meshRows` is odd, THEN THE Profile_Validator SHALL throw an error
   naming the offending field.
3. THE Geometry_Module SHALL run the Profile_Validator when building a paper frame, and
   THE Paper_Turn_Renderer SHALL run the Profile_Validator in its constructor.
4. IF the Profile_Validator throws during renderer construction, THEN THE
   Transition_Coordinator SHALL dispose the allocated resources and SHALL complete the
   transition through the existing full-motion fallback.
5. WHEN a grab anchor, a column count, and a row count are supplied, THE Geometry_Module
   SHALL return an integer vertex index within
   `[0, (columns + 1) · (rows + 1))` addressing the vertex whose coordinate equals that
   anchor's unit-square coordinate.
6. IF `uv.x · columns` or `uv.y · rows` is not an integer for the requested anchor, THEN
   THE Geometry_Module SHALL throw an error naming the anchor and the offending
   dimension.
7. THE Geometry_Module SHALL return a vertex index for a corner anchor with any positive
   integer column and row counts, including odd ones.
8. THE Motion_Profile SHALL declare `meshColumns` of `20` and `meshRows` of `14`, both
   even, and SHALL document both fields as constrained to even numbers.

### Requirement 13: Reveal clip totality and closed-clip agreement

**User Story:** As a developer, I want the reveal clip to yield a valid polygon at every
progress for every anchor, so that the public clip function is usable at intermediate
progress and the coordinator's closed clip matches the sheet's first frame.

*Derived from: design — The reveal sweep must become basis-driven; `closedClipForAnchor`.*

#### Acceptance Criteria

1. THE Geometry_Module SHALL measure the reveal sweep by a fold-basis distance that is
   `0` at the grab anchor and `2` at the pivot anchor, with level sets parallel to the
   fold axis.
2. WHERE any of the eight grab anchors is in effect, WHEN progress lies within `(0, 1]`,
   THE Geometry_Module SHALL return a reveal polygon with at least three points.
3. WHERE any of the eight grab anchors is in effect, WHEN progress increases, THE
   Geometry_Module SHALL return a reveal polygon whose covered area is non-decreasing.
4. WHEN progress is `1`, THE Geometry_Module SHALL return a reveal polygon equal to the
   full destination rectangle for every one of the eight anchors.
5. WHEN the grab anchor is a corner, THE Geometry_Module SHALL return the same reveal
   polygon as the current L1-distance sweep for every progress value.
6. WHEN the grab anchor is `top-center`, THE Geometry_Module SHALL return a reveal front
   that grows downward as a horizontal band parallel to the fold axis.
7. WHEN two adjacent rect corners differ in insideness, THE Geometry_Module SHALL
   interpolate the crossing point using their differing sweep distances, so the
   interpolation denominator stays non-zero.
8. WHEN a grab anchor is supplied, THE Transition_Coordinator SHALL derive the closed
   clip from that anchor's unit-square coordinate as a degenerate three-point polygon
   expressed in percentages, through a table-driven lookup.
9. WHERE any of the eight grab anchors is in effect, THE Transition_Coordinator SHALL
   produce a closed clip equal to the reveal clip path for the same anchor at progress
   `0`.
10. WHILE progress is below `1`, THE Geometry_Module SHALL return as the frame's reveal
    clip the degenerate triangle at the grab anchor point on the base rect, and WHEN
    progress reaches `1`, THE Geometry_Module SHALL return the full destination
    rectangle.

### Requirement 14: Resolved anchor diagnostics

**User Story:** As a test author, I want the resolved anchor published on the overlay, so
that I can assert resolution for a given viewport without inspecting pixels.

*Derived from: design — Components and Interfaces, Wiring in `main.ts`, Browser
interaction tests.*

#### Acceptance Criteria

1. WHEN the overlay is created, THE Paper_Turn_Renderer SHALL publish the resolved grab
   anchor as a dataset attribute on the overlay element, alongside the existing mesh
   vertex count and progress attributes.
2. THE Paper_Turn_Renderer SHALL publish the anchor value as one of the eight anchor
   string literals.
3. THE Paper_Turn_Renderer SHALL expose the resolved anchor through the overlay dataset
   only, adding no debug-panel user interface.

### Requirement 15: Preservation of existing contract guarantees

**User Story:** As a stakeholder in the approved motion contract, I want every existing
guarantee to keep holding, so that widening the anchor vocabulary changes only anchor
selection and axis choice.

*Derived from: design — Preserved contract guarantees, Error handling, Testing strategy.*

#### Acceptance Criteria

1. THE Geometry_Module SHALL hold reveal progress at `0` until the eased progress reaches
   `1`, so that the sheet performs the reveal.
2. WHILE a turn is in progress, THE Transition_Coordinator SHALL keep the destination DOM
   fully covered until the sheet lands.
3. THE Transition_Coordinator SHALL reveal the destination through the sheet alone,
   presenting no independent background wipe and no flat panel of page content.
4. THE Paper_Turn_Renderer SHALL gate the contact shadow on the anchor-independent `lift`
   value through the existing shadow lift scale.
5. WHEN progress reaches its midpoint, THE Geometry_Module SHALL produce a curved
   cross-section whose bulge scales with `maxPerp`, so that a midline fold bulges by the
   same fraction of its half-width as a diagonal fold.
6. THE Geometry_Module SHALL preserve the `sin(π/2 · acrossFold)` deformation form, so
   the sheet stays continuous across the fold axis.
7. THE Paper_Turn_Renderer SHALL print both faces of the sheet and SHALL degrade the
   reverse face to paper white through the existing back-texture mix behavior.
8. THE Transition_Coordinator SHALL preserve the existing capture fidelity and Spectrum
   token inlining behavior.
9. THE Transition_Coordinator SHALL preserve the existing accessibility behavior,
   including background inertness, focus handling, and scroll freeze and restore.
10. WHERE reduced motion is requested or required capabilities are absent, WHEN a tile is
    activated, THE Transition_Coordinator SHALL complete the transition through the
    existing fallback path without consulting the grab anchor.
11. IF any step of the turn fails, THEN THE Transition_Coordinator SHALL leave no hidden
    card and no orphaned overlay, using the existing recovery paths.
12. THE Paper_Turn_Renderer SHALL keep the mesh within the existing mobile budget of
    `315` vertices and a canvas within twice the viewport.
13. THE Transition_Coordinator SHALL leave its state machine, cleanup, and fallback paths
    unchanged by this feature.

### Requirement 16: Performance envelope and dependency budget

**User Story:** As a user on a mobile device, I want resolution to cost nothing per
frame, so that adding position awareness does not cost frame budget.

*Derived from: design — Performance considerations, Dependencies, Testing strategy.*

#### Acceptance Criteria

1. WHEN a tile is activated, THE Activation_Handler SHALL perform exactly one layout
   measurement pass over the tile list, of cost linear in the number of tiles.
2. THE Geometry_Module SHALL read no layout inside the frame loop.
3. THE Anchor_Resolver SHALL resolve an anchor using arithmetic plus one sort of the
   measured values per axis.
4. THE Paper_Turn_Renderer SHALL leave mesh density, texture device-pixel-ratio handling,
   and pixel caps at their current values.
5. THE Build_Configuration SHALL declare the same runtime and development dependencies as
   before this feature.
6. THE Unit_Test_Suite SHALL establish the anchor properties by exhaustive enumeration
   over the eight anchors and over grid shapes with `rowCount` and `columnCount` within
   `[1, 8]`, and SHALL establish the aspect-ratio property through a deterministic sweep
   driven by a seeded generator.
7. THE Visual_Regression_Suite SHALL add baselines for a midline fold at peak curl and
   mid-turn, and SHALL retain the existing corner-turn baselines.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid
executions of a system — essentially, a formal statement about what the system should do.
Properties serve as the bridge between human-readable specifications and
machine-verifiable correctness guarantees.*

The design document already states fourteen numbered correctness properties over
`A = the eight anchors`, `R = valid rect pairs`, `P = progress ∈ [0, 1]`, and
`G = grid shapes with rowCount, columnCount ∈ [1, 8]`. This section maps those same
properties — **P1 through P14, no others** — to the acceptance criteria above. The
property statements are restated in condensed form for readability; `design.md` remains
authoritative for their exact wording.

### Property 1 — Destination-frame reflection

For all anchors in `A`, all rect pairs in `R`, and all mesh vertices `(u, v)`: at
`progress = 1` the vertex lands at `reflect_anchor(u, v)` mapped into the destination
rect. This subsumes the legacy "the other corners stay put" claim, which is false for a
midline fold.

**Validates: Requirements 9.12, 10.1, 10.2, 10.4, 10.5, 11.1**

### Property 2 — Anchor exchange

For all anchors in `A`: at `progress = 1` the vertex at the grab anchor lands on the
destination's pivot anchor and the vertex at the pivot anchor lands on the destination's
grab anchor.

**Validates: Requirements 1.3, 1.6, 11.2**

### Property 3 — Fold axis stationary in the growing frame

For all anchors in `A` and all progress in `P`: the two fold-axis endpoint vertices sit
exactly at their corresponding anchor points on the base rect.

**Validates: Requirements 11.3, 12.5**

### Property 4 — Flatness and exactness at both endpoints

For all anchors in `A`: at `progress = 0` every vertex lies on the source rect with
`z = 0`, at `progress = 1` every vertex lies on the destination rect with `z = 0`, and
`lift = 0` at both endpoints.

**Validates: Requirements 11.4, 11.5, 15.1**

### Property 5 — Continuity across the fold axis

For all anchors in `A` and all progress in `P`: for adjacent mesh vertices straddling
`perp = 0`, the position delta is bounded by `C / min(meshColumns, meshRows)` for a
constant `C` independent of progress. Equivalently, no deformation term is a `sign()`-style
step.

**Validates: Requirements 11.6, 11.7, 11.8, 15.6**

### Property 6 — Midline reflection is exact at arbitrary aspect ratios

For all edge-midpoint anchors and all rect pairs with independently varied widths and
heights: the `progress = 1` landing positions match the closed-form pixel-space mirror
about the destination rect's centerline within floating-point tolerance. Corner anchors
are deliberately exempt in pixel space — that is the bowtie the contract rules out.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4**

### Property 7 — Resolution is total

For all grid shapes in `G` and all row/column indices, and additionally for non-finite,
non-integer, negative, and out-of-range input: resolution returns one of the eight
anchors, never throws, and collapses malformed input to the single-tile anchor.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

### Property 8 — Resolution agrees with the table

For all grid shapes in `G` and all cells: the returned anchor equals the documented table
entry, including every degenerate row and the even-column tie-break.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5,
3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8**

### Property 9 — Mirror symmetry, with stated exceptions

For non-degenerate grids, reflecting the column index maps the resolved anchor by the
horizontal mirror and reflecting the row index maps it by the vertical mirror, except at
the fully centered tile, which always grabs `top-center`. Degenerate single-row and
single-column grids are exempt, and their constants are related by the transpose
`(u, v) → (v, u)`.

**Validates: Requirements 2.6, 2.7, 2.8, 4.9**

### Property 10 — Clustering recovers the grid

For synthetic rects laid out as an `R × C` grid with per-tile jitter strictly below the
tolerance, position resolution returns exactly `R` rows and `C` columns and assigns each
tile its authored indices; the result is stable under uniform translation and scaling of
the whole grid.

**Validates: Requirements 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9**

### Property 11 — Closed clip agrees with the first frame

For all anchors in `A`: the coordinator's closed clip equals the reveal clip path for the
same anchor at `progress = 0`, so the `preparing` clip and the sheet's opening frame
cannot disagree.

**Validates: Requirements 13.8, 13.9, 13.10**

### Property 12 — Reveal sweep is total and monotone

For all anchors in `A` and all progress in `(0, 1]`: the reveal clip yields a polygon with
at least three finite points, whose covered area is non-decreasing in progress, and which
equals the full rectangle at `progress = 1`. Corner anchors reproduce the current L1
sweep exactly.

**Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7**

### Property 13 — Opposite is an involution and family-preserving

For all anchors in `A`: applying the opposite relation twice returns the original anchor,
corners map to corners and edge midpoints to edge midpoints, and an anchor and its
opposite share a single fold-axis entry.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**

### Property 14 — Even-mesh validation fails loudly

For every odd `meshColumns` or `meshRows`, profile validation throws naming the field; and
vertex indexing throws for exactly those anchor-and-dimension combinations it cannot
represent, while accepting corner anchors at any positive integer dimension.

**Validates: Requirements 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8**

### Criteria covered by other test types

The following criteria are deliberately **not** property-tested. They verify DOM
lifecycle, module wiring, configuration values, external behavior, or the shape of the
suite itself — none of which gain from many randomized iterations.

| Criteria | Test type | Rationale |
| --- | --- | --- |
| 1.1, 1.7, 9.11, 12.4, 16.4 | Example / configuration | Closed-set membership and named constant values; one assertion each. |
| 5.7, 8.3, 8.4, 9.10, 14.3, 15.13, 16.3, 16.5, 16.6 | Smoke / review | Architectural and deletion claims, compile-time renames, dependency and suite structure. |
| 6.1, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 16.1, 16.2 | Integration | Live layout reads, activation wiring, viewport-driven resolution, frame-loop discipline. |
| 7.6, 7.7, 9.7, 9.8, 9.9, 10.6, 10.7, 13.6, 14.1, 14.2 | Example / edge case | Single scenarios, basis-construction postconditions over the eight-value domain, one-shot renderer side effects. |
| 8.1, 8.2 | Property over the removed attribute | Swept over all eight attribute values to confirm the override is inert. |
| 15.2, 15.3, 15.8, 15.9, 15.11, 15.12, 16.7 | Integration / visual | Preserved contract guarantees already covered by the existing browser, capture, and baseline suites, plus the new midline baselines. |
| 15.4, 15.7, 15.10 | Example | Anchor-independent existing behavior at representative progress values. |
| 15.5 | Property | Metamorphic comparison of peak bulge between the two axis families, normalized by `maxPerp`. |

---

## Traceability notes

- Every requirement above cites the design section it derives from. No requirement
  introduces a decision the design has not already settled.
- `design.md` is unchanged by this phase. Its property numbering P1–P14 is the single
  source of truth for correctness properties; this document supplies the
  requirement-to-property mapping in the section above rather than duplicating or
  renumbering the properties.
- The design's non-goals remain non-goals: no mid-turn re-resolution on resize, no debug
  panel exposure of the anchor, and no authoring escape hatch to override the resolved
  anchor.
