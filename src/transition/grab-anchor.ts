import type { ColumnBand, GrabAnchor, GridPosition, Rect, RowBand } from './types';

/**
 * Tolerance, in CSS pixels, within which two measured rect edges count as
 * belonging to the same row or column.
 *
 * Sub-pixel layout rounding stays well under one pixel, and fractional zoom or
 * device-pixel-ratio scaling can push it slightly past that. Two pixels absorbs
 * both while staying far below the separation between genuine rows or columns,
 * which is at least a tile dimension plus the grid gap.
 *
 * This lives here rather than on `MotionProfile` on purpose: it describes a
 * measurement artifact of the layout engine, not a design-tunable knob of the
 * motion, so it is deliberately **not** a `MotionProfile` field.
 */
export const GRID_CLUSTER_TOLERANCE_PX = 2;

/**
 * The anchor used for a lone tile, and the collapse target for any grid
 * position that cannot be trusted.
 */
export const SINGLE_TILE_ANCHOR: GrabAnchor = 'bottom-right';

/** One axis of a measured grid, resolved into clusters of near-equal values. */
export interface AxisClustering {
  /** Cluster index per supplied value, in the order the values were supplied. */
  clusterIndex: number[];
  /** Number of distinct clusters found; at least `1`. */
  clusterCount: number;
}

/**
 * Group one-dimensional measured values — rect `top`s for rows, `left`s for
 * columns — into clusters of near-equal values.
 *
 * Values are visited in ascending order and each candidate is compared against
 * the **smallest** value of the cluster under construction; a new cluster opens
 * only when that difference is strictly greater than the tolerance. So `0`, `2`
 * and `4` at a tolerance of `2` form exactly two clusters, not one.
 *
 * Comparing against the cluster's first value rather than the previous value is
 * load-bearing: chaining off the previous value lets a long run of tiles each
 * drifting by `tolerance` merge into a single cluster.
 *
 * Cluster `0` holds the smallest value, so row `0` is the topmost measured row
 * and column `0` the leftmost. Equal values land in the same cluster, indices
 * are non-decreasing in value, every index is in `[0, clusterCount)`, and every
 * member of a cluster is within the tolerance of that cluster's smallest
 * member.
 *
 * Exactly one sort per call. Pure: no module state, no DOM read, no clock read,
 * and `values` is not mutated.
 *
 * @param values Non-empty list of finite measured values.
 * @param tolerance Finite, non-negative. Defaults to `GRID_CLUSTER_TOLERANCE_PX`.
 */
export function clusterAxis(
  values: readonly number[],
  tolerance = GRID_CLUSTER_TOLERANCE_PX,
): AxisClustering {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('Invalid tolerance: expected a finite number greater than or equal to 0.');
  }

  if (values.length < 1) {
    throw new Error('Invalid values: expected at least one value to cluster.');
  }

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid values[${index}]: expected a finite number.`);
    }
  });

  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const clusterIndex = values.map(() => 0);
  let smallestInCluster = ordered[0]!.value;
  let current = 0;

  for (const entry of ordered) {
    if (entry.value - smallestInCluster > tolerance) {
      current += 1;
      smallestInCluster = entry.value;
    }

    clusterIndex[entry.index] = current;
  }

  return { clusterIndex, clusterCount: current + 1 };
}
/**
 * The grid position of a lone tile, and the collapse target for any measured
 * layout in which the activated tile cannot be placed.
 *
 * Returned as a fresh object on every call so a caller mutating the result
 * cannot corrupt a later resolution.
 */
function singleTilePosition(): GridPosition {
  return { rowIndex: 0, rowCount: 1, columnIndex: 0, columnCount: 1 };
}

/** A rect is measurable only when it encloses a finite, non-empty area. */
function isVisible(rect: Rect | undefined): rect is Rect {
  return (
    rect !== undefined &&
    Number.isFinite(rect.width) &&
    rect.width > 0 &&
    Number.isFinite(rect.height) &&
    rect.height > 0 &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.left)
  );
}

/**
 * Place the activated tile in the grid its siblings describe, by clustering the
 * measured rect edges rather than parsing CSS track definitions.
 *
 * Rows come from clustering the visible `top` values and columns from clustering
 * the visible `left` values; no other rect member feeds the clustering. Tiles
 * that are collapsed or unmeasurable — zero or non-finite `width` or `height`,
 * non-finite `top` or `left` — are filtered out first, so they invent no phantom
 * rows or columns, and the activated tile's indices are taken from its position
 * among the retained tiles alone.
 *
 * Total: it never throws. The single-tile position
 * `{ rowIndex: 0, rowCount: 1, columnIndex: 0, columnCount: 1 }` is returned
 * whenever the target is absent from the visible set — an empty rect list, a
 * negative, non-integer, or out-of-range `targetIndex`, or an activated rect
 * that is itself unmeasurable — and for an unusable tolerance. Every returned
 * position satisfies the `GridPosition` validation rules: both counts are
 * integers of at least `1`, and each index lies within its count.
 *
 * Pure: no module state, no DOM read, no clock read, and neither `rects` nor its
 * members are mutated.
 *
 * @param rects Measured tile rects in document order.
 * @param targetIndex 0-based position of the activated tile within `rects`.
 * @param tolerance Finite, non-negative. Defaults to `GRID_CLUSTER_TOLERANCE_PX`.
 */
export function gridPositionFromRects(
  rects: readonly Rect[],
  targetIndex: number,
  tolerance = GRID_CLUSTER_TOLERANCE_PX,
): GridPosition {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return singleTilePosition();
  }

  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= rects.length) {
    return singleTilePosition();
  }

  const tops: number[] = [];
  const lefts: number[] = [];
  let target = -1;

  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];

    if (!isVisible(rect)) {
      continue;
    }

    if (index === targetIndex) {
      target = tops.length;
    }

    tops.push(rect.top);
    lefts.push(rect.left);
  }

  if (target < 0) {
    return singleTilePosition();
  }

  const rows = clusterAxis(tops, tolerance);
  const columns = clusterAxis(lefts, tolerance);

  return {
    rowIndex: rows.clusterIndex[target]!,
    rowCount: rows.clusterCount,
    columnIndex: columns.clusterIndex[target]!,
    columnCount: columns.clusterCount,
  };
}
/**
 * Classify a row index into its band.
 *
 * The `top` test runs before the `bottom` test, so a `rowCount` of `1`
 * classifies index `0` as `top` rather than as `bottom`. Single-row grids never
 * reach the band table — the degenerate rules in `anchorForGridPosition` claim
 * them first — but the ordering is part of the classification contract and is
 * asserted directly.
 */
function rowBand(rowIndex: number, rowCount: number): RowBand {
  if (rowIndex === 0) {
    return 'top';
  }

  if (rowIndex === rowCount - 1) {
    return 'bottom';
  }

  return 'middle';
}

/**
 * Classify a column index into its band.
 *
 * A `center` band exists only for an odd `columnCount`, where it holds the
 * single index `(columnCount - 1) / 2`. An even count has no center column at
 * all: the tie-break sends `index < columnCount / 2` to `left` and the rest to
 * `right`, splitting the tiles evenly toward whichever edge each is nearer. So a
 * 4-column grid resolves `0, 1 → left` and `2, 3 → right`, while a 5-column grid
 * resolves `0, 1 → left`, `2 → center`, and `3, 4 → right`.
 */
function columnBand(columnIndex: number, columnCount: number): ColumnBand {
  const hasTrueCenter = columnCount % 2 === 1;

  if (hasTrueCenter && columnIndex === (columnCount - 1) / 2) {
    return 'center';
  }

  return columnIndex < columnCount / 2 ? 'left' : 'right';
}

/**
 * The anchor for every band pair of a non-degenerate grid — both counts at least
 * `2`.
 *
 * Rows that are neither top nor bottom take the edge **midpoint** on their side
 * rather than a corner, so the sheet folds about a midline. The `middle`/`center`
 * cell grabbing `top-center` is the one intentional break in the table's
 * vertical-mirror symmetry: a tile with no edge affinity in either direction has
 * to pick a direction, and grabbing from the top matches the page-turn
 * convention the rest of the table follows.
 */
const ANCHOR_TABLE: Readonly<Record<RowBand, Readonly<Record<ColumnBand, GrabAnchor>>>> =
  Object.freeze({
    top: Object.freeze({
      left: 'top-left',
      center: 'top-center',
      right: 'top-right',
    } as const),
    middle: Object.freeze({
      left: 'middle-left',
      center: 'top-center',
      right: 'middle-right',
    } as const),
    bottom: Object.freeze({
      left: 'bottom-left',
      center: 'bottom-center',
      right: 'bottom-right',
    } as const),
  } as const);

/** Does the position satisfy every `GridPosition` validation rule? */
function isWellFormed(position: GridPosition): boolean {
  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  return (
    Number.isInteger(rowCount) &&
    rowCount >= 1 &&
    Number.isInteger(columnCount) &&
    columnCount >= 1 &&
    Number.isInteger(rowIndex) &&
    rowIndex >= 0 &&
    rowIndex < rowCount &&
    Number.isInteger(columnIndex) &&
    columnIndex >= 0 &&
    columnIndex < columnCount
  );
}

/**
 * Resolve a grid position to the anchor the sheet is grabbed by.
 *
 * Three stages, in this order:
 *
 * 1. **Well-formedness.** Any non-finite, non-integer, negative, or out-of-range
 *    member collapses the whole position — remaining members disregarded — to
 *    `SINGLE_TILE_ANCHOR`. `Number.isInteger` rejects `NaN` and both infinities,
 *    so no separate finiteness test is needed.
 * 2. **Degenerate shapes**, which override the band table. A `1 x 1` grid is both
 *    degenerate cases at once and resolves to `bottom-right`, which is what both
 *    rules agree on when the ambiguous axis prefers its *last* position. A single
 *    column resolves `top-right` / `top-center` / `bottom-right` for its first,
 *    interior, and last tiles; a single row is the transpose of that under
 *    `(u, v) -> (v, u)`, giving `bottom-left` / `middle-left` / `bottom-right`.
 * 3. **The band table**, for both counts at least `2`.
 *
 * Total by construction: it never throws and always returns one of the eight
 * anchors. Pure: no module state, no DOM read, no clock read, and `position` is
 * not mutated.
 */
export function anchorForGridPosition(position: GridPosition): GrabAnchor {
  if (!isWellFormed(position)) {
    return SINGLE_TILE_ANCHOR;
  }

  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  if (rowCount === 1 && columnCount === 1) {
    return 'bottom-right';
  }

  if (columnCount === 1) {
    if (rowIndex === 0) {
      return 'top-right';
    }

    if (rowIndex === rowCount - 1) {
      return 'bottom-right';
    }

    return 'top-center';
  }

  if (rowCount === 1) {
    if (columnIndex === 0) {
      return 'bottom-left';
    }

    if (columnIndex === columnCount - 1) {
      return 'bottom-right';
    }

    return 'middle-left';
  }

  return ANCHOR_TABLE[rowBand(rowIndex, rowCount)][columnBand(columnIndex, columnCount)];
}

/**
 * Resolve the grab anchor for the activated tile from the measured layout of it
 * and its siblings — the module's entry point, and the composition of its two
 * halves.
 *
 * Total by construction: `gridPositionFromRects` never throws and always yields a
 * well-formed position, and `anchorForGridPosition` is total over every position.
 * An empty rect list, an out-of-range index, or an unmeasurable activated rect
 * therefore collapses to `SINGLE_TILE_ANCHOR` rather than failing the activation.
 *
 * Pure: no module state, no DOM read, no clock read, and neither `tileRects` nor
 * its members are mutated, so repeated calls with equal inputs return equal
 * anchors.
 *
 * @param tileRects Measured tile rects in document order.
 * @param targetIndex 0-based position of the activated tile within `tileRects`.
 * @param tolerance Finite, non-negative. Defaults to `GRID_CLUSTER_TOLERANCE_PX`.
 */
export function resolveGrabAnchor(
  tileRects: readonly Rect[],
  targetIndex: number,
  tolerance = GRID_CLUSTER_TOLERANCE_PX,
): GrabAnchor {
  return anchorForGridPosition(gridPositionFromRects(tileRects, targetIndex, tolerance));
}
