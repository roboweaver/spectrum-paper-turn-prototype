import { describe, expect, it, vi } from 'vitest';
import {
  anchorForGridPosition,
  clusterAxis,
  GRID_CLUSTER_TOLERANCE_PX,
  gridPositionFromRects,
  resolveGrabAnchor,
  SINGLE_TILE_ANCHOR,
} from '../../src/transition/grab-anchor';
import type {
  ColumnBand,
  GrabAnchor,
  GridPosition,
  Rect,
  RowBand,
} from '../../src/transition/types';

/**
 * The grid shapes the suite enumerates: every `rowCount` and `columnCount` in
 * `[1, 8]`, so 64 shapes covering 1,296 shape-and-cell combinations in total.
 * No shape, cell, or anchor is sampled at random.
 */
const AXIS_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Row band per row index, written out by hand for each `rowCount` in `[2, 8]`
 * rather than derived from the implementation's classifier, so the two can
 * disagree. Index `0` is `top`, index `rowCount - 1` is `bottom`, and everything
 * between is `middle` — which is why a 2-row grid has no `middle` entry at all
 * and therefore no cell resolving to `middle-left` or `middle-right`.
 */
const EXPECTED_ROW_BANDS: Readonly<Record<number, readonly RowBand[]>> = {
  2: ['top', 'bottom'],
  3: ['top', 'middle', 'bottom'],
  4: ['top', 'middle', 'middle', 'bottom'],
  5: ['top', 'middle', 'middle', 'middle', 'bottom'],
  6: ['top', 'middle', 'middle', 'middle', 'middle', 'bottom'],
  7: ['top', 'middle', 'middle', 'middle', 'middle', 'middle', 'bottom'],
  8: ['top', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle', 'bottom'],
};

/**
 * Column band per column index, likewise written out by hand for each
 * `columnCount` in `[2, 8]`.
 *
 * An odd count has exactly one `center` index, `(columnCount - 1) / 2`. An even
 * count has none: the tie-break splits the indices evenly, sending the lower half
 * to `left` and the upper half to `right`. So `columnCount` `4` reads
 * `left, left, right, right` and `columnCount` `5` reads
 * `left, left, center, right, right`.
 */
const EXPECTED_COLUMN_BANDS: Readonly<Record<number, readonly ColumnBand[]>> = {
  2: ['left', 'right'],
  3: ['left', 'center', 'right'],
  4: ['left', 'left', 'right', 'right'],
  5: ['left', 'left', 'center', 'right', 'right'],
  6: ['left', 'left', 'left', 'right', 'right', 'right'],
  7: ['left', 'left', 'left', 'center', 'right', 'right', 'right'],
  8: ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right'],
};

/**
 * The band table for a non-degenerate grid — both counts at least `2` — written
 * independently of the module's own table.
 *
 * The `middle`/`center` entry is `top-center`, not a center-of-the-sheet value:
 * the fully centered tile is the one intentional break in the table's
 * vertical-mirror symmetry.
 */
const EXPECTED_BAND_TABLE: Readonly<Record<RowBand, Readonly<Record<ColumnBand, GrabAnchor>>>> = {
  top: { left: 'top-left', center: 'top-center', right: 'top-right' },
  middle: { left: 'middle-left', center: 'top-center', right: 'middle-right' },
  bottom: { left: 'bottom-left', center: 'bottom-center', right: 'bottom-right' },
};

/** The single-column degenerate row: first, interior, and last tiles. */
const EXPECTED_SINGLE_COLUMN = {
  first: 'top-right',
  interior: 'top-center',
  last: 'bottom-right',
} as const satisfies Record<string, GrabAnchor>;

/** The single-row degenerate row, the transpose of the single-column one. */
const EXPECTED_SINGLE_ROW = {
  first: 'bottom-left',
  interior: 'middle-left',
  last: 'bottom-right',
} as const satisfies Record<string, GrabAnchor>;

/** The lone tile, which is both degenerate cases at once. */
const EXPECTED_SINGLE_TILE: GrabAnchor = 'bottom-right';

/**
 * The anchor the spec's tables say a grid position resolves to, computed here
 * from the hand-written tables above with no reference to the implementation.
 *
 * Degenerate shapes are decided first and never consult the band tables: `1 x 1`
 * outranks both single-axis rules, and a single column or single row uses its own
 * three-value row.
 */
function expectedAnchor(position: GridPosition): GrabAnchor {
  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  if (rowCount === 1 && columnCount === 1) {
    return EXPECTED_SINGLE_TILE;
  }

  if (columnCount === 1) {
    if (rowIndex === 0) {
      return EXPECTED_SINGLE_COLUMN.first;
    }

    return rowIndex === rowCount - 1
      ? EXPECTED_SINGLE_COLUMN.last
      : EXPECTED_SINGLE_COLUMN.interior;
  }

  if (rowCount === 1) {
    if (columnIndex === 0) {
      return EXPECTED_SINGLE_ROW.first;
    }

    return columnIndex === columnCount - 1
      ? EXPECTED_SINGLE_ROW.last
      : EXPECTED_SINGLE_ROW.interior;
  }

  const rows = EXPECTED_ROW_BANDS[rowCount];
  const columns = EXPECTED_COLUMN_BANDS[columnCount];

  if (rows === undefined || columns === undefined) {
    throw new Error(`No expected bands authored for a ${rowCount} x ${columnCount} grid.`);
  }

  const rowBand = rows[rowIndex];
  const columnBand = columns[columnIndex];

  if (rowBand === undefined || columnBand === undefined) {
    throw new Error(
      `No expected band for cell (${rowIndex}, ${columnIndex}) of a ${rowCount} x ${columnCount} grid.`,
    );
  }

  return EXPECTED_BAND_TABLE[rowBand][columnBand];
}

/** Every cell of every enumerated shape, in a stable, fully determined order. */
function everyCell(): GridPosition[] {
  const cells: GridPosition[] = [];

  for (const rowCount of AXIS_COUNTS) {
    for (const columnCount of AXIS_COUNTS) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          cells.push({ rowIndex, rowCount, columnIndex, columnCount });
        }
      }
    }
  }

  return cells;
}

/**
 * A failure report carrying the grid shape as supplied alongside both anchors, so
 * a failing case is reproducible from the report alone with no shrinking step.
 */
function describeCase(position: GridPosition, actual: GrabAnchor, expected: GrabAnchor): string {
  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  return `shape ${rowCount}x${columnCount} cell (row ${rowIndex}, column ${columnIndex}): resolved ${actual}, expected ${expected}`;
}

describe('anchorForGridPosition — Property 8: resolution agrees with the table', () => {
  it('enumerates all 64 shapes and 1,296 shape-and-cell combinations', () => {
    const cells = everyCell();
    const shapes = new Set(cells.map(({ rowCount, columnCount }) => `${rowCount}x${columnCount}`));

    expect(shapes.size).toBe(64);
    expect(cells).toHaveLength(1_296);
  });

  it('returns the documented anchor for every cell of every shape', () => {
    const mismatches = everyCell().flatMap((position) => {
      const actual = anchorForGridPosition(position);
      const expected = expectedAnchor(position);

      return actual === expected ? [] : [describeCase(position, actual, expected)];
    });

    expect(mismatches).toEqual([]);
  });

  it('resolves equal grid positions to equal anchors', () => {
    const mismatches = everyCell().flatMap((position) => {
      const first = anchorForGridPosition(position);
      const second = anchorForGridPosition({ ...position });

      return first === second ? [] : [describeCase(position, second, first)];
    });

    expect(mismatches).toEqual([]);
  });

  it('resolves the lone tile to bottom-right, outranking both single-axis rules', () => {
    expect(anchorForGridPosition({ rowIndex: 0, rowCount: 1, columnIndex: 0, columnCount: 1 })).toBe(
      'bottom-right',
    );
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('walks a single column of %i tiles', (rowCount) => {
    const column = Array.from({ length: rowCount }, (_unused, rowIndex) =>
      anchorForGridPosition({ rowIndex, rowCount, columnIndex: 0, columnCount: 1 }),
    );

    expect(column[0]).toBe('top-right');
    expect(column.at(-1)).toBe('bottom-right');
    expect(column.slice(1, -1)).toEqual(Array.from({ length: rowCount - 2 }, () => 'top-center'));
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('walks a single row of %i tiles', (columnCount) => {
    const row = Array.from({ length: columnCount }, (_unused, columnIndex) =>
      anchorForGridPosition({ rowIndex: 0, rowCount: 1, columnIndex, columnCount }),
    );

    expect(row[0]).toBe('bottom-left');
    expect(row.at(-1)).toBe('bottom-right');
    expect(row.slice(1, -1)).toEqual(Array.from({ length: columnCount - 2 }, () => 'middle-left'));
  });

  it('splits an even column count toward the nearer edge with no center', () => {
    const topRow = Array.from({ length: 4 }, (_unused, columnIndex) =>
      anchorForGridPosition({ rowIndex: 0, rowCount: 3, columnIndex, columnCount: 4 }),
    );

    expect(topRow).toEqual(['top-left', 'top-left', 'top-right', 'top-right']);
    expect(topRow).not.toContain('top-center');
  });

  it('gives an odd column count exactly one center column', () => {
    const topRow = Array.from({ length: 5 }, (_unused, columnIndex) =>
      anchorForGridPosition({ rowIndex: 0, rowCount: 3, columnIndex, columnCount: 5 }),
    );

    expect(topRow).toEqual(['top-left', 'top-left', 'top-center', 'top-right', 'top-right']);
    expect(new Set(topRow).size).toBe(3);
  });

  it('classifies both rows of a two-row grid as top and bottom, never middle', () => {
    const anchors = AXIS_COUNTS.filter((columnCount) => columnCount >= 2).flatMap((columnCount) =>
      [0, 1].flatMap((rowIndex) =>
        Array.from({ length: columnCount }, (_unused, columnIndex) =>
          anchorForGridPosition({ rowIndex, rowCount: 2, columnIndex, columnCount }),
        ),
      ),
    );

    expect(anchors).not.toContain('middle-left');
    expect(anchors).not.toContain('middle-right');
  });

  it('grabs the fully centered tile by top-center', () => {
    expect(anchorForGridPosition({ rowIndex: 1, rowCount: 3, columnIndex: 1, columnCount: 3 })).toBe(
      'top-center',
    );
    expect(anchorForGridPosition({ rowIndex: 2, rowCount: 5, columnIndex: 3, columnCount: 7 })).toBe(
      'top-center',
    );
  });

  it('takes an edge midpoint rather than a corner on the sides of a middle row', () => {
    expect(anchorForGridPosition({ rowIndex: 1, rowCount: 3, columnIndex: 0, columnCount: 4 })).toBe(
      'middle-left',
    );
    expect(anchorForGridPosition({ rowIndex: 1, rowCount: 3, columnIndex: 3, columnCount: 4 })).toBe(
      'middle-right',
    );
  });
});
/**
 * The closed anchor vocabulary, written out here rather than imported from the
 * module under test, so a ninth value leaking into the implementation shows up as
 * a failure instead of silently widening the assertion.
 */
const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'bottom-right',
  'bottom-center',
  'bottom-left',
  'middle-left',
] as const satisfies readonly GrabAnchor[];

const ANCHOR_VOCABULARY: ReadonlySet<unknown> = new Set(ALL_ANCHORS);

/** Is the returned value a member of the eight-anchor vocabulary? */
function isAnchor(value: unknown): value is GrabAnchor {
  return ANCHOR_VOCABULARY.has(value);
}

/**
 * The `GridPosition` validation rules, restated here so the resolver's own
 * well-formedness check is not the thing certifying its own output.
 */
function isWellFormedPosition(position: GridPosition): boolean {
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
 * The well-formed position every malformed case is derived from. It resolves to
 * `top-center`, which is *not* the collapse target, so a collapse to
 * `bottom-right` is observable rather than coincidental.
 */
const WELL_FORMED_BASE: GridPosition = { rowIndex: 1, rowCount: 3, columnIndex: 1, columnCount: 3 };

const GRID_POSITION_FIELDS = [
  'rowIndex',
  'rowCount',
  'columnIndex',
  'columnCount',
] as const satisfies readonly (keyof GridPosition)[];

/**
 * Malformed values per field, each one violating a specific validation rule
 * against `WELL_FORMED_BASE`: non-finite, non-integer, negative, and — for the
 * indices — in range numerically but at or past the count.
 */
const MALFORMED_BY_FIELD: Readonly<Record<keyof GridPosition, readonly number[]>> = {
  rowIndex: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5, 1.5, -0.5, -1, 3, 4],
  rowCount: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5, 2.5, -1, 0],
  columnIndex: [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0.5,
    1.5,
    -0.5,
    -1,
    3,
    4,
  ],
  columnCount: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5, 2.5, -1, 0],
};

/**
 * The value set swept simultaneously across all four fields. Every entry other
 * than `'keep'` is malformed for every one of the four fields, so a combination
 * collapses exactly when it contains at least one non-`'keep'` value.
 */
const CROSS_FIELD_VALUES = [
  'keep',
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  1.5,
  -1,
] as const;

type CrossFieldValue = (typeof CROSS_FIELD_VALUES)[number];

function resolveField(field: keyof GridPosition, value: CrossFieldValue): number {
  return value === 'keep' ? WELL_FORMED_BASE[field] : value;
}

/** A measurable tile rect: finite origin, positive area. */
function tile(top: number, left: number): Rect {
  return { top, left, width: 120, height: 90 };
}

/**
 * The report for a value that left the vocabulary entirely. `describeCase` cannot
 * carry it — its `expected` parameter is a `GrabAnchor`, and the whole point here is
 * that the returned value may be `null`, `undefined`, or a ninth string.
 */
function describeVocabularyCase(position: GridPosition, actual: unknown): string {
  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  return `shape ${rowCount}x${columnCount} cell (row ${rowIndex}, column ${columnIndex}): resolved ${String(actual)}, expected one of the eight anchors`;
}

/**
 * **Property 7: Resolution is total.**
 *
 * Resolution has no failure mode. Every grid position value — including ones whose
 * members are `NaN`, `±Infinity`, non-integer, negative, or out of range — yields
 * exactly one of the eight anchors, and a position that cannot be trusted collapses
 * specifically to `bottom-right` rather than to some arbitrary member of the
 * vocabulary. Measurement is likewise total: an empty tile list, an unusable target
 * index, and an unmeasurable activated rect all yield the single-tile position.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
 */
describe('grab anchor resolution — Property 7: resolution is total', () => {
  it('resolves one of the eight anchors for every well-formed cell of every shape', () => {
    const offenders = everyCell().flatMap((position) => {
      const anchor = anchorForGridPosition(position);

      return isAnchor(anchor) ? [] : [describeVocabularyCase(position, anchor)];
    });

    expect(offenders).toEqual([]);
  });

  it('collapses a malformed member of any single field to bottom-right without throwing', () => {
    const offenders: string[] = [];

    for (const field of GRID_POSITION_FIELDS) {
      for (const value of MALFORMED_BY_FIELD[field]) {
        const position: GridPosition = { ...WELL_FORMED_BASE, [field]: value };

        expect(() => anchorForGridPosition(position)).not.toThrow();

        const anchor = anchorForGridPosition(position);

        expect(anchor).not.toBeNull();
        expect(anchor).not.toBeUndefined();

        if (!isAnchor(anchor) || anchor !== SINGLE_TILE_ANCHOR) {
          offenders.push(`${field} = ${String(value)}: ${describeCase(position, anchor, SINGLE_TILE_ANCHOR)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('collapses every combination of malformed members across all four fields', () => {
    const offenders: string[] = [];
    let collapsed = 0;
    let preserved = 0;

    for (const rowIndex of CROSS_FIELD_VALUES) {
      for (const rowCount of CROSS_FIELD_VALUES) {
        for (const columnIndex of CROSS_FIELD_VALUES) {
          for (const columnCount of CROSS_FIELD_VALUES) {
            const position: GridPosition = {
              rowIndex: resolveField('rowIndex', rowIndex),
              rowCount: resolveField('rowCount', rowCount),
              columnIndex: resolveField('columnIndex', columnIndex),
              columnCount: resolveField('columnCount', columnCount),
            };
            const malformed = [rowIndex, rowCount, columnIndex, columnCount].some(
              (value) => value !== 'keep',
            );
            const expected: GrabAnchor = malformed ? SINGLE_TILE_ANCHOR : 'top-center';
            const anchor = anchorForGridPosition(position);

            if (malformed) {
              collapsed += 1;
            } else {
              preserved += 1;
            }

            if (!isAnchor(anchor) || anchor !== expected) {
              offenders.push(describeCase(position, anchor, expected));
            }
          }
        }
      }
    }

    expect(offenders).toEqual([]);
    expect(preserved).toBe(1);
    expect(collapsed).toBe(CROSS_FIELD_VALUES.length ** GRID_POSITION_FIELDS.length - 1);
  });

  it('collapses a position whose every member is non-finite', () => {
    const anchor = anchorForGridPosition({
      rowIndex: Number.NaN,
      rowCount: Number.POSITIVE_INFINITY,
      columnIndex: Number.NEGATIVE_INFINITY,
      columnCount: Number.NaN,
    });

    expect(anchor).toBe('bottom-right');
    expect(SINGLE_TILE_ANCHOR).toBe('bottom-right');
  });

  it('returns the single-tile position for an empty rect list', () => {
    expect(gridPositionFromRects([], 0)).toEqual({
      rowIndex: 0,
      rowCount: 1,
      columnIndex: 0,
      columnCount: 1,
    });
    expect(resolveGrabAnchor([], 0)).toBe('bottom-right');
  });

  it.each([
    { label: 'negative', targetIndex: -1 },
    { label: 'non-integer', targetIndex: 1.5 },
    { label: 'non-finite', targetIndex: Number.NaN },
    { label: 'at the tile count', targetIndex: 4 },
    { label: 'past the tile count', targetIndex: 9 },
  ])('returns the single-tile position for an index that is $label', ({ targetIndex }) => {
    const rects = [tile(0, 0), tile(0, 200), tile(200, 0), tile(200, 200)];

    expect(gridPositionFromRects(rects, targetIndex)).toEqual({
      rowIndex: 0,
      rowCount: 1,
      columnIndex: 0,
      columnCount: 1,
    });
    expect(resolveGrabAnchor(rects, targetIndex)).toBe('bottom-right');
  });

  it.each([
    { label: 'zero width', rect: { top: 200, left: 200, width: 0, height: 90 } },
    { label: 'zero height', rect: { top: 200, left: 200, width: 120, height: 0 } },
    { label: 'negative width', rect: { top: 200, left: 200, width: -120, height: 90 } },
    { label: 'a non-finite width', rect: { top: 200, left: 200, width: Number.NaN, height: 90 } },
    {
      label: 'a non-finite height',
      rect: { top: 200, left: 200, width: 120, height: Number.POSITIVE_INFINITY },
    },
    { label: 'a non-finite top', rect: { top: Number.NaN, left: 200, width: 120, height: 90 } },
    {
      label: 'a non-finite left',
      rect: { top: 200, left: Number.NEGATIVE_INFINITY, width: 120, height: 90 },
    },
  ])(
    'returns the single-tile position when the activated rect has $label, however many siblings remain usable',
    ({ rect }) => {
      const rects: Rect[] = [tile(0, 0), tile(0, 200), tile(200, 0), rect];

      expect(gridPositionFromRects(rects, 3)).toEqual({
        rowIndex: 0,
        rowCount: 1,
        columnIndex: 0,
        columnCount: 1,
      });
      expect(resolveGrabAnchor(rects, 3)).toBe('bottom-right');
    },
  );

  it('returns a well-formed position, and never throws, for every measured input it is given', () => {
    const usable = [tile(0, 0), tile(0, 200), tile(200, 0), tile(200, 200)];
    const inputs: { label: string; rects: Rect[]; targetIndex: number }[] = [
      { label: 'a usable 2x2 grid', rects: usable, targetIndex: 2 },
      { label: 'an empty list', rects: [], targetIndex: 0 },
      { label: 'a negative index', rects: usable, targetIndex: -3 },
      { label: 'a non-integer index', rects: usable, targetIndex: 0.25 },
      { label: 'an out-of-range index', rects: usable, targetIndex: 12 },
      {
        label: 'an unmeasurable activated rect',
        rects: [tile(0, 0), { top: 0, left: 200, width: 0, height: 0 }],
        targetIndex: 1,
      },
      {
        label: 'a grid whose every sibling is unmeasurable',
        rects: [
          { top: Number.NaN, left: 0, width: 120, height: 90 },
          { top: 0, left: Number.NaN, width: 120, height: 90 },
          tile(200, 200),
        ],
        targetIndex: 2,
      },
      { label: 'a lone tile', rects: [tile(17.5, 42.25)], targetIndex: 0 },
    ];

    const offenders = inputs.flatMap(({ label, rects, targetIndex }) => {
      expect(() => gridPositionFromRects(rects, targetIndex)).not.toThrow();

      const position = gridPositionFromRects(rects, targetIndex);
      const anchor = resolveGrabAnchor(rects, targetIndex);
      const failures: string[] = [];

      if (!isWellFormedPosition(position)) {
        failures.push(
          `${label}: position ${JSON.stringify(position)} violates the GridPosition rules`,
        );
      }

      if (!isAnchor(anchor)) {
        failures.push(`${label}: resolved ${String(anchor)}, expected one of the eight anchors`);
      }

      return failures;
    });

    expect(offenders).toEqual([]);
  });

  it('resolves a well-formed anchor when clustering gives every tile its own row and column', () => {
    // A staircase: consecutive tops and lefts differ by far more than the
    // tolerance, so each tile lands alone in both its row and its column.
    const rects = AXIS_COUNTS.map((step) => tile(step * 300, step * 300));

    const offenders = rects.flatMap((_unused, targetIndex) => {
      const position = gridPositionFromRects(rects, targetIndex);
      const anchor = resolveGrabAnchor(rects, targetIndex);
      const failures: string[] = [];

      if (position.rowCount !== rects.length || position.columnCount !== rects.length) {
        failures.push(
          `tile ${targetIndex}: expected a ${rects.length}x${rects.length} grid, got ${position.rowCount}x${position.columnCount}`,
        );
      }

      if (position.rowIndex !== targetIndex || position.columnIndex !== targetIndex) {
        failures.push(
          `tile ${targetIndex}: expected cell (${targetIndex}, ${targetIndex}), got (${position.rowIndex}, ${position.columnIndex})`,
        );
      }

      if (!isAnchor(anchor)) {
        failures.push(describeVocabularyCase(position, anchor));
      }

      return failures;
    });

    expect(offenders).toEqual([]);
  });
});

/**
 * Unit-square coordinate per anchor, hand-authored here rather than imported from
 * the geometry module, so this suite states the transpose and mirror relations in
 * its own terms and does not certify one implementation against another.
 */
const ANCHOR_UV: Readonly<Record<GrabAnchor, readonly [number, number]>> = {
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'middle-right': [1, 0.5],
  'bottom-right': [1, 1],
  'bottom-center': [0.5, 1],
  'bottom-left': [0, 1],
  'middle-left': [0, 0.5],
};

/** The anchor sitting at a unit-square coordinate, for reading a mapped uv back. */
function anchorForUv(u: number, v: number): GrabAnchor {
  const found = ALL_ANCHORS.find((anchor) => {
    const [x, y] = ANCHOR_UV[anchor];

    return x === u && y === v;
  });

  if (found === undefined) {
    throw new Error(`No anchor sits at unit-square coordinate (${u}, ${v}).`);
  }

  return found;
}

/**
 * The horizontal mirror — reflection about the vertical centerline, `x → 1 − x`.
 * Left and right swap; the two edge midpoints on the vertical centerline are
 * fixed.
 */
const HORIZONTAL_MIRROR: Readonly<Record<GrabAnchor, GrabAnchor>> = {
  'top-left': 'top-right',
  'top-right': 'top-left',
  'bottom-left': 'bottom-right',
  'bottom-right': 'bottom-left',
  'middle-left': 'middle-right',
  'middle-right': 'middle-left',
  'top-center': 'top-center',
  'bottom-center': 'bottom-center',
};

/**
 * The vertical mirror — reflection about the horizontal centerline, `y → 1 − y`.
 * Top and bottom swap; `middle-left` and `middle-right` are fixed.
 */
const VERTICAL_MIRROR: Readonly<Record<GrabAnchor, GrabAnchor>> = {
  'top-left': 'bottom-left',
  'bottom-left': 'top-left',
  'top-right': 'bottom-right',
  'bottom-right': 'top-right',
  'top-center': 'bottom-center',
  'bottom-center': 'top-center',
  'middle-left': 'middle-left',
  'middle-right': 'middle-right',
};

/** The anchor at the transposed coordinate `(u, v) → (v, u)`. */
function transposeAnchor(anchor: GrabAnchor): GrabAnchor {
  const [u, v] = ANCHOR_UV[anchor];

  return anchorForUv(v, u);
}

/** Both counts at least `2`, so the band table decides the cell. */
function isNonDegenerate({ rowCount, columnCount }: GridPosition): boolean {
  return rowCount >= 2 && columnCount >= 2;
}

/** The cell with its column index reflected to `columnCount − 1 − columnIndex`. */
function reflectColumn(position: GridPosition): GridPosition {
  return { ...position, columnIndex: position.columnCount - 1 - position.columnIndex };
}

/** The cell with its row index reflected to `rowCount − 1 − rowIndex`. */
function reflectRow(position: GridPosition): GridPosition {
  return { ...position, rowIndex: position.rowCount - 1 - position.rowIndex };
}

/**
 * The fully centered tile: the `middle` row band of a grid of at least `3` rows
 * crossed with the `center` column band, which exists only for an odd
 * `columnCount` of at least `3`. This is the single cell the vertical mirror is
 * not expected to hold at.
 */
function isFullyCentered({ rowIndex, rowCount, columnIndex, columnCount }: GridPosition): boolean {
  const isMiddleRow = rowIndex > 0 && rowIndex < rowCount - 1;
  const isCenterColumn = columnCount % 2 === 1 && columnIndex === (columnCount - 1) / 2;

  return isMiddleRow && isCenterColumn;
}

/**
 * Whether a **degenerate** cell's anchor is expected to survive the column
 * reflection, authored from the degenerate constants rather than measured.
 *
 * A single column reflects onto itself, so the relation can only hold where the
 * anchor is fixed by the horizontal mirror — the interior `top-center`. The two
 * ends grab `top-right` and `bottom-right`, deliberately right-biased, so they
 * fail. A single row reflects its two ends onto each other, and `bottom-left`
 * and `bottom-right` are each other's horizontal mirror, so those hold; the
 * interior `middle-left` is left-biased and fails.
 */
function expectsColumnMirror(position: GridPosition): boolean {
  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  if (rowCount === 1 && columnCount === 1) {
    return false;
  }

  if (columnCount === 1) {
    return rowIndex > 0 && rowIndex < rowCount - 1;
  }

  return columnIndex === 0 || columnIndex === columnCount - 1;
}

/**
 * Whether a **degenerate** cell's anchor is expected to survive the row
 * reflection — the transpose of `expectsColumnMirror`.
 *
 * A single row reflects onto itself, so only the interior `middle-left`, fixed by
 * the vertical mirror, holds; its bottom-biased ends fail. A single column
 * reflects its ends onto each other, and `top-right` and `bottom-right` are each
 * other's vertical mirror, so those hold; the interior `top-center` would have to
 * become `bottom-center` and fails.
 */
function expectsRowMirror(position: GridPosition): boolean {
  const { rowIndex, rowCount, columnIndex, columnCount } = position;

  if (rowCount === 1 && columnCount === 1) {
    return false;
  }

  if (rowCount === 1) {
    return columnIndex > 0 && columnIndex < columnCount - 1;
  }

  return rowIndex === 0 || rowIndex === rowCount - 1;
}

/**
 * **Property 9: Mirror symmetry, with stated exceptions.**
 *
 * The resolution table is left/right symmetric without exception: reflecting a
 * cell's column index maps its anchor by the horizontal mirror for every cell of
 * every non-degenerate grid. It is top/bottom symmetric with exactly one
 * exception — the fully centered tile, which always grabs `top-center` because a
 * tile with no edge affinity in either direction still has to pick a direction.
 *
 * The degenerate single-row and single-column shapes are exempt from both
 * mirrors, and the exemption is asserted rather than skipped: their constants
 * deliberately bias toward the right and the bottom, so the exact set of cells
 * that break each mirror is pinned down here. The two degenerate families remain
 * related to each other by the unit-square transpose `(u, v) → (v, u)`.
 *
 * **Validates: Requirements 2.6, 2.7, 2.8, 4.9**
 */
describe('anchorForGridPosition — Property 9: mirror symmetry, with stated exceptions', () => {
  it('defines both mirrors as unit-square reflections and as involutions', () => {
    const offenders = ALL_ANCHORS.flatMap((anchor) => {
      const [x, y] = ANCHOR_UV[anchor];
      const failures: string[] = [];

      if (HORIZONTAL_MIRROR[HORIZONTAL_MIRROR[anchor]] !== anchor) {
        failures.push(`${anchor}: the horizontal mirror is not an involution`);
      }

      if (VERTICAL_MIRROR[VERTICAL_MIRROR[anchor]] !== anchor) {
        failures.push(`${anchor}: the vertical mirror is not an involution`);
      }

      if (HORIZONTAL_MIRROR[anchor] !== anchorForUv(1 - x, y)) {
        failures.push(
          `${anchor}: the horizontal mirror is ${HORIZONTAL_MIRROR[anchor]}, but (1 - x, y) is ${anchorForUv(1 - x, y)}`,
        );
      }

      if (VERTICAL_MIRROR[anchor] !== anchorForUv(x, 1 - y)) {
        failures.push(
          `${anchor}: the vertical mirror is ${VERTICAL_MIRROR[anchor]}, but (x, 1 - y) is ${anchorForUv(x, 1 - y)}`,
        );
      }

      return failures;
    });

    expect(offenders).toEqual([]);
  });

  it('maps the anchor by the horizontal mirror under the column reflection, for every non-degenerate cell', () => {
    const cells = everyCell().filter(isNonDegenerate);
    const offenders = cells.flatMap((position) => {
      const expected = HORIZONTAL_MIRROR[anchorForGridPosition(position)];
      const actual = anchorForGridPosition(reflectColumn(position));

      return actual === expected ? [] : [describeCase(reflectColumn(position), actual, expected)];
    });

    expect(offenders).toEqual([]);
    // Every shape with both counts at least 2: 7 x 7 of the 64 enumerated shapes.
    expect(new Set(cells.map(({ rowCount, columnCount }) => `${rowCount}x${columnCount}`)).size).toBe(
      49,
    );
  });

  it('maps the anchor by the vertical mirror under the row reflection, everywhere but the fully centered tile', () => {
    const cells = everyCell().filter(isNonDegenerate);
    let exempt = 0;

    const offenders = cells.flatMap((position) => {
      if (isFullyCentered(position)) {
        exempt += 1;

        return [];
      }

      const expected = VERTICAL_MIRROR[anchorForGridPosition(position)];
      const actual = anchorForGridPosition(reflectRow(position));

      return actual === expected ? [] : [describeCase(reflectRow(position), actual, expected)];
    });

    expect(offenders).toEqual([]);
    // The exemption is narrow, not a blanket escape: the middle rows of the 6
    // shapes with at least 3 rows (1 + 2 + 3 + 4 + 5 + 6 = 21 middle rows) crossed
    // with the 3 odd column counts of at least 3.
    expect(exempt).toBe(21 * 3);
  });

  it('grabs every fully centered tile by top-center, which the row reflection holds fixed', () => {
    const centered = everyCell().filter(
      (position) => isNonDegenerate(position) && isFullyCentered(position),
    );

    const offenders = centered.flatMap((position) => {
      const anchor = anchorForGridPosition(position);
      const reflected = anchorForGridPosition(reflectRow(position));
      const failures: string[] = [];

      if (anchor !== 'top-center') {
        failures.push(describeCase(position, anchor, 'top-center'));
      }

      // Reflecting the row leaves the anchor alone, which is exactly how it
      // departs from the vertical mirror: that would demand bottom-center.
      if (reflected !== 'top-center') {
        failures.push(describeCase(reflectRow(position), reflected, 'top-center'));
      }

      if (VERTICAL_MIRROR[anchor] !== 'bottom-center') {
        failures.push(`${anchor}: expected the vertical mirror to be bottom-center`);
      }

      return failures;
    });

    expect(offenders).toEqual([]);
    expect(centered).toHaveLength(21 * 3);
  });

  it('holds the fully centered tile at top-center under the column reflection too', () => {
    const position: GridPosition = { rowIndex: 1, rowCount: 3, columnIndex: 1, columnCount: 3 };

    expect(anchorForGridPosition(position)).toBe('top-center');
    expect(anchorForGridPosition(reflectColumn(position))).toBe('top-center');
    expect(HORIZONTAL_MIRROR['top-center']).toBe('top-center');
  });

  it('exempts the degenerate shapes, whose constants bias toward the right and the bottom', () => {
    const degenerate = everyCell().filter((position) => !isNonDegenerate(position));
    const brokenShapes = new Set<string>();

    const offenders = degenerate.flatMap((position) => {
      const { rowCount, columnCount } = position;
      const anchor = anchorForGridPosition(position);
      const columnHolds = anchorForGridPosition(reflectColumn(position)) === HORIZONTAL_MIRROR[anchor];
      const rowHolds = anchorForGridPosition(reflectRow(position)) === VERTICAL_MIRROR[anchor];
      const failures: string[] = [];

      if (!columnHolds || !rowHolds) {
        brokenShapes.add(`${rowCount}x${columnCount}`);
      }

      const where = `shape ${rowCount}x${columnCount} cell (row ${position.rowIndex}, column ${position.columnIndex}) grabbing ${anchor}`;

      if (columnHolds !== expectsColumnMirror(position)) {
        failures.push(
          `${where}: the horizontal mirror ${columnHolds ? 'held' : 'broke'}, expected it to ${expectsColumnMirror(position) ? 'hold' : 'break'}`,
        );
      }

      if (rowHolds !== expectsRowMirror(position)) {
        failures.push(
          `${where}: the vertical mirror ${rowHolds ? 'held' : 'broke'}, expected it to ${expectsRowMirror(position) ? 'hold' : 'break'}`,
        );
      }

      return failures;
    });

    expect(offenders).toEqual([]);
    // No degenerate shape is fully symmetric: all 15 of them — 8 single-column, 8
    // single-row, sharing the 1 x 1 — break at least one mirror.
    expect(brokenShapes.size).toBe(15);
  });

  it('breaks both mirrors at the lone tile, which grabs the right-and-bottom constant', () => {
    const position: GridPosition = { rowIndex: 0, rowCount: 1, columnIndex: 0, columnCount: 1 };

    expect(anchorForGridPosition(position)).toBe('bottom-right');
    // Both reflections are the identity on a 1 x 1 grid, so the anchor comes back
    // unchanged while either mirror would demand it move.
    expect(anchorForGridPosition(reflectColumn(position))).toBe('bottom-right');
    expect(HORIZONTAL_MIRROR['bottom-right']).toBe('bottom-left');
    expect(anchorForGridPosition(reflectRow(position))).toBe('bottom-right');
    expect(VERTICAL_MIRROR['bottom-right']).toBe('top-right');
  });

  it.each(AXIS_COUNTS.filter((count) => count >= 3))(
    'breaks the vertical mirror at the interior of a single column of %i tiles',
    (rowCount) => {
      const position: GridPosition = { rowIndex: 1, rowCount, columnIndex: 0, columnCount: 1 };

      expect(anchorForGridPosition(position)).toBe('top-center');
      expect(anchorForGridPosition(reflectRow(position))).toBe('top-center');
      expect(VERTICAL_MIRROR['top-center']).toBe('bottom-center');
    },
  );

  it.each(AXIS_COUNTS.filter((count) => count >= 3))(
    'breaks the horizontal mirror at the interior of a single row of %i tiles',
    (columnCount) => {
      const position: GridPosition = { rowIndex: 0, rowCount: 1, columnIndex: 1, columnCount };

      expect(anchorForGridPosition(position)).toBe('middle-left');
      expect(anchorForGridPosition(reflectColumn(position))).toBe('middle-left');
      expect(HORIZONTAL_MIRROR['middle-left']).toBe('middle-right');
    },
  );

  it.each([
    { label: 'first', column: 'top-right', row: 'bottom-left' },
    { label: 'interior', column: 'top-center', row: 'middle-left' },
    { label: 'last', column: 'bottom-right', row: 'bottom-right' },
  ] as const satisfies readonly { label: string; column: GrabAnchor; row: GrabAnchor }[])(
    'transposes the $label single-column anchor $column onto the single-row anchor $row',
    ({ column, row }) => {
      expect(transposeAnchor(column)).toBe(row);
    },
  );

  it('relates the two degenerate families by the unit-square transpose, cell for cell', () => {
    const offenders = AXIS_COUNTS.flatMap((count) =>
      Array.from({ length: count }, (_unused, index) => index).flatMap((index) => {
        const columnCell: GridPosition = {
          rowIndex: index,
          rowCount: count,
          columnIndex: 0,
          columnCount: 1,
        };
        const rowCell: GridPosition = {
          rowIndex: 0,
          rowCount: 1,
          columnIndex: index,
          columnCount: count,
        };
        const expected = transposeAnchor(anchorForGridPosition(columnCell));
        const actual = anchorForGridPosition(rowCell);

        return actual === expected ? [] : [describeCase(rowCell, actual, expected)];
      }),
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * The clustering tolerance in CSS pixels, restated here rather than imported, so
 * a change to the module constant shows up as a failure of these synthesized
 * layouts instead of silently moving the goalposts they are built against.
 */
const TOLERANCE_PX = 2;

/** The position every unplaceable target collapses to. */
const SINGLE_TILE_POSITION: GridPosition = {
  rowIndex: 0,
  rowCount: 1,
  columnIndex: 0,
  columnCount: 1,
};

/**
 * A seeded linear congruential generator returning values in `[0, 1)`, local to
 * this block so the jitter below is one fixed sequence. Nothing here is sampled
 * from an unseeded source: a failing grid reproduces exactly on the next run.
 *
 * The multiply stays below `2^53` for any state below `2^32`, so the modulo is
 * exact in double precision.
 */
function seededUnitInterval(seed: number): () => number {
  let state = seed % 4_294_967_296;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;

    return state / 4_294_967_296;
  };
}

interface SyntheticGridSpec {
  rowCount: number;
  columnCount: number;
  /**
   * Half the width of the per-tile jitter band, so the spread within an authored
   * row or column is at most `2 * jitter` and must stay **strictly** below the
   * tolerance for the grid to be recoverable.
   */
  jitter?: number;
  rowPitch?: number;
  columnPitch?: number;
  originTop?: number;
  originLeft?: number;
  tileWidth?: number;
  tileHeight?: number;
  seed?: number;
}

interface SyntheticGrid {
  /** What a failure report names the layout by. */
  label: string;
  /** Rects in document order, row-major, as `main.ts` would measure them. */
  rects: Rect[];
  /** The authored cell of each rect, in the same order. */
  authored: readonly { rowIndex: number; columnIndex: number }[];
  rowCount: number;
  columnCount: number;
}

/**
 * Lay out an `R x C` grid of measurable rects with deterministic per-tile jitter.
 *
 * Row pitch and column pitch both exceed the tolerance by a wide margin while the
 * jitter stays under it, which is exactly the layout shape Requirement 6.8
 * describes: within a row the tops agree to within a tolerance, between rows they
 * do not.
 */
function syntheticGrid({
  rowCount,
  columnCount,
  jitter = 0.9,
  rowPitch = 140,
  columnPitch = 170,
  originTop = 0,
  originLeft = 0,
  tileWidth = 120,
  tileHeight = 90,
  seed = 20_240_913,
}: SyntheticGridSpec): SyntheticGrid {
  const nextUnit = seededUnitInterval(seed);
  const rects: Rect[] = [];
  const authored: { rowIndex: number; columnIndex: number }[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const topJitter = (nextUnit() * 2 - 1) * jitter;
      const leftJitter = (nextUnit() * 2 - 1) * jitter;

      rects.push({
        top: originTop + rowIndex * rowPitch + topJitter,
        left: originLeft + columnIndex * columnPitch + leftJitter,
        width: tileWidth,
        height: tileHeight,
      });
      authored.push({ rowIndex, columnIndex });
    }
  }

  return {
    label: `${rowCount}x${columnCount} grid (jitter ${jitter}, pitch ${rowPitch}/${columnPitch})`,
    rects,
    authored,
    rowCount,
    columnCount,
  };
}

/** The same grid moved bodily by a finite offset, tile dimensions untouched. */
function translatedGrid(grid: SyntheticGrid, offsetTop: number, offsetLeft: number): SyntheticGrid {
  return {
    ...grid,
    label: `${grid.label} translated by (${offsetTop}, ${offsetLeft})`,
    rects: grid.rects.map((rect) => ({
      ...rect,
      top: rect.top + offsetTop,
      left: rect.left + offsetLeft,
    })),
  };
}

/**
 * The same grid scaled about the origin by a positive factor — every measured
 * number multiplied, jitter included, which is why the base jitter has to be
 * small enough that the largest factor keeps the scaled spread under the
 * tolerance.
 */
function scaledGrid(grid: SyntheticGrid, factor: number): SyntheticGrid {
  return {
    ...grid,
    label: `${grid.label} scaled by ${factor}`,
    rects: grid.rects.map((rect) => ({
      top: rect.top * factor,
      left: rect.left * factor,
      width: rect.width * factor,
      height: rect.height * factor,
    })),
  };
}

/**
 * Check the synthesized layout against the preconditions Requirement 6.8 and 6.9
 * state, so a passing recovery cannot be an accident of a grid that never had
 * sub-tolerance jitter or above-tolerance separation in the first place. This
 * also carries the `WHILE` clause of the transformation invariant: a transformed
 * grid has to still satisfy these before its position is expected to match.
 */
function layoutPreconditionFailures(grid: SyntheticGrid): string[] {
  const failures: string[] = [];
  const rowTops: number[][] = Array.from({ length: grid.rowCount }, () => []);
  const columnLefts: number[][] = Array.from({ length: grid.columnCount }, () => []);

  grid.rects.forEach((rect, index) => {
    const { rowIndex, columnIndex } = grid.authored[index]!;

    rowTops[rowIndex]!.push(rect.top);
    columnLefts[columnIndex]!.push(rect.left);

    if (
      !(rect.width > 0) ||
      !(rect.height > 0) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.left)
    ) {
      failures.push(`${grid.label} tile ${index}: not measurable — ${JSON.stringify(rect)}`);
    }
  });

  const checkAxis = (axis: string, groups: readonly number[][]): void => {
    groups.forEach((values, groupIndex) => {
      const smallest = Math.min(...values);
      const largest = Math.max(...values);

      if (!(largest - smallest < TOLERANCE_PX)) {
        failures.push(
          `${grid.label} ${axis} ${groupIndex}: spread ${largest - smallest} is not strictly under the tolerance ${TOLERANCE_PX}`,
        );
      }

      if (groupIndex > 0) {
        const previous = Math.min(...groups[groupIndex - 1]!);

        if (!(smallest - previous > TOLERANCE_PX)) {
          failures.push(
            `${grid.label} ${axis} ${groupIndex}: separated from ${axis} ${groupIndex - 1} by ${smallest - previous}, which is not above the tolerance ${TOLERANCE_PX}`,
          );
        }
      }
    });
  };

  checkAxis('row', rowTops);
  checkAxis('column', columnLefts);

  return failures;
}

/**
 * Does measurement recover the authored grid? Every tile's measured shape and
 * cell must match what was laid out, and the anchor resolved end to end through
 * `resolveGrabAnchor` must match the hand-written table's answer for that cell.
 */
function recoveryFailures(grid: SyntheticGrid): string[] {
  return grid.rects.flatMap((_rect, index) => {
    const authored = grid.authored[index]!;
    const expected: GridPosition = {
      rowIndex: authored.rowIndex,
      rowCount: grid.rowCount,
      columnIndex: authored.columnIndex,
      columnCount: grid.columnCount,
    };
    const position = gridPositionFromRects(grid.rects, index);
    const failures: string[] = [];

    if (position.rowCount !== expected.rowCount || position.columnCount !== expected.columnCount) {
      failures.push(
        `${grid.label} tile ${index}: measured a ${position.rowCount}x${position.columnCount} grid, authored ${expected.rowCount}x${expected.columnCount}`,
      );
    }

    if (position.rowIndex !== expected.rowIndex || position.columnIndex !== expected.columnIndex) {
      failures.push(
        `${grid.label} tile ${index}: measured cell (row ${position.rowIndex}, column ${position.columnIndex}), authored (row ${expected.rowIndex}, column ${expected.columnIndex})`,
      );
    }

    const anchor = resolveGrabAnchor(grid.rects, index);
    const tabled = expectedAnchor(expected);

    if (anchor !== tabled) {
      failures.push(`${grid.label} tile ${index}: resolved ${anchor}, expected ${tabled}`);
    }

    return failures;
  });
}

/**
 * The clustering postconditions, checked against the axis values a synthesized
 * grid actually presents: one index per value, every index in range, equal values
 * together, indices non-decreasing in value, and every member within the
 * tolerance of its cluster's smallest member.
 */
function clusteringPostconditionFailures(label: string, values: readonly number[]): string[] {
  const { clusterIndex, clusterCount } = clusterAxis(values);
  const failures: string[] = [];

  if (!Number.isInteger(clusterCount) || clusterCount < 1) {
    failures.push(`${label}: clusterCount ${clusterCount} is not an integer of at least 1`);
  }

  if (clusterIndex.length !== values.length) {
    failures.push(
      `${label}: got ${clusterIndex.length} cluster indices for ${values.length} values`,
    );
  }

  const smallestOf = new Map<number, number>();

  clusterIndex.forEach((index, position) => {
    if (!Number.isInteger(index) || index < 0 || index >= clusterCount) {
      failures.push(`${label}: value ${values[position]} got cluster index ${index}`);

      return;
    }

    const value = values[position]!;
    const smallest = smallestOf.get(index);

    smallestOf.set(index, smallest === undefined ? value : Math.min(smallest, value));
  });

  values.forEach((value, position) => {
    const index = clusterIndex[position]!;
    const smallest = smallestOf.get(index)!;

    if (!(value - smallest <= TOLERANCE_PX)) {
      failures.push(
        `${label}: value ${value} sits ${value - smallest} from the smallest member of its cluster, past the tolerance ${TOLERANCE_PX}`,
      );
    }

    values.forEach((other, otherPosition) => {
      const otherIndex = clusterIndex[otherPosition]!;

      if (value === other && index !== otherIndex) {
        failures.push(`${label}: equal values ${value} got cluster indices ${index} and ${otherIndex}`);
      }

      if (value < other && index > otherIndex) {
        failures.push(
          `${label}: value ${value} got cluster index ${index}, above the ${otherIndex} of the larger ${other}`,
        );
      }
    });
  });

  return failures;
}

/**
 * **Property 10: Clustering recovers the grid.**
 *
 * Measurement is the half of resolution that talks to the layout engine, and its
 * contract is that a visually rectangular arrangement comes back as the grid it
 * looks like. For every `R x C` shape with `R, C` in `[1, 8]`, laid out with
 * per-tile jitter strictly under the tolerance and rows and columns separated by
 * more than it, `gridPositionFromRects` returns exactly `R` rows, exactly `C`
 * columns, and each tile's authored indices.
 *
 * The same holds after the whole grid is translated or uniformly scaled, which is
 * the responsive-layout invariant: nothing about the answer may depend on where
 * the grid sits in the viewport or how large it is drawn, only on the relative
 * arrangement. Tiles that measure as collapsed or non-finite are excluded before
 * any clustering happens, so a hidden tile invents no row and no column.
 *
 * The synthesized layouts are checked against their own stated preconditions
 * first, so a green recovery cannot come from a grid that never had sub-tolerance
 * jitter to begin with. Jitter comes from a seeded generator local to this block.
 *
 * **Validates: Requirements 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9**
 */
describe('gridPositionFromRects — Property 10: clustering recovers the grid', () => {
  it('recovers every R x C shape with R, C in [1, 8] from jittered rects', () => {
    const grids = AXIS_COUNTS.flatMap((rowCount, rowSeed) =>
      AXIS_COUNTS.map((columnCount, columnSeed) =>
        syntheticGrid({ rowCount, columnCount, seed: 1_000 + rowSeed * 8 + columnSeed }),
      ),
    );

    expect(grids).toHaveLength(64);
    expect(grids.flatMap(layoutPreconditionFailures)).toEqual([]);
    expect(grids.flatMap(recoveryFailures)).toEqual([]);
    // Every cell of every shape: the same 1,296 combinations Property 8 enumerates.
    expect(grids.reduce((total, grid) => total + grid.rects.length, 0)).toBe(1_296);
  });

  it('recovers a grid whose rows and columns clear the tolerance only just', () => {
    // Separation of 3 CSS pixels against a jitter band of 0.8: the smallest top of
    // each row still lands more than the tolerance past the smallest top of the row
    // above, which is the whole condition clustering needs.
    const grid = syntheticGrid({
      rowCount: 5,
      columnCount: 4,
      jitter: 0.4,
      rowPitch: 3,
      columnPitch: 3,
      seed: 7_331,
    });

    expect(layoutPreconditionFailures(grid)).toEqual([]);
    expect(recoveryFailures(grid)).toEqual([]);
  });

  it('holds the clustering postconditions on the axis values of every shape', () => {
    const failures = AXIS_COUNTS.flatMap((rowCount) =>
      AXIS_COUNTS.flatMap((columnCount) => {
        const grid = syntheticGrid({ rowCount, columnCount, seed: 4_242 });

        return [
          ...clusteringPostconditionFailures(
            `${grid.label} tops`,
            grid.rects.map((rect) => rect.top),
          ),
          ...clusteringPostconditionFailures(
            `${grid.label} lefts`,
            grid.rects.map((rect) => rect.left),
          ),
        ];
      }),
    );

    expect(failures).toEqual([]);
  });

  it.each([
    { offsetTop: -2_048.5, offsetLeft: -512.25 },
    { offsetTop: 0, offsetLeft: 1_920 },
    { offsetTop: 100_000.75, offsetLeft: -64.125 },
  ])(
    'returns the same grid position after a uniform translation by ($offsetTop, $offsetLeft)',
    ({ offsetTop, offsetLeft }) => {
      const grids = AXIS_COUNTS.flatMap((rowCount) =>
        AXIS_COUNTS.map((columnCount) =>
          translatedGrid(syntheticGrid({ rowCount, columnCount, seed: 909 }), offsetTop, offsetLeft),
        ),
      );

      // The transformed layout still satisfies the tolerance conditions, so the
      // invariant applies rather than being vacuous.
      expect(grids.flatMap(layoutPreconditionFailures)).toEqual([]);
      expect(grids.flatMap(recoveryFailures)).toEqual([]);
    },
  );

  it.each([0.25, 0.5, 1, 2, 4])(
    'returns the same grid position after a uniform scaling by %f',
    (factor) => {
      // Scaling multiplies the jitter too, so the base band is 0.4 wide: at the
      // largest factor the scaled spread is 1.6, still under the tolerance.
      const grids = AXIS_COUNTS.flatMap((rowCount) =>
        AXIS_COUNTS.map((columnCount) =>
          scaledGrid(syntheticGrid({ rowCount, columnCount, jitter: 0.2, seed: 555 }), factor),
        ),
      );

      expect(grids.flatMap(layoutPreconditionFailures)).toEqual([]);
      expect(grids.flatMap(recoveryFailures)).toEqual([]);
    },
  );

  it('reads only top and left, so tile dimensions cannot move a tile between cells', () => {
    const grid = syntheticGrid({ rowCount: 4, columnCount: 5, seed: 8_080 });
    const nextUnit = seededUnitInterval(31);
    const reshaped: SyntheticGrid = {
      ...grid,
      label: `${grid.label} with per-tile dimensions`,
      rects: grid.rects.map((rect) => ({
        ...rect,
        width: 1 + nextUnit() * 4_000,
        height: 1 + nextUnit() * 4_000,
      })),
    };

    expect(recoveryFailures(grid)).toEqual([]);
    expect(recoveryFailures(reshaped)).toEqual([]);
    // The dimensions really did change, so the agreement above is not trivial.
    expect(reshaped.rects.map((rect) => rect.width)).not.toEqual(grid.rects.map((rect) => rect.width));
  });

  it('excludes a collapsed row, which then contributes no row of its own', () => {
    const grid = syntheticGrid({ rowCount: 3, columnCount: 3, seed: 12_345 });
    // The middle authored row measures zero height — a collapsed tile, not a
    // missing one, so its top is still a perfectly clusterable number.
    const rects = grid.rects.map((rect, index) =>
      index >= 3 && index <= 5 ? { ...rect, height: 0 } : rect,
    );

    expect(gridPositionFromRects(rects, 0)).toEqual({
      rowIndex: 0,
      rowCount: 2,
      columnIndex: 0,
      columnCount: 3,
    });
    expect(gridPositionFromRects(rects, 7)).toEqual({
      rowIndex: 1,
      rowCount: 2,
      columnIndex: 1,
      columnCount: 3,
    });
    expect(gridPositionFromRects(rects, 8)).toEqual({
      rowIndex: 1,
      rowCount: 2,
      columnIndex: 2,
      columnCount: 3,
    });
    // A collapsed tile cannot be placed at all when it is itself the target.
    expect(gridPositionFromRects(rects, 4)).toEqual(SINGLE_TILE_POSITION);
  });

  it('excludes a zero-width column, which then contributes no column of its own', () => {
    const grid = syntheticGrid({ rowCount: 3, columnCount: 3, seed: 54_321 });
    const rects = grid.rects.map((rect, index) =>
      index % 3 === 2 ? { ...rect, width: 0 } : rect,
    );

    expect(gridPositionFromRects(rects, 0)).toEqual({
      rowIndex: 0,
      rowCount: 3,
      columnIndex: 0,
      columnCount: 2,
    });
    expect(gridPositionFromRects(rects, 7)).toEqual({
      rowIndex: 2,
      rowCount: 3,
      columnIndex: 1,
      columnCount: 2,
    });
    expect(gridPositionFromRects(rects, 5)).toEqual(SINGLE_TILE_POSITION);
  });

  it.each([
    { label: 'zero width', overrides: { width: 0 } },
    { label: 'zero height', overrides: { height: 0 } },
    { label: 'a non-finite top', overrides: { top: Number.NaN } },
    { label: 'a non-finite left', overrides: { left: Number.POSITIVE_INFINITY } },
  ])(
    'lets a stray tile with $label contribute neither a row nor a column',
    ({ overrides }) => {
      const grid = syntheticGrid({ rowCount: 2, columnCount: 2, seed: 606 });
      // A fifth tile parked well clear of every measured row and column: were it
      // retained it would add one of each.
      const rects: Rect[] = [...grid.rects, { ...tile(9_000, 9_000), ...overrides }];

      expect(layoutPreconditionFailures(grid)).toEqual([]);
      expect(
        recoveryFailures({ ...grid, label: `${grid.label} with a stray tile`, rects: grid.rects }),
      ).toEqual([]);

      const offenders = grid.rects.flatMap((_rect, index) => {
        const authored = grid.authored[index]!;
        const position = gridPositionFromRects(rects, index);

        return position.rowCount === 2 &&
          position.columnCount === 2 &&
          position.rowIndex === authored.rowIndex &&
          position.columnIndex === authored.columnIndex
          ? []
          : [`tile ${index}: got ${JSON.stringify(position)}`];
      });

      expect(offenders).toEqual([]);
      // And the stray tile is unplaceable when it is the target itself.
      expect(gridPositionFromRects(rects, 4)).toEqual(SINGLE_TILE_POSITION);
    },
  );

  it('derives the indices of the retained tiles from their own positions alone', () => {
    // Document order 0..5 over a 2 x 3 layout whose first, third, and fifth tiles
    // are unmeasurable. What is left is a 2 x 2 arrangement, and the retained
    // tiles are indexed within it — not within the original six.
    const grid = syntheticGrid({ rowCount: 2, columnCount: 3, seed: 4_004 });
    const rects = grid.rects.map((rect, index) =>
      index === 0 || index === 2 || index === 4 ? { ...rect, width: 0, height: 0 } : rect,
    );

    // Retained: tile 1 (row 0, column 1), tile 3 (row 1, column 0), tile 5 (row 1,
    // column 2). Two rows and three columns survive, and each retained tile is
    // indexed by where it sits among the retained tiles — a row index of 1 for
    // tile 3 even though it is the second retained tile of six authored ones.
    expect(gridPositionFromRects(rects, 1)).toEqual({
      rowIndex: 0,
      rowCount: 2,
      columnIndex: 1,
      columnCount: 3,
    });
    expect(gridPositionFromRects(rects, 3)).toEqual({
      rowIndex: 1,
      rowCount: 2,
      columnIndex: 0,
      columnCount: 3,
    });
    expect(gridPositionFromRects(rects, 5)).toEqual({
      rowIndex: 1,
      rowCount: 2,
      columnIndex: 2,
      columnCount: 3,
    });
  });
});

/**
 * Length of the drifting run below. Sixteen values is long enough that a
 * chaining bug is unmistakable — it would report one cluster where the contract
 * asks for eight — and short enough to read in a failure message.
 */
const DRIFT_RUN_LENGTH = 16;

/**
 * `0, 2, 4, …` — a run in which every consecutive pair sits *exactly* the
 * tolerance apart. This is the layout that separates the two candidate
 * algorithms: comparing each candidate against the previous value admits every
 * one of these into a single cluster, while comparing against the cluster's
 * smallest value does not.
 */
function driftingRun(length: number, step: number = TOLERANCE_PX): number[] {
  return Array.from({ length }, (_unused, index) => index * step);
}

/**
 * The clusters a run of exactly-tolerance steps has to form: the second value of
 * each cluster is admitted because it sits exactly the tolerance from the
 * cluster's smallest member, and the third is rejected because it sits twice
 * that. So the values pair up, two per cluster.
 */
function expectedDriftClusters(length: number): number[] {
  return Array.from({ length }, (_unused, index) => Math.floor(index / 2));
}

/** Tolerance arguments the module is required to refuse. */
const UNUSABLE_TOLERANCES = [
  { label: 'NaN', tolerance: Number.NaN },
  { label: 'positive infinite', tolerance: Number.POSITIVE_INFINITY },
  { label: 'negative infinite', tolerance: Number.NEGATIVE_INFINITY },
  { label: 'negative', tolerance: -1 },
  { label: 'barely negative', tolerance: -0.000_1 },
] as const;

/** A measurable 2 x 2 layout, used where the shape itself is not the point. */
function twoByTwo(): Rect[] {
  return [tile(0, 0), tile(0, 200), tile(200, 0), tile(200, 200)];
}

/**
 * Clustering edge cases and the module's purity contract.
 *
 * Property 10 establishes that a well-formed jittered grid comes back as the grid
 * it looks like. These are the cases either side of that: the exact tolerance
 * boundary, where admitting one value too many merges two genuine rows; the
 * drifting run, which is the layout that tells the specified algorithm apart from
 * the one that chains off the previous value; the default the constant supplies
 * and the arguments it refuses; and the purity that lets the resolver be called
 * freely without the caller's measurements changing underneath it.
 *
 * _Requirements: 5.7, 6.3, 6.10, 16.4_
 */
describe('clusterAxis — clustering edge cases and purity', () => {
  it('opens a new cluster only strictly past the tolerance, so 0, 2 and 4 form two clusters', () => {
    const { clusterIndex, clusterCount } = clusterAxis([0, 2, 4], 2);

    // 2 sits exactly the tolerance from 0 and joins it; 4 sits twice the
    // tolerance from that cluster's smallest member and opens its own.
    expect(clusterIndex).toEqual([0, 0, 1]);
    expect(clusterCount).toBe(2);
    expect(clusterCount).not.toBe(1);
  });

  it('reaches the same two clusters however the values are supplied', () => {
    // Cluster indices follow the values, not the argument order, and cluster 0
    // always holds the smallest value.
    expect(clusterAxis([4, 0, 2], 2)).toEqual({ clusterIndex: [1, 0, 0], clusterCount: 2 });
    expect(clusterAxis([2, 4, 0], 2)).toEqual({ clusterIndex: [0, 1, 0], clusterCount: 2 });
    expect(clusterAxis([4, 2, 0], 2)).toEqual({ clusterIndex: [1, 0, 0], clusterCount: 2 });
  });

  it('admits a value exactly the tolerance from its cluster and refuses one just past it', () => {
    expect(clusterAxis([0, TOLERANCE_PX], TOLERANCE_PX).clusterCount).toBe(1);
    expect(clusterAxis([0, TOLERANCE_PX + 0.000_1], TOLERANCE_PX).clusterCount).toBe(2);
  });

  it('does not chain: a long run of values each 2 apart stays many clusters', () => {
    const values = driftingRun(DRIFT_RUN_LENGTH);
    const { clusterIndex, clusterCount } = clusterAxis(values, TOLERANCE_PX);

    expect(clusterIndex).toEqual(expectedDriftClusters(DRIFT_RUN_LENGTH));
    expect(clusterCount).toBe(DRIFT_RUN_LENGTH / 2);
    // The failure this rules out: chaining off the previous value swallows the
    // whole run into one cluster.
    expect(clusterCount).not.toBe(1);
    // And no member ends up further than the tolerance from its cluster's
    // smallest member, which is what the run would violate if it did chain.
    expect(clusteringPostconditionFailures('drifting run', values)).toEqual([]);
  });

  it('does not chain a drifting column of measured rows into a single row', () => {
    // Sixteen tiles stacked in one column, each top exactly the tolerance below
    // the last. Eight rows survive, not one.
    const rects = driftingRun(DRIFT_RUN_LENGTH).map((top) => tile(top, 0));
    const rowCount = DRIFT_RUN_LENGTH / 2;

    expect(gridPositionFromRects(rects, 0)).toEqual({
      rowIndex: 0,
      rowCount,
      columnIndex: 0,
      columnCount: 1,
    });
    expect(gridPositionFromRects(rects, DRIFT_RUN_LENGTH - 1)).toEqual({
      rowIndex: rowCount - 1,
      rowCount,
      columnIndex: 0,
      columnCount: 1,
    });
    // End to end: a single measured column, so the degenerate row applies.
    expect(resolveGrabAnchor(rects, 0)).toBe('top-right');
    expect(resolveGrabAnchor(rects, DRIFT_RUN_LENGTH - 1)).toBe('bottom-right');
  });

  it('applies GRID_CLUSTER_TOLERANCE_PX of 2 when no tolerance argument is supplied', () => {
    const values = [0, 2, 4, 5.5, 100, 100.75];

    expect(GRID_CLUSTER_TOLERANCE_PX).toBe(2);
    expect(GRID_CLUSTER_TOLERANCE_PX).toBe(TOLERANCE_PX);
    expect(clusterAxis(values)).toEqual(clusterAxis(values, GRID_CLUSTER_TOLERANCE_PX));
    expect(clusterAxis(values)).toEqual(clusterAxis(values, 2));
  });

  it('supplies a default that is 2 and not some neighbouring value', () => {
    // A gap of exactly 2 is absorbed by the default but not by a tolerance of 1,
    // and a gap of 3 is not absorbed by the default but is by a tolerance of 3.
    // Only a default of 2 satisfies both.
    expect(clusterAxis([0, 2]).clusterCount).toBe(1);
    expect(clusterAxis([0, 2], 1).clusterCount).toBe(2);
    expect(clusterAxis([0, 3]).clusterCount).toBe(2);
    expect(clusterAxis([0, 3], 3).clusterCount).toBe(1);
  });

  it('applies the same default through measurement and end-to-end resolution', () => {
    const grid = syntheticGrid({ rowCount: 3, columnCount: 4, seed: 2_802 });

    const offenders = grid.rects.flatMap((_rect, index) => {
      const implicit = gridPositionFromRects(grid.rects, index);
      const explicit = gridPositionFromRects(grid.rects, index, GRID_CLUSTER_TOLERANCE_PX);
      const failures: string[] = [];

      if (JSON.stringify(implicit) !== JSON.stringify(explicit)) {
        failures.push(
          `tile ${index}: default tolerance gave ${JSON.stringify(implicit)}, explicit 2 gave ${JSON.stringify(explicit)}`,
        );
      }

      if (resolveGrabAnchor(grid.rects, index) !== resolveGrabAnchor(grid.rects, index, 2)) {
        failures.push(
          `tile ${index}: default tolerance resolved ${resolveGrabAnchor(grid.rects, index)}, explicit 2 resolved ${resolveGrabAnchor(grid.rects, index, 2)}`,
        );
      }

      return failures;
    });

    expect(offenders).toEqual([]);
  });

  it.each(UNUSABLE_TOLERANCES)('refuses a $label tolerance by name', ({ tolerance }) => {
    expect(() => clusterAxis([0, 10, 20], tolerance)).toThrow(/tolerance/i);
  });

  it.each(UNUSABLE_TOLERANCES)(
    'collapses measurement rather than throwing for a $label tolerance',
    ({ tolerance }) => {
      const rects = twoByTwo();

      expect(() => gridPositionFromRects(rects, 3, tolerance)).not.toThrow();
      expect(gridPositionFromRects(rects, 3, tolerance)).toEqual(SINGLE_TILE_POSITION);
      expect(() => resolveGrabAnchor(rects, 3, tolerance)).not.toThrow();
      expect(resolveGrabAnchor(rects, 3, tolerance)).toBe(SINGLE_TILE_ANCHOR);
    },
  );

  it('accepts a tolerance of 0, which groups only exactly equal values', () => {
    const { clusterIndex, clusterCount } = clusterAxis([0, 0, 0.5, 0.5, 1], 0);

    expect(clusterIndex).toEqual([0, 0, 1, 1, 2]);
    expect(clusterCount).toBe(3);
  });

  it('returns equal anchors for repeated invocations with equal inputs', () => {
    const grid = syntheticGrid({ rowCount: 4, columnCount: 5, seed: 1_618 });
    const cloned = grid.rects.map((rect) => ({ ...rect }));

    const first = grid.rects.map((_rect, index) => resolveGrabAnchor(grid.rects, index));
    const second = grid.rects.map((_rect, index) => resolveGrabAnchor(cloned, index));
    const third = grid.rects.map((_rect, index) => resolveGrabAnchor(grid.rects, index));

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.every(isAnchor)).toBe(true);
    // A second, structurally equal call is answering from the arguments alone —
    // there is no retained state for the first call to have primed.
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('mutates neither the supplied rect array nor its members', () => {
    const grid = syntheticGrid({ rowCount: 3, columnCount: 3, seed: 2_718 });
    const before = JSON.stringify(grid.rects);

    grid.rects.forEach((_rect, index) => {
      gridPositionFromRects(grid.rects, index);
      resolveGrabAnchor(grid.rects, index);
    });
    // Including the malformed paths, which take a different route out.
    gridPositionFromRects(grid.rects, -1);
    resolveGrabAnchor(grid.rects, Number.NaN);
    resolveGrabAnchor(grid.rects, 0, Number.NaN);

    expect(JSON.stringify(grid.rects)).toBe(before);
  });

  it('mutates neither the supplied value list nor its order', () => {
    const values = [4, 0, 2, 2, 9, -3.5];
    const before = [...values];

    clusterAxis(values);
    clusterAxis(values, 0);

    expect(values).toEqual(before);
  });

  it('resolves from a frozen rect array of frozen members, so no write is even attempted', () => {
    // Test modules are strict-mode ESM, so an attempted write to a frozen object
    // throws rather than failing silently.
    const rects: readonly Rect[] = Object.freeze(twoByTwo().map((rect) => Object.freeze(rect)));

    expect(() => resolveGrabAnchor(rects, 3)).not.toThrow();
    expect(resolveGrabAnchor(rects, 3)).toBe('bottom-right');
    expect(gridPositionFromRects(rects, 3)).toEqual({
      rowIndex: 1,
      rowCount: 2,
      columnIndex: 1,
      columnCount: 2,
    });
    expect(() => clusterAxis(Object.freeze([4, 0, 2]))).not.toThrow();
  });

  it('returns a fresh position on every call, so a mutated result cannot leak into the next', () => {
    const collapsed = gridPositionFromRects([], 0);

    collapsed.rowCount = 99;
    collapsed.columnIndex = 42;

    expect(gridPositionFromRects([], 0)).toEqual(SINGLE_TILE_POSITION);

    const measured = gridPositionFromRects(twoByTwo(), 3);

    measured.rowIndex = -7;

    expect(gridPositionFromRects(twoByTwo(), 3)).toEqual({
      rowIndex: 1,
      rowCount: 2,
      columnIndex: 1,
      columnCount: 2,
    });
  });

  it('sorts at most once per axis, so at most twice per resolution', () => {
    const grid = syntheticGrid({ rowCount: 4, columnCount: 4, seed: 3_141 });
    const spy = vi.spyOn(Array.prototype, 'sort');
    let perResolution = 0;
    let perClustering = 0;

    try {
      resolveGrabAnchor(grid.rects, 5);
      perResolution = spy.mock.calls.length;
      spy.mockClear();
      clusterAxis(grid.rects.map((rect) => rect.top));
      perClustering = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }

    expect(perResolution).toBeLessThanOrEqual(2);
    expect(perClustering).toBe(1);
  });
});
