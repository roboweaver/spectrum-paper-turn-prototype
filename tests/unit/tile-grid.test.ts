import { describe, expect, it } from 'vitest';
import {
  clampTileCount,
  columnsThatFit,
  DEFAULT_TILE_COUNT,
  formatGridShape,
  gridShapeFor,
  idealColumnCount,
  MAX_TILE_COUNT,
  MIN_TILE_COUNT,
  minTileWidthPx,
  NARROWEST_TILE_MIN_PX,
  tileCountFromParams,
  WIDEST_TILE_MIN_PX,
} from '../../src/tile-grid';

/**
 * Widths available to the grid at the viewports the browser suites use, derived
 * the same way the page derives them: the list surface is padded by
 * `clamp(24px, 5vw, 72px)` per side, dropping to a flat 20px below the 600px
 * breakpoint.
 *
 * - 1280px viewport: 5vw = 64px per side, so 1280 - 128 = 1152.
 * - 700px viewport: 35px per side, so 700 - 70 = 630.
 * - 400px viewport: 20px per side, so 400 - 40 = 360.
 */
const DESKTOP_GRID_WIDTH = 1152;
const MEDIUM_GRID_WIDTH = 630;
const NARROW_GRID_WIDTH = 360;

describe('clampTileCount', () => {
  it('rounds and clamps into the supported range', () => {
    expect(clampTileCount(1)).toBe(MIN_TILE_COUNT);
    expect(clampTileCount(16)).toBe(MAX_TILE_COUNT);
    expect(clampTileCount(0)).toBe(MIN_TILE_COUNT);
    expect(clampTileCount(-4)).toBe(MIN_TILE_COUNT);
    expect(clampTileCount(99)).toBe(MAX_TILE_COUNT);
    expect(clampTileCount(9.4)).toBe(9);
    expect(clampTileCount(9.5)).toBe(10);
  });

  it('falls back to the default for anything non-finite', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampTileCount(value)).toBe(DEFAULT_TILE_COUNT);
    }
  });
});

describe('tileCountFromParams', () => {
  it('reads a usable ?tiles= value', () => {
    expect(tileCountFromParams('?tiles=9')).toBe(9);
    expect(tileCountFromParams(new URLSearchParams('tiles=16'))).toBe(16);
    expect(tileCountFromParams('?tiles=1')).toBe(1);
  });

  it('clamps out-of-range values instead of rejecting them', () => {
    expect(tileCountFromParams('?tiles=0')).toBe(MIN_TILE_COUNT);
    expect(tileCountFromParams('?tiles=64')).toBe(MAX_TILE_COUNT);
  });

  it('falls back to the default when absent, empty, or unparseable', () => {
    for (const search of ['', '?duration=1200', '?tiles=', '?tiles=banana']) {
      expect(tileCountFromParams(search)).toBe(DEFAULT_TILE_COUNT);
    }
  });
});

describe('idealColumnCount', () => {
  it('is the more-columns half of the most balanced exact factor pair', () => {
    const expected: Record<number, number> = {
      1: 1,
      2: 2,
      3: 3,
      4: 2,
      5: 5,
      6: 3,
      7: 7,
      8: 4,
      9: 3,
      10: 5,
      11: 11,
      12: 4,
      13: 13,
      14: 7,
      15: 5,
      16: 4,
    };

    for (const [count, columns] of Object.entries(expected)) {
      expect(idealColumnCount(Number(count)), `${count} tiles`).toBe(columns);
    }
  });

  it('always describes a shape that holds every tile with no partial row', () => {
    for (let count = MIN_TILE_COUNT; count <= MAX_TILE_COUNT; count += 1) {
      const columns = idealColumnCount(count);

      expect(Number.isInteger(columns)).toBe(true);
      expect(count % columns).toBe(0);
      // Rows never exceed columns, so the shape is named the way layouts are:
      // `2 x 5`, never `5 x 2`.
      expect(count / columns).toBeLessThanOrEqual(columns);
    }
  });
});

describe('minTileWidthPx', () => {
  it('keeps the original 240px floor for three or fewer columns', () => {
    for (const columns of [1, 2, 3]) {
      expect(minTileWidthPx(columns)).toBe(WIDEST_TILE_MIN_PX);
    }
  });

  it('narrows as more columns are asked for, never past the floor', () => {
    expect(minTileWidthPx(4)).toBe(180);
    expect(minTileWidthPx(5)).toBe(NARROWEST_TILE_MIN_PX);

    for (let columns = 5; columns <= MAX_TILE_COUNT; columns += 1) {
      expect(minTileWidthPx(columns)).toBe(NARROWEST_TILE_MIN_PX);
    }
  });
});

describe('columnsThatFit', () => {
  it('counts tracks of the given minimum, gaps included', () => {
    // (1152 + 24) / (240 + 24) = 4.45
    expect(columnsThatFit(DESKTOP_GRID_WIDTH, 240)).toBe(4);
    // (630 + 24) / 264 = 2.47
    expect(columnsThatFit(MEDIUM_GRID_WIDTH, 240)).toBe(2);
    // (360 + 24) / 264 = 1.45
    expect(columnsThatFit(NARROW_GRID_WIDTH, 240)).toBe(1);
  });

  it('never reports fewer than one column, whatever the width', () => {
    for (const width of [0, -100, 12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(columnsThatFit(width, 240)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('gridShapeFor', () => {
  it('lays out the named shapes at a desktop width', () => {
    const expected: Record<number, string> = {
      1: '1x1',
      2: '1x2',
      3: '1x3',
      4: '2x2',
      6: '2x3',
      8: '2x4',
      9: '3x3',
      10: '2x5',
      12: '3x4',
      15: '3x5',
      16: '4x4',
    };

    for (const [count, shape] of Object.entries(expected)) {
      const { rowCount, columnCount } = gridShapeFor(Number(count), DESKTOP_GRID_WIDTH);
      expect(`${rowCount}x${columnCount}`, `${count} tiles`).toBe(shape);
    }
  });

  it('keeps the default three-tile layout identical at every browser-suite width', () => {
    // The shapes the existing interaction and visual suites measure. A change
    // here is a change to every one of those expectations, so it has to fail a
    // named test rather than a screenshot.
    expect(gridShapeFor(3, DESKTOP_GRID_WIDTH)).toEqual({ rowCount: 1, columnCount: 3 });
    expect(gridShapeFor(3, MEDIUM_GRID_WIDTH)).toEqual({ rowCount: 2, columnCount: 2 });
    expect(gridShapeFor(3, NARROW_GRID_WIDTH)).toEqual({ rowCount: 3, columnCount: 1 });
  });

  it('folds a requested shape down when the width cannot hold it', () => {
    // 16 tiles want four columns; a phone-width grid holds one.
    expect(gridShapeFor(16, NARROW_GRID_WIDTH)).toEqual({ rowCount: 16, columnCount: 1 });
    // And reports the partial last row it actually laid out, not the ideal
    // shape: 10 tiles want 2 x 5, a 630px grid holds three 150px columns, so
    // what lands is four rows with one tile in the last.
    expect(gridShapeFor(10, MEDIUM_GRID_WIDTH)).toEqual({ rowCount: 4, columnCount: 3 });
  });

  it('is total over every count and width', () => {
    for (let count = MIN_TILE_COUNT; count <= MAX_TILE_COUNT; count += 1) {
      for (const width of [0, -1, Number.NaN, 120, 630, 1152, 4096]) {
        const shape = gridShapeFor(count, width);

        expect(Number.isInteger(shape.rowCount)).toBe(true);
        expect(Number.isInteger(shape.columnCount)).toBe(true);
        expect(shape.columnCount).toBeGreaterThanOrEqual(1);
        expect(shape.rowCount).toBeGreaterThanOrEqual(1);
        // The shape has to hold every tile, and waste no whole row doing it.
        expect(shape.rowCount * shape.columnCount).toBeGreaterThanOrEqual(count);
        expect((shape.rowCount - 1) * shape.columnCount).toBeLessThan(count);
      }
    }
  });
});

describe('formatGridShape', () => {
  it('reads as a tile count and a shape, singular where it should be', () => {
    expect(formatGridShape(1, { rowCount: 1, columnCount: 1 })).toBe('1 tile · 1 × 1');
    expect(formatGridShape(16, { rowCount: 4, columnCount: 4 })).toBe('16 tiles · 4 × 4');
  });
});
