import type { Corner, MotionProfile, PaperFrame, Point, Rect } from './types';

export const cornerUv: Record<Corner, Point> = {
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-left': { x: 0, y: 1 },
};

const orderedCornerKeys: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/** Depth-driven scale that fakes perspective under the orthographic camera. */
const PERSPECTIVE_STRENGTH = 0.00042;
/** Darkest shading applied when the sheet is edge-on to the viewer. */
const FACING_FLOOR = 0.32;
/** Eased progress at which the destination page is fully uncovered. */
const REVEAL_COMPLETE_AT = 0.92;
/**
 * Fraction of half-width each half keeps at peak curl. A rigid plate would
 * project to a zero-width line when edge-on; a real sheet stays curved, so the
 * turn reads as a peel rather than a sliver that vanishes.
 */
const ARC_BULGE = 0.34;
function revealProgress(eased: number): number {
  return Math.min(1, Math.max(0, eased / REVEAL_COMPLETE_AT));
}

export function oppositeCorner(corner: Corner): Corner {
  const opposites: Record<Corner, Corner> = {
    'top-left': 'bottom-right',
    'top-right': 'bottom-left',
    'bottom-right': 'top-left',
    'bottom-left': 'top-right',
  };

  return opposites[corner];
}

export function cornerPoint(rect: Rect, corner: Corner): Point {
  const uv = cornerUv[corner];

  return {
    x: rect.left + uv.x * rect.width,
    y: rect.top + uv.y * rect.height,
  };
}

export function vertexIndex(corner: Corner, columns: number, rows: number): number {
  const uv = cornerUv[corner];
  return uv.y * rows * (columns + 1) + uv.x * columns;
}

function clampUnitInterval(progress: number): number {
  return Math.min(1, Math.max(0, progress));
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

function validateProfile(profile: MotionProfile): void {
  validatePositiveInteger(profile.meshColumns, 'profile.meshColumns');
  validatePositiveInteger(profile.meshRows, 'profile.meshRows');
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
  return orderedCornerKeys.map((corner) => cornerPoint(rect, corner)) as [Point, Point, Point, Point];
}

function lerpRect(source: Rect, destination: Rect, progress: number): Rect {
  return {
    left: mix(source.left, destination.left, progress),
    top: mix(source.top, destination.top, progress),
    width: mix(source.width, destination.width, progress),
    height: mix(source.height, destination.height, progress),
  };
}

interface FoldBasis {
  origin: Point;
  axis: Point;
  normal: Point;
  axisLength: number;
  maxPerp: number;
}

/**
 * The sheet turns about the diagonal joining the two corners that stay put,
 * expressed in normalized card space so a half-turn is an exact reflection.
 * In pixel space that diagonal is not a symmetry axis unless the rect is
 * square, so rotating there would leave the corners short of each other.
 */
function foldBasis(grabbed: Corner): FoldBasis {
  const grabbedUv = cornerUv[grabbed];
  const origin = { x: grabbedUv.x, y: 1 - grabbedUv.y };
  const far = { x: 1 - grabbedUv.x, y: grabbedUv.y };
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
    origin,
    axis,
    normal,
    axisLength,
    maxPerp: normal.x * toGrabbed.x + normal.y * toGrabbed.y,
  };
}

function clipViewport(rect: Rect, grabbed: Corner, progress: number): Point[] {
  const grabbedUv = cornerUv[grabbed];
  const threshold = progress * 2;
  const normalized = orderedCorners(rect).map((point) => {
    const u = (point.x - rect.left) / rect.width;
    const v = (point.y - rect.top) / rect.height;

    return {
      point,
      distance: Math.abs(u - grabbedUv.x) + Math.abs(v - grabbedUv.y),
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
function clipPathBetween(shape: Rect, reference: Rect, grabbed: Corner, progress: number): string {
  const toPercent = (point: Point): string => {
    const x = ((point.x - reference.left) / reference.width) * 100;
    const y = ((point.y - reference.top) / reference.height) * 100;

    return `${percent(x)} ${percent(y)}`;
  };

  if (progress <= 0) {
    const collapsed = toPercent(cornerPoint(shape, grabbed));

    return `polygon(${collapsed}, ${collapsed}, ${collapsed})`;
  }

  return `polygon(${clipViewport(shape, grabbed, Math.min(1, progress))
    .map(toPercent)
    .join(', ')})`;
}

export function revealClipPath(rect: Rect, grabbed: Corner, progress: number): string {
  validateRect(rect, 'rect');
  validateFiniteNumber(progress, 'progress');

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
 * The reflection is fixed for a given grabbed corner, so this is a static
 * attribute rather than per-frame work.
 */
export function backFaceUvs(grabbed: Corner, columns: number, rows: number): Float32Array {
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

export function buildPaperFrame(  source: Rect,
  destination: Rect,
  grabbed: Corner,
  progress: number,
  profile: MotionProfile,
): PaperFrame {
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
