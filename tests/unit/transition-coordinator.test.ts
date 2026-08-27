import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultMotionProfile } from '../../src/transition/motion-profile';
import { TransitionCoordinator } from '../../src/transition/transition-coordinator';
import type {
  PaperRenderer,
  TransitionDependencies,
  TransitionOpenRequest,
  TransitionView,
} from '../../src/transition/types';

const FULL_CLIP = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';

interface ActiveSnapshot {
  request: TransitionOpenRequest;
  source: HTMLElement | null;
  renderer: PaperRenderer | null;
  controller: AbortController | null;
  progress: number;
  requestedEndpoint: 'idle' | 'open';
  interruption: 'escape' | 'resize' | null;
}

interface HarnessOptions {
  mode?: 'full' | 'fallback';
  sourceExists?: boolean;
  captureFailure?: Error;
  createRendererFailure?: Error;
  fallbackFailure?: Error;
  modeFailure?: Error;
}

function makeAbortError(message = 'The operation was aborted.'): DOMException {
  return new DOMException(message, 'AbortError');
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

function getActiveTransition(coordinator: TransitionCoordinator): ActiveSnapshot | null {
  return (coordinator as unknown as { active: ActiveSnapshot | null }).active;
}

function harness(options: HarnessOptions = {}) {
  const source = document.createElement('button');
  source.dataset.sourceId = 'one';
  document.body.append(source);

  const trigger = source;
  const rendered: number[] = [];
  const texture = document.createElement('canvas');
  const renderer: PaperRenderer = {
    render: vi.fn((progress: number) => {
      rendered.push(progress);
      return {
        positions: new Float32Array(),
        shade: new Float32Array(),
        revealClipPath: `polygon(${progress * 100}% 0%, 100% 100%, 0% 100%)`,
      };
    }),
    dispose: vi.fn(),
  };

  const view: TransitionView = {
    prepareDetail: vi.fn(),
    measureDestination: vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 700 })),
    resolveSource: vi.fn(() => (options.sourceExists === false ? null : source)),
    measureSource: vi.fn(() => ({ left: 100, top: 80, width: 240, height: 160 })),
    setDetailClip: vi.fn(),
    setSourceHidden: vi.fn(),
    setListVisible: vi.fn(),
    setDetailVisible: vi.fn(),
    setDetailInert: vi.fn(),
    setBusy: vi.fn(),
    freezeScroll: vi.fn(),
    restoreScroll: vi.fn(),
    focusDetailHeading: vi.fn(),
    focusListFallback: vi.fn(),
  };

  const dependencies: TransitionDependencies = {
    profile: defaultMotionProfile,
    selectMotionMode: options.modeFailure
      ? vi.fn(() => {
          throw options.modeFailure;
        })
      : vi.fn(() => options.mode ?? 'full'),
    capture: options.captureFailure
      ? vi.fn().mockRejectedValue(options.captureFailure)
      : vi.fn().mockResolvedValue(texture),
    createRenderer: options.createRendererFailure
      ? vi.fn(() => {
          throw options.createRendererFailure;
        })
      : vi.fn(() => renderer),
    runFallback: options.fallbackFailure
      ? vi.fn().mockRejectedValue(options.fallbackFailure)
      : vi.fn().mockResolvedValue(undefined),
    animate: vi.fn(async (from, to, _duration, onFrame, signal) => {
      onFrame(from);
      if (signal.aborted) {
        throw makeAbortError();
      }
      onFrame((from + to) / 2);
      if (signal.aborted) {
        throw makeAbortError();
      }
      onFrame(to);
    }),
  };

  const coordinator = new TransitionCoordinator(view, dependencies);
  const request: TransitionOpenRequest = {
    sourceId: 'one',
    grabbedCorner: 'top-right',
    trigger,
  };

  return { coordinator, dependencies, rendered, renderer, request, source, texture, trigger, view };
}

describe('TransitionCoordinator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens through preparing and opening before settling on active detail DOM', async () => {
    const { coordinator, renderer, request, source, view } = harness();
    const states: string[] = [];
    coordinator.addEventListener('statechange', () => states.push(coordinator.state));

    await coordinator.open(request);

    expect(states).toEqual(['preparing', 'opening', 'open']);
    expect(view.freezeScroll).toHaveBeenCalledTimes(1);
    expect(view.prepareDetail).toHaveBeenCalledWith('one');
    expect(view.setDetailVisible).toHaveBeenNthCalledWith(1, true);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(false);
    expect(view.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.setSourceHidden).toHaveBeenNthCalledWith(1, source, true);
    expect(view.setSourceHidden).toHaveBeenLastCalledWith(source, false);
    expect(view.setDetailClip).toHaveBeenLastCalledWith(FULL_CLIP);
    expect(view.setListVisible).toHaveBeenLastCalledWith(false);
    expect(view.focusDetailHeading).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        request,
        source,
        renderer: null,
        controller: null,
        progress: 1,
        requestedEndpoint: 'open',
        interruption: null,
      }),
    );
  });

  it('rejects an overlapping open while already opening and exposes the active request', async () => {
    const { coordinator, dependencies, request, source } = harness();
    let release!: () => void;
    dependencies.animate = vi.fn(
      async (_from, to, _duration, onFrame, signal) =>
        new Promise<void>((resolve, reject) => {
          onFrame(0);
          onFrame(0.4);
          release = () => {
            if (signal.aborted) {
              reject(makeAbortError());
              return;
            }
            onFrame(to);
            resolve();
          };
        }),
    );

    const firstOpen = coordinator.open(request);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(coordinator.state).toBe('opening');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        request,
        source,
        requestedEndpoint: 'open',
        interruption: null,
        progress: 0.4,
        controller: expect.any(AbortController),
      }),
    );
    await expect(coordinator.open(request)).rejects.toThrow('Cannot open while transition state is opening');

    release();
    await firstOpen;
  });

  it('rejects close requests from idle with the exact current state', async () => {
    const { coordinator } = harness();

    await expect(coordinator.close()).rejects.toThrow('Cannot close while transition state is idle');
  });

  it('closes by rendering the same timeline in reverse, restoring scroll, and focusing the source without scrolling', async () => {
    const { coordinator, rendered, request, source, view } = harness();
    const focus = vi.spyOn(source, 'focus');

    await coordinator.open(request);
    rendered.length = 0;

    await coordinator.close();

    expect(rendered).toEqual([1, 0.5, 0]);
    expect(coordinator.state).toBe('idle');
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(true);
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('remeasures the current source bounds before closing and uses them for the reverse renderer', async () => {
    const { coordinator, dependencies, request, view } = harness();

    await coordinator.open(request);
    vi.mocked(view.measureSource).mockReturnValue({ left: 40, top: 30, width: 320, height: 180 });

    await coordinator.close();

    expect(dependencies.createRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceRect: { left: 40, top: 30, width: 320, height: 180 },
      }),
    );
  });

  it('recovers to a stable idle endpoint when the source is missing before opening', async () => {
    const { coordinator, request, view } = harness({ sourceExists: false });
    const states: string[] = [];
    coordinator.addEventListener('statechange', () => states.push(coordinator.state));

    await expect(coordinator.open(request)).rejects.toThrow('Source card no longer exists: one');

    expect(states).toEqual(['preparing', 'idle']);
    expect(coordinator.state).toBe('idle');
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(true);
    expect(view.setListVisible).toHaveBeenLastCalledWith(true);
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('uses fallback after a capture failure, logs exactly once, and still reaches open', async () => {
    const captureFailure = new Error('capture failed');
    const { coordinator, dependencies, request } = harness({ captureFailure });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.open(request);

    expect(report).toHaveBeenCalledWith('Paper-turn full motion failed; using fallback.', captureFailure);
    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('uses fallback after renderer creation failure and still reaches open', async () => {
    const failure = new Error('renderer creation failed');
    const { coordinator, dependencies, request } = harness({ createRendererFailure: failure });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.open(request);

    expect(report).toHaveBeenCalledWith('Paper-turn full motion failed; using fallback.', failure);
    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('uses fallback after a renderer frame failure, disposes the overlay, and reaches open', async () => {
    const { coordinator, dependencies, renderer, request, source, view } = harness();
    const failure = new Error('shader failed');
    vi.mocked(renderer.render).mockImplementation((progress: number) => {
      if (progress === 0.5) {
        throw failure;
      }

      return {
        positions: new Float32Array(),
        shade: new Float32Array(),
        revealClipPath: `polygon(${progress * 100}% 0%, 100% 100%, 0% 100%)`,
      };
    });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.open(request);

    expect(report).toHaveBeenCalledWith('Paper-turn full motion failed; using fallback.', failure);
    expect(renderer.dispose).toHaveBeenCalled();
    expect(view.setSourceHidden).toHaveBeenCalledWith(source, false);
    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('focuses the list fallback when the source no longer exists before closing', async () => {
    const { coordinator, request, view } = harness();

    await coordinator.open(request);
    vi.mocked(view.resolveSource).mockReturnValue(null);

    await coordinator.close();

    expect(view.focusListFallback).toHaveBeenCalledTimes(1);
  });

  it('opens in fallback mode without attempting capture or renderer creation', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });

    await coordinator.open(request);

    expect(dependencies.capture).not.toHaveBeenCalled();
    expect(dependencies.createRenderer).not.toHaveBeenCalled();
    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('logs fallback failures exactly and still settles to the requested stable endpoint', async () => {
    const fallbackFailure = new Error('fallback failed');
    const { coordinator, request } = harness({ mode: 'fallback', fallbackFailure });
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.open(request);

    expect(report).toHaveBeenCalledWith(
      'Paper-turn fallback failed; settling to a stable endpoint.',
      fallbackFailure,
    );
    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)?.controller).toBeNull();
  });

  it('recovers to stable idle cleanup when motion-mode selection fails during open', async () => {
    const modeFailure = new Error('mode failed');
    const { coordinator, request, view } = harness({ modeFailure });

    await expect(coordinator.open(request)).rejects.toBe(modeFailure);

    expect(coordinator.state).toBe('idle');
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('Escape at low opening progress falls back closed and settles idle', async () => {
    const { coordinator, dependencies, request } = harness();
    dependencies.animate = vi.fn(
      async (_from, _to, _duration, onFrame, signal) =>
        new Promise<void>((_resolve, reject) => {
          onFrame(0.2);
          signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
        }),
    );

    const opening = coordinator.open(request);
    await flushMicrotasks();
    await flushMicrotasks();
    coordinator.cancel();
    await opening;

    expect(dependencies.runFallback).toHaveBeenCalledWith('close', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('idle');
  });

  it('Escape at threshold opening progress falls back open and settles open', async () => {
    const { coordinator, dependencies, request } = harness();
    dependencies.animate = vi.fn(
      async (_from, _to, _duration, onFrame, signal) =>
        new Promise<void>((_resolve, reject) => {
          onFrame(0.5);
          signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
        }),
    );

    const opening = coordinator.open(request);
    await flushMicrotasks();
    await flushMicrotasks();
    coordinator.cancel();
    await opening;

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('Escape during closing uses absolute paper progress to reopen when the sheet is still mostly open', async () => {
    const { coordinator, dependencies, request } = harness();
    await coordinator.open(request);

    dependencies.animate = vi.fn(
      async (_from, _to, _duration, onFrame, signal) =>
        new Promise<void>((_resolve, reject) => {
          onFrame(0.8);
          signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
        }),
    );

    const closing = coordinator.close();
    await flushMicrotasks();
    coordinator.cancel();
    await closing;

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('viewport resize preserves the requested endpoint and avoids geometry recompute during fallback', async () => {
    const { coordinator, dependencies, request, view } = harness();
    dependencies.animate = vi.fn(
      async (_from, _to, _duration, onFrame, signal) =>
        new Promise<void>((_resolve, reject) => {
          onFrame(0.2);
          signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
        }),
    );

    const opening = coordinator.open(request);
    await flushMicrotasks();
    await flushMicrotasks();
    coordinator.handleViewportChange();
    await opening;

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(view.measureSource).toHaveBeenCalledTimes(1);
    expect(view.measureDestination).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe('open');
  });

  it('propagates an unexpected AbortError only after restoring stable idle cleanup', async () => {
    const { coordinator, dependencies, renderer, request, source, view } = harness();
    dependencies.animate = vi.fn(async (_from, _to, _duration, onFrame) => {
      onFrame(0);
      onFrame(0.2);
      throw makeAbortError('unexpected abort');
    });

    await expect(coordinator.open(request)).rejects.toMatchObject({ name: 'AbortError' });

    expect(dependencies.runFallback).not.toHaveBeenCalled();
    expect(coordinator.state).toBe('idle');
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(view.setSourceHidden).toHaveBeenNthCalledWith(1, source, true);
    expect(view.setSourceHidden).toHaveBeenLastCalledWith(source, false);
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('propagates an unexpected close AbortError only after restoring stable open cleanup once', async () => {
    const { coordinator, dependencies, request, renderer, view } = harness();
    const states: string[] = [];
    coordinator.addEventListener('statechange', () => states.push(coordinator.state));

    await coordinator.open(request);
    states.length = 0;
    vi.mocked(view.focusDetailHeading).mockClear();
    dependencies.animate = vi.fn(async (_from, _to, _duration, onFrame) => {
      onFrame(1);
      onFrame(0.7);
      throw makeAbortError('unexpected close abort');
    });

    await expect(coordinator.close()).rejects.toMatchObject({ name: 'AbortError' });

    expect(states).toEqual(['closing', 'open']);
    expect(dependencies.runFallback).not.toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalledTimes(2);
    expect(view.focusDetailHeading).toHaveBeenCalledTimes(1);
    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        controller: null,
        renderer: null,
        requestedEndpoint: 'idle',
        interruption: null,
        progress: 1,
      }),
    );
  });
});
