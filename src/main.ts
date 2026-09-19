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
import { createTileGridController, type TileGridController } from './debug/tile-grid-control';
import { tileCountFromParams } from './tile-grid';
import { TransitionCoordinator } from './transition/transition-coordinator';
import { resolveGrabAnchor } from './transition/grab-anchor';
import type { MotionProfile } from './transition/types';

declare global {
  interface Window {
    __paperTurn?: {
      coordinator: TransitionCoordinator;
      profile: MotionProfile;
      tiles: TileGridController;
    };
  }
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
const app = createDemoApp(root, tileCountFromParams(searchParams));
const tiles = createTileGridController(app);
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
// `?duration=` means for anyone who is not touching the slider. The tile control
// is the same shape: `?tiles=` seeds it and is never rewritten.
mountDebugPanel(transitionDebugger, createAnimationSpeedController(profile), document.body, {
  visible: isDebugPanelVisible(searchParams),
  onVisibilityChange: (visible) => syncDebugParam(visible),
  tiles,
  anchorLabels: {
    visible: () => app.anchorLabelsVisible(),
    setVisible: (visible) => app.setAnchorLabelsVisible(visible),
  },
});

root.dataset.transitionState = coordinator.state;
coordinator.addEventListener('statechange', () => {
  root.dataset.transitionState = coordinator.state;
});

window.__paperTurn = { coordinator, profile, tiles };

// Delegated rather than bound per tile: the tile count control re-renders the
// grid, so a listener attached to a trigger would be discarded with it.
app.cardGrid.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const trigger = target?.closest<HTMLElement>('[data-card-trigger]') ?? null;

  if (!trigger || !app.cardGrid.contains(trigger)) {
    return;
  }

  const sourceId = trigger.dataset.sourceId;
  if (!sourceId) {
    reportCoordinatorFailure('open', new Error('Demo DOM contract is incomplete: card trigger missing data-source-id'));
    return;
  }

  // Measurement and resolution both complete synchronously here, before the
  // coordinator schedules the first animation frame, so no layout read is
  // attributable to the frame loop and none happens again while the turn runs.
  //
  // The anchor is derived from position alone: no element attribute, constant, or
  // runtime parameter can override it.
  const { triggers, rects } = app.measureTiles();
  const grabAnchor = resolveGrabAnchor(rects, triggers.indexOf(trigger));

  runCoordinatorAction(
    'open',
    coordinator.open({
      sourceId,
      grabAnchor,
      trigger,
    }),
  );
});

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
  // Column count is capped by the width available, so a resize can change the
  // grid shape and with it every tile's anchor. Re-laying out never replaces a
  // tile element, so this is safe while a turn is settling.
  tiles.refresh();
});

window.addEventListener('orientationchange', () => {
  coordinator.handleViewportChange();
  tiles.refresh();
});
