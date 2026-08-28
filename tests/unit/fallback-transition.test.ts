import { describe, expect, it, vi } from 'vitest';
import { createFallbackRunner } from '../../src/transition/fallback-transition';

type FakeAnimation = Pick<Animation, 'cancel' | 'finished'>;

function createAnimatedElement(animation: FakeAnimation): {
  element: HTMLElement;
  animate: ReturnType<typeof vi.fn>;
} {
  const element = document.createElement('div');
  const animate = vi.fn(() => animation as Animation);
  Object.defineProperty(element, 'animate', {
    value: animate,
    configurable: true,
  });

  return { element, animate };
}

describe('createFallbackRunner', () => {
  it('runs the open fallback animation with the exact keyframes and options', async () => {
    const finished = Promise.resolve({} as Animation);
    const animation = {
      cancel: vi.fn(),
      finished,
    } satisfies FakeAnimation;
    const { element, animate } = createAnimatedElement(animation);
    const runner = createFallbackRunner(element);

    await expect(runner('open', 200, new AbortController().signal)).resolves.toBeUndefined();

    expect(animate).toHaveBeenCalledWith(
      {
        opacity: ['0.35', '1'],
        transform: ['scale(0.985)', 'scale(1)'],
      },
      {
        duration: 200,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    );
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  });

  it('runs the close fallback animation with the exact keyframes and options', async () => {
    const finished = Promise.resolve({} as Animation);
    const animation = {
      cancel: vi.fn(),
      finished,
    } satisfies FakeAnimation;
    const { element, animate } = createAnimatedElement(animation);
    const runner = createFallbackRunner(element);

    await runner('close', 180, new AbortController().signal);

    expect(animate).toHaveBeenCalledWith(
      {
        opacity: ['1', '0'],
        transform: ['scale(1)', 'scale(0.985)'],
      },
      {
        duration: 180,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    );
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid durations before animating', async () => {
    const finished = Promise.resolve({} as Animation);
    const animation = {
      cancel: vi.fn(),
      finished,
    } satisfies FakeAnimation;
    const { element, animate } = createAnimatedElement(animation);
    const runner = createFallbackRunner(element);

    await expect(runner('open', 0, new AbortController().signal)).rejects.toThrow(/duration/i);
    await expect(runner('open', Number.NaN, new AbortController().signal)).rejects.toThrow(/duration/i);
    expect(animate).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted signal before starting the animation', async () => {
    const finished = Promise.resolve({} as Animation);
    const animation = {
      cancel: vi.fn(),
      finished,
    } satisfies FakeAnimation;
    const { element, animate } = createAnimatedElement(animation);
    const controller = new AbortController();
    controller.abort();
    const runner = createFallbackRunner(element);

    await expect(runner('open', 200, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(animate).not.toHaveBeenCalled();
  });

  it('cancels on abort, rejects with AbortError, and removes the abort listener', async () => {
    let rejectFinished: ((reason?: unknown) => void) | undefined;
    const animation = {
      cancel: vi.fn(() => {
        rejectFinished?.(new DOMException('The operation was aborted.', 'AbortError'));
      }),
      finished: new Promise<never>((_, reject) => {
        rejectFinished = reject;
      }),
    } satisfies FakeAnimation;
    const { element } = createAnimatedElement(animation);
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const runner = createFallbackRunner(element);

    const promise = runner('open', 200, controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the abort listener after a successful animation', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const finished = Promise.resolve({} as Animation);
    const animation = {
      cancel: vi.fn(),
      finished,
    } satisfies FakeAnimation;
    const { element } = createAnimatedElement(animation);
    const runner = createFallbackRunner(element);

    await runner('open', 200, controller.signal);

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('propagates non-abort animation failures unchanged and removes the listener', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const failure = new Error('animation failed');
    const animation = {
      cancel: vi.fn(),
      finished: Promise.reject(failure),
    } satisfies FakeAnimation;
    const { element } = createAnimatedElement(animation);
    const runner = createFallbackRunner(element);

    await expect(runner('close', 200, controller.signal)).rejects.toBe(failure);
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
