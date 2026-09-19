import type {
  Corner,
  FoldAxis,
  FoldAxisKind,
  GrabAnchor,
  MotionProfile,
  PaperFrame,
  Point,
  Rect,
} from './types';

/**
 * Unit-square coordinate of each of the eight grab anchors, with `x`
 * increasing left to right and `y` increasing top to bottom.
 *
 * Every component is exactly `0`, `0.5`, or `1`, all eight coordinates are
 * distinct, and the rectangle center `(0.5, 0.5)` is assigned to no anchor —
 * a sheet cannot be grabbed by its own middle.
 */
export const anchorUv: Record<GrabAnchor, Point> = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'middle-right': { x: 1, y: 0.5 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-left': { x: 0, y: 1 },
  'middle-left': { x: 0, y: 0.5 },
};

/**
 * The pivot of each anchor: its point reflection through `(0.5, 0.5)`.
 *
 * Because the reflection negates both components about the center, corners
 * pair with corners and edge midpoints with edge midpoints, so the two
 * families never mix.
 */
const OPPOSITE_ANCHOR: Record<GrabAnchor, GrabAnchor> = {
  'top-left': 'bottom-right',
  'top-center': 'bottom-center',
  'top-right': 'bottom-left',
  'middle-right': 'middle-left',
  'bottom-right': 'top-left',
  'bottom-center': 'top-center',
  'bottom-left': 'top-right',
  'middle-left': 'middle-right',
};

function frozenFoldAxis(kind: FoldAxisKind, origin: Point, far: Point): FoldAxis {
  return Object.freeze({ kind, origin: Object.freeze(origin), far: Object.freeze(far) });
}

/**
 * The line each anchor folds about, in unit-square coordinates: the line
 * joining the two anchors of the grab anchor's own family that are neither the
 * grab anchor nor its pivot.
 *
 * An anchor and its pivot deliberately share one entry. `foldBasis()` orients
 * the normal toward the grab anchor, so one shared line yields opposite normals
 * for the two members of a pair without a second row.
 *
 * Which endpoint is named `origin` is immaterial: swapping the two negates
 * `axis` and `along`, and neither the turned position — `point − 2 · perp ·
 * normal`, independent of which point on the line is the origin — nor the ridge
 * term, which satisfies `sin(π t) = sin(π (1 − t))`, can tell the difference.
 *
 * Frozen because it is the module's only table beyond the anchor tables and
 * nothing may rewrite a fold line at runtime.
 */
const FOLD_AXIS: Record<GrabAnchor, FoldAxis> = Object.freeze({
  // Diagonal family: the other two corners hold still, and `axisLength` and
  // `maxPerp` fall out as `√2` and `1 / √2`.
  'top-right': frozenFoldAxis('diagonal', { x: 0, y: 0 }, { x: 1, y: 1 }),
  'bottom-left': frozenFoldAxis('diagonal', { x: 0, y: 0 }, { x: 1, y: 1 }),
  'top-left': frozenFoldAxis('diagonal', { x: 0, y: 1 }, { x: 1, y: 0 }),
  'bottom-right': frozenFoldAxis('diagonal', { x: 0, y: 1 }, { x: 1, y: 0 }),
  // Midline family: the other two edge midpoints hold still, and `axisLength`
  // and `maxPerp` fall out as `1` and `0.5`.
  'top-center': frozenFoldAxis('midline', { x: 0, y: 0.5 }, { x: 1, y: 0.5 }),
  'bottom-center': frozenFoldAxis('midline', { x: 0, y: 0.5 }, { x: 1, y: 0.5 }),
  'middle-left': frozenFoldAxis('midline', { x: 0.5, y: 0 }, { x: 0.5, y: 1 }),
  'middle-right': frozenFoldAxis('midline', { x: 0.5, y: 0 }, { x: 0.5, y: 1 }),
});

/**
 * Winding order of the rectangle's four true corners.
 *
 * Deliberately keyed off `Corner` rather than `GrabAnchor`: the reveal polygon
 * is built from this list, and it must not grow to eight members when an edge
 * midpoint is grabbed.
 */
const orderedCornerKeys: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

function validateAnchor(anchor: GrabAnchor): void {
  if (!Object.hasOwn(anchorUv, anchor)) {
    throw new Error(
      `Invalid grab anchor: ${JSON.stringify(anchor)} is not a member of the anchor vocabulary.`,
    );
  }
}

/** Depth-driven scale that fakes perspective under the orthographic camera. */
const PERSPECTIVE_STRENGTH = 0.00042;
/** Darkest shading applied when the sheet is edge-on to the viewer. */
const FACING_FLOOR = 0.32;
/**
 * Fraction of half-width each half keeps at peak curl. A rigid plate would
 * project to a zero-width line when edge-on; a real sheet stays curved, so the
 * turn reads as a peel rather than a sliver that vanishes.
 */
const ARC_BULGE = 0.34;
/**
 * The sheet already prints the destination page on its reverse face, so
 * uncovering the live DOM part-way through drew a second, flat copy of the page
 * that was not part of the fold and hid the card list behind it. The page stays
 * shut until the sheet lands, where the sheet's geometry matches the
 * destination rect exactly and the swap to real DOM is invisible.
 */
function revealProgress(eased: number): number {
  return eased >= 1 ? 1 : 0;
}

export function oppositeAnchor(anchor: GrabAnchor): GrabAnchor {
  validateAnchor(anchor);

  return OPPOSITE_ANCHOR[anchor];
}

export function anchorPoint(rect: Rect, anchor: GrabAnchor): Point {
  validateAnchor(anchor);

  const uv = anchorUv[anchor];

  return {
    x: rect.left + uv.x * rect.width,
    y: rect.top + uv.y * rect.height,
  };
}

/**
 * Index of the mesh vertex sitting exactly on `anchor`.
 *
 * An edge midpoint contributes a `0.5`, so it only lands on a real vertex when
 * the corresponding mesh dimension is even. Rather than round — which would
 * silently address a vertex half a cell off the edge center — the unrepresentable
 * half-step is rejected by name. Corners are exact at any positive integer
 * dimensions, because their components are each exactly `0` or `1`.
 */
export function vertexIndex(anchor: GrabAnchor, columns: number, rows: number): number {
  validateAnchor(anchor);
  validatePositiveInteger(columns, 'columns');
  validatePositiveInteger(rows, 'rows');

  const uv = anchorUv[anchor];
  const column = uv.x * columns;
  const row = uv.y * rows;

  if (!Number.isInteger(column)) {
    throw new Error(
      `Invalid columns for grab anchor ${JSON.stringify(anchor)}: ` +
        `columns of ${columns} places its unit-square x of ${uv.x} between vertices; expected an even columns.`,
    );
  }

  if (!Number.isInteger(row)) {
    throw new Error(
      `Invalid rows for grab anchor ${JSON.stringify(anchor)}: ` +
        `rows of ${rows} places its unit-square y of ${uv.y} between vertices; expected an even rows.`,
    );
  }

  return row * (columns + 1) + column;
}

function clampUnitInterval(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}

/**
 * `clampUnitInterval` alone propagates `NaN`, so the non-finite cases are named
 * here: `+Infinity` saturates to a fully revealed `1`, and `−Infinity` and `NaN`
 * both collapse to the unrevealed `0`.
 */
function clampRevealProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return progress === Number.POSITIVE_INFINITY ? 1 : 0;
  }

  return clampUnitInterval(progress);
}

function validateFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: expected a finite number.`);
  }
}

function validatePositiveNumber(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (value <= 0) {
    throw new Error(`Invalid ${field}: expected a number greater than 0.`);
  }
}

function validatePositiveInteger(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${field}: expected an integer greater than or equal to 1.`);
  }
}

function validateRect(rect: Rect, field: string): void {
  validateFiniteNumber(rect.left, `${field}.left`);
  validateFiniteNumber(rect.top, `${field}.top`);
  validatePositiveNumber(rect.width, `${field}.width`);
  validatePositiveNumber(rect.height, `${field}.height`);
}

/**
 * Both mesh dimensions must be even, unconditionally.
 *
 * An edge-midpoint anchor's `uv` component of `0.5` only lands on a real mesh
 * vertex when the corresponding dimension is even, and which of the eight
 * anchors is grabbed is decided by the live layout at activation — so a profile
 * has to be usable for all eight rather than for the anchor of the moment.
 *
 * Both odd fields are named in one message: a designer halving one dimension
 * has usually halved the other too, and reporting one at a time turns that into
 * two round trips.
 */
function validateEvenMesh(profile: MotionProfile): void {
  const oddFields: string[] = [];

  if (!Number.isInteger(profile.meshColumns / 2)) {
    oddFields.push('profile.meshColumns');
  }

  if (!Number.isInteger(profile.meshRows / 2)) {
    oddFields.push('profile.meshRows');
  }

  if (oddFields.length > 0) {
    throw new Error(
      `Invalid ${oddFields.join(' and ')}: expected an even integer greater than or equal to 2, ` +
        'so that an edge-midpoint grab anchor lands on a real mesh vertex.',
    );
  }
}

/**
 * Exported so the renderer can run the same checks before it allocates a mesh,
 * a texture, or the overlay element — an odd mesh dimension then fails into the
 * existing full-motion fallback instead of mid-animation.
 */
export function validateProfile(profile: MotionProfile): void {
  validatePositiveInteger(profile.meshColumns, 'profile.meshColumns');
  validatePositiveInteger(profile.meshRows, 'profile.meshRows');
  validateEvenMesh(profile);
  validatePositiveNumber(profile.foldSoftness, 'profile.foldSoftness');
  validateFiniteNumber(profile.bendDepth, 'profile.bendDepth');
  validateFiniteNumber(profile.edgeCurvature, 'profile.edgeCurvature');
}

function easedProgress(progress: number, profile: MotionProfile): number {
  validateFiniteNumber(progress, 'progress');

  const eased = profile.easing(clampUnitInterval(progress));

  if (!Number.isFinite(eased)) {
    throw new Error('Invalid profile.easing: expected a finite number.');
  }

  return clampUnitInterval(eased);
}

function mix(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

function orderedCorners(rect: Rect): [Point, Point, Point, Point] {
  return orderedCornerKeys.map((corner) => anchorPoint(rect, corner)) as [Point, Point, Point, Point];
}

function lerpRect(source: Rect, destination: Rect, progress: number): Rect {
  return {
    left: mix(source.left, destination.left, progress),
    top: mix(source.top, destination.top, progress),
    width: mix(source.width, destination.width, progress),
    height: mix(source.height, destination.height, progress),
  };
}

export interface FoldBasis {
  origin: Point;
  axis: Point;
  normal: Point;
  axisLength: number;
  maxPerp: number;
}

/**
 * The sheet turns about the line joining the two anchors that stay put — the
 * far diagonal for a corner grab, a midline for an edge-midpoint grab —
 * expressed in normalized card space so a half-turn is an exact reflection.
 * In pixel space a diagonal is not a symmetry axis unless the rect is square,
 * so rotating there would leave the corners short of each other.
 *
 * Both families produce the same `FoldBasis` shape, which is the whole reason
 * the per-vertex deformation reads only this basis and never the axis kind.
 */
export function foldBasis(grabbed: GrabAnchor): FoldBasis {
  validateAnchor(grabbed);

  const grabbedUv = anchorUv[grabbed];
  const { origin, far } = FOLD_AXIS[grabbed];
  const deltaX = far.x - origin.x;
  const deltaY = far.y - origin.y;
  const axisLength = Math.hypot(deltaX, deltaY);
  const axis = { x: deltaX / axisLength, y: deltaY / axisLength };
  const toGrabbed = { x: grabbedUv.x - origin.x, y: grabbedUv.y - origin.y };
  const candidate = { x: -axis.y, y: axis.x };
  const normal =
    candidate.x * toGrabbed.x + candidate.y * toGrabbed.y >= 0
      ? candidate
      : { x: axis.y, y: -axis.x };

  return {
    // Copied out of the frozen table so the basis a caller receives is its own.
    origin: { x: origin.x, y: origin.y },
    axis,
    normal,
    axisLength,
    maxPerp: normal.x * toGrabbed.x + normal.y * toGrabbed.y,
  };
}

/**
 * How far a unit-square point sits behind the reveal front, measured along the
 * fold-basis normal and scaled so the sweep is anchor-independent:
 *
 * - `0` at the grab anchor, where the sheet lifts first,
 * - `1` everywhere on the fold axis,
 * - `2` at the pivot anchor, which is uncovered last,
 * - constant along every line parallel to the fold axis, because only the
 *   perpendicular component is read.
 *
 * For each of the four corner anchors this is algebraically the old
 * `|u − gx| + |v − gy|` L1 metric — for `top-right` both reduce to `1 − u + v` —
 * so corner reveal output is unchanged. Unlike the L1 form it stays total for an
 * edge midpoint: for `top-center` it reduces to `2v`, a band growing downward
 * from the top edge, where L1 left every corner outside the front for any
 * `0 < progress < 0.25` and emitted a pointless `polygon()`.
 */
function frontDistance(basis: FoldBasis, u: number, v: number): number {
  const offsetX = u - basis.origin.x;
  const offsetY = v - basis.origin.y;
  const perp = offsetX * basis.normal.x + offsetY * basis.normal.y;

  return (basis.maxPerp - perp) / basis.maxPerp;
}

function clipViewport(rect: Rect, grabbed: GrabAnchor, progress: number): Point[] {
  const basis = foldBasis(grabbed);
  const threshold = progress * 2;
  const normalized = orderedCorners(rect).map((point) => {
    const u = (point.x - rect.left) / rect.width;
    const v = (point.y - rect.top) / rect.height;

    return {
      point,
      distance: frontDistance(basis, u, v),
    };
  });
  const output: Point[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    const currentInside = current.distance <= threshold;
    const nextInside = next.distance <= threshold;

    if (currentInside) {
      output.push(current.point);
    }

    if (currentInside !== nextInside) {
      // Reached only when the two corners fall on opposite sides of the
      // threshold, which requires distinct `frontDistance` values — so the
      // denominator is never `0` and the crossing point is always finite.
      const edgeProgress = (threshold - current.distance) / (next.distance - current.distance);
      output.push({
        x: mix(current.point.x, next.point.x, edgeProgress),
        y: mix(current.point.y, next.point.y, edgeProgress),
      });
    }
  }

  return output;
}

function percent(value: number): string {
  return `${value}%`;
}

/**
 * Builds the destination clip polygon for a sweep across `shape`, expressed in
 * percentages of `reference`. Keeping the two rects separate lets the reveal
 * follow the turning sheet's own footprint instead of wiping the whole
 * viewport before the sheet has swept over it.
 */
function clipPathBetween(shape: Rect, reference: Rect, grabbed: GrabAnchor, progress: number): string {
  const clamped = clampRevealProgress(progress);
  const toPercent = (point: Point): string => {
    const x = ((point.x - reference.left) / reference.width) * 100;
    const y = ((point.y - reference.top) / reference.height) * 100;

    return `${percent(x)} ${percent(y)}`;
  };

  if (clamped <= 0) {
    const collapsed = toPercent(anchorPoint(shape, grabbed));

    return `polygon(${collapsed}, ${collapsed}, ${collapsed})`;
  }

  return `polygon(${clipViewport(shape, grabbed, clamped).map(toPercent).join(', ')})`;
}

/**
 * A clip is a purely visual quantity with a defined answer at every progress —
 * nothing is uncovered below `0` and everything is uncovered above `1` — so an
 * out-of-range or non-finite progress clamps rather than throwing. The rect
 * still validates, because a degenerate rect has no percentages to report.
 */
export function revealClipPath(rect: Rect, grabbed: GrabAnchor, progress: number): string {
  validateRect(rect, 'rect');

  return clipPathBetween(rect, rect, grabbed, progress);
}

/**
 * Texture coordinates for the sheet's reverse face.
 *
 * The sheet is one piece of paper: the tile is printed on the front and the
 * destination page on the back. Turning it over reflects the back across the
 * fold axis, so the back samples the mirrored uv rather than the front's. At
 * rest the back therefore reads as the page mirrored and shrunk onto the tile;
 * at the end of the turn the front reads as the tile mirrored and stretched
 * across the page.
 *
 * The reflection is fixed for a given grab anchor, so this is a static
 * attribute rather than per-frame work.
 *
 * The body reads nothing but the fold basis, so the reflection generalizes to
 * all eight anchors with the fold-axis table: a midline anchor mirrors uv about
 * a centerline where a corner anchor mirrors about a diagonal.
 *
 * Evenness of the mesh dimensions is deliberately not a precondition. The
 * reflection is defined at every vertex whether or not a vertex happens to sit
 * on the anchor itself, so requiring it here would reject meshes this function
 * handles exactly.
 */
export function backFaceUvs(grabbed: GrabAnchor, columns: number, rows: number): Float32Array {
  // Every argument is checked before the output buffer is allocated, so a bad
  // dimension leaves no partial coordinate data behind.
  validateAnchor(grabbed);
  validatePositiveInteger(columns, 'columns');
  validatePositiveInteger(rows, 'rows');

  const basis = foldBasis(grabbed);
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;

    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const offsetX = u - basis.origin.x;
      const offsetY = v - basis.origin.y;
      const along = offsetX * basis.axis.x + offsetY * basis.axis.y;
      const perp = offsetX * basis.normal.x + offsetY * basis.normal.y;
      const index = (row * (columns + 1) + column) * 2;

      uvs[index] = basis.origin.x + along * basis.axis.x - perp * basis.normal.x;
      uvs[index + 1] = basis.origin.y + along * basis.axis.y - perp * basis.normal.y;
    }
  }

  return uvs;
}

/**
 * One frame of the turn, for any of the eight grab anchors.
 *
 * The per-vertex loop consumes the fold basis and nothing else — it never reads
 * the fold-axis kind — because both families normalize into the same two ranges:
 *
 * - `acrossFold = perp / maxPerp ∈ [−1, 1]`. Midline: `maxPerp` is `0.5` and
 *   `perp` is the signed offset from the centerline, itself bounded by `0.5`.
 *   Diagonal: `maxPerp` is `1 / √2` and `perp` is `(u − v) / √2` or
 *   `(u + v − 1) / √2`, both bounded by `1 / √2`.
 * - `along / axisLength ∈ [0, 1]`. Midline: `along` is `u` or `v` over an
 *   `axisLength` of `1`. Diagonal: `along` is `(u + v) / √2` or its reflection
 *   over an `axisLength` of `√2`, so the quotient is `(u + v) / 2`.
 *
 * So the profile tunables and `ARC_BULGE` need no per-family retuning, and the
 * `sin(π / 2 · acrossFold)` bulge stays as written: it is odd about the axis and
 * continuous through it, so no term branches on `sign(acrossFold)`.
 *
 * `baseRect` is `lerpRect(source, destination, eased)`, computed before the
 * basis and independent of the anchor, which keeps the sheet footprint a
 * growing rectangle for all eight anchors.
 */
export function buildPaperFrame(
  source: Rect,
  destination: Rect,
  grabbed: GrabAnchor,
  progress: number,
  profile: MotionProfile,
): PaperFrame {
  // Every validation runs before a single buffer is allocated or a single
  // vertex is written, so a bad profile propagates with the arguments untouched
  // and no partial frame in flight.
  validateRect(source, 'source');
  validateRect(destination, 'destination');
  validateProfile(profile);

  const eased = easedProgress(progress, profile);
  const baseRect = lerpRect(source, destination, eased);
  const basis = foldBasis(grabbed);
  const vertexCount = (profile.meshColumns + 1) * (profile.meshRows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const shade = new Float32Array(vertexCount);
  const turn = Math.PI * eased;
  const lift = Math.sin(turn);
  const centerX = baseRect.left + baseRect.width / 2;
  const centerY = baseRect.top + baseRect.height / 2;

  for (let row = 0; row <= profile.meshRows; row += 1) {
    const v = row / profile.meshRows;

    for (let column = 0; column <= profile.meshColumns; column += 1) {
      const u = column / profile.meshColumns;
      const index = row * (profile.meshColumns + 1) + column;
      const offsetX = u - basis.origin.x;
      const offsetY = v - basis.origin.y;
      const along = offsetX * basis.axis.x + offsetY * basis.axis.y;
      const perp = offsetX * basis.normal.x + offsetY * basis.normal.y;
      const acrossFold = perp / basis.maxPerp;

      // The grabbed half leads the tucked half, so the sheet stays curved
      // through the turn instead of collapsing edge-on all at once.
      const localTurn = turn + profile.foldSoftness * lift * acrossFold;
      const localCos = Math.cos(localTurn);
      const localSin = Math.sin(localTurn);
      const ridge = Math.sin(Math.PI * clampUnitInterval(along / basis.axisLength));
      // Smooth across the fold: a sign() step here would tear the mesh into
      // visible stair steps where triangles straddle the axis.
      const bulge =
        basis.maxPerp * ARC_BULGE * lift * ridge * Math.sin((Math.PI / 2) * acrossFold);
      const turnedPerp = perp * localCos + bulge;
      const turnedU = basis.origin.x + along * basis.axis.x + turnedPerp * basis.normal.x;
      const turnedV = basis.origin.y + along * basis.axis.y + turnedPerp * basis.normal.y;
      const depth = acrossFold * localSin * profile.bendDepth + profile.edgeCurvature * localSin * ridge;
      const scale = 1 + depth * PERSPECTIVE_STRENGTH;
      const flatX = baseRect.left + turnedU * baseRect.width;
      const flatY = baseRect.top + turnedV * baseRect.height;

      positions[index * 3] = centerX + (flatX - centerX) * scale;
      positions[index * 3 + 1] = centerY + (flatY - centerY) * scale;
      positions[index * 3 + 2] = depth;
      shade[index] = clampUnitInterval(FACING_FLOOR + (1 - FACING_FLOOR) * Math.abs(localCos));
    }
  }

  return {
    positions,
    shade,
    lift,
    alpha: 1,
    revealClipPath: clipPathBetween(baseRect, destination, grabbed, revealProgress(eased)),
  };
}
