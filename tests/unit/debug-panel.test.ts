import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnimationSpeedController,
  DEFAULT_SLIDER_INDEX,
  SPEED_SLIDER_STEPS,
} from '../../src/debug/animation-speed';
import { mountDebugPanel, type DebugPanelOptions } from '../../src/debug/debug-panel';
import type { DebugState, TransitionDebugger } from '../../src/debug/transition-debugger';
import { defaultMotionProfile } from '../../src/transition/motion-profile';
import type { MotionProfile } from '../../src/transition/types';

const IDLE: DebugState = { active: false, paused: false, position: 0, progress: 0 };
const RUNNING: DebugState = { active: true, paused: false, position: 0.4, progress: 0.4 };
const PAUSED: DebugState = { active: true, paused: true, position: 0.4, progress: 0.4 };

function createStubDebugger(): TransitionDebugger & { emit(state: DebugState): void } {
  const listeners = new Set<(state: DebugState) => void>();

  return {
    animate: vi.fn(() => Promise.resolve()),
    isPaused: () => false,
    pause: vi.fn(),
    resume: vi.fn(),
    toggle: vi.fn(),
    scrubTo: vi.fn(),
    step: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(IDLE);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (state) => {
      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}

function setup(profileOverrides: Partial<MotionProfile> = {}, options: DebugPanelOptions = {}) {
  const profile: MotionProfile = { ...defaultMotionProfile, ...profileOverrides };
  const controller = createStubDebugger();
  const speed = createAnimationSpeedController(profile);
  const teardown = mountDebugPanel(controller, speed, document.body, options);

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing debug element: ${selector}`);
    }
    return element;
  };

  return {
    profile,
    controller,
    speed,
    teardown,
    panel: query<HTMLElement>('[data-paper-turn-debug]'),
    speedSlider: query<HTMLInputElement>('[data-debug-speed]'),
    speedReadout: query<HTMLElement>('[data-debug-speed-readout]'),
    speedReset: query<HTMLButtonElement>('[data-debug-speed-reset]'),
    scrub: query<HTMLInputElement>('[data-debug-scrub]'),
    hide: query<HTMLButtonElement>('[data-debug-hide]'),
    chip: query<HTMLButtonElement>('[data-paper-turn-debug-chip]'),
  };
}

function drag(slider: HTMLInputElement, value: number): void {
  slider.dispatchEvent(new Event('pointerdown'));
  slider.value = String(value);
  slider.dispatchEvent(new Event('input'));
  slider.dispatchEvent(new Event('pointerup'));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('debug panel speed control', () => {
  it('renders a second slider seeded at 1x with an unambiguous readout', () => {
    const { speedSlider, speedReadout, speedReset, scrub } = setup();

    expect(speedSlider).not.toBe(scrub);
    expect(speedSlider.type).toBe('range');
    expect(speedSlider.min).toBe('0');
    expect(speedSlider.max).toBe(String(SPEED_SLIDER_STEPS));
    expect(speedSlider.value).toBe(String(DEFAULT_SLIDER_INDEX));
    expect(speedReadout.textContent).toBe('1x · 720 ms');
    expect(speedReset.textContent).toBe('Reset 1x');
  });

  it('retimes both durations live, without a reload', () => {
    const { profile, speedSlider, speedReadout } = setup();

    drag(speedSlider, 0);
    expect(profile.durationMs).toBe(10_000);
    expect(profile.fallbackDurationMs).toBe(2778);
    expect(speedReadout.textContent).toBe('0.07x · 10000 ms');

    drag(speedSlider, SPEED_SLIDER_STEPS);
    expect(profile.durationMs).toBe(180);
    expect(profile.fallbackDurationMs).toBe(50);
    expect(speedReadout.textContent).toBe('4x · 180 ms');
  });

  it('returns to exactly 720 ms via the reset button', () => {
    const { profile, speedSlider, speedReadout, speedReset } = setup();

    drag(speedSlider, 120);
    expect(profile.durationMs).not.toBe(720);

    speedReset.click();
    expect(profile.durationMs).toBe(720);
    expect(profile.fallbackDurationMs).toBe(200);
    expect(speedSlider.value).toBe(String(DEFAULT_SLIDER_INDEX));
    expect(speedReadout.textContent).toBe('1x · 720 ms');
  });

  it('seeds the slider from a ?duration profile instead of 720', () => {
    const { speedSlider, speedReadout } = setup({ durationMs: 1440 });

    expect(speedReadout.textContent).toBe('0.5x · 1440 ms');
    expect(Number(speedSlider.value)).toBeLessThan(DEFAULT_SLIDER_INDEX);
  });

  it('does not fight the pointer while the slider is being dragged', () => {
    const { speed, speedSlider } = setup();

    speedSlider.dispatchEvent(new Event('pointerdown'));
    speed.setMultiplier(2);
    expect(speedSlider.value).toBe(String(DEFAULT_SLIDER_INDEX));

    speedSlider.dispatchEvent(new Event('pointerup'));
    speed.setMultiplier(3);
    expect(Number(speedSlider.value)).toBeGreaterThan(DEFAULT_SLIDER_INDEX);
  });
});

describe('debug panel speed control availability', () => {
  it('is disabled while a turn is in flight and restored when it settles', () => {
    const { controller, speedSlider, speedReset } = setup();

    expect(speedSlider.disabled).toBe(false);
    expect(speedReset.disabled).toBe(false);

    controller.emit(RUNNING);
    expect(speedSlider.disabled).toBe(true);
    expect(speedReset.disabled).toBe(true);

    controller.emit(IDLE);
    expect(speedSlider.disabled).toBe(false);
    expect(speedReset.disabled).toBe(false);
  });

  it('stays disabled while scrubbing a paused turn, then recovers on resume', () => {
    const { controller, speedSlider, speedReset } = setup();

    controller.emit(PAUSED);
    expect(speedSlider.disabled).toBe(true);

    controller.emit(RUNNING);
    expect(speedSlider.disabled).toBe(true);

    controller.emit(IDLE);
    expect(speedSlider.disabled).toBe(false);
    expect(speedReset.disabled).toBe(false);
  });

  it('recovers when a turn is aborted partway', () => {
    const { controller, speedSlider, speedReset } = setup();

    controller.emit(RUNNING);
    // An abort settles the debugger back to an inactive state mid-position.
    controller.emit({ active: false, paused: false, position: 0.4, progress: 0.4 });

    expect(speedSlider.disabled).toBe(false);
    expect(speedReset.disabled).toBe(false);
  });

  it('keeps the scrub slider dimming keyed to the panel active flag', () => {
    const { controller, panel } = setup();

    expect(panel.dataset.active).toBe('false');
    controller.emit(RUNNING);
    expect(panel.dataset.active).toBe('true');
  });
});

describe('debug panel transport controls', () => {
  it('drives the debugger from buttons and the scrub slider', () => {
    const { controller, scrub } = setup();
    const toggle = document.querySelector<HTMLButtonElement>('[data-debug-toggle]');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.paper-turn-debug button')];
    const [, back, forward] = buttons;

    toggle?.click();
    expect(controller.toggle).toHaveBeenCalledTimes(1);

    back?.click();
    expect(controller.step).toHaveBeenLastCalledWith(-0.01);

    forward?.click();
    expect(controller.step).toHaveBeenLastCalledWith(0.01);

    scrub.dispatchEvent(new Event('pointerdown'));
    scrub.value = '250';
    scrub.dispatchEvent(new Event('input'));
    expect(controller.scrubTo).toHaveBeenLastCalledWith(0.25);

    // Held while dragging so incoming frames do not yank the thumb.
    controller.emit(RUNNING);
    expect(scrub.value).toBe('250');

    scrub.dispatchEvent(new Event('blur'));
    controller.emit(RUNNING);
    expect(scrub.value).toBe('400');
  });

  it('maps keyboard shortcuts to the debugger', () => {
    const { controller } = setup();

    for (const [key, assertion] of [
      [' ', () => expect(controller.toggle).toHaveBeenCalledTimes(1)],
      ['ArrowLeft', () => expect(controller.step).toHaveBeenLastCalledWith(-0.01)],
      ['ArrowRight', () => expect(controller.step).toHaveBeenLastCalledWith(0.01)],
    ] as const) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      window.dispatchEvent(event);
      assertion();
      expect(event.defaultPrevented).toBe(true);
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(controller.toggle).toHaveBeenCalledTimes(1);
  });

  it('never hijacks keys typed into either slider', () => {
    const { controller, speedSlider, scrub } = setup();

    for (const input of [speedSlider, scrub]) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
    }

    expect(controller.step).not.toHaveBeenCalled();
    expect(controller.toggle).not.toHaveBeenCalled();
  });

  it('mounts into an explicit parent', () => {
    const host = document.createElement('section');
    document.body.append(host);

    const teardown = mountDebugPanel(
      createStubDebugger(),
      createAnimationSpeedController({ ...defaultMotionProfile }),
      host,
    );

    expect(host.querySelector('[data-paper-turn-debug]')).not.toBeNull();
    teardown();
    expect(host.querySelector('[data-paper-turn-debug]')).toBeNull();
  });
});

describe('debug panel visibility', () => {
  it('opens showing the panel and not the chip', () => {
    const { panel, chip } = setup();

    expect(panel.hidden).toBe(false);
    expect(chip.hidden).toBe(true);
  });

  it('does not report a visibility change for the state it was mounted in', () => {
    const onVisibilityChange = vi.fn();

    setup({}, { visible: true, onVisibilityChange });
    expect(onVisibilityChange).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    setup({}, { visible: false, onVisibilityChange });
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it('can be mounted already hidden, leaving only the chip on screen', () => {
    const { panel, chip } = setup({}, { visible: false });

    expect(panel.hidden).toBe(true);
    expect(chip.hidden).toBe(false);
  });

  it('hides in place when Hide is pressed and reports it once', () => {
    const onVisibilityChange = vi.fn();
    const { panel, chip, hide } = setup({}, { onVisibilityChange });

    hide.click();

    expect(panel.hidden).toBe(true);
    expect(chip.hidden).toBe(false);
    expect(onVisibilityChange).toHaveBeenCalledExactlyOnceWith(false);
    // Hiding is a view change, not an unmount: the panel stays in the document
    // so no transition state or speed setting is lost.
    expect(document.body.contains(panel)).toBe(true);
  });

  it('brings the panel back when the chip is pressed', () => {
    const onVisibilityChange = vi.fn();
    const { panel, chip, hide } = setup({}, { onVisibilityChange });

    hide.click();
    onVisibilityChange.mockClear();
    chip.click();

    expect(panel.hidden).toBe(false);
    expect(chip.hidden).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('ignores a repeated Hide so the URL is not rewritten for nothing', () => {
    const onVisibilityChange = vi.fn();
    const { hide } = setup({}, { onVisibilityChange });

    hide.click();
    hide.click();

    expect(onVisibilityChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('keeps the chosen speed across a hide and show round trip', () => {
    const { profile, hide, chip, speedReadout, speedSlider } = setup();

    drag(speedSlider, 0);
    const slowed = profile.durationMs;

    hide.click();
    chip.click();

    expect(profile.durationMs).toBe(slowed);
    expect(speedSlider.value).toBe('0');
    expect(speedReadout.textContent).toContain('ms');
  });

  it('stops answering keyboard shortcuts while hidden', () => {
    const { controller, hide, chip } = setup();

    hide.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(controller.toggle).not.toHaveBeenCalled();

    chip.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(controller.toggle).toHaveBeenCalledTimes(1);
  });
});

describe('debug panel teardown', () => {
  it('removes the panel and every listener it added', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { profile, speed, controller, teardown, speedSlider, speedReset } = setup();

    teardown();

    expect(document.querySelector('[data-paper-turn-debug]')).toBeNull();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    // Detached controls must no longer drive the profile, and neither
    // subscription may keep pushing into the removed DOM.
    drag(speedSlider, 0);
    speedReset.click();
    expect(profile.durationMs).toBe(720);

    expect(() => {
      speed.setMultiplier(4);
      controller.emit(RUNNING);
    }).not.toThrow();
    expect(speedSlider.disabled).toBe(false);
  });

  it('takes the chip with it and leaves its click wiring inert', () => {
    const onVisibilityChange = vi.fn();
    const { panel, chip, hide, teardown } = setup({}, { onVisibilityChange });

    teardown();

    expect(document.querySelector('[data-paper-turn-debug-chip]')).toBeNull();

    // A detached chip that still toggled visibility would be a leaked listener
    // holding the panel alive, which is exactly what teardown must rule out.
    chip.click();
    hide.click();
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(false);
  });
});
