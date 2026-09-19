/**
 * A true rectangle corner, and the vocabulary of the reveal clip polygon.
 *
 * Deliberately kept a four-value union that admits no edge midpoint, so the
 * polygon's winding-order corner list cannot grow beyond four members.
 */
export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/** The midpoint of one rectangle edge. */
export type EdgeMidpoint = 'top-center' | 'middle-right' | 'bottom-center' | 'middle-left';

/**
 * Any point the sheet may be grabbed by: the four corners plus the four edge
 * midpoints. The pivot is always the geometric opposite of the grab anchor.
 */
export type GrabAnchor = Corner | EdgeMidpoint;

/** Which family of line the sheet folds about. */
export type FoldAxisKind = 'diagonal' | 'midline';

/**
 * The line in unit-square coordinates about which the sheet's back face is the
 * reflection of its front face. It joins the two anchors of the grab anchor's
 * own family that are neither the grab anchor nor its opposite.
 */
export interface FoldAxis {
  kind: FoldAxisKind;
  /** Endpoint of the fold line, in unit-square coordinates. */
  origin: Point;
  /** The other endpoint of the fold line, in unit-square coordinates. */
  far: Point;
}

/**
 * Where a tile sits in the measured grid.
 *
 * Indices are 0-based: rows are ordered top to bottom and columns left to
 * right, so `rowIndex` `0` is the topmost measured row and `columnIndex` `0`
 * the leftmost measured column. Both counts are integers of at least `1`, with
 * `0 <= rowIndex < rowCount` and `0 <= columnIndex < columnCount`.
 */
export interface GridPosition {
  rowIndex: number;
  rowCount: number;
  columnIndex: number;
  columnCount: number;
}

/** Classification of a tile's row index within the measured grid. */
export type RowBand = 'top' | 'middle' | 'bottom';

/**
 * Classification of a tile's column index within the measured grid. A `center`
 * band exists only when `columnCount` is odd.
 */
export type ColumnBand = 'left' | 'center' | 'right';

export type TransitionState = 'idle' | 'preparing' | 'opening' | 'open' | 'closing';
export type MotionMode = 'full' | 'fallback';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MotionProfile {
  durationMs: number;
  fallbackDurationMs: number;
  bendDepth: number;
  foldSoftness: number;
  edgeCurvature: number;
  shadowStrength: number;
  meshColumns: number;
  meshRows: number;
  maxTextureDpr: number;
  maxTexturePixels: number;
  easing: (progress: number) => number;
}

export interface PaperFrame {
  positions: Float32Array;
  shade: Float32Array;
  /** Sine of the turn angle: 0 at both endpoints, 1 at peak curl. */
  lift: number;
  /** Sheet opacity, ramped to 0 as the turn settles onto the page. */
  alpha: number;
  revealClipPath: string;
}

export interface RendererInput {
  sourceRect: Rect;
  destinationRect: Rect;
  grabAnchor: GrabAnchor;
  texture: HTMLCanvasElement;
  /**
   * Capture of the destination page, printed on the sheet's reverse face.
   * `null` degrades the reverse to blank paper.
   */
  backTexture: HTMLCanvasElement | null;
  profile: MotionProfile;
}

export interface PaperRenderer {
  render(progress: number): PaperFrame;
  dispose(): void;
}

export interface TransitionOpenRequest {
  sourceId: string;
  grabAnchor: GrabAnchor;
  trigger: HTMLElement;
}

export interface TransitionView {
  prepareDetail(sourceId: string): void;
  measureDestination(): Rect;
  resolveSource(sourceId: string): HTMLElement | null;
  resolveDestination(): HTMLElement;
  measureSource(source: HTMLElement): Rect;
  setDetailClip(clipPath: string): void;
  setSourceHidden(source: HTMLElement, hidden: boolean): void;
  setListVisible(visible: boolean): void;
  setDetailVisible(visible: boolean): void;
  setDetailInert(inert: boolean): void;
  setBusy(busy: boolean): void;
  freezeScroll(): void;
  restoreScroll(): void;
  focusDetailHeading(): void;
  focusListFallback(): void;
}

export interface TransitionDependencies {
  profile: MotionProfile;
  selectMotionMode(): MotionMode;
  capture(
    source: HTMLElement,
    profile: MotionProfile,
    styleOverrides?: Partial<CSSStyleDeclaration>,
  ): Promise<HTMLCanvasElement>;
  createRenderer(input: RendererInput): PaperRenderer;
  runFallback(direction: 'open' | 'close', durationMs: number, signal: AbortSignal): Promise<void>;
  animate(
    from: number,
    to: number,
    durationMs: number,
    onFrame: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface CaptureOptions {
  pixelRatio: number;
  width: number;
  height: number;
}

export interface FullMotionPrerequisites {
  reducedMotion: boolean;
  webglAvailable: boolean;
  captureAvailable: boolean;
}
