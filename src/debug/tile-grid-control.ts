import { clampTileCount, formatGridShape, type GridShape } from '../tile-grid';

/**
 * The part of the demo app this controller drives. Narrow on purpose, so a test
 * can supply a double without building the Spectrum DOM.
 */
export interface TileGridTarget {
  tileCount(): number;
  setTileCount(count: number): GridShape;
  refreshLayout(): GridShape;
}

export interface TileGridState {
  readonly tileCount: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface TileGridController {
  state(): TileGridState;
  /** Render this many tiles. Rounded and clamped to the supported range. */
  setTileCount(count: number): void;
  /** Re-measure the layout without changing the tile count, after a resize. */
  refresh(): void;
  subscribe(listener: (state: TileGridState) => void): () => void;
}

export function formatTileGridReadout(state: TileGridState): string {
  return formatGridShape(state.tileCount, state);
}

/**
 * Live tile-count control over the rendered grid.
 *
 * The shape is whatever the target reports back after laying out, never what was
 * asked for: a narrow viewport folds a requested 4 x 4 down to fewer columns, and
 * the readout has to say what is on screen rather than what was intended.
 *
 * Construction measures the grid as it already stands, so the readout is correct
 * before anything is touched.
 */
export function createTileGridController(target: TileGridTarget): TileGridController {
  const listeners = new Set<(state: TileGridState) => void>();
  let tileCount = target.tileCount();
  let shape = target.refreshLayout();

  const stateOf = (): TileGridState => ({
    tileCount,
    rowCount: shape.rowCount,
    columnCount: shape.columnCount,
  });

  const publish = (): void => {
    const state = stateOf();

    for (const listener of listeners) {
      listener(state);
    }
  };

  return {
    state: stateOf,
    setTileCount: (count) => {
      const next = clampTileCount(count);

      if (next === tileCount) {
        // Still re-publish nothing: re-rendering the same tiles would detach the
        // element the coordinator may be holding for focus restore.
        return;
      }

      tileCount = next;
      shape = target.setTileCount(next);
      publish();
    },
    refresh: () => {
      shape = target.refreshLayout();
      publish();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener(stateOf());

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
