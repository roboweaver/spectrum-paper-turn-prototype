export type FallbackRunner = (direction: 'open' | 'close', durationMs: number, signal: AbortSignal) => Promise<void>;

const FALLBACK_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getKeyframes(direction: 'open' | 'close'): PropertyIndexedKeyframes {
  if (direction === 'open') {
    return {
      opacity: ['0.35', '1'],
      transform: ['scale(0.985)', 'scale(1)'],
    };
  }

  return {
    opacity: ['1', '0'],
    transform: ['scale(1)', 'scale(0.985)'],
  };
}

function assertDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('Fallback transition duration must be a positive finite number');
  }
}

export function createFallbackRunner(element: HTMLElement): FallbackRunner {
  return async (direction, durationMs, signal) => {
    assertDuration(durationMs);

    if (signal.aborted) {
      throw createAbortError();
    }

    let aborted = false;
    let animation: Animation | null = null;
    const onAbort = () => {
      aborted = true;
      animation?.cancel();
    };

    signal.addEventListener('abort', onAbort, { once: true });

    try {
      if (signal.aborted) {
        throw createAbortError();
      }

      animation = element.animate(getKeyframes(direction), {
        duration: durationMs,
        easing: FALLBACK_EASING,
        fill: 'both',
      });

      await animation.finished;
    } catch (error) {
      if (aborted || signal.aborted || isAbortError(error)) {
        throw createAbortError();
      }

      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
}
