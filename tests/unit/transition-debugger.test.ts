import { describe, expect, it, vi } from 'vitest';
import { createTransitionDebugger } from '../../src/debug/transition-debugger';
import type { FrameClock } from '../../src/transition/timeline';

interface FakeClockControls {
  readonly clock: FrameClock;
  advanceTo(timestamp: number): void;
  hasQueuedFrame(): boolean;
}

function createFakeClock(): FakeClockControls {
  const frames = new Map<number, FrameRequestCallback>();
  let now = 0;
  let nextHandle = 1;

  return {
    clock: {
      now: () => now,
      requestFrame: (callback) => {
        const handle = nextHandle;
        nextHandle += 1;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
    },
    hasQueuedFrame: () => frames.size > 0,
    advanceTo(timestamp: number) {
      now = timestamp;
      const entry = frames.entries().next().value;

      if (entry === undefined) {
        throw new Error('No frame queued.');
      }

      const [handle, callback] = entry;
      frames.delete(handle);
      callback(timestamp);
    },
  };
}

describe('createTransitionDebugger', () => {
  it('advances progress with the clock while running', async () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const onFrame = vi.fn();
    const promise = controller.animate(0, 1, 1000, onFrame, new AbortController().signal);

    expect(onFrame).toHaveBeenLastCalledWith(0);

    fake.advanceTo(250);
    expect(onFrame).toHaveBeenLastCalledWith(0.25);

    fake.advanceTo(1000);
    expect(onFrame).toHaveBeenLastCalledWith(1);

    await expect(promise).resolves.toBeUndefined();
  });

  it('holds progress while paused and does not settle', async () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const onFrame = vi.fn();
    const settled = vi.fn();
    void controller.animate(0, 1, 1000, onFrame, new AbortController().signal).then(settled);

    fake.advanceTo(400);
    expect(onFrame).toHaveBeenLastCalledWith(0.4);

    controller.pause();
    fake.advanceTo(900);
    fake.advanceTo(5000);

    expect(onFrame).toHaveBeenLastCalledWith(0.4);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
  });

  it('resumes from the paused position rather than wall-clock time', async () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const onFrame = vi.fn();
    const promise = controller.animate(0, 1, 1000, onFrame, new AbortController().signal);

    fake.advanceTo(400);
    controller.pause();
    fake.advanceTo(9000);
    controller.resume();

    fake.advanceTo(9100);
    expect(onFrame).toHaveBeenLastCalledWith(0.5);

    fake.advanceTo(9600);
    await expect(promise).resolves.toBeUndefined();
  });

  it('scrubs to an explicit position and stays paused there', () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const onFrame = vi.fn();
    void controller.animate(0, 1, 1000, onFrame, new AbortController().signal);

    controller.scrubTo(0.75);

    expect(controller.isPaused()).toBe(true);
    expect(onFrame).toHaveBeenLastCalledWith(0.75);
  });

  it('clamps scrub input to the timeline bounds', () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const onFrame = vi.fn();
    void controller.animate(0, 1, 1000, onFrame, new AbortController().signal);

    controller.scrubTo(-3);
    expect(onFrame).toHaveBeenLastCalledWith(0);

    controller.scrubTo(3);
    expect(onFrame).toHaveBeenLastCalledWith(1);
  });

  it('maps scrub position through the from/to range when closing', () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const onFrame = vi.fn();
    void controller.animate(1, 0, 1000, onFrame, new AbortController().signal);

    controller.scrubTo(0.25);

    expect(onFrame).toHaveBeenLastCalledWith(0.75);
  });

  it('rejects when the signal aborts, even while paused', async () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const abort = new AbortController();
    const promise = controller.animate(0, 1, 1000, vi.fn(), abort.signal);

    fake.advanceTo(300);
    controller.pause();
    abort.abort();

    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('reports run state to subscribers', () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const listener = vi.fn();
    controller.subscribe(listener);

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false, paused: false }),
    );

    void controller.animate(0, 1, 1000, vi.fn(), new AbortController().signal);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));

    fake.advanceTo(500);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true, position: 0.5 }),
    );

    fake.advanceTo(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }));
  });

  it('stops subscribers after unsubscribe', () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    listener.mockClear();

    unsubscribe();
    void controller.animate(0, 1, 1000, vi.fn(), new AbortController().signal);

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a pause request applied to the next transition', async () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);
    controller.pause();

    const onFrame = vi.fn();
    void controller.animate(0, 1, 1000, onFrame, new AbortController().signal);

    expect(onFrame).toHaveBeenLastCalledWith(0);
    fake.advanceTo(500);
    expect(onFrame).toHaveBeenLastCalledWith(0);
  });

  it('rejects a non-positive duration', async () => {
    const fake = createFakeClock();
    const controller = createTransitionDebugger(fake.clock);

    await expect(
      controller.animate(0, 1, 0, vi.fn(), new AbortController().signal),
    ).rejects.toThrow(/durationMs/);
  });
});
