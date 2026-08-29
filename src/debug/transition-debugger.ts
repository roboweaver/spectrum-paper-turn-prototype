import type { FrameClock } from '../transition/timeline';

const browserClock: FrameClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export type AnimateProgressFn = (
  from: number,
  to: number,
  durationMs: number,
  onFrame: (progress: number) => void,
  signal: AbortSignal,
) => Promise<void>;

export interface DebugState {
  /** True while a transition is being driven. */
  readonly active: boolean;
  readonly paused: boolean;
  /** Normalized position along the run, 0 at the start and 1 at the end. */
  readonly position: number;
  /** The progress value handed to the renderer, which reverses when closing. */
  readonly progress: number;
}

export interface TransitionDebugger {
  readonly animate: AnimateProgressFn;
  isPaused(): boolean;
  pause(): void;
  resume(): void;
  toggle(): void;
  /** Jump to a normalized position and hold there. */
  scrubTo(position: number): void;
  /** Nudge the position by a signed delta and hold there. */
  step(delta: number): void;
  subscribe(listener: (state: DebugState) => void): () => void;
}

function clampPosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

interface ActiveRun {
  readonly from: number;
  readonly to: number;
  readonly durationMs: number;
  readonly onFrame: (progress: number) => void;
  readonly signal: AbortSignal;
  readonly settleSuccess: () => void;
  readonly settleFailure: (error: unknown) => void;
  position: number;
  /** Clock timestamp the next advance is measured from. */
  lastTimestamp: number;
  frameHandle: number;
}

/**
 * A drop-in replacement for `animateProgress` that can pause, resume, and scrub.
 *
 * It exists so the paper turn can be inspected frame by frame. Because the demo
 * ships with the debug panel on by default, it now drives every turn, and it
 * deliberately lives outside `src/transition/` so the shipped transition modules
 * stay unaware of it: the coordinator already takes `animate` as an injected
 * dependency, which is the only seam this needs.
 *
 * Position accumulates from per-frame deltas rather than absolute elapsed time,
 * which is what makes pausing possible: held frames simply contribute nothing.
 * The deltas telescope, so an unpaused run still lands on the same timing as
 * `animateProgress`.
 */
export function createTransitionDebugger(clock: FrameClock = browserClock): TransitionDebugger {
  const listeners = new Set<(state: DebugState) => void>();
  let run: ActiveRun | null = null;
  let paused = false;

  const stateOf = (): DebugState => {
    if (!run) {
      return { active: false, paused, position: 0, progress: 0 };
    }

    return {
      active: true,
      paused,
      position: run.position,
      progress: run.from + (run.to - run.from) * run.position,
    };
  };

  const emit = (): void => {
    const state = stateOf();

    for (const listener of listeners) {
      listener(state);
    }
  };

  const finish = (settle: () => void): void => {
    if (run && run.frameHandle !== 0) {
      clock.cancelFrame(run.frameHandle);
    }

    run = null;
    settle();
    emit();
  };

  /** Push the current position to the renderer. Returns false if the run died. */
  const paint = (): boolean => {
    const current = run;

    if (!current) {
      return false;
    }

    try {
      current.onFrame(current.from + (current.to - current.from) * current.position);
    } catch (error) {
      finish(() => current.settleFailure(error));
      return false;
    }

    return true;
  };

  const abortRun = (): void => {
    const current = run;

    if (!current) {
      return;
    }

    finish(() => {
      current.settleFailure(new DOMException('Animation aborted', 'AbortError'));
    });
  };

  const queueFrame = (): void => {
    const current = run;

    if (!current || current.frameHandle !== 0) {
      return;
    }

    try {
      current.frameHandle = clock.requestFrame(onFrameTick);
    } catch (error) {
      finish(() => current.settleFailure(error));
    }
  };

  function onFrameTick(timestamp: number): void {
    const current = run;

    if (!current) {
      return;
    }

    current.frameHandle = 0;

    if (current.signal.aborted) {
      abortRun();
      return;
    }

    if (paused) {
      // Hold position, but keep a frame queued so resume is immediate.
      queueFrame();
      return;
    }

    const previous = current.lastTimestamp;
    current.lastTimestamp = timestamp;
    current.position = clampPosition(
      current.position + Math.max(0, timestamp - previous) / current.durationMs,
    );

    if (!paint()) {
      return;
    }

    if (current.signal.aborted) {
      abortRun();
      return;
    }

    if (current.position >= 1) {
      finish(current.settleSuccess);
      return;
    }

    emit();
    queueFrame();
  }

  const animate: AnimateProgressFn = (from, to, durationMs, onFrame, signal) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return Promise.reject(new Error('Invalid durationMs: expected a number greater than 0.'));
    }

    if (signal.aborted) {
      return Promise.reject(new DOMException('Animation aborted', 'AbortError'));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleOnce = (settle: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        signal.removeEventListener('abort', onAbort);
        settle();
      };
      const onAbort = (): void => {
        abortRun();
      };

      signal.addEventListener('abort', onAbort, { once: true });

      run = {
        from,
        to,
        durationMs,
        onFrame,
        signal,
        settleSuccess: () => settleOnce(resolve),
        settleFailure: (error) => settleOnce(() => reject(error)),
        position: 0,
        lastTimestamp: clock.now(),
        frameHandle: 0,
      };

      if (!paint()) {
        return;
      }

      emit();
      queueFrame();
    });
  };

  const holdAt = (position: number): void => {
    paused = true;

    if (!run) {
      emit();
      return;
    }

    run.position = clampPosition(position);
    run.lastTimestamp = clock.now();

    if (paint()) {
      emit();
      queueFrame();
    }
  };

  const setPaused = (next: boolean): void => {
    paused = next;

    if (run) {
      run.lastTimestamp = clock.now();

      if (!next) {
        queueFrame();
      }
    }

    emit();
  };

  return {
    animate,
    isPaused: () => paused,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    toggle: () => setPaused(!paused),
    scrubTo: (position) => holdAt(position),
    step: (delta) => holdAt((run?.position ?? 0) + delta),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(stateOf());

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
