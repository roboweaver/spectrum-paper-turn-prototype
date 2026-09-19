import type { MotionProfile } from './types';

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) return 4 * progress * progress * progress;
  return 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export const defaultMotionProfile = Object.freeze({
  durationMs: 720,
  fallbackDurationMs: 200,
  bendDepth: 150,
  foldSoftness: 0.62,
  edgeCurvature: 20,
  shadowStrength: 0.42,
  /**
   * Constrained to an even integer of at least 2, and validated as such by
   * `validateProfile()` in `geometry.ts`.
   *
   * An edge-midpoint grab anchor carries a `uv` component of exactly `0.5`,
   * which only lands on a real mesh vertex when the corresponding dimension is
   * even. Which of the eight anchors is grabbed is decided by the live layout at
   * activation, so the constraint is unconditional: the profile has to be usable
   * for all eight, not just for the anchor of the moment.
   */
  meshColumns: 20,
  /**
   * Constrained to an even integer of at least 2, for the same reason as
   * `meshColumns` — a `middle-left`/`middle-right` anchor's `uv.y` of `0.5` needs
   * an even row count to address a real mesh vertex — and validated by
   * `validateProfile()`.
   */
  meshRows: 14,
  maxTextureDpr: 2,
  maxTexturePixels: 4_194_304,
  easing: easeInOutCubic,
} satisfies MotionProfile);
