import { describe, expect, it, vi } from 'vitest';
import {
  clampMultiplier,
  createAnimationSpeedController,
  DEFAULT_MULTIPLIER,
  DEFAULT_SLIDER_INDEX,
  durationToMultiplier,
  FASTEST_DURATION_MS,
  formatMultiplier,
  formatSpeedReadout,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  multiplierToDurationMs,
  multiplierToFallbackDurationMs,
  multiplierToPosition,
  multiplierToSliderIndex,
  positionToMultiplier,
  SLOWEST_DURATION_MS,
  SPEED_SLIDER_STEPS,
  sliderIndexToMultiplier,
} from '../../src/debug/animation-speed';
import { defaultMotionProfile } from '../../src/transition/motion-profile';
import type { MotionProfile } from '../../src/transition/types';

function mutableProfile(overrides: Partial<MotionProfile> = {}): MotionProfile {
  return { ...defaultMotionProfile, ...overrides };
}

describe('animation speed mapping', () => {
  it('hits the requested endpoints exactly', () => {
    expect(multiplierToDurationMs(positionToMultiplier(0))).toBe(SLOWEST_DURATION_MS);
    expect(multiplierToDurationMs(positionToMultiplier(1))).toBe(FASTEST_DURATION_MS);
    expect(SLOWEST_DURATION_MS).toBe(10_000);
    expect(FASTEST_DURATION_MS).toBe(180);
  });

  it('maps 1x to exactly the default profile timing', () => {
    expect(multiplierToDurationMs(DEFAULT_MULTIPLIER)).toBe(720);
    expect(multiplierToDurationMs(DEFAULT_MULTIPLIER)).toBe(defaultMotionProfile.durationMs);
    expect(multiplierToFallbackDurationMs(DEFAULT_MULTIPLIER)).toBe(200);
    expect(multiplierToFallbackDurationMs(DEFAULT_MULTIPLIER)).toBe(
      defaultMotionProfile.fallbackDurationMs,
    );
  });

  it('derives its bounds from the 720 ms basis', () => {
    expect(MIN_MULTIPLIER).toBeCloseTo(0.072, 10);
    expect(MAX_MULTIPLIER).toBe(4);
  });

  it('round-trips position and multiplier', () => {
    for (const position of [0, 0.1, 0.25, 0.5, 0.655, 0.75, 0.9, 1]) {
      expect(multiplierToPosition(positionToMultiplier(position))).toBeCloseTo(position, 10);
    }

    for (const multiplier of [MIN_MULTIPLIER, 0.25, 0.5, 1, 2, 3, MAX_MULTIPLIER]) {
      expect(positionToMultiplier(multiplierToPosition(multiplier))).toBeCloseTo(multiplier, 10);
    }
  });

  it('is logarithmic, so 1x sits in the reachable middle of the track', () => {
    const defaultPosition = multiplierToPosition(DEFAULT_MULTIPLIER);
    expect(defaultPosition).toBeGreaterThan(0.6);
    expect(defaultPosition).toBeLessThan(0.7);

    // A linear-in-milliseconds track would put 1x here instead, which is the
    // unusable arrangement this mapping exists to avoid.
    const linearPosition =
      (SLOWEST_DURATION_MS - 720) / (SLOWEST_DURATION_MS - FASTEST_DURATION_MS);
    expect(linearPosition).toBeGreaterThan(0.9);

    // Geometric spacing: equal steps multiply rather than subtract.
    const quarter = positionToMultiplier(0.25);
    const half = positionToMultiplier(0.5);
    const threeQuarters = positionToMultiplier(0.75);
    expect(half / quarter).toBeCloseTo(threeQuarters / half, 10);
  });

  it('increases speed monotonically along the track', () => {
    let previous = -Infinity;

    for (let index = 0; index <= SPEED_SLIDER_STEPS; index += 25) {
      const multiplier = positionToMultiplier(index / SPEED_SLIDER_STEPS);
      expect(multiplier).toBeGreaterThan(previous);
      previous = multiplier;
    }
  });

  it('scales the fallback proportionally rather than to the same absolute value', () => {
    expect(multiplierToDurationMs(0.5)).toBe(1440);
    expect(multiplierToFallbackDurationMs(0.5)).toBe(400);

    expect(multiplierToDurationMs(2)).toBe(360);
    expect(multiplierToFallbackDurationMs(2)).toBe(100);

    for (const multiplier of [MIN_MULTIPLIER, 0.5, 1, 2, MAX_MULTIPLIER]) {
      expect(multiplierToDurationMs(multiplier)).not.toBe(
        multiplierToFallbackDurationMs(multiplier),
      );
      expect(
        multiplierToDurationMs(multiplier) / multiplierToFallbackDurationMs(multiplier),
      ).toBeCloseTo(720 / 200, 1);
    }
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(clampMultiplier(99)).toBe(MAX_MULTIPLIER);
    expect(clampMultiplier(0)).toBe(MIN_MULTIPLIER);
    expect(clampMultiplier(-5)).toBe(MIN_MULTIPLIER);
    expect(clampMultiplier(Number.NaN)).toBe(DEFAULT_MULTIPLIER);

    expect(positionToMultiplier(Number.NaN)).toBe(MIN_MULTIPLIER);
    expect(positionToMultiplier(-1)).toBe(MIN_MULTIPLIER);
    expect(positionToMultiplier(2)).toBe(MAX_MULTIPLIER);

    expect(multiplierToDurationMs(99)).toBe(FASTEST_DURATION_MS);
    expect(multiplierToDurationMs(0)).toBe(SLOWEST_DURATION_MS);
  });

  it('converts a duration back to a multiplier for the ?duration seed', () => {
    expect(durationToMultiplier(720)).toBe(1);
    expect(durationToMultiplier(1440)).toBe(0.5);
    expect(durationToMultiplier(180)).toBe(MAX_MULTIPLIER);
    expect(durationToMultiplier(50)).toBe(MAX_MULTIPLIER);
    expect(durationToMultiplier(99_999)).toBe(MIN_MULTIPLIER);
    expect(durationToMultiplier(0)).toBe(DEFAULT_MULTIPLIER);
    expect(durationToMultiplier(Number.NaN)).toBe(DEFAULT_MULTIPLIER);
  });
});

describe('speed slider indices', () => {
  it('keeps a detent at 1x so the default is reachable by dragging', () => {
    expect(DEFAULT_SLIDER_INDEX).toBeGreaterThan(0);
    expect(DEFAULT_SLIDER_INDEX).toBeLessThan(SPEED_SLIDER_STEPS);
    expect(sliderIndexToMultiplier(DEFAULT_SLIDER_INDEX)).toBe(DEFAULT_MULTIPLIER);
    expect(multiplierToDurationMs(sliderIndexToMultiplier(DEFAULT_SLIDER_INDEX))).toBe(720);
    expect(multiplierToSliderIndex(DEFAULT_MULTIPLIER)).toBe(DEFAULT_SLIDER_INDEX);
  });

  it('maps the track ends to the exact duration bounds', () => {
    expect(multiplierToDurationMs(sliderIndexToMultiplier(0))).toBe(SLOWEST_DURATION_MS);
    expect(multiplierToDurationMs(sliderIndexToMultiplier(SPEED_SLIDER_STEPS))).toBe(
      FASTEST_DURATION_MS,
    );
  });

  it('clamps and rounds indices off the track', () => {
    expect(sliderIndexToMultiplier(-10)).toBe(MIN_MULTIPLIER);
    expect(sliderIndexToMultiplier(5000)).toBe(MAX_MULTIPLIER);
    expect(sliderIndexToMultiplier(Number.NaN)).toBe(DEFAULT_MULTIPLIER);
    expect(sliderIndexToMultiplier(DEFAULT_SLIDER_INDEX + 0.4)).toBe(DEFAULT_MULTIPLIER);
  });
});

describe('speed readout formatting', () => {
  it('shows the multiplier and the real milliseconds together', () => {
    expect(formatMultiplier(1)).toBe('1x');
    expect(formatMultiplier(4)).toBe('4x');
    expect(formatMultiplier(0.5)).toBe('0.5x');
    expect(formatMultiplier(MIN_MULTIPLIER)).toBe('0.07x');

    const profile = mutableProfile();
    const controller = createAnimationSpeedController(profile);
    expect(formatSpeedReadout(controller.state())).toBe('1x · 720 ms');

    controller.setMultiplier(0.5);
    expect(formatSpeedReadout(controller.state())).toBe('0.5x · 1440 ms');
  });
});

describe('createAnimationSpeedController', () => {
  it('writes both durations into the profile in place', () => {
    const profile = mutableProfile();
    const controller = createAnimationSpeedController(profile);

    expect(profile.durationMs).toBe(720);
    expect(profile.fallbackDurationMs).toBe(200);

    controller.setMultiplier(0.5);
    expect(profile.durationMs).toBe(1440);
    expect(profile.fallbackDurationMs).toBe(400);

    controller.setMultiplier(4);
    expect(profile.durationMs).toBe(180);
    expect(profile.fallbackDurationMs).toBe(50);
  });

  it('leaves the rest of the profile untouched', () => {
    const profile = mutableProfile();
    createAnimationSpeedController(profile).setMultiplier(2);

    expect(profile.bendDepth).toBe(defaultMotionProfile.bendDepth);
    expect(profile.meshColumns).toBe(defaultMotionProfile.meshColumns);
    expect(profile.easing).toBe(defaultMotionProfile.easing);
  });

  it('seeds itself from the profile so ?duration survives as the initial value', () => {
    const profile = mutableProfile({ durationMs: 1440 });
    const controller = createAnimationSpeedController(profile);

    expect(controller.state().multiplier).toBe(0.5);
    expect(controller.state().durationMs).toBe(1440);
    // The seed scales the fallback too, keeping the single-multiplier contract.
    expect(profile.fallbackDurationMs).toBe(400);
    expect(controller.state().sliderIndex).toBe(multiplierToSliderIndex(0.5));
  });

  it('clamps a ?duration seed that sits outside the track', () => {
    expect(createAnimationSpeedController(mutableProfile({ durationMs: 60_000 })).state()).toEqual(
      expect.objectContaining({ durationMs: SLOWEST_DURATION_MS, sliderIndex: 0 }),
    );
    expect(createAnimationSpeedController(mutableProfile({ durationMs: 10 })).state()).toEqual(
      expect.objectContaining({ durationMs: FASTEST_DURATION_MS, sliderIndex: SPEED_SLIDER_STEPS }),
    );
  });

  it('resets to exactly 1x / 720 ms', () => {
    const profile = mutableProfile({ durationMs: 5000 });
    const controller = createAnimationSpeedController(profile);

    controller.setSliderIndex(0);
    expect(profile.durationMs).toBe(SLOWEST_DURATION_MS);

    controller.reset();
    expect(controller.state().multiplier).toBe(1);
    expect(controller.state().sliderIndex).toBe(DEFAULT_SLIDER_INDEX);
    expect(profile.durationMs).toBe(720);
    expect(profile.fallbackDurationMs).toBe(200);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const controller = createAnimationSpeedController(mutableProfile());
    const listener = vi.fn();

    const unsubscribe = controller.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ durationMs: 720 }));

    controller.setSliderIndex(SPEED_SLIDER_STEPS);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ durationMs: 180 }));

    unsubscribe();
    controller.reset();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('refuses to be constructed over the frozen default profile', () => {
    expect(() => createAnimationSpeedController(defaultMotionProfile)).toThrow(TypeError);
  });
});
