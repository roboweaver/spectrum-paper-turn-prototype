/**
 * Tunables for content resolution.
 *
 * Deliberately **not** fields on `MotionProfile`. The latency budget argued for
 * living there — it is a timing, and designers tune timings — but `MotionProfile`
 * is constructed as a literal by four test suites and `docs/architecture.md`
 * records that widening it is a deliberate cost. Keeping resolution's tunables
 * separate leaves this feature's blast radius off the motion contract entirely,
 * and the two objects have different owners in practice: a designer tunes motion,
 * an engineer tunes network behaviour.
 */
export interface ResolverConfig {
  /**
   * How long to wait for fonts to load and images to decode after adopting a
   * fragment, before capturing anyway.
   *
   * A bound rather than an open wait, because this sits on the click-to-animate
   * path: the fragment is already in the DOM and the sheet has not moved yet, so
   * every millisecond here is a millisecond the click feels unacknowledged. When
   * it elapses the capture proceeds regardless, which costs the fidelity of one
   * texture rather than the whole activation.
   *
   * 500 ms is the starting value. Long enough for a decoded local image or a
   * cached webfont, short enough that a hung third-party asset does not read as a
   * dead click. Tune it against real pages rather than by reasoning.
   *
   * Deliberately **not** covered by `latencyBudgetMs`: a slow decode means the
   * content is there but not yet paintable, which is a different failure from the
   * content not having arrived, and it is right to proceed to capture rather than
   * degrade the whole turn.
   */
  readonly captureReadinessTimeoutMs: number;

  /**
   * How long an activation waits for *resolution* before giving up on the full
   * turn and committing to the fallback transition.
   *
   * Covers the network only. When it elapses the activation still completes — it
   * simply takes the opacity/scale path instead of the paper turn, which is the
   * right answer when there is nothing yet to photograph.
   *
   * ~120 ms is inherited from the design as a starting point and has **never been
   * measured**. The mechanism is what the requirements assert; this number is a
   * tunable awaiting a throttled-connection test against a real host. It may well
   * want to differ between pointer and touch.
   */
  readonly latencyBudgetMs: number;

  /**
   * The hard ceiling on a single `fetch`, after which the request is aborted.
   *
   * Distinct from `latencyBudgetMs`, which only governs whether the *turn*
   * downgrades to the fallback — a hung request has to be terminated regardless of
   * which activation happens to be waiting on it, or the tile's single-flight entry
   * never settles and the URL is poisoned for the life of the page. The abort
   * surfaces as a `request-failed` outcome, so the activation falls through to a
   * real navigation rather than hanging.
   *
   * 8000 ms is a starting value and, like `latencyBudgetMs`, has **not been
   * measured**: long enough that a slow-but-real response still lands, short enough
   * that a dead socket does not pin the tile open for the whole session. Tune it
   * against a real host rather than by reasoning.
   */
  readonly requestTimeoutMs: number;

  /**
   * How long an activation may be pending before the tile shows it was heard.
   *
   * **Must be shorter than `latencyBudgetMs`.** Otherwise the fallback commit
   * fires before the tile has acknowledged the click, which is the worst of both:
   * a degraded transition *and* a dead-feeling press. `validateResolverConfig`
   * enforces it.
   *
   * Once prefetch lands most activations are cache hits that never reach this at
   * all, so the affordance is the exception path.
   */
  readonly pendingAffordanceDelayMs: number;

  /**
   * How many response bodies the cache may hold, evicting least-recently-used.
   *
   * Entries rather than bytes: byte accounting for strings is unreliable across
   * engines, and entry count is what actually protects a long-lived page from
   * unbounded growth. `MAX_TILE_COUNT` is 16, so the demo's whole reachable set
   * fits — the bound exists for hosts with far more destinations.
   */
  readonly cacheMaxEntries: number;

  /**
   * How old a cached body may be before it is treated as absent.
   *
   * A detail page is not immutable, and a page left open for hours turning over to
   * show yesterday's content is a correctness problem rather than a freshness
   * nicety. This bounds *our* staleness only; it is not an attempt to reimplement
   * HTTP caching, which the browser already does beneath `fetch`.
   */
  readonly cacheMaxAgeMs: number;

  /**
   * How long a pointer must dwell on a tile before `pointerover` warms it.
   *
   * Hover intent, so that sweeping the pointer across the grid to reach something
   * else does not fire one warm per tile passed through. Only `pointerover` is
   * debounced; `focusin` and `touchstart` warm immediately, because keyboard focus
   * and touch are deliberate intent rather than an incidental sweep.
   *
   * ~65 ms is a starting value and has **not been measured** — short enough to feel
   * instant on a genuine hover, long enough to skip a tile the pointer only crosses.
   * Tune it against a real grid rather than by reasoning.
   */
  readonly warmHoverIntentMs: number;

  /**
   * How many warm requests may be in flight at once.
   *
   * A sweep across a large grid could otherwise issue one concurrent request per
   * tile, competing with the navigation the user actually wants on a metered or slow
   * connection. The resolver already de-dupes cached and in-flight URLs, so this cap
   * only gates genuinely new warms.
   *
   * ~4 is a starting value and has **not been measured**. Tune it against a real host
   * with more destinations than the demo's sixteen.
   */
  readonly maxConcurrentWarms: number;
}

export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = Object.freeze({
  captureReadinessTimeoutMs: 500,
  latencyBudgetMs: 120,
  requestTimeoutMs: 8000,
  pendingAffordanceDelayMs: 100,
  cacheMaxEntries: 32,
  cacheMaxAgeMs: 5 * 60 * 1000,
  warmHoverIntentMs: 65,
  maxConcurrentWarms: 4,
});

/**
 * Throws when a config could not behave as specified.
 *
 * Only one relationship is load-bearing enough to check: the affordance delay must
 * be under the latency budget. Getting those two the wrong way round produces a
 * subtle, plausible-looking bug — every slow activation silently degrades to the
 * fallback while the tile never acknowledges the press — so it fails loudly here
 * instead.
 */
export function validateResolverConfig(config: ResolverConfig): void {
  const positive: Array<keyof ResolverConfig> = [
    'captureReadinessTimeoutMs',
    'latencyBudgetMs',
    'requestTimeoutMs',
    'pendingAffordanceDelayMs',
    'cacheMaxEntries',
    'cacheMaxAgeMs',
    'warmHoverIntentMs',
    'maxConcurrentWarms',
  ];

  for (const field of positive) {
    const value = config[field];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`ResolverConfig.${field} must be a finite number greater than 0, got ${value}`);
    }
  }

  if (!Number.isInteger(config.cacheMaxEntries)) {
    throw new Error(
      `ResolverConfig.cacheMaxEntries must be an integer, got ${config.cacheMaxEntries}`,
    );
  }

  if (!Number.isInteger(config.maxConcurrentWarms)) {
    throw new Error(
      `ResolverConfig.maxConcurrentWarms must be an integer, got ${config.maxConcurrentWarms}`,
    );
  }

  if (config.pendingAffordanceDelayMs >= config.latencyBudgetMs) {
    throw new Error(
      `ResolverConfig.pendingAffordanceDelayMs (${config.pendingAffordanceDelayMs}) must be less than latencyBudgetMs (${config.latencyBudgetMs}), or the fallback commit fires before the tile acknowledges the click`,
    );
  }
}

/*
 * Still deliberately absent, and absence is the point:
 *
 * - Abort on supersession. By design, not omission. Cancelling a pending
 *   resolution means "do not call open()" — there is no in-flight transition to
 *   unwind, and aborting a request a second activation may have joined would break
 *   single-flight for no benefit. A request *lifetime* bound (`requestTimeoutMs`)
 *   is a different mechanism and does exist: it terminates a hung request so its
 *   single-flight entry settles, independently of whether anything superseded it.
 * - HTTP cache semantics. No ETag, no Cache-Control parsing, no revalidation. The
 *   browser's own cache sits under `fetch` and honours whatever the host sends; a
 *   second cache disagreeing with the first is worse than none.
 * - Per-route cache age. A global cap ships. A dashboard going stale in seconds is
 *   a real need and a Phase 5 one; the choice does not affect the mechanism.
 * - Connection signals other than `saveData`. `effectiveType` is ambiguous for
 *   prefetching: a slow connection is where warming helps most *and* where a
 *   wasted request hurts most.
 */
