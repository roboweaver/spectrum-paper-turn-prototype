/**
 * How many tiles the demo shows, and the grid shape that many tiles lay out in.
 *
 * The prototype exists to show that the grab anchor is derived from where a tile
 * sits in the grid, and there are eight anchors to reach. Three tiles can only
 * ever measure into three shapes, so the demo lets the tile count be dialled
 * from 1 to 16 and derives the column count from it — a 3 x 3 grid reaches all
 * eight anchors at once, a 4 x 4 reaches the six that a grid with no centre
 * column can.
 *
 * Pure: no DOM, no clock, no module state. `app.ts` applies the result.
 */

export const MIN_TILE_COUNT = 1;
export const MAX_TILE_COUNT = 16;

/**
 * The count the demo opens with.
 *
 * Deliberately the three tiles the prototype has always shown, so the default
 * page is the layout every existing browser and visual test measures.
 */
export const DEFAULT_TILE_COUNT = 3;

/** Grid gap, in CSS pixels. Must match `--grid-gap` in `styles.css`. */
export const TILE_GAP_PX = 24;

/**
 * Widest tile minimum, in CSS pixels — the prototype's original tile size, and
 * the floor used whenever three or fewer columns are asked for.
 */
export const WIDEST_TILE_MIN_PX = 240;

/** Narrowest tile minimum, in CSS pixels, once many columns are asked for. */
export const NARROWEST_TILE_MIN_PX = 150;

export interface GridShape {
  readonly rowCount: number;
  readonly columnCount: number;
}

/** Round and clamp any number into `[MIN_TILE_COUNT, MAX_TILE_COUNT]`. */
export function clampTileCount(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TILE_COUNT;
  }

  return Math.min(MAX_TILE_COUNT, Math.max(MIN_TILE_COUNT, Math.round(value)));
}

/** Read `?tiles=` as a tile count, falling back to the default for anything unusable. */
export function tileCountFromParams(search: string | URLSearchParams): number {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = params.get('tiles');

  if (raw === null || raw.trim() === '') {
    return DEFAULT_TILE_COUNT;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampTileCount(parsed) : DEFAULT_TILE_COUNT;
}

/**
 * The column count a tile count wants, as the more-columns half of the most
 * balanced exact factor pair: rows is the largest divisor of `count` at or below
 * its square root, and columns is what is left.
 *
 * So the shape is always full — no ragged last row — and reads the way the
 * layouts are usually named: `1 -> 1x1`, `2 -> 1x2`, `3 -> 1x3`, `6 -> 2x3`,
 * `9 -> 3x3`, `10 -> 2x5`, `12 -> 3x4`, `16 -> 4x4`. A prime count above three
 * asks for a single row of that many columns, which the width cap below then
 * trims to something that fits.
 */
export function idealColumnCount(count: number): number {
  const tiles = clampTileCount(count);
  let rows = 1;

  for (let candidate = 1; candidate * candidate <= tiles; candidate += 1) {
    if (tiles % candidate === 0) {
      rows = candidate;
    }
  }

  return tiles / rows;
}

/**
 * The narrowest a tile may be laid out at when `columns` columns are asked for.
 *
 * Tiles are allowed to get narrower the more columns are requested, or a 2 x 5
 * would be unreachable on an ordinary laptop. Three or fewer columns keep the
 * original 240px floor exactly, so the default layout is unchanged at every
 * viewport width.
 */
export function minTileWidthPx(columns: number): number {
  const requested = Math.max(1, Math.round(columns));

  return Math.max(
    NARROWEST_TILE_MIN_PX,
    Math.min(WIDEST_TILE_MIN_PX, Math.round((WIDEST_TILE_MIN_PX * 3) / requested)),
  );
}

/**
 * How many columns of at least `minTileWidth` fit in `availableWidthPx`, gaps
 * included. At least `1`, so a width too small for even one tile still lays out.
 *
 * This is the column count `repeat(auto-fit, minmax(minTileWidth, 1fr))` would
 * have produced, restated here so the requested shape can be capped by it rather
 * than by whatever the browser's own track sizing happens to choose.
 */
export function columnsThatFit(availableWidthPx: number, minTileWidth: number): number {
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) {
    return 1;
  }

  const stride = Math.max(1, minTileWidth) + TILE_GAP_PX;
  return Math.max(1, Math.floor((availableWidthPx + TILE_GAP_PX) / stride));
}

/**
 * The shape `count` tiles lay out in, given the width available to the grid: the
 * ideal column count, capped by how many columns actually fit.
 *
 * Narrow viewports therefore fold the requested shape down — 16 tiles on a phone
 * become a single column of 16 rows, which is a legitimate degenerate shape and
 * one of the cases worth inspecting. `rowCount` is what the tiles measure into,
 * so a capped shape reports its real, possibly partial, last row.
 *
 * Total: never throws, and always returns counts that are integers of at least 1.
 */
export function gridShapeFor(count: number, availableWidthPx: number): GridShape {
  const tiles = clampTileCount(count);
  const ideal = idealColumnCount(tiles);
  const columnCount = Math.min(ideal, columnsThatFit(availableWidthPx, minTileWidthPx(ideal)));

  return { rowCount: Math.ceil(tiles / columnCount), columnCount };
}

/** `3 tiles · 1 × 3`, for the debug readout. */
export function formatGridShape(tileCount: number, shape: GridShape): string {
  const tiles = `${tileCount} ${tileCount === 1 ? 'tile' : 'tiles'}`;
  return `${tiles} · ${shape.rowCount} × ${shape.columnCount}`;
}
