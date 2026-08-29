import {
  type AnimationSpeedController,
  type AnimationSpeedState,
  formatSpeedReadout,
  SPEED_SLIDER_STEPS,
} from './animation-speed';
import type { DebugState, TransitionDebugger } from './transition-debugger';

const STEP = 0.01;
const SLIDER_STEPS = 1000;

function button(label: string, title: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.title = title;
  return element;
}

export interface DebugPanelOptions {
  /** Whether the panel starts on screen. Defaults to true. */
  readonly visible?: boolean;
  /**
   * Called only when the user hides or re-shows the panel, never on mount.
   * `main.ts` uses it to keep the URL in step via `history.replaceState`.
   */
  readonly onVisibilityChange?: (visible: boolean) => void;
}

/**
 * A small always-on-top control strip for inspecting the turn frame by frame.
 * Mounted on `document.body` rather than inside `#app` so it stays clickable
 * while the app root carries `data-transition-busy="true"`, which disables
 * pointer events for everything inside it.
 *
 * Carries two sliders: one scrubs position through the current turn, the other
 * retimes the next turn via the shared motion profile.
 *
 * The panel can be hidden down to a small chip. Both live under one teardown,
 * and hiding only toggles `hidden` — nothing is unmounted, so the turn keeps
 * running and the chosen speed survives a hide/show round trip.
 */
export function mountDebugPanel(
  controller: TransitionDebugger,
  speed: AnimationSpeedController,
  parent: HTMLElement = document.body,
  options: DebugPanelOptions = {},
): () => void {
  const panel = document.createElement('div');
  panel.className = 'paper-turn-debug';
  panel.dataset.paperTurnDebug = 'true';

  const toggle = button('Pause', 'Pause or resume the turn (Space)');
  toggle.dataset.debugToggle = 'true';

  const back = button('◀', 'Step back one frame (←)');
  const forward = button('▶', 'Step forward one frame (→)');

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(SLIDER_STEPS);
  slider.value = '0';
  slider.step = '1';
  slider.title = 'Scrub the turn';
  slider.dataset.debugScrub = 'true';

  const readout = document.createElement('span');
  readout.className = 'paper-turn-debug__readout';
  readout.dataset.debugReadout = 'true';

  const speedLabel = document.createElement('span');
  speedLabel.className = 'paper-turn-debug__label';
  speedLabel.textContent = 'Speed';

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.min = '0';
  speedSlider.max = String(SPEED_SLIDER_STEPS);
  speedSlider.step = '1';
  speedSlider.title = 'Animation speed — applies to the next turn';
  speedSlider.dataset.debugSpeed = 'true';

  const speedReadout = document.createElement('span');
  speedReadout.className = 'paper-turn-debug__readout paper-turn-debug__readout--speed';
  speedReadout.dataset.debugSpeedReadout = 'true';

  const speedReset = button('Reset 1x', 'Reset animation speed to 1x (720 ms)');
  speedReset.dataset.debugSpeedReset = 'true';

  const hide = button('Hide', 'Hide the debug panel');
  hide.dataset.debugHide = 'true';

  const chip = button('Debug', 'Show the debug panel');
  chip.className = 'paper-turn-debug-chip';
  chip.dataset.paperTurnDebugChip = 'true';

  panel.append(
    toggle,
    back,
    forward,
    slider,
    readout,
    speedLabel,
    speedSlider,
    speedReadout,
    speedReset,
    hide,
  );
  parent.append(panel, chip);

  let dragging = false;
  let draggingSpeed = false;
  let visible = options.visible ?? true;

  const renderSpeed = (state: AnimationSpeedState): void => {
    if (!draggingSpeed) {
      speedSlider.value = String(state.sliderIndex);
    }

    speedReadout.textContent = formatSpeedReadout(state);
  };

  const render = (state: DebugState): void => {
    toggle.textContent = state.paused ? 'Play' : 'Pause';
    panel.dataset.active = String(state.active);
    panel.dataset.paused = String(state.paused);

    // Retiming a run already in flight is not supported, so the speed control
    // is unavailable until the turn settles. `active` returns to false on
    // completion, abort, and failure alike, so this cannot latch on.
    speedSlider.disabled = state.active;
    speedReset.disabled = state.active;

    if (!dragging) {
      slider.value = String(Math.round(state.position * SLIDER_STEPS));
    }

    readout.textContent = state.active
      ? `${(state.position * 100).toFixed(1)}% · progress ${state.progress.toFixed(3)}`
      : 'idle — click a card';
  };

  const unsubscribe = controller.subscribe(render);
  const unsubscribeSpeed = speed.subscribe(renderSpeed);

  const applyVisibility = (): void => {
    panel.hidden = !visible;
    chip.hidden = visible;
  };

  const setVisible = (next: boolean): void => {
    if (visible === next) {
      return;
    }

    visible = next;
    applyVisibility();
    options.onVisibilityChange?.(next);
  };

  applyVisibility();

  const onToggle = (): void => controller.toggle();
  const onBack = (): void => controller.step(-STEP);
  const onForward = (): void => controller.step(STEP);
  const onScrub = (): void => controller.scrubTo(Number(slider.value) / SLIDER_STEPS);
  const onSpeed = (): void => speed.setSliderIndex(Number(speedSlider.value));
  const onSpeedReset = (): void => speed.reset();
  const onHide = (): void => setVisible(false);
  const onShow = (): void => setVisible(true);
  const onDragStart = (): void => {
    dragging = true;
  };
  const onDragEnd = (): void => {
    dragging = false;
  };
  const onSpeedDragStart = (): void => {
    draggingSpeed = true;
  };
  const onSpeedDragEnd = (): void => {
    draggingSpeed = false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // A hidden panel must not keep stealing Space and the arrow keys: someone
    // who hid the controls did not ask for hidden shortcuts over the demo.
    if (!visible) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (target && (target.tagName === 'INPUT' || target.isContentEditable)) {
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      controller.toggle();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      controller.step(-STEP);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      controller.step(STEP);
    }
  };

  // Registered as a table so mount and teardown can never drift apart.
  const bindings: readonly (readonly [EventTarget, string, EventListener])[] = [
    [toggle, 'click', onToggle],
    [back, 'click', onBack],
    [forward, 'click', onForward],
    [slider, 'input', onScrub],
    [slider, 'pointerdown', onDragStart],
    [slider, 'pointerup', onDragEnd],
    [slider, 'blur', onDragEnd],
    [speedSlider, 'input', onSpeed],
    [speedSlider, 'pointerdown', onSpeedDragStart],
    [speedSlider, 'pointerup', onSpeedDragEnd],
    [speedSlider, 'blur', onSpeedDragEnd],
    [speedReset, 'click', onSpeedReset],
    [hide, 'click', onHide],
    [chip, 'click', onShow],
  ];

  for (const [target, type, listener] of bindings) {
    target.addEventListener(type, listener);
  }

  window.addEventListener('keydown', onKeyDown);

  return () => {
    unsubscribe();
    unsubscribeSpeed();

    for (const [target, type, listener] of bindings) {
      target.removeEventListener(type, listener);
    }

    window.removeEventListener('keydown', onKeyDown);
    panel.remove();
    chip.remove();
  };
}
