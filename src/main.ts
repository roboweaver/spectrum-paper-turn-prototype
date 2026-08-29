import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/card/sp-card.js';
import '@spectrum-web-components/button/sp-button.js';
import './styles.css';
import { createDemoApp } from './app';
import { createFallbackRunner } from './transition/fallback-transition';
import { captureElement } from './transition/capture';
import { browserMotionMode } from './transition/capabilities';
import { DomTransitionView } from './transition/dom-transition-view';
import { defaultMotionProfile } from './transition/motion-profile';
import { PaperTurnRenderer } from './transition/paper-turn-renderer';
import { createTransitionDebugger } from './debug/transition-debugger';
import { createAnimationSpeedController } from './debug/animation-speed';
import { isDebugPanelVisible, syncDebugParam } from './debug/debug-visibility';
import { mountDebugPanel } from './debug/debug-panel';
import { TransitionCoordinator } from './transition/transition-coordinator';
import type { Corner, MotionProfile } from './transition/types';

declare global {
  interface Window {
    __paperTurn?: {
      coordinator: TransitionCoordinator;
      profile: MotionProfile;
    };
  }
}

const DEFAULT_CORNER: Corner = 'top-right';

function resolveGrabbedCorner(trigger: HTMLElement): Corner {
  const { grabbedCorner } = trigger.dataset;
  return grabbedCorner === 'top-left' ||
      grabbedCorner === 'top-right' ||
      grabbedCorner === 'bottom-right' ||
      grabbedCorner === 'bottom-left'
    ? grabbedCorner
    : DEFAULT_CORNER;
}

function createMotionProfile(searchParams: URLSearchParams): MotionProfile {
  const durationMs = Number(searchParams.get('duration'));
  // Always a copy: `defaultMotionProfile` is frozen, and the debug speed
  // control retimes the next turn by writing to this object in place.
  return Number.isFinite(durationMs) && durationMs > 0
    ? { ...defaultMotionProfile, durationMs }
    : { ...defaultMotionProfile };
}

function reportCoordinatorFailure(action: 'open' | 'close', error: unknown): void {
  console.error(`Paper-turn ${action} interaction failed.`, error);
}

function runCoordinatorAction(action: 'open' | 'close', work: Promise<void>): void {
  work.catch((error) => reportCoordinatorFailure(action, error));
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app mount point');
}

const searchParams = new URLSearchParams(window.location.search);
const profile = createMotionProfile(searchParams);
// The demo is published for inspection, so the debugger is always installed:
// the panel can be re-shown at any moment from the chip, and a driver that had
// to be swapped in first could not pause or scrub a turn already under way.
const transitionDebugger = createTransitionDebugger();
const app = createDemoApp(root);
const transitionView = new DomTransitionView({
  list: app.listSurface,
  detail: app.detailSurface,
  heading: app.detailHeading,
  fallback: app.listFocusFallback,
  renderDetail: app.renderDetail,
});
const coordinator = new TransitionCoordinator(transitionView, {
  profile,
  selectMotionMode: () => (searchParams.has('fallback') ? 'fallback' : browserMotionMode()),
  capture: captureElement,
  createRenderer: (input) => new PaperTurnRenderer(input),
  runFallback: createFallbackRunner(app.detailSurface),
  animate: transitionDebugger.animate,
});

// The speed controller seeds its slider from `?duration=` but does not write
// back to the profile, so making the panel default-on does not change what
// `?duration=` means for anyone who is not touching the slider.
mountDebugPanel(transitionDebugger, createAnimationSpeedController(profile), document.body, {
  visible: isDebugPanelVisible(searchParams),
  onVisibilityChange: (visible) => syncDebugParam(visible),
});

root.dataset.transitionState = coordinator.state;
coordinator.addEventListener('statechange', () => {
  root.dataset.transitionState = coordinator.state;
});

window.__paperTurn = { coordinator, profile };

for (const trigger of root.querySelectorAll<HTMLElement>('[data-card-trigger]')) {
  trigger.addEventListener('click', () => {
    const sourceId = trigger.dataset.sourceId;
    if (!sourceId) {
      reportCoordinatorFailure('open', new Error('Demo DOM contract is incomplete: card trigger missing data-source-id'));
      return;
    }

    runCoordinatorAction(
      'open',
      coordinator.open({
        sourceId,
        grabbedCorner: resolveGrabbedCorner(trigger),
        trigger,
      }),
    );
  });
}

app.closeButton.addEventListener('click', () => {
  runCoordinatorAction('close', coordinator.close());
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    coordinator.cancel();
  }
});

window.addEventListener('resize', () => {
  coordinator.handleViewportChange();
});

window.addEventListener('orientationchange', () => {
  coordinator.handleViewportChange();
});
