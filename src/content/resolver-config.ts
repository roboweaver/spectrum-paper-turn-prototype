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
   */
  readonly captureReadinessTimeoutMs: number;
}

export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = Object.freeze({
  captureReadinessTimeoutMs: 500,
});

/*
 * What is deliberately absent from ResolverConfig in Phase 1, and why absence is
 * the point rather than an oversight:
 *
 * - Latency budget and fallback commit. Phase 2. Committing to the fallback
 *   transition when a fragment is slow needs the prefetch cache to exist first, or
 *   every cold click takes the degraded path.
 * - Cache policy. Phase 2. Phase 1 holds no cross-activation fragment cache at
 *   all, so there is no eviction, no staleness window, and nothing to configure.
 * - Abort on supersession. By design, not omission. The design's position is that
 *   cancelling a pending resolution means "do not call open()" — there is no
 *   in-flight transition to unwind, and aborting a request that a second
 *   activation may have joined would break single-flight for no benefit.
 */
