import { describe, expect, it, vi } from 'vitest';
import { animateProgress, type FrameClock } from '../../src/transition/timeline';

interface FakeClockControls {
  readonly clock: FrameClock;
  readonly requestFrame: ReturnType<typeof vi.fn>;
  readonly cancelFrame: ReturnType<typeof vi.fn>;
  readonly queuedHandles: () => number[];
  advanceTo(timestamp: number): void;
}

function createFakeClock(startedAt = 0): FakeClockControls {
  const frames = new Map<number, FrameRequestCallback>();
  let now = startedAt;
  let nextHandle = 1;

  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    frames.set(handle, callback);
    return handle;
  });
  const cancelFrame = vi.fn((handle: number) => {
    frames.delete(handle);
  });

  return {
    clock: {
      now: () => now,
      requestFrame,
      cancelFrame,
    },
    requestFrame,
    cancelFrame,
    queuedHandles: () => [...frames.keys()],
    advanceTo(timestamp: number) {
      const handle = frames.keys().next().value;

      if (handle === undefined) {
        throw new Error('No frame queued.');
      }

      const callback = frames.get(handle);

      if (!callback) {
        throw new Error(`Missing queued frame callback for handle ${String(handle)}.`);
      }

      frames.delete(handle);
      now = timestamp;
      callback(timestamp);
    },
  };
}

describe('animateProgress', () => {
  it('emits exact first and last endpoints in forward and reverse directions', async () => {
    const forwardClock = createFakeClock();
    const forwardValues: number[] = [];
    const forward = animateProgress(
      0,
      1,
      100,
      (value) => forwardValues.push(value),
      new AbortController().signal,
      forwardClock.clock,
    );

    forwardClock.advanceTo(50);
    forwardClock.advanceTo(100);
    await forward;

    expect(forwardValues[0]).toBe(0);
    expect(forwardValues.at(-1)).toBe(1);

    const reverseClock = createFakeClock();
    const reverseValues: number[] = [];
    const reverse = animateProgress(
      1,
      0,
      100,
      (value) => reverseValues.push(value),
      new AbortController().signal,
      reverseClock.clock,
    );

    reverseClock.advanceTo(50);
    reverseClock.advanceTo(100);
    await reverse;

    expect(reverseValues[0]).toBe(1);
    expect(reverseValues.at(-1)).toBe(0);
  });

  it('rejects with AbortError and cancels the queued frame', async () => {
    const controller = new AbortController();
    const cancelFrame = vi.fn();
    const promise = animateProgress(0, 1, 100, vi.fn(), controller.signal, {
      now: () => 0,
      requestFrame: () => 42,
      cancelFrame,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelFrame).toHaveBeenCalledWith(42);
  });

  it('rejects when onFrame throws and does not orphan or schedule a frame', async () => {
    const requestFrame = vi.fn<FrameClock['requestFrame']>(() => 1);
    const failure = new Error('render failed');
    const promise = animateProgress(
      0,
      1,
      100,
      () => {
        throw failure;
      },
      new AbortController().signal,
      {
        now: () => 0,
        requestFrame,
        cancelFrame: vi.fn(),
      },
    );

    await expect(promise).rejects.toBe(failure);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted signal before emitting or scheduling', async () => {
    const controller = new AbortController();
    controller.abort();
    const onFrame = vi.fn();
    const requestFrame = vi.fn();
    const cancelFrame = vi.fn();

    await expect(
      animateProgress(0, 1, 100, onFrame, controller.signal, {
        now: () => 0,
        requestFrame,
        cancelFrame,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(onFrame).not.toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it.each([
    ['from', Number.NaN, 1, 100],
    ['to', 0, Number.POSITIVE_INFINITY, 100],
    ['durationMs', 0, 1, 0],
    ['durationMs', 0, 1, Number.POSITIVE_INFINITY],
  ] as const)(
    'rejects invalid %s inputs before emitting or scheduling',
    async (field, from, to, durationMs) => {
      const onFrame = vi.fn();
      const requestFrame = vi.fn();
      const cancelFrame = vi.fn();

      await expect(
        animateProgress(from, to, durationMs, onFrame, new AbortController().signal, {
          now: () => 0,
          requestFrame,
          cancelFrame,
        }),
      ).rejects.toThrow(field);

      expect(onFrame).not.toHaveBeenCalled();
      expect(requestFrame).not.toHaveBeenCalled();
      expect(cancelFrame).not.toHaveBeenCalled();
    },
  );
});
