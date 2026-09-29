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
}

export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = Object.freeze({
  captureReadinessTimeoutMs: 500,
  latencyBudgetMs: 120,
  pendingAffordanceDelayMs: 100,
  cacheMaxEntries: 32,
  cacheMaxAgeMs: 5 * 60 * 1000,
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
    'pendingAffordanceDelayMs',
    'cacheMaxEntries',
    'cacheMaxAgeMs',
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
 *   single-flight for no benefit.
 * - HTTP cache semantics. No ETag, no Cache-Control parsing, no revalidation. The
 *   browser's own cache sits under `fetch` and honours whatever the host sends; a
 *   second cache disagreeing with the first is worse than none.
 * - Per-route cache age. A global cap ships. A dashboard going stale in seconds is
 *   a real need and a Phase 5 one; the choice does not affect the mechanism.
 * - Connection signals other than `saveData`. `effectiveType` is ambiguous for
 *   prefetching: a slow connection is where warming helps most *and* where a
 *   wasted request hurts most.
 */
