import { describe, expect, it, vi } from 'vitest';
import { createFallbackRunner } from '../../src/transition/fallback-transition';

type FakeAnimation = Pick<Animation, 'cancel' | 'finished'>;

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
}

function createAnimatedElement(options: {
  finished?: Promise<Animation>;
  onCancel?: () => void;
} = {}): {
  element: HTMLElement;
  animate: ReturnType<typeof vi.fn>;
  animation: FakeAnimation;
} {
  const element = document.createElement('div');
  let attachedAnimation: Animation | null = null;
  const animation = {
    cancel: vi.fn(() => {
      attachedAnimation = null;
      options.onCancel?.();
    }),
    finished: options.finished ?? Promise.resolve({} as Animation),
  } satisfies FakeAnimation;
  const animationHandle = animation as unknown as Animation;
  const animate = vi.fn(() => {
    attachedAnimation = animationHandle;
    return animationHandle;
  });
  Object.defineProperty(element, 'animate', {
    value: animate,
    configurable: true,
  });
  Object.defineProperty(element, 'getAnimations', {
    value: vi.fn(() => (attachedAnimation ? [attachedAnimation] : [])),
    configurable: true,
  });

  return { element, animate, animation };
}

describe('createFallbackRunner', () => {
  it('runs the open fallback animation with the exact keyframes and options', async () => {
    const finished = createDeferred<Animation>();
    const { element, animate, animation } = createAnimatedElement({
      finished: finished.promise,
    });
    const runner = createFallbackRunner(element);

    const promise = runner('open', 200, new AbortController().signal);

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
    expect(element.getAnimations()).toEqual([animation as Animation]);
    finished.resolve({} as Animation);
    await expect(promise).resolves.toBeUndefined();
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(element.getAnimations()).toHaveLength(0);
  });

  it('runs the close fallback animation with the exact keyframes and options', async () => {
    const finished = createDeferred<Animation>();
    const { element, animate, animation } = createAnimatedElement({
      finished: finished.promise,
    });
    const runner = createFallbackRunner(element);

    const promise = runner('close', 180, new AbortController().signal);

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
    expect(element.getAnimations()).toEqual([animation as Animation]);
    finished.resolve({} as Animation);
    await expect(promise).resolves.toBeUndefined();
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(element.getAnimations()).toHaveLength(0);
  });

  it('rejects invalid durations before animating', async () => {
    const { element, animate } = createAnimatedElement();
    const runner = createFallbackRunner(element);

    await expect(runner('open', 0, new AbortController().signal)).rejects.toThrow(/duration/i);
    await expect(runner('open', Number.NaN, new AbortController().signal)).rejects.toThrow(/duration/i);
    expect(animate).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted signal before starting the animation', async () => {
    const { element, animate } = createAnimatedElement();
    const controller = new AbortController();
    controller.abort();
    const runner = createFallbackRunner(element);

    await expect(runner('open', 200, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(animate).not.toHaveBeenCalled();
  });

  it('cancels exactly once when abort wins after animate returns and detaches the animation', async () => {
    const finished = createDeferred<Animation>();
    const { element, animation } = createAnimatedElement({
      finished: finished.promise,
      onCancel: () => {
        finished.reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
    });
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const runner = createFallbackRunner(element);

    const promise = runner('open', 200, controller.signal);
    expect(element.getAnimations()).toEqual([animation as Animation]);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(element.getAnimations()).toHaveLength(0);
    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the abort listener after a successful animation', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const { element } = createAnimatedElement();
    const runner = createFallbackRunner(element);

    await runner('open', 200, controller.signal);

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('propagates non-abort animation failures unchanged and removes the listener', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const finished = createDeferred<Animation>();
    const failure = new Error('animation failed');
    const { element, animation } = createAnimatedElement({
      finished: finished.promise,
    });
    const runner = createFallbackRunner(element);

    const promise = runner('close', 200, controller.signal);
    expect(element.getAnimations()).toEqual([animation as Animation]);
    finished.reject(failure);

    await expect(promise).rejects.toBe(failure);
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(element.getAnimations()).toHaveLength(0);
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
