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

/**
 * A small always-on-top control strip for inspecting the turn frame by frame.
 * Mounted on `document.body` rather than inside `#app` so it stays clickable
 * while the app root carries `data-transition-busy="true"`, which disables
 * pointer events for everything inside it.
 */
export function mountDebugPanel(
  controller: TransitionDebugger,
  parent: HTMLElement = document.body,
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

  panel.append(toggle, back, forward, slider, readout);
  parent.append(panel);

  let dragging = false;

  const render = (state: DebugState): void => {
    toggle.textContent = state.paused ? 'Play' : 'Pause';
    panel.dataset.active = String(state.active);
    panel.dataset.paused = String(state.paused);

    if (!dragging) {
      slider.value = String(Math.round(state.position * SLIDER_STEPS));
    }

    readout.textContent = state.active
      ? `${(state.position * 100).toFixed(1)}% · progress ${state.progress.toFixed(3)}`
      : 'idle — click a card';
  };

  const unsubscribe = controller.subscribe(render);

  const onToggle = (): void => controller.toggle();
  const onBack = (): void => controller.step(-STEP);
  const onForward = (): void => controller.step(STEP);
  const onScrub = (): void => controller.scrubTo(Number(slider.value) / SLIDER_STEPS);
  const onDragStart = (): void => {
    dragging = true;
  };
  const onDragEnd = (): void => {
    dragging = false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
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

  toggle.addEventListener('click', onToggle);
  back.addEventListener('click', onBack);
  forward.addEventListener('click', onForward);
  slider.addEventListener('input', onScrub);
  slider.addEventListener('pointerdown', onDragStart);
  slider.addEventListener('pointerup', onDragEnd);
  slider.addEventListener('blur', onDragEnd);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKeyDown);
    panel.remove();
  };
}
