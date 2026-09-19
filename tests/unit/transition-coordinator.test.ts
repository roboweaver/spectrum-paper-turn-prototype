import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  anchorPoint,
  anchorUv,
  buildPaperFrame,
  revealClipPath,
  validateProfile,
} from '../../src/transition/geometry';
import {
  anchorForGridPosition,
  gridPositionFromRects,
  resolveGrabAnchor,
} from '../../src/transition/grab-anchor';
import { defaultMotionProfile } from '../../src/transition/motion-profile';
import { TransitionCoordinator, closedClipForAnchor } from '../../src/transition/transition-coordinator';
import type {
  Corner,
  GrabAnchor,
  MotionProfile,
  PaperRenderer,
  Point,
  Rect,
  RendererInput,
  TransitionDependencies,
  TransitionOpenRequest,
  TransitionView,
} from '../../src/transition/types';

// Every real resolution implementation is kept — only the call record is added.
// One of the coordinator's obligations is a claim about calls rather than about
// output: it consumes the anchor supplied on the open request and resolves none
// itself, on any path (Requirement 7.6).
vi.mock('../../src/transition/grab-anchor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/transition/grab-anchor')>();

  return {
    ...actual,
    resolveGrabAnchor: vi.fn(actual.resolveGrabAnchor),
    gridPositionFromRects: vi.fn(actual.gridPositionFromRects),
    anchorForGridPosition: vi.fn(actual.anchorForGridPosition),
  };
});

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
  const detail = document.createElement('main');
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
    resolveDestination: vi.fn(() => detail),
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
    grabAnchor: 'top-right',
    trigger,
  };

  return { coordinator, dependencies, rendered, renderer, request, source, texture, trigger, view };
}

describe('TransitionCoordinator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prints the destination on the sheet reverse by capturing through its closed clip', async () => {
    const { coordinator, dependencies, view, request } = harness();
    const backTexture = document.createElement('canvas');
    const sourceTexture = document.createElement('canvas');
    dependencies.capture = vi.fn(async (element: HTMLElement) =>
      element === view.resolveDestination() ? backTexture : sourceTexture,
    );

    await coordinator.open(request);

    expect(dependencies.capture).toHaveBeenCalledWith(
      view.resolveDestination(),
      dependencies.profile,
      { clipPath: 'none' },
    );
    expect(dependencies.createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ texture: sourceTexture, backTexture }),
    );
  });

  it('degrades the reverse to blank paper when the destination capture fails', async () => {
    const { coordinator, dependencies, view, request } = harness();
    dependencies.capture = vi.fn(async (element: HTMLElement) => {
      if (element === view.resolveDestination()) {
        throw new Error('destination capture failed');
      }

      return document.createElement('canvas');
    });

    await coordinator.open(request);

    expect(coordinator.state).toBe('open');
    expect(dependencies.createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ backTexture: null }),
    );
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
    async (grabAnchor, closedClip) => {
      const { coordinator, request, view } = harness();
      request.grabAnchor = grabAnchor;

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
    const closedClip = CLOSED_CLIP_BY_CORNER[request.grabAnchor as Corner];

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
    const closedClip = CLOSED_CLIP_BY_CORNER[request.grabAnchor as Corner];
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
      expect(view.setDetailClip).toHaveBeenLastCalledWith(CLOSED_CLIP_BY_CORNER[request.grabAnchor as Corner]);
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

/**
 * **Property 11: Closed clip agrees with the first frame.**
 *
 * The coordinator seeds the detail page's clip before the sheet has swept over
 * any of it, and the sheet's own first frame has to land on the same three
 * points — otherwise the page visibly jumps between the `preparing` clip and
 * the opening frame.
 *
 * The comparison is made on RESOLVED POINT COORDINATES rather than on the raw
 * strings. For a rect at the origin the two strings happen to be
 * character-identical for all eight anchors, and that is pinned below because it
 * is worth knowing when it stops being true. For an offset rect with an awkward
 * width, geometry's pixel round-trip — anchor uv into pixels, back out to a
 * percentage of the same rect — emits `49.99999999999999%` where the coordinator
 * emits `50%`. That is a discrepancy of roughly `1e-14` CSS pixels, so the
 * contract is stated in pixels with a `1e-6` tolerance and the assertions follow
 * suit.
 *
 * **Validates: Requirements 13.11, 13.12, 13.13**
 */
describe('closed clip agrees with the first frame', () => {
  const ALL_ANCHORS: readonly GrabAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
  ];
  const WINDING_CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const CLIP_TOLERANCE_PX = 1e-6;
  const ORIGIN_RECT: Rect = { left: 0, top: 0, width: 1000, height: 700 };
  // Awkward on purpose: a fractional left and a fractional width are what make
  // the uv → pixel → percentage round-trip inexact.
  const AWKWARD_RECT: Rect = { left: 27.7, top: -13.25, width: 100.7, height: 311.3 };
  const AGREEMENT_RECTS: readonly { label: string; rect: Rect }[] = [
    { label: 'a rect at the origin', rect: ORIGIN_RECT },
    { label: 'an awkward offset rect', rect: AWKWARD_RECT },
  ];
  const FRAME_SOURCE: Rect = { left: 100, top: 80, width: 240, height: 160 };
  const FRAME_DESTINATION: Rect = { left: 27.7, top: -13.25, width: 1000.7, height: 711.3 };
  const PROGRESS_BELOW_ONE: readonly number[] = [0, 0.05, 0.2, 0.25, 0.5, 0.75, 0.9, 0.999];

  function parsePolygonPercentages(clip: string, label: string): Point[] {
    const match = /^polygon\(([^)]*)\)$/.exec(clip);
    if (!match) {
      throw new Error(`${label}: expected a polygon() clip, received ${JSON.stringify(clip)}`);
    }

    const body = match[1]!.trim();
    if (body === '') {
      return [];
    }

    return body.split(',').map((pair) => {
      const parts = pair.trim().split(/\s+/);
      if (parts.length !== 2) {
        throw new Error(`${label}: expected two components per point, received ${JSON.stringify(pair)}`);
      }

      const [x, y] = parts.map((component) => {
        if (!component.endsWith('%')) {
          throw new Error(`${label}: expected a percentage, received ${JSON.stringify(component)}`);
        }

        const value = Number.parseFloat(component.slice(0, -1));
        if (!Number.isFinite(value)) {
          throw new Error(`${label}: expected a finite percentage, received ${JSON.stringify(component)}`);
        }

        return value;
      }) as [number, number];

      return { x, y };
    });
  }

  /** Percentages of `rect` back into the CSS pixels the browser would resolve. */
  function resolveAgainst(rect: Rect, points: readonly Point[]): Point[] {
    return points.map((point) => ({
      x: rect.left + (point.x / 100) * rect.width,
      y: rect.top + (point.y / 100) * rect.height,
    }));
  }

  function expectCoincident(actual: Point, expected: Point, label: string): void {
    expect(Math.abs(actual.x - expected.x), `${label}: x ${actual.x} vs ${expected.x}`).toBeLessThanOrEqual(
      CLIP_TOLERANCE_PX,
    );
    expect(Math.abs(actual.y - expected.y), `${label}: y ${actual.y} vs ${expected.y}`).toBeLessThanOrEqual(
      CLIP_TOLERANCE_PX,
    );
  }

  /**
   * The sheet's footprint at `progress`, written out independently of
   * `geometry.ts` so the frame's own reveal clip is checked against the
   * documented `lerpRect(source, destination, eased)` rather than against
   * whatever the module happens to compute.
   */
  function baseRectAt(progress: number): Rect {
    const eased = defaultMotionProfile.easing(progress);
    const lerp = (from: number, to: number): number => from + (to - from) * eased;

    return {
      left: lerp(FRAME_SOURCE.left, FRAME_DESTINATION.left),
      top: lerp(FRAME_SOURCE.top, FRAME_DESTINATION.top),
      width: lerp(FRAME_SOURCE.width, FRAME_DESTINATION.width),
      height: lerp(FRAME_SOURCE.height, FRAME_DESTINATION.height),
    };
  }

  it.each(ALL_ANCHORS)(
    'derives the %s closed clip from that anchor coordinate scaled to percentages',
    (anchor) => {
      const points = parsePolygonPercentages(closedClipForAnchor(anchor), `closed clip for ${anchor}`);

      expect(points).toHaveLength(3);
      for (const point of points) {
        expect(point.x).toBe(anchorUv[anchor].x * 100);
        expect(point.y).toBe(anchorUv[anchor].y * 100);
      }
    },
  );

  it.each(ALL_ANCHORS)(
    'resolves the %s closed clip onto the reveal clip at progress 0 for every rect',
    (anchor) => {
      for (const { label, rect } of AGREEMENT_RECTS) {
        const context = `${anchor} on ${label}`;
        const closed = parsePolygonPercentages(closedClipForAnchor(anchor), `closed clip for ${context}`);
        const first = parsePolygonPercentages(
          revealClipPath(rect, anchor, 0),
          `reveal clip for ${context}`,
        );

        expect(closed, `closed clip for ${context}`).toHaveLength(3);
        expect(first, `reveal clip for ${context}`).toHaveLength(3);

        const closedPoints = resolveAgainst(rect, closed);
        const firstPoints = resolveAgainst(rect, first);
        const grabPoint = anchorPoint(rect, anchor);

        for (let index = 0; index < closedPoints.length; index += 1) {
          expectCoincident(closedPoints[index]!, firstPoints[index]!, `${context} point ${index}`);
          expectCoincident(closedPoints[index]!, grabPoint, `${context} closed point ${index}`);
          expectCoincident(firstPoints[index]!, grabPoint, `${context} reveal point ${index}`);
        }
      }
    },
  );

  it.each(ALL_ANCHORS)(
    'emits character-identical clip strings for %s against a rect at the origin',
    (anchor) => {
      expect(closedClipForAnchor(anchor)).toBe(revealClipPath(ORIGIN_RECT, anchor, 0));
    },
  );

  it.each(ALL_ANCHORS)(
    'holds the %s frame reveal clip at three coincident base-rect anchor points below progress 1',
    (anchor) => {
      for (const progress of PROGRESS_BELOW_ONE) {
        const context = `${anchor} at progress ${progress}`;
        const frame = buildPaperFrame(
          FRAME_SOURCE,
          FRAME_DESTINATION,
          anchor,
          progress,
          defaultMotionProfile,
        );
        const points = resolveAgainst(
          FRAME_DESTINATION,
          parsePolygonPercentages(frame.revealClipPath, `frame reveal clip for ${context}`),
        );
        const grabPoint = anchorPoint(baseRectAt(progress), anchor);

        expect(points, `frame reveal clip for ${context}`).toHaveLength(3);
        for (let index = 0; index < points.length; index += 1) {
          expectCoincident(points[index]!, grabPoint, `${context} point ${index}`);
        }
      }
    },
  );

  it.each(ALL_ANCHORS)(
    'opens the %s frame reveal clip onto the four destination corners at progress 1',
    (anchor) => {
      const frame = buildPaperFrame(FRAME_SOURCE, FRAME_DESTINATION, anchor, 1, defaultMotionProfile);
      const points = resolveAgainst(
        FRAME_DESTINATION,
        parsePolygonPercentages(frame.revealClipPath, `frame reveal clip for ${anchor}`),
      );

      expect(points, `frame reveal clip for ${anchor}`).toHaveLength(4);
      WINDING_CORNERS.forEach((corner, index) => {
        expectCoincident(points[index]!, anchorPoint(FRAME_DESTINATION, corner), `${anchor} corner ${corner}`);
      });
    },
  );
});

/**
 * The coordinator's side of the anchor contract: it is handed one anchor on the
 * open request, keeps that one value for the lifetime of the transition, and
 * resolves nothing itself.
 *
 * Three claims here are about calls rather than about rendered output, so they
 * are instrumented rather than inferred:
 *
 * - The resolution module is spied at the top of this file, so any resolution
 *   reachable from `open()`, `close()`, `cancel()`, or `handleViewportChange()`
 *   would be recorded (Requirements 7.6, 7.7).
 * - `grabAnchor` is replaced with a counting accessor, so an anchor READ can be
 *   located in time — which is what "the fallback path reads no anchor" means.
 *   The two legitimate reads are the `preparing` clip in `open()` and the
 *   settle-to-idle clip; neither is on the fallback path itself, and the counter
 *   is sampled on entry to the fallback runner to pin that (Requirement 15.10).
 * - The renderer factory validates before it allocates, exactly as
 *   `PaperTurnRenderer` does, and its overlay is a real element appended to the
 *   document. An orphaned overlay is then observable as a stray
 *   `.paper-turn-overlay` node rather than as an un-called `dispose` spy
 *   (Requirements 12.4, 15.11).
 *
 * **Validates: Requirements 7.6, 7.7, 8.5, 12.4, 15.10, 15.11, 15.13**
 */
describe('coordinator anchor pass-through and validation recovery', () => {
  const ALL_ANCHORS: readonly GrabAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
  ];
  const FALLBACK_DURATION_MS = defaultMotionProfile.fallbackDurationMs;
  const HIDDEN_ATTRIBUTE = 'data-paper-turn-hidden';
  const OVERLAY_SELECTOR = '.paper-turn-overlay';

  /** Both mesh dimensions odd, so the validator has to name both fields. */
  const oddMeshProfile: MotionProfile = { ...defaultMotionProfile, meshColumns: 21, meshRows: 15 };

  interface AnchorReadCounter {
    count(): number;
  }

  /**
   * Replaces `grabAnchor` with an accessor that counts reads, leaving the value
   * itself unchanged. `harness()` hands back a plain object literal, so the
   * request the coordinator sees is the instrumented one.
   */
  function countAnchorReads(request: TransitionOpenRequest, anchor: GrabAnchor): AnchorReadCounter {
    let reads = 0;
    Object.defineProperty(request, 'grabAnchor', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return anchor;
      },
    });

    return { count: () => reads };
  }

  /** Makes a hidden card observable in the DOM rather than only in a call record. */
  function trackHiddenCards(view: TransitionView): void {
    vi.mocked(view.setSourceHidden).mockImplementation((source: HTMLElement, hidden: boolean) => {
      if (hidden) {
        source.setAttribute(HIDDEN_ATTRIBUTE, 'true');
      } else {
        source.removeAttribute(HIDDEN_ATTRIBUTE);
      }
    });
  }

  interface ValidatingRendererFactory {
    createRenderer: TransitionDependencies['createRenderer'];
    /** Overlays allocated, in construction order. */
    overlays: HTMLDivElement[];
    /** Overlays whose `dispose()` ran. */
    disposedOverlays: HTMLDivElement[];
    /** Anchors seen by each successful construction, in order. */
    anchors: GrabAnchor[];
    validationFailures: Error[];
  }

  /**
   * Mirrors `PaperTurnRenderer`'s construction order: validate the profile as
   * the first statement, then allocate. A validation throw therefore allocates
   * nothing, which is the postcondition Requirement 12.4 rests on.
   */
  function validatingRendererFactory(): ValidatingRendererFactory {
    const overlays: HTMLDivElement[] = [];
    const disposedOverlays: HTMLDivElement[] = [];
    const anchors: GrabAnchor[] = [];
    const validationFailures: Error[] = [];

    const createRenderer = vi.fn((input: RendererInput): PaperRenderer => {
      try {
        validateProfile(input.profile);
      } catch (error) {
        validationFailures.push(error as Error);
        throw error;
      }

      const overlay = document.createElement('div');
      overlay.className = 'paper-turn-overlay';
      overlay.dataset.grabAnchor = input.grabAnchor;
      document.body.append(overlay);
      overlays.push(overlay);
      anchors.push(input.grabAnchor);

      return {
        render: (progress: number) =>
          buildPaperFrame(input.sourceRect, input.destinationRect, input.grabAnchor, progress, input.profile),
        dispose: () => {
          overlay.remove();
          disposedOverlays.push(overlay);
        },
      };
    });

    return { createRenderer, overlays, disposedOverlays, anchors, validationFailures };
  }

  function expectNoResolution(): void {
    expect(vi.mocked(resolveGrabAnchor)).not.toHaveBeenCalled();
    expect(vi.mocked(gridPositionFromRects)).not.toHaveBeenCalled();
    expect(vi.mocked(anchorForGridPosition)).not.toHaveBeenCalled();
  }

  function expectNothingLeftBehind(): void {
    expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
    expect(document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)).toHaveLength(0);
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.mocked(resolveGrabAnchor).mockClear();
    vi.mocked(gridPositionFromRects).mockClear();
    vi.mocked(anchorForGridPosition).mockClear();
  });

  it.each(ALL_ANCHORS)(
    'passes the %s open-request anchor to the renderer unchanged and reuses it for the settle-to-idle clip',
    async (anchor) => {
      const { coordinator, dependencies, request, view } = harness();
      const factory = validatingRendererFactory();
      dependencies.createRenderer = factory.createRenderer;
      const reads = countAnchorReads(request, anchor);

      await coordinator.open(request);

      expect(view.setDetailClip).toHaveBeenNthCalledWith(1, closedClipForAnchor(anchor));
      expect(factory.anchors).toEqual([anchor]);
      expect(factory.createRenderer).toHaveBeenLastCalledWith(
        expect.objectContaining({ grabAnchor: anchor, profile: dependencies.profile }),
      );
      expect(factory.overlays[0]?.dataset.grabAnchor).toBe(anchor);

      await coordinator.close();

      // The close leg folds about the same anchor and settles onto the closed
      // clip derived from it, with no second resolution in between.
      expect(factory.anchors).toEqual([anchor, anchor]);
      expect(view.setDetailClip).toHaveBeenLastCalledWith(closedClipForAnchor(anchor));
      expect(coordinator.state).toBe('idle');
      expectNoResolution();
      expectNothingLeftBehind();
      // Exactly four reads: the preparing clip and the renderer input on each of
      // the two legs, plus the settle-to-idle clip — no incidental re-reads.
      expect(reads.count()).toBe(4);
    },
  );

  it('completes through the full-motion fallback when profile validation throws during renderer construction', async () => {
    const { coordinator, dependencies, request, source, view } = harness();
    const factory = validatingRendererFactory();
    dependencies.profile = oddMeshProfile;
    dependencies.createRenderer = factory.createRenderer;
    trackHiddenCards(view);
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // No rethrow to the activation path: the caller's promise resolves.
    await expect(coordinator.open(request)).resolves.toBeUndefined();

    expect(factory.createRenderer).toHaveBeenCalledTimes(1);
    expect(factory.validationFailures).toHaveLength(1);
    const failure = factory.validationFailures[0]!;
    expect(failure.message).toContain('profile.meshColumns');
    expect(failure.message).toContain('profile.meshRows');

    // Nothing was allocated, so there is nothing to orphan.
    expect(factory.overlays).toHaveLength(0);
    expect(factory.disposedOverlays).toHaveLength(0);
    expectNothingLeftBehind();
    expect(source.hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false);

    expect(report).toHaveBeenCalledWith('Paper-turn full motion failed; using fallback.', failure);
    expect(dependencies.runFallback).toHaveBeenCalledWith(
      'open',
      FALLBACK_DURATION_MS,
      expect.any(AbortSignal),
    );
    expect(coordinator.state).toBe('open');
    expect(getActiveTransition(coordinator)).toEqual(
      expect.objectContaining({ renderer: null, controller: null, progress: 1, requestedEndpoint: 'open' }),
    );
    expect(view.setDetailClip).toHaveBeenLastCalledWith(FULL_CLIP);
    expectNoResolution();
  });

  it('disposes the overlay allocated for a successful open leg before a validation throw on the close leg', async () => {
    const { coordinator, dependencies, request, view } = harness();
    const factory = validatingRendererFactory();
    dependencies.createRenderer = factory.createRenderer;
    trackHiddenCards(view);
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.open(request);

    // The open leg's overlay is allocated and then disposed on settle, so the
    // close leg starts with nothing outstanding.
    expect(factory.overlays).toHaveLength(1);
    expect(factory.disposedOverlays).toEqual(factory.overlays);
    expectNothingLeftBehind();

    // Retuning the mesh to an odd dimension between legs is the same failure
    // shape arriving on the close leg.
    dependencies.profile = oddMeshProfile;

    await expect(coordinator.close()).resolves.toBeUndefined();

    expect(factory.createRenderer).toHaveBeenCalledTimes(2);
    expect(factory.overlays).toHaveLength(1);
    expect(factory.validationFailures).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(
      'Paper-turn full motion failed; using fallback.',
      factory.validationFailures[0]!,
    );
    expect(dependencies.runFallback).toHaveBeenCalledWith(
      'close',
      FALLBACK_DURATION_MS,
      expect.any(AbortSignal),
    );
    expect(coordinator.state).toBe('idle');
    expect(getActiveTransition(coordinator)).toBeNull();
    expect(view.setDetailClip).toHaveBeenLastCalledWith(closedClipForAnchor(request.grabAnchor));
    expectNothingLeftBehind();
    expectNoResolution();
  });

  it('settles a viewport change during closing on the activation anchor without re-measuring or re-resolving', async () => {
    const { coordinator, dependencies, request, view } = harness();
    const factory = validatingRendererFactory();
    dependencies.createRenderer = factory.createRenderer;
    trackHiddenCards(view);
    request.grabAnchor = 'middle-left';

    await coordinator.open(request);
    vi.mocked(view.measureSource).mockClear();
    vi.mocked(view.measureDestination).mockClear();

    let closingStarted!: () => void;
    const closingInFlight = new Promise<void>((resolve) => {
      closingStarted = resolve;
    });
    dependencies.animate = vi.fn(
      async (_from, _to, _duration, onFrame, signal) =>
        new Promise<void>((_resolve, reject) => {
          onFrame(0.6);
          queueMicrotask(closingStarted);
          signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
        }),
    );

    const closing = coordinator.close();
    await closingInFlight;
    coordinator.handleViewportChange();
    await closing;

    expect(dependencies.runFallback).toHaveBeenCalledWith(
      'close',
      FALLBACK_DURATION_MS,
      expect.any(AbortSignal),
    );
    expect(coordinator.state).toBe('idle');
    // Settled on the anchor resolved at activation, not on a fresh one.
    expect(view.setDetailClip).toHaveBeenLastCalledWith(closedClipForAnchor('middle-left'));
    expect(factory.anchors).toEqual(['middle-left', 'middle-left']);
    // One measurement pass per leg, none attributable to the viewport change.
    expect(view.measureSource).toHaveBeenCalledTimes(1);
    expect(view.measureDestination).toHaveBeenCalledTimes(1);
    expectNoResolution();
    expectNothingLeftBehind();
  });

  it('reads no anchor on the reduced-motion fallback path', async () => {
    const { coordinator, dependencies, request, view } = harness({ mode: 'fallback' });
    const factory = validatingRendererFactory();
    dependencies.createRenderer = factory.createRenderer;
    trackHiddenCards(view);
    const reads = countAnchorReads(request, 'bottom-center');

    const readsOnFallbackEntry: number[] = [];
    dependencies.runFallback = vi.fn(async () => {
      readsOnFallbackEntry.push(reads.count());
    });

    await coordinator.open(request);

    // One read only: the `preparing` clip, taken in `open()` before the mode is
    // even selected. Neither the fallback runner nor `settleOpen` reads an anchor.
    expect(readsOnFallbackEntry).toEqual([1]);
    expect(reads.count()).toBe(1);
    expect(dependencies.capture).not.toHaveBeenCalled();
    expect(factory.createRenderer).not.toHaveBeenCalled();
    expect(view.setDetailClip).toHaveBeenLastCalledWith(FULL_CLIP);
    expect(coordinator.state).toBe('open');

    await coordinator.close();

    // The close leg's fallback runner still reads nothing; the one further read
    // is the settle-to-idle clip, which is the retained anchor being reused.
    expect(readsOnFallbackEntry).toEqual([1, 1]);
    expect(reads.count()).toBe(2);
    expect(view.setDetailClip).toHaveBeenLastCalledWith(closedClipForAnchor('bottom-center'));
    expect(coordinator.state).toBe('idle');
    expect(factory.createRenderer).not.toHaveBeenCalled();
    expect(factory.overlays).toHaveLength(0);
    expectNothingLeftBehind();
    expectNoResolution();
  });
});
