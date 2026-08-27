import type { MotionProfile } from './types';

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) return 4 * progress * progress * progress;
  return 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export const defaultMotionProfile = Object.freeze({
  durationMs: 720,
  fallbackDurationMs: 200,
  bendDepth: 120,
  foldSoftness: 0.14,
  edgeCurvature: 20,
  shadowStrength: 0.42,
  meshColumns: 20,
  meshRows: 14,
  maxTextureDpr: 2,
  maxTexturePixels: 4_194_304,
  easing: easeInOutCubic,
} satisfies MotionProfile);
