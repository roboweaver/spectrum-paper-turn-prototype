import { defaultMotionProfile } from '../transition/motion-profile';
import type { MotionProfile } from '../transition/types';

/** Slowest end of the track, as a total turn duration in milliseconds. */
export const SLOWEST_DURATION_MS = 10_000;
/** Fastest end of the track, as a total turn duration in milliseconds. */
export const FASTEST_DURATION_MS = 180;
/** Discrete positions on the speed slider track. */
export const SPEED_SLIDER_STEPS = 1000;

/**
 * The 1x basis. Both durations are scaled by the same multiplier, each against
 * its own basis, so the fallback keeps its proportion to the full turn instead
 * of collapsing onto the same absolute millisecond value.
 */
const BASE_DURATION_MS = defaultMotionProfile.durationMs;
const BASE_FALLBACK_DURATION_MS = defaultMotionProfile.fallbackDurationMs;

export const DEFAULT_MULTIPLIER = 1;
export const MIN_MULTIPLIER = BASE_DURATION_MS / SLOWEST_DURATION_MS;
export const MAX_MULTIPLIER = BASE_DURATION_MS / FASTEST_DURATION_MS;

const LOG_SPAN = Math.log(MAX_MULTIPLIER / MIN_MULTIPLIER);

export function clampMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier)) {
    return DEFAULT_MULTIPLIER;
  }

  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier));
}

/**
 * Maps a normalized track position to a speed multiplier on a log scale.
 *
 * A linear-in-milliseconds track would bunch every useful speed into the last
 * few percent, putting 1x at roughly 94% of the track. Spacing the multiplier
 * geometrically instead keeps 1x near two thirds of the way along and gives
 * both halves of the range usable travel.
 */
export function positionToMultiplier(position: number): number {
  if (!Number.isFinite(position) || position <= 0) {
    return MIN_MULTIPLIER;
  }

  if (position >= 1) {
    return MAX_MULTIPLIER;
  }

  return MIN_MULTIPLIER * Math.exp(LOG_SPAN * position);
}

/** Inverse of {@link positionToMultiplier}, clamped to the track. */
export function multiplierToPosition(multiplier: number): number {
  return Math.log(clampMultiplier(multiplier) / MIN_MULTIPLIER) / LOG_SPAN;
}

export function multiplierToDurationMs(multiplier: number): number {
  return Math.round(BASE_DURATION_MS / clampMultiplier(multiplier));
}

export function multiplierToFallbackDurationMs(multiplier: number): number {
  return Math.round(BASE_FALLBACK_DURATION_MS / clampMultiplier(multiplier));
}

export function durationToMultiplier(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return DEFAULT_MULTIPLIER;
  }

  return clampMultiplier(BASE_DURATION_MS / durationMs);
}

/**
 * Track index that means exactly 1x.
 *
 * Quantising the log track to whole steps cannot land on 1x exactly, so this
 * index is treated as a detent: the default stays reachable by dragging and
 * reports 720 ms rather than 719.8 ms.
 */
export const DEFAULT_SLIDER_INDEX = Math.round(
  multiplierToPosition(DEFAULT_MULTIPLIER) * SPEED_SLIDER_STEPS,
);

export function sliderIndexToMultiplier(index: number): number {
  if (!Number.isFinite(index)) {
    return DEFAULT_MULTIPLIER;
  }

  const clamped = Math.min(SPEED_SLIDER_STEPS, Math.max(0, Math.round(index)));
  return clamped === DEFAULT_SLIDER_INDEX
    ? DEFAULT_MULTIPLIER
    : positionToMultiplier(clamped / SPEED_SLIDER_STEPS);
}

export function multiplierToSliderIndex(multiplier: number): number {
  return Math.round(multiplierToPosition(multiplier) * SPEED_SLIDER_STEPS);
}

export function formatMultiplier(multiplier: number): string {
  return `${Number(multiplier.toFixed(2))}x`;
}

export interface AnimationSpeedState {
  readonly multiplier: number;
  readonly durationMs: number;
  readonly fallbackDurationMs: number;
  readonly sliderIndex: number;
}

export function formatSpeedReadout(state: AnimationSpeedState): string {
  return `${formatMultiplier(state.multiplier)} · ${state.durationMs} ms`;
}

export interface AnimationSpeedController {
  state(): AnimationSpeedState;
  setSliderIndex(index: number): void;
  setMultiplier(multiplier: number): void;
  /** Return to 1x, which is the default profile's own timing. */
  reset(): void;
  subscribe(listener: (state: AnimationSpeedState) => void): () => void;
}

/**
 * Live animation-speed control backed by a mutable {@link MotionProfile}.
 *
 * The coordinator reads `profile.durationMs` when it starts a full turn and
 * `profile.fallbackDurationMs` when it starts a crossfade, so rewriting the
 * profile between transitions is enough to retime the next one. The profile
 * handed in must not be frozen.
 */
export function createAnimationSpeedController(profile: MotionProfile): AnimationSpeedController {
  const listeners = new Set<(state: AnimationSpeedState) => void>();
  let multiplier = durationToMultiplier(profile.durationMs);

  const stateOf = (): AnimationSpeedState => ({
    multiplier,
    durationMs: multiplierToDurationMs(multiplier),
    fallbackDurationMs: multiplierToFallbackDurationMs(multiplier),
    sliderIndex: multiplierToSliderIndex(multiplier),
  });

  const apply = (next: number): void => {
    multiplier = next;

    const state = stateOf();
    profile.durationMs = state.durationMs;
    profile.fallbackDurationMs = state.fallbackDurationMs;

    for (const listener of listeners) {
      listener(state);
    }
  };

  apply(multiplier);

  return {
    state: stateOf,
    setSliderIndex: (index) => apply(sliderIndexToMultiplier(index)),
    setMultiplier: (value) => apply(clampMultiplier(value)),
    reset: () => apply(DEFAULT_MULTIPLIER),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(stateOf());

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
