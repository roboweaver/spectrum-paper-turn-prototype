import { describe, expect, it } from 'vitest';
import { validateProfile } from '../../src/transition/geometry';
import { defaultMotionProfile } from '../../src/transition/motion-profile';

function assertDefaultMotionProfileIsReadonly(): void {
  // @ts-expect-error default profile is readonly
  defaultMotionProfile.durationMs = 700;
}

void assertDefaultMotionProfileIsReadonly;

describe('defaultMotionProfile', () => {
  it('stays inside approved timing, mesh, and texture limits', () => {
    expect(defaultMotionProfile.durationMs).toBe(720);
    expect(defaultMotionProfile.durationMs).toBeGreaterThanOrEqual(650);
    expect(defaultMotionProfile.durationMs).toBeLessThanOrEqual(800);
    expect(defaultMotionProfile.fallbackDurationMs).toBe(200);
    expect(defaultMotionProfile.fallbackDurationMs).toBeGreaterThanOrEqual(180);
    expect(defaultMotionProfile.fallbackDurationMs).toBeLessThanOrEqual(220);
    expect(defaultMotionProfile.bendDepth).toBe(150);
    expect(defaultMotionProfile.foldSoftness).toBe(0.62);
    expect(defaultMotionProfile.edgeCurvature).toBe(20);
    expect(defaultMotionProfile.shadowStrength).toBe(0.42);
    expect(defaultMotionProfile.meshColumns).toBe(20);
    expect(defaultMotionProfile.meshRows).toBe(14);
    expect(defaultMotionProfile.maxTextureDpr).toBe(2);
    expect(defaultMotionProfile.maxTextureDpr).toBeLessThanOrEqual(2);
    expect(defaultMotionProfile.maxTexturePixels).toBe(4_194_304);
    expect(Object.isFrozen(defaultMotionProfile)).toBe(true);
  });

  // An edge-midpoint grab anchor's uv carries a component of exactly 0.5, which
  // only addresses a real mesh vertex when the matching dimension is even. A
  // future tuning change to an odd density should trip this named test rather
  // than throw out of validateProfile() at activation time.
  it('ships an even mesh so every edge-midpoint anchor is addressable', () => {
    expect(defaultMotionProfile.meshColumns).toBe(20);
    expect(defaultMotionProfile.meshRows).toBe(14);
    expect(defaultMotionProfile.meshColumns % 2).toBe(0);
    expect(defaultMotionProfile.meshRows % 2).toBe(0);
    expect(defaultMotionProfile.meshColumns).toBeGreaterThanOrEqual(2);
    expect(defaultMotionProfile.meshRows).toBeGreaterThanOrEqual(2);
  });

  it('passes the profile validator without throwing', () => {
    expect(() => validateProfile(defaultMotionProfile)).not.toThrow();
  });

  it('has a monotonic easing with exact endpoints', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(defaultMotionProfile.easing);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
  });
});
