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
import { createContentResolver } from './content/content-resolver';
import { awaitCaptureReadiness } from './content/capture-readiness';
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
// Owns the network wait, the single-flight guard, and supersession. Deliberately
// constructed outside the coordinator and never handed to it.
const resolver = createContentResolver();
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

  void activate(event, trigger);
});

/**
 * Resolve, then measure, then open.
 *
 * The order is the design's central decision made concrete. The network wait
 * happens here, entirely outside the coordinator, so the state machine gains no
 * long-lived `preparing` state, no new cancellation semantics, and no new failure
 * mode. Measurement follows resolution with no round trip between it and `open()`,
 * so the rects cannot go stale mid-prepare.
 *
 * Nothing is frozen or inert while the network works: the list stays scrollable
 * and the other tiles stay usable, because `setBusy` and `freezeScroll` only run
 * once `open()` is called.
 */
async function activate(event: MouseEvent, trigger: HTMLElement): Promise<void> {

  // The trigger is a real <a>, so a modified or non-primary click belongs to the
  // browser. Swallowing one is the classic way a transition breaks the browser:
  // cmd-click stops opening a new tab, middle-click stops working, and the reader
  // has no way to tell the page is at fault. Return *before* preventDefault so the
  // native navigation proceeds untouched.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }

  const sourceId = trigger.dataset.sourceId;
  if (!sourceId) {
    reportCoordinatorFailure('open', new Error('Demo DOM contract is incomplete: card trigger missing data-source-id'));
    return;
  }

  // From here the enhancement owns the click, so the browser must not also
  // navigate to the href.
  event.preventDefault();

  const href = trigger.getAttribute('href') ?? '';
  const outcome = await resolver.resolve(href);

  if (outcome.kind === 'superseded') {
    // A later activation took over. Do nothing at all — in particular do not fall
    // through to navigation, or a click the reader already abandoned would take the
    // page out from under the activation they are watching.
    return;
  }

  if (outcome.kind === 'failed') {
    // An ordinary outcome, not an exception. The tile is a real link, so the
    // reader still gets the page; only the animation is lost. Nothing has been
    // frozen or hidden at this point, so there is no state to unwind.
    console.warn(`Paper-turn: ${outcome.reason} for ${href}; navigating instead.`, outcome.message);
    window.location.assign(href);
    return;
  }

  if (coordinator.state !== 'idle') {
    // The resolution outran a transition that started meanwhile. Calling `open()`
    // now would trip the coordinator's own state guard and throw.
    return;
  }

  app.setPendingDetail({
    sourceId,
    fragment: outcome.fragment,
    color: outcome.color,
  });

  // Adopt here rather than leaving it to the coordinator's `prepareDetail`, because
  // nothing in the fragment loads until it is in the live document and the capture
  // needs those loads finished. `renderDetail` is idempotent for one activation, so
  // `prepareDetail` calling it again is a no-op rather than a re-adoption that would
  // restart the loading this wait just paid for.
  app.renderDetail(sourceId);

  const readiness = await awaitCaptureReadiness(app.detailSurface, {
    timeoutMs: resolver.config.captureReadinessTimeoutMs,
  });

  if (readiness.timedOut) {
    console.warn(
      `Paper-turn: capture readiness for ${href} exceeded ${resolver.config.captureReadinessTimeoutMs}ms; capturing anyway. The reverse face may show unloaded assets.`,
    );
  }

  if (coordinator.state !== 'idle') {
    // The readiness wait is another await, so re-check rather than assume.
    return;
  }

  // Measured after resolution and readiness, immediately before `open()`, so no
  // layout read is attributable to the frame loop and none happens again while the
  // turn runs.
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
  // Column count is capped by the width available, so a resize can change the
  // grid shape and with it every tile's anchor. Re-laying out never replaces a
  // tile element, so this is safe while a turn is settling.
  tiles.refresh();
});

window.addEventListener('orientationchange', () => {
  coordinator.handleViewportChange();
  tiles.refresh();
});
