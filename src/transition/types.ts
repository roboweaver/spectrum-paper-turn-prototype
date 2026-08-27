export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
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
  revealClipPath: string;
}

export interface RendererInput {
  sourceRect: Rect;
  destinationRect: Rect;
  grabbedCorner: Corner;
  texture: HTMLCanvasElement;
  profile: MotionProfile;
}

export interface PaperRenderer {
  render(progress: number): PaperFrame;
  dispose(): void;
}

export interface TransitionOpenRequest {
  sourceId: string;
  grabbedCorner: Corner;
  trigger: HTMLElement;
}

export interface TransitionView {
  prepareDetail(sourceId: string): void;
  measureDestination(): Rect;
  resolveSource(sourceId: string): HTMLElement | null;
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
  capture(source: HTMLElement, profile: MotionProfile): Promise<HTMLCanvasElement>;
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
