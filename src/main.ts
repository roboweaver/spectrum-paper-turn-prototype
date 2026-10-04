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
import { createContentResolver, type ResolveOutcome } from './content/content-resolver';
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
// Owns the network wait, the single-flight guard, supersession, and the cache.
// Deliberately constructed outside the coordinator and never handed to it.
const resolver = createContentResolver();

/**
 * Whether the activation currently in flight exceeded the latency budget.
 *
 * Read by the injected `selectMotionMode` below and cleared when the coordinator
 * returns to `idle`. Declared here rather than beside its uses because both the
 * selector and the statechange listener close over it.
 */
let slowActivation = false;

/**
 * The pending handle owned by the activation currently in flight, if any.
 *
 * Tracked at module scope rather than only in `activate`'s local `pending` const so
 * that a newer click can clear the previous tile's marker the *moment* it starts,
 * rather than having to wait for the earlier `resolve()` to settle and report
 * `superseded`. Without this a slow or hung first request would leave its tile dimmed
 * and `aria-busy` behind the second tile that replaced it.
 */
let activePending: { clear(): void } | null = null;

const coordinator = new TransitionCoordinator(transitionView, {
  profile,
  // The latency budget's entire integration with the transition. `selectMotionMode` is
  // already an injected dependency the coordinator calls inside `open()` and `close()`,
  // so a slow resolution reaches the existing fallback path without a line changing in
  // `transition-coordinator.ts`, `runFallbackTo`, or the motion mode itself.
  //
  // Order matters: an explicit `?fallback=` or a device that cannot do full motion
  // already returns `fallback`, and the budget must not be able to override *upwards*.
  selectMotionMode: () =>
    searchParams.has('fallback') || slowActivation ? 'fallback' : browserMotionMode(),
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

  // The fallback commit is scoped to the activation that earned it. Cleared when the
  // cycle returns to idle rather than at settle-open, so that a turn which opened in
  // fallback also *closes* in fallback — the coordinator calls `selectMotionMode`
  // again on close, and an open/close pair in different modes would look like a bug.
  // Clearing it at all is what stops one slow page degrading the whole session.
  if (coordinator.state === 'idle') {
    slowActivation = false;
  }
});

window.__paperTurn = { coordinator, profile, tiles };

/**
 * Warm a tile's content speculatively.
 *
 * Delegated for the same reason the click handler is: the tile-count control
 * re-renders the grid, so a listener bound to a trigger would be discarded with it.
 *
 * `pointerover` rather than `pointerenter`, which does **not bubble** and so would
 * never reach a delegated listener at all — verified in Chromium against this page.
 * Because `pointerover` fires repeatedly as the pointer moves within one tile, the
 * handler has to be cheap: `warm` on an already-warmed or in-flight URL is a map
 * lookup and a return.
 *
 * No `preventDefault` anywhere here. Warming must not disturb the tile's native link
 * behaviour, and these events are not activations.
 */
/**
 * Shapes the prefetch traffic, so a sweep across the grid does not fan out into one
 * concurrent request per tile.
 *
 * Two guards, both in this listener layer rather than inside `resolver.warm`, so the
 * resolver's "cheap, idempotent, owed-to-nobody" contract — and the 1000 unit tests
 * that pin it — stay untouched:
 *
 * - **Hover intent.** A `pointerover` warms only after the pointer has dwelled on the
 *   tile for `warmHoverIntentMs`; moving on before then cancels it. Keyboard focus and
 *   touch are deliberate intent, not an incidental sweep, so `focusin`/`touchstart`
 *   warm immediately.
 * - **A concurrency cap.** At most `maxConcurrentWarms` warms are counted in flight at
 *   once. The resolver already de-dupes cached/in-flight URLs, so this only needs to
 *   gate genuinely new warms. A slot is released after `requestTimeoutMs`, which bounds
 *   how long a warm's request can live, so the count can never sit below the true
 *   number in flight.
 */
const hoverIntentTimers = new Map<HTMLElement, number>();
let warmsInFlight = 0;

function requestWarm(href: string): void {
  if (warmsInFlight >= resolver.config.maxConcurrentWarms) {
    return;
  }
  warmsInFlight += 1;
  resolver.warm(href);
  // The resolver gives no completion signal by design, so the slot is freed on the
  // request-lifetime bound. A warm's own fetch cannot outlive `requestTimeoutMs`, so
  // releasing then never frees a slot a live request still holds.
  window.setTimeout(() => {
    warmsInFlight = Math.max(0, warmsInFlight - 1);
  }, resolver.config.requestTimeoutMs);
}

function triggerFrom(event: Event): HTMLElement | null {
  const target = event.target as HTMLElement | null;
  const trigger = target?.closest<HTMLElement>('[data-card-trigger]') ?? null;
  return trigger && app.cardGrid.contains(trigger) ? trigger : null;
}

// `pointerover` is debounced for hover intent; the pointer must dwell before a warm
// fires, so sweeping across a tile to reach another one does not warm it.
app.cardGrid.addEventListener(
  'pointerover',
  (event) => {
    const trigger = triggerFrom(event);
    if (!trigger) {
      return;
    }
    if (hoverIntentTimers.has(trigger)) {
      return;
    }
    const timer = window.setTimeout(() => {
      hoverIntentTimers.delete(trigger);
      requestWarm(trigger.getAttribute('href') ?? '');
    }, resolver.config.warmHoverIntentMs);
    hoverIntentTimers.set(trigger, timer);
  },
  { passive: true },
);

// Cancel a pending hover-intent warm when the pointer leaves the tile before it dwelled
// long enough. `pointerout` bubbles (unlike `pointerleave`), so it reaches the delegate.
app.cardGrid.addEventListener(
  'pointerout',
  (event) => {
    const trigger = triggerFrom(event);
    if (!trigger) {
      return;
    }
    const timer = hoverIntentTimers.get(trigger);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      hoverIntentTimers.delete(trigger);
    }
  },
  { passive: true },
);

// Keyboard focus and touch are deliberate intent, so they warm immediately — but still
// through the concurrency cap. Passive: the handler never calls `preventDefault`, so
// `touchstart` must not block the scrolling grid.
for (const type of ['focusin', 'touchstart'] as const) {
  app.cardGrid.addEventListener(
    type,
    (event) => {
      const trigger = triggerFrom(event);
      if (!trigger) {
        return;
      }
      requestWarm(trigger.getAttribute('href') ?? '');
    },
    { passive: true },
  );
}

/**
 * Shows that an activation was heard, after a delay.
 *
 * The delay is what keeps the affordance off the fast path: once prefetch lands most
 * activations resolve from cache long before it elapses, and a flash of pending state
 * on a cache hit is worse than no affordance at all.
 *
 * `aria-busy` is not decoration alongside the opacity change. Opacity signals through
 * appearance only, so without it the affordance does not exist for anyone using a
 * screen reader.
 */
function markPending(trigger: HTMLElement, delayMs: number, title: string): { clear(): void } {
  const timer = window.setTimeout(() => {
    trigger.dataset.paperTurnPending = 'true';
    trigger.setAttribute('aria-busy', 'true');
    // `aria-busy` on an already-focused trigger is a defer-presentation hint, not an
    // arrival announcement, so a screen-reader user may not hear it. The polite live
    // region carries the state as words, re-announced on each change. Set alongside the
    // opacity mark and on the same delayed timer, so a cache hit never populates it.
    app.pendingStatus.textContent = title ? `Loading ${title}` : 'Loading';
  }, delayMs);

  return {
    clear() {
      window.clearTimeout(timer);
      delete trigger.dataset.paperTurnPending;
      trigger.removeAttribute('aria-busy');
      app.pendingStatus.textContent = '';
    },
  };
}

/**
 * Resolves, and notes whether it took longer than the budget allows.
 *
 * The budget does not abandon the activation — it downgrades it. Resolution is still
 * awaited to completion; what changes is that the turn will take the existing
 * opacity/scale fallback instead of the paper turn, which is the right answer when
 * there was nothing to photograph in time.
 *
 * Scoped to resolution only. The capture-readiness wait has its own separate bound and
 * keeps proceeding in full motion, because a slow decode means the content is there but
 * not yet paintable — a different failure with a different remedy. Conflating them would
 * throw away the turn for a page whose images were merely slow.
 */
async function resolveWithinBudget(
  href: string,
): Promise<{ outcome: ResolveOutcome; exceededBudget: boolean }> {
  const resolution = resolver.resolve(href);
  let timer: number | undefined;

  const budgetElapsed = new Promise<'budget'>((settle) => {
    timer = window.setTimeout(() => settle('budget'), resolver.config.latencyBudgetMs);
  });

  try {
    // Both branches map to the same value: a rejection here would otherwise reject the
    // race *and* the `resolution` returned below, producing two unhandled rejections
    // from one fault. `resolve` reports failures as outcomes rather than throwing, so
    // this is belt-and-braces — but the cost of being wrong is noise in the console of
    // someone debugging something else.
    const winner = await Promise.race([
      resolution.then(
        () => 'resolved' as const,
        () => 'resolved' as const,
      ),
      budgetElapsed,
    ]);

    // Returned rather than written to `slowActivation` here, and that distinction is
    // the whole correctness argument. Requirement 6.4 asks for the fallback commit to
    // be *scoped to the activation that exceeded the budget*, and a module-level
    // boolean written at this moment cannot do that: a slow activation would set it,
    // then a second activation could supersede and reach `open()` while the first is
    // still in flight — inheriting a fallback it did not earn. Keeping the answer local
    // and applying it immediately before `open()` means the value the coordinator reads
    // always belongs to the activation actually opening.
    return { outcome: await resolution, exceededBudget: winner === 'budget' };
  } finally {
    window.clearTimeout(timer);
  }
}

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
  const title = trigger.querySelector('sp-card')?.getAttribute('heading') ?? '';

  // A newer click clears the previous tile's marker the moment it starts, rather than
  // waiting for the earlier `resolve()` to settle and report `superseded`. Without this
  // a slow or hung first request leaves its tile dimmed and `aria-busy` behind the
  // second tile.
  activePending?.clear();

  // Cleared on *every* route out of this function, including the ones where nothing
  // else visible happens. A tile left dimmed after an abandoned activation is a worse
  // defect than never having dimmed it, and supersession is the path easiest to forget
  // precisely because it is otherwise silent.
  const pending = markPending(trigger, resolver.config.pendingAffordanceDelayMs, title);
  activePending = pending;
  const { outcome, exceededBudget } = await resolveWithinBudget(href);
  pending.clear();
  // Only drop the shared reference if it is still ours: a later activation may have
  // already replaced it (and cleared this one) while we were awaiting resolution.
  if (activePending === pending) {
    activePending = null;
  }

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

  // Applied here, immediately before `open()`, so the value the coordinator reads
  // always belongs to the activation it is opening. Assigning unconditionally — rather
  // than only when true — is what stops an abandoned slow activation leaking its
  // fallback into the fast one that replaced it.
  slowActivation = exceededBudget;

  runCoordinatorAction(
    'open',
    coordinator.open({
      sourceId,
      grabAnchor,
      trigger,
    }).catch((error) => {
      // The body may have been the cause, so a retry must re-fetch rather than
      // re-serve it from the cache.
      resolver.invalidate(href);
      throw error;
    }),
  );
}

app.closeButton.addEventListener('click', () => {
  // On a close-setup failure the coordinator's recovery restores state to `open` — and
  // because it was already `open`, `setState` is a no-op that fires no `statechange`.
  // So the `idle` listener above never runs and `slowActivation` would survive into the
  // next turn, degrading a perfectly fast activation to the fallback. Clear it on the
  // failure path, keying the reset on the close attempt rather than on reaching `idle`.
  // `selectMotionMode` has already been consulted inside `close()` by this point, so the
  // open/close mode pairing this flag exists to preserve is unaffected.
  runCoordinatorAction(
    'close',
    coordinator.close().catch((error) => {
      slowActivation = false;
      throw error;
    }),
  );
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
