import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultMotionProfile } from '../../src/transition/motion-profile';
import { TransitionCoordinator } from '../../src/transition/transition-coordinator';
import type {
  Corner,
  PaperRenderer,
  TransitionDependencies,
  TransitionOpenRequest,
  TransitionView,
} from '../../src/transition/types';

const FULL_CLIP = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
const CLOSED_CLIP_BY_CORNER: Record<Corner, string> = {
  'top-left': 'polygon(0% 0%, 0% 0%, 0% 0%)',
  'top-right': 'polygon(100% 0%, 100% 0%, 100% 0%)',
  'bottom-right': 'polygon(100% 100%, 100% 100%, 100% 100%)',
  'bottom-left': 'polygon(0% 100%, 0% 100%, 0% 100%)',
};

interface ActiveSnapshot {
  request: TransitionOpenRequest;
  source: HTMLElement | null;
  renderer: PaperRenderer | null;
  controller: AbortController | null;
  progress: number;
  requestedEndpoint: 'idle' | 'open';
  interruption: 'escape' | 'resize' | null;
}

interface ActiveFallbackTimingSnapshot {
  direction: 'open' | 'close';
  startedAt: number;
  durationMs: number;
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

function createAbortableFallbackRunner() {
  let started!: () => void;
  const waitUntilStarted = new Promise<void>((resolve) => {
    started = resolve;
  });

  const runFallback = vi.fn(
    async (_direction: 'open' | 'close', _durationMs: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        started();
        if (signal.aborted) {
          reject(makeAbortError());
          return;
        }

        signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
      }),
  );

  return { runFallback, waitUntilStarted };
}

function getActiveTransition(coordinator: TransitionCoordinator): ActiveSnapshot | null {
  return (coordinator as unknown as { active: ActiveSnapshot | null }).active;
}

function getActiveFallbackTiming(coordinator: TransitionCoordinator): ActiveFallbackTimingSnapshot | null {
  return (coordinator as unknown as { activeFallbackTiming: ActiveFallbackTimingSnapshot | null })
    .activeFallbackTiming;
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
        lift: 0,
        alpha: 1,
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

  it.each(Object.entries(CLOSED_CLIP_BY_CORNER) as [Corner, string][])(
    'seeds the %s closed clip before revealing detail',
    async (grabbedCorner, closedClip) => {
      const { coordinator, request, view } = harness();
      request.grabbedCorner = grabbedCorner;

      await coordinator.open(request);

      expect(view.setDetailClip).toHaveBeenNthCalledWith(1, closedClip);
      expect(vi.mocked(view.setDetailClip).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(view.setDetailVisible).mock.invocationCallOrder[0]!,
      );
      expect(view.setDetailVisible).toHaveBeenNthCalledWith(1, true);
    },
  );

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

  it('focuses the original trigger when it differs from the current source before settling idle', async () => {
    const { coordinator, request, source, view } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const sourceFocus = vi.spyOn(source, 'focus');

    await coordinator.open(request);
    await coordinator.close();

    expect(triggerFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(sourceFocus).not.toHaveBeenCalled();
    expect(view.focusListFallback).not.toHaveBeenCalled();
  });

  it('falls back to the current source when the original trigger is disconnected before settling idle', async () => {
    const { coordinator, request, source, view } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const sourceFocus = vi.spyOn(source, 'focus');

    await coordinator.open(request);
    trigger.remove();
    await coordinator.close();

    expect(triggerFocus).not.toHaveBeenCalled();
    expect(sourceFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(view.focusListFallback).not.toHaveBeenCalled();
  });

  it('focuses the list fallback when neither the trigger nor source is available before settling idle', async () => {
    const { coordinator, request, view } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;
    const triggerFocus = vi.spyOn(trigger, 'focus');

    await coordinator.open(request);
    trigger.remove();
    vi.mocked(view.resolveSource).mockReturnValue(null);
    await coordinator.close();

    expect(triggerFocus).not.toHaveBeenCalled();
    expect(view.focusListFallback).toHaveBeenCalledTimes(1);
  });

  it('clears the active transition before focus restoration can re-enter open', async () => {
    const { coordinator, request } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;

    let reopened: Promise<void> | null = null;
    let activeDuringFocus: ActiveSnapshot | null | undefined;
    trigger.addEventListener(
      'focus',
      () => {
        activeDuringFocus = getActiveTransition(coordinator);
        reopened ??= coordinator.open(request);
      },
      { once: true },
    );

    await coordinator.open(request);
    await coordinator.close();
    await expect(reopened).resolves.toBeUndefined();
    expect(activeDuringFocus).toBeNull();
    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        request,
        requestedEndpoint: 'open',
      }),
    );
  });

  it('clears the active transition before publishing the idle state change', async () => {
    const { coordinator, request } = harness();

    let reopened: Promise<void> | null = null;
    let activeWhenIdlePublished: ActiveSnapshot | null | undefined;
    coordinator.addEventListener('statechange', () => {
      if (coordinator.state === 'idle') {
        activeWhenIdlePublished = getActiveTransition(coordinator);
        reopened ??= coordinator.open(request);
      }
    });

    await coordinator.open(request);
    await coordinator.close();
    await expect(reopened).resolves.toBeUndefined();
    expect(activeWhenIdlePublished).toBeNull();
    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        request,
        requestedEndpoint: 'open',
      }),
    );
  });

  it('re-resolves the current source at idle settle when the trigger is disconnected during close', async () => {
    const { coordinator, dependencies, request, source, view } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;
    vi.mocked(view.resolveSource).mockImplementation((sourceId: string) => {
      return (
        Array.from(document.body.querySelectorAll<HTMLElement>('[data-source-id]')).find(
          (element) => element.dataset.sourceId === sourceId,
        ) ?? null
      );
    });

    const triggerFocus = vi.spyOn(trigger, 'focus');
    const sourceFocus = vi.spyOn(source, 'focus');
    const replacement = document.createElement('button');
    replacement.dataset.sourceId = 'one';
    const replacementFocus = vi.spyOn(replacement, 'focus');

    await coordinator.open(request);

    let release!: () => void;
    dependencies.animate = vi.fn(
      async (_from, to, _duration, onFrame, signal) =>
        new Promise<void>((resolve, reject) => {
          onFrame(1);
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

    const closing = coordinator.close();
    await flushMicrotasks();
    trigger.remove();
    source.remove();
    document.body.append(replacement);
    release();
    await closing;

    expect(triggerFocus).not.toHaveBeenCalled();
    expect(sourceFocus).not.toHaveBeenCalled();
    expect(replacementFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(view.focusListFallback).not.toHaveBeenCalled();
  });

  it('prefers the current re-resolved source over a stale connected source snapshot', async () => {
    const { coordinator, dependencies, request, source, view } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;
    vi.mocked(view.resolveSource).mockImplementation((sourceId: string) => {
      return (
        Array.from(document.body.querySelectorAll<HTMLElement>('[data-source-id]')).find(
          (element) => element.dataset.sourceId === sourceId,
        ) ?? null
      );
    });

    const triggerFocus = vi.spyOn(trigger, 'focus');
    const sourceFocus = vi.spyOn(source, 'focus');
    const replacement = document.createElement('button');
    replacement.dataset.sourceId = 'one';
    const replacementFocus = vi.spyOn(replacement, 'focus');

    await coordinator.open(request);

    let release!: () => void;
    dependencies.animate = vi.fn(
      async (_from, to, _duration, onFrame, signal) =>
        new Promise<void>((resolve, reject) => {
          onFrame(1);
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

    const closing = coordinator.close();
    await flushMicrotasks();
    trigger.remove();
    document.body.prepend(replacement);
    release();
    await closing;

    expect(triggerFocus).not.toHaveBeenCalled();
    expect(sourceFocus).not.toHaveBeenCalled();
    expect(replacementFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(view.focusListFallback).not.toHaveBeenCalled();
  });

  it('re-resolves the current source after idle listeners update the list', async () => {
    const { coordinator, request, source, view } = harness();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    request.trigger = trigger;
    vi.mocked(view.resolveSource).mockImplementation((sourceId: string) => {
      return (
        Array.from(document.body.querySelectorAll<HTMLElement>('[data-source-id]')).find(
          (element) => element.dataset.sourceId === sourceId,
        ) ?? null
      );
    });

    const triggerFocus = vi.spyOn(trigger, 'focus');
    const sourceFocus = vi.spyOn(source, 'focus');
    const replacement = document.createElement('button');
    replacement.dataset.sourceId = 'one';
    const replacementFocus = vi.spyOn(replacement, 'focus');

    coordinator.addEventListener('statechange', () => {
      if (coordinator.state === 'idle') {
        trigger.remove();
        source.replaceWith(replacement);
      }
    });

    await coordinator.open(request);
    await coordinator.close();

    expect(triggerFocus).not.toHaveBeenCalled();
    expect(sourceFocus).not.toHaveBeenCalled();
    expect(replacementFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(view.focusListFallback).not.toHaveBeenCalled();
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
        lift: 0,
        alpha: 1,
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

  it('focuses the original trigger when the source no longer exists before closing', async () => {
    const { coordinator, request, trigger, view } = harness();
    const focus = vi.spyOn(trigger, 'focus');

    await coordinator.open(request);
    vi.mocked(view.resolveSource).mockReturnValue(null);

    await coordinator.close();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(view.focusListFallback).not.toHaveBeenCalled();
  });

  it('opens in fallback mode without attempting capture or renderer creation', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });

    await coordinator.open(request);

    expect(dependencies.capture).not.toHaveBeenCalled();
    expect(dependencies.createRenderer).not.toHaveBeenCalled();
    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('open');
  });

  it('resets the hidden clip after a fallback close and reseeds it before reopening', async () => {
    const { coordinator, request, view } = harness({ mode: 'fallback' });
    const closedClip = CLOSED_CLIP_BY_CORNER[request.grabbedCorner];

    await coordinator.open(request);
    vi.mocked(view.setDetailClip).mockClear();
    vi.mocked(view.setDetailVisible).mockClear();

    await coordinator.close();

    expect(view.setDetailClip).toHaveBeenLastCalledWith(closedClip);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);

    vi.mocked(view.setDetailClip).mockClear();
    vi.mocked(view.setDetailVisible).mockClear();

    await coordinator.open(request);

    expect(view.setDetailClip).toHaveBeenNthCalledWith(1, closedClip);
    expect(view.setDetailClip).toHaveBeenNthCalledWith(2, FULL_CLIP);
    expect(vi.mocked(view.setDetailClip).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(view.setDetailVisible).mock.invocationCallOrder[0]!,
    );
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

  it('recovers to stable idle cleanup when busy setup throws during open', async () => {
    const busyFailure = new Error('busy failed');
    const { coordinator, request, view } = harness();
    vi.mocked(view.setBusy).mockImplementationOnce(() => {
      throw busyFailure;
    });

    await expect(coordinator.open(request)).rejects.toBe(busyFailure);

    expect(coordinator.state).toBe('idle');
    expect(view.freezeScroll).not.toHaveBeenCalled();
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(true);
    expect(view.setListVisible).toHaveBeenLastCalledWith(true);
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('recovers to stable idle cleanup when detail preparation throws during open and allows retry', async () => {
    const prepareFailure = new Error('prepare failed');
    const { coordinator, request, view } = harness();
    vi.mocked(view.prepareDetail).mockImplementationOnce(() => {
      throw prepareFailure;
    });

    await expect(coordinator.open(request)).rejects.toBe(prepareFailure);

    expect(coordinator.state).toBe('idle');
    expect(view.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(true);
    expect(view.setListVisible).toHaveBeenLastCalledWith(true);
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toBeNull();

    await expect(coordinator.open(request)).resolves.toBeUndefined();
    expect(coordinator.state).toBe('open');
  });

  it('preserves the original open setup error when idle recovery cleanup also throws', async () => {
    const prepareFailure = new Error('prepare failed');
    const cleanupFailure = new Error('list cleanup failed');
    const { coordinator, request, view } = harness();
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(view.prepareDetail).mockImplementationOnce(() => {
      throw prepareFailure;
    });
    vi.mocked(view.setListVisible).mockImplementationOnce(() => {
      throw cleanupFailure;
    });

    await expect(coordinator.open(request)).rejects.toBe(prepareFailure);

    expect(report).toHaveBeenCalledWith(
      'Paper-turn open setup cleanup failed while preserving the original error.',
      cleanupFailure,
      prepareFailure,
    );
    expect(coordinator.state).toBe('idle');
    expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('recovers to stable open cleanup when busy setup throws during close and allows retry', async () => {
    const busyFailure = new Error('close busy failed');
    const { coordinator, request, view } = harness();

    await coordinator.open(request);
    vi.mocked(view.focusDetailHeading).mockClear();
    vi.mocked(view.setBusy).mockImplementationOnce(() => {
      throw busyFailure;
    });

    await expect(coordinator.close()).rejects.toBe(busyFailure);

    expect(coordinator.state).toBe('open');
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.setDetailClip).toHaveBeenLastCalledWith(FULL_CLIP);
    expect(view.setListVisible).toHaveBeenLastCalledWith(false);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(true);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(false);
    expect(view.focusDetailHeading).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        controller: null,
        renderer: null,
        requestedEndpoint: 'idle',
        interruption: null,
        progress: 1,
      }),
    );

    vi.mocked(view.setBusy).mockImplementation(() => undefined);
    await expect(coordinator.close()).resolves.toBeUndefined();
    expect(coordinator.state).toBe('idle');
  });

  it('recovers to stable open cleanup when list visibility throws during close and allows retry', async () => {
    const visibilityFailure = new Error('list visibility failed');
    const { coordinator, request, view } = harness();

    await coordinator.open(request);
    vi.mocked(view.focusDetailHeading).mockClear();
    vi.mocked(view.setListVisible).mockImplementationOnce(() => {
      throw visibilityFailure;
    });

    await expect(coordinator.close()).rejects.toBe(visibilityFailure);

    expect(coordinator.state).toBe('open');
    expect(view.setBusy).toHaveBeenLastCalledWith(false);
    expect(view.setDetailClip).toHaveBeenLastCalledWith(FULL_CLIP);
    expect(view.setListVisible).toHaveBeenLastCalledWith(false);
    expect(view.setDetailVisible).toHaveBeenLastCalledWith(true);
    expect(view.setDetailInert).toHaveBeenLastCalledWith(false);
    expect(view.focusDetailHeading).toHaveBeenCalledTimes(1);
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        controller: null,
        renderer: null,
        requestedEndpoint: 'idle',
        interruption: null,
      }),
    );

    vi.mocked(view.setListVisible).mockImplementation(() => undefined);
    await expect(coordinator.close()).resolves.toBeUndefined();
    expect(coordinator.state).toBe('idle');
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

  it('resets the hidden clip after an interrupted low-progress close-to-idle and reseeds it before reopening', async () => {
    const { coordinator, dependencies, request, view } = harness();
    const closedClip = CLOSED_CLIP_BY_CORNER[request.grabbedCorner];
    const animateNormally = dependencies.animate;

    await coordinator.open(request);
    expect(coordinator.state).toBe('open');

    let closingStarted!: () => void;
    const closingInFlight = new Promise<void>((resolve) => {
      closingStarted = resolve;
    });
    dependencies.animate = vi.fn(
      async (_from, _to, _duration, onFrame, signal) =>
        new Promise<void>((_resolve, reject) => {
          onFrame(0.4);
          queueMicrotask(closingStarted);
          signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
        }),
    );

    const closing = coordinator.close();
    await closingInFlight;
    coordinator.cancel();
    await closing;

    expect(dependencies.runFallback).toHaveBeenCalledWith('close', 200, expect.any(AbortSignal));
    expect(coordinator.state).toBe('idle');
    expect(view.setDetailClip).toHaveBeenLastCalledWith(closedClip);

    dependencies.animate = animateNormally;
    vi.mocked(view.setDetailClip).mockClear();
    vi.mocked(view.setDetailVisible).mockClear();

    await coordinator.open(request);

    expect(view.setDetailClip).toHaveBeenNthCalledWith(1, closedClip);
    expect(vi.mocked(view.setDetailClip).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(view.setDetailVisible).mock.invocationCallOrder[0]!,
    );
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

  it('Escape before the fallback opening midpoint settles idle', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });
    const fallback = createAbortableFallbackRunner();
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    dependencies.profile = { ...dependencies.profile, fallbackDurationMs: 1000 };
    dependencies.runFallback = fallback.runFallback;

    const opening = coordinator.open(request);
    await fallback.waitUntilStarted;
    now = 499;
    coordinator.cancel();
    await opening;

    expect(coordinator.state).toBe('idle');
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it('Escape after the fallback opening midpoint settles open', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });
    const fallback = createAbortableFallbackRunner();
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    dependencies.profile = { ...dependencies.profile, fallbackDurationMs: 1000 };
    dependencies.runFallback = fallback.runFallback;

    const opening = coordinator.open(request);
    await fallback.waitUntilStarted;
    now = 601;
    coordinator.cancel();
    await opening;

    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        progress: 1,
        requestedEndpoint: 'open',
      }),
    );
  });

  it('Escape before the fallback closing midpoint reopens the detail surface', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });
    await coordinator.open(request);

    const fallback = createAbortableFallbackRunner();
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    dependencies.profile = { ...dependencies.profile, fallbackDurationMs: 1000 };
    dependencies.runFallback = fallback.runFallback;

    const closing = coordinator.close();
    await fallback.waitUntilStarted;
    now = 499;
    coordinator.cancel();
    await closing;

    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({
        progress: 1,
        requestedEndpoint: 'open',
      }),
    );
  });

  it('Escape after the fallback closing midpoint settles idle', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });
    await coordinator.open(request);

    const fallback = createAbortableFallbackRunner();
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    dependencies.profile = { ...dependencies.profile, fallbackDurationMs: 1000 };
    dependencies.runFallback = fallback.runFallback;

    const closing = coordinator.close();
    await fallback.waitUntilStarted;
    now = 601;
    coordinator.cancel();
    await closing;

    expect(coordinator.state).toBe('idle');
    expect(getActiveTransition(coordinator)).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -200],
  ])(
    'fallback open with %s duration settles open immediately without invoking the runner',
    async (_label, fallbackDurationMs) => {
      const { coordinator, dependencies, request, source, view } = harness({ mode: 'fallback' });
      dependencies.profile = { ...dependencies.profile, fallbackDurationMs };

      await coordinator.open(request);

      expect(dependencies.runFallback).not.toHaveBeenCalled();
      expect(coordinator.state).toBe('open');
      expect(getActiveFallbackTiming(coordinator)).toBeNull();
      expect(getActiveTransition(coordinator)).toEqual(
        expect.objectContaining({
          source,
          controller: null,
          renderer: null,
          progress: 1,
          requestedEndpoint: 'open',
          interruption: null,
        }),
      );
      expect(view.setBusy).toHaveBeenLastCalledWith(false);
      expect(view.setDetailClip).toHaveBeenLastCalledWith(FULL_CLIP);
      expect(view.setListVisible).toHaveBeenLastCalledWith(false);
      expect(view.setDetailVisible).toHaveBeenLastCalledWith(true);
      expect(view.setDetailInert).toHaveBeenLastCalledWith(false);
    },
  );

  it.each([
    ['zero', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -200],
  ])(
    'fallback close with %s duration settles idle immediately without invoking the runner',
    async (_label, fallbackDurationMs) => {
      const { coordinator, dependencies, request, source, view } = harness({ mode: 'fallback' });
      dependencies.profile = { ...dependencies.profile, fallbackDurationMs };

      await coordinator.open(request);
      vi.mocked(view.setSourceHidden).mockClear();
      vi.mocked(view.setBusy).mockClear();
      vi.mocked(view.setDetailClip).mockClear();
      vi.mocked(view.setListVisible).mockClear();
      vi.mocked(view.setDetailVisible).mockClear();
      vi.mocked(view.setDetailInert).mockClear();
      vi.mocked(view.restoreScroll).mockClear();

      await coordinator.close();

      expect(dependencies.runFallback).not.toHaveBeenCalled();
      expect(coordinator.state).toBe('idle');
      expect(getActiveFallbackTiming(coordinator)).toBeNull();
      expect(getActiveTransition(coordinator)).toBeNull();
      expect(view.setSourceHidden).toHaveBeenNthCalledWith(1, source, false);
      expect(view.setBusy).toHaveBeenLastCalledWith(false);
      expect(view.setDetailClip).toHaveBeenLastCalledWith(CLOSED_CLIP_BY_CORNER[request.grabbedCorner]);
      expect(view.setDetailVisible).toHaveBeenLastCalledWith(false);
      expect(view.setListVisible).toHaveBeenLastCalledWith(true);
      expect(view.setDetailInert).toHaveBeenLastCalledWith(true);
      expect(view.restoreScroll).toHaveBeenCalledTimes(1);
    },
  );

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

  it('viewport resize during fallback opening preserves the requested open endpoint', async () => {
    const { coordinator, dependencies, request } = harness({ mode: 'fallback' });
    const fallback = createAbortableFallbackRunner();
    dependencies.profile = { ...dependencies.profile, fallbackDurationMs: 1000 };
    dependencies.runFallback = fallback.runFallback;

    const opening = coordinator.open(request);
    await fallback.waitUntilStarted;
    coordinator.handleViewportChange();
    await opening;

    expect(dependencies.runFallback).toHaveBeenCalledWith('open', 1000, expect.any(AbortSignal));
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
