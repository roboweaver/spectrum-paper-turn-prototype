export interface FrameClock {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

const browserClock: FrameClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

function validateFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: expected a finite number.`);
  }
}

function validatePositiveNumber(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (value <= 0) {
    throw new Error(`Invalid ${field}: expected a number greater than 0.`);
  }
}

export function animateProgress(
  from: number,
  to: number,
  durationMs: number,
  onFrame: (progress: number) => void,
  signal: AbortSignal,
  clock: FrameClock = browserClock,
): Promise<void> {
  try {
    validateFiniteNumber(from, 'from');
    validateFiniteNumber(to, 'to');
    validatePositiveNumber(durationMs, 'durationMs');
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Animation aborted', 'AbortError'));
      return;
    }

    const startedAt = clock.now();
    let frameHandle = 0;
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const settleSuccess = () => {
      if (settled) {
        return;
      }

      settled = true;
      frameHandle = 0;
      cleanup();
      resolve();
    };
    const settleFailure = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;

      if (frameHandle !== 0) {
        clock.cancelFrame(frameHandle);
        frameHandle = 0;
      }

      cleanup();
      reject(error);
    };
    const settleAbort = () => {
      if (settled) {
        return;
      }

      settled = true;

      if (frameHandle !== 0) {
        clock.cancelFrame(frameHandle);
        frameHandle = 0;
      }

      cleanup();
      reject(new DOMException('Animation aborted', 'AbortError'));
    };
    const onAbort = () => {
      settleAbort();
    };
    const queueFrame = () => {
      try {
        frameHandle = clock.requestFrame(frame);
      } catch (error) {
        settleFailure(error);
      }
    };
    const frame: FrameRequestCallback = (timestamp) => {
      if (settled) {
        return;
      }

      frameHandle = 0;

      if (signal.aborted) {
        settleAbort();
        return;
      }

      const elapsed = Math.min(1, Math.max(0, (timestamp - startedAt) / durationMs));

      try {
        onFrame(from + (to - from) * elapsed);
      } catch (error) {
        settleFailure(error);
        return;
      }

      if (settled || signal.aborted) {
        settleAbort();
        return;
      }

      if (elapsed === 1) {
        settleSuccess();
        return;
      }

      queueFrame();
    };

    signal.addEventListener('abort', onAbort, { once: true });

    try {
      onFrame(from);
    } catch (error) {
      settleFailure(error);
      return;
    }

    if (settled || signal.aborted) {
      settleAbort();
      return;
    }

    queueFrame();
  });
}
