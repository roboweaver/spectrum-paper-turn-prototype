# Implementation Plan: Prefetch and the latency budget (Phase 2)

## Overview

The work lands in dependency order: the resolver's new surface first, because everything
else calls it; then the cache behind that surface; then the two consumers in the
activation path — prefetch triggers and the latency budget — and the affordance that the
budget's timing constrains; then the browser suites; then the documents.

**No new runtime or development dependency.** `fetch`, `DOMParser`, `navigator.connection`
and a `setTimeout` are the whole toolkit.

The transition subsystem gains no task. `geometry.ts`, `paper-turn-renderer.ts`,
`paper-shaders.ts`, `timeline.ts`, `fallback-transition.ts`, `motion-profile.ts`,
`grab-anchor.ts`, `capture.ts`, and **`transition-coordinator.ts`** are all untouched —
the fallback commit reaches the coordinator through the `selectMotionMode` it already has
injected. If a task appears to require editing one of them, the design has been misread.

One regression is the reason this plan exists and is worth naming up front: a `warm` that
takes the activation token supersedes a pending click, and the activation path treats a
superseded outcome as "do nothing at all". The click is swallowed with no error, no log,
and nothing visible but a tile that did not respond. Task 1.1 makes it impossible and
task 1.3 asserts it.

## Tasks

- [x] 1. Split warming from resolving
  - [x] 1.1 Add `warm(url)` to `src/content/content-resolver.ts`
    - Export `warm(url: string): void` on the `ContentResolver` interface, alongside the
      existing `resolve`
    - **Do not touch `currentActivation`.** That single line is the whole point of the
      task: `resolve` increments it, and a `warm` that did the same would supersede a
      pending click
    - Return `void`, not a promise, so no caller can await a speculative fetch or branch
      on its outcome
    - Swallow every outcome — non-OK response, transport failure, contract violation.
      A prefetch failure is not actionable, because the activation will make the same
      request and report properly
    - Reject an absent, empty, or cross-origin URL without issuing a request, reusing the
      existing `absoluteUrl` guard
    - Read no geometry, call no coordinator method, mutate no detail surface
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_

  - [x] 1.2 Reject a `resolve`-with-a-flag shape explicitly
    - Keep `resolve(url)` single-argument. No options object, no `prefetch` boolean
    - Record on the interface why: a flag switching off supersession, outcome reporting,
      and failure propagation is three behaviours behind one parameter, and leaves both
      modes returning `Promise<ResolveOutcome>` for a caller to confuse
    - _Requirements: 1.1_

  - [x] 1.3 Assert a warm cannot swallow an activation, in `tests/unit/content-resolver.test.ts`
    - **The load-bearing test.** Start an activation against a gated response, issue
      several warms for other URLs while it is pending, release the activation's
      response, and assert its outcome is `resolved` and **not** `superseded`
    - Assert the same with warms for the *same* URL as the pending activation
    - Assert activation-supersedes-activation still holds, so the fix did not disable the
      Phase 1 behaviour
    - Assert at most one non-superseded pending activation however many warms are in
      flight
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2. Give the resolver a cache
  - [x] 2.1 Add the cache fields to `src/content/resolver-config.ts`
    - Add `cacheMaxEntries` and `cacheMaxAgeMs` with documented defaults, and
      `latencyBudgetMs` and `pendingAffordanceDelayMs` while the file is open
    - Record that `pendingAffordanceDelayMs` must be less than `latencyBudgetMs`, or the
      fallback commit fires before the tile has acknowledged the click
    - Remove the comment block's claim that cache policy and the latency budget are
      deliberately absent — they arrive here
    - **Do not touch `MotionProfile`.** Keeping these out of it is what leaves the four
      suites that build it as a literal compiling unmodified
    - _Requirements: 4.3, 4.4, 6.1, 7.4, 8.5_

  - [x] 2.2 Implement the cache in `src/content/content-resolver.ts`
    - Store response **bodies** by absolute URL, not extracted fragments, so each
      consumer extracts its own independent `DocumentFragment`
    - Evict least-recently-used past `cacheMaxEntries`; treat an entry older than
      `cacheMaxAgeMs` as absent
    - Serve `resolve` from the cache without a request when a live entry exists
    - Keep the existing in-flight map and its single-flight behaviour intact; the cache
      sits in front of it, not instead of it
    - No `ETag`, no `Cache-Control`, no revalidation. The browser's cache under `fetch`
      owns those semantics and a second cache disagreeing with the first is worse than
      none
    - A `warm` for a URL already cached or already in flight must issue no additional
      request, which the cache lookup and the in-flight map give for free — and is what
      makes a repeated `pointerover` cheap
    - Not shared across documents, not persisted, not exposed on `window`
    - _Requirements: 1.5, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 10.8_

  - [x] 2.3 Drop a cache entry when its activation fails downstream
    - Expose a way for the Activation_Handler to invalidate one URL, and call it when an
      activation fails after resolution succeeded
    - The reasoning is that the body may have been the cause, so a retry must re-fetch
      rather than re-serve it
    - _Requirements: 4.5_

  - [x] 2.4 Add the `saveData` guard
    - Skip the network in `warm` when `navigator.connection.saveData` is `true`
    - Warm normally when the connection API, the `connection` object, or the property is
      absent — absence is not a signal to abstain
    - Consult nothing else. `effectiveType` is ambiguous for prefetch: a slow connection
      is where warming helps most *and* where a waste hurts most
    - Never let it affect `resolve`, which serves a click the user actually made
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.5 Unit-test the cache and the guard
    - Cache hit issues no request; miss issues one; a second sequential resolve of a
      cached URL still issues none, which is the behaviour Phase 1 deliberately lacked
    - LRU eviction past the entry cap, and an entry past the age cap treated as absent
    - A downstream failure drops the entry, and the next resolve re-fetches
    - Repeated `warm` calls for one URL issue a single request, whether the first is
      still in flight or already cached
    - `saveData` true skips the request; absent API warms normally; `resolve` is
      unaffected by `saveData`
    - _Requirements: 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 5.1, 5.2, 5.4_

- [x] 3. Checkpoint - the resolver is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Warm from the grid
  - [x] 4.1 Add the delegated prefetch listeners in `src/main.ts`
    - Attach `pointerover`, `focusin`, and `touchstart` to `app.cardGrid`, resolving the
      tile with `closest('[data-card-trigger]')` exactly as the click handler does
    - **Not `pointerenter`.** It does not bubble, so a delegated listener never sees it —
      verified in Chromium against the real page. Delegation is not optional here: the
      tile-count control re-renders the grid, so a listener bound to a trigger is
      discarded with it
    - Keep the handler cheap and idempotent, because `pointerover` fires repeatedly as
      the pointer moves within one tile
    - Never `preventDefault()`, and never interfere with the tile's native link behaviour
    - No `mousedown` trigger, and no viewport-visibility trigger
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 4.2 Interaction-test the triggers
    - Hover then click issues exactly **one** request for that URL
    - Focus then activate by keyboard likewise
    - Moving the pointer across one tile repeatedly issues one request, not many
    - Hovering a second tile during a pending activation does not swallow the first
      click — the same regression as task 1.3, asserted in a real browser
    - _Requirements: 3.1, 3.2, 3.4, 2.1_

- [x] 5. Add the latency budget
  - [x] 5.1 Bound the resolution wait in `src/main.ts`
    - Race resolution against `latencyBudgetMs`; when the budget elapses first, mark this
      activation as having to take the fallback, and continue waiting for resolution
      rather than abandoning it
    - Scope the mark to the activation and clear it on settle, or one slow page degrades
      every later turn in the session
    - Cover resolution only. The capture-readiness wait keeps its own separate bound and
      keeps proceeding to capture in full motion, because a slow decode means the content
      is there but not yet paintable — a different failure with a different remedy
    - _Requirements: 6.1, 6.2, 6.4, 7.1, 7.2, 7.3_

  - [x] 5.2 Let the budget reach the coordinator through `selectMotionMode`
    - Extend the injected `selectMotionMode` in `main.ts` to return `fallback` when the
      current activation was marked slow, alongside the existing `?fallback=` and
      `browserMotionMode()` conditions
    - **This is the whole integration.** `runFallbackTo`, the `fallback` motion mode, and
      `transition-coordinator.ts` are untouched
    - Do not override a `fallback` that reduced motion, absent WebGL, or `?fallback=`
      would already have produced
    - _Requirements: 6.3, 6.5, 9.1, 9.3_

  - [x] 5.3 Unit-test the budget
    - The budget elapsing marks the activation and the selector then returns `fallback`
    - The mark clears on settle, so the next activation is not degraded
    - A resolution inside the budget leaves the selector's answer unchanged
    - An already-`fallback` selector answer is not altered by the budget
    - A warm activation never reaches the budget
    - _Requirements: 6.2, 6.4, 6.5, 6.6_

- [x] 6. Add the pending affordance
  - [x] 6.1 Mark the trigger after the delay, in `src/main.ts`
    - After `pendingAffordanceDelayMs`, set `data-paper-turn-pending="true"` and
      `aria-busy="true"` on the activated trigger
    - Clear both on **every** exit from pending: settling open, falling through to
      navigation, and being superseded. A tile left dimmed after an abandoned activation
      is a worse defect than never having dimmed it, and supersession is the path easiest
      to forget because nothing else visible happens on it
    - A warm activation must never reach the delay
    - _Requirements: 8.1, 8.6, 8.7_

  - [x] 6.2 Add the affordance styling to `src/styles.css`
    - Reduce the card's opacity for a pending trigger, with a short `ease-out` transition
    - Change **no** layout property — not size, position, margin, padding, or border
      width. Every visual baseline contains the grid, so a layout change moves six frames
      on two platforms
    - Draw nothing: no pseudo-element, no animation, no second focal point. The chosen
      option is the dim precisely because the affordance is the exception path once
      prefetch lands, and the exception path should be the quietest thing that works
    - Retain the transition under `prefers-reduced-motion`; a fade is not motion in the
      sense that preference addresses. Record that as a decision so it is not "fixed"
      later
    - _Requirements: 8.2, 8.3, 8.8_

  - [x] 6.3 Test the affordance
    - Unit: the delay is shorter than the budget by construction, and the attributes are
      set and cleared on each of the three exits
    - Interaction: a cold activation shows the affordance and carries `aria-busy`; a warm
      one never does; a superseded activation leaves no tile marked
    - Interaction: the tile's bounding box is identical marked and unmarked, which is the
      assertion that protects the reference images
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 7. Checkpoint - the feature works end to end
  - Ensure all tests pass, ask the user if questions arise. Run `npm run test:visual`
    here specifically: task 6.2 is the only change in this phase that touches a rendered
    pixel, so this is the point at which a baseline could have moved.

- [x] 8. Document and verify
  - [x] 8.1 Update `docs/architecture.md` and `README.md`
    - Record the warm/resolve split and why it is two verbs rather than a flag
    - Record the prefetch triggers, and that `pointerenter` cannot be used because it
      does not bubble past a delegated listener
    - Record the cache's bounds and that it deliberately implements no HTTP cache
      semantics
    - Record that the latency budget reaches the fallback through the injected
      `selectMotionMode` and changes no coordinator code
    - Record the affordance, its `aria-busy` pairing, and that `saveData` support is
      best-effort and Chromium-only
    - _Requirements: 5.5_

  - [x] 8.2 Verify the Phase 2 boundary
    - Grep to confirm no `pushState`, no `replaceState`, no `popstate`, no navigation on
      settle, no router, no `iframe`, no init contract, no top-layer surface, and no
      generalised token inlining
    - Confirm by `git diff` that the nine preserved modules are untouched, the
      `MotionProfile` shape is unchanged, and the coordinator's state set is still the
      same five values
    - Confirm the lockfile is unchanged and no dependency was added
    - Confirm the cache is not persisted, not shared across documents, and not on
      `window`
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 8.3 Run every gate
    - `npm run lint`, `npm run typecheck`, `npm run build`, the unit suite, the
      interaction suite on all three projects, and the visual suite
    - The existing tests must pass unmodified, the sole permitted exception being a test
      asserting a request count that prefetching legitimately changes — and any such edit
      must be called out rather than absorbed
    - The visual suite must pass against its existing twelve images with none regenerated
    - The fragment contract must be unchanged, so a page turnable under Phase 1 is still
      turnable
    - Clean up any scratch files
    - _Requirements: 9.4, 9.6, 9.7, 9.8_

## Notes

- **`transition-coordinator.ts` has no task.** Phase 1 established that discipline and
  this phase keeps it: the fallback commit reaches the coordinator through an injected
  function it already calls. Task 8.2 verifies it by `git diff`.
- Task 1.1 is the smallest and most important change in the phase. The single line it must
  *not* write — incrementing the activation token — is the whole difference between a
  prefetch and a swallowed click.
- Tasks 5 and 6 are ordered together because the affordance delay must be shorter than the
  budget. Building the affordance first risks picking a delay that makes the budget
  unreachable.
- Task 6.2 is the only change in this phase that touches a rendered pixel. That is why
  checkpoint 7 runs the visual suite and why 6.2 forbids layout properties explicitly.
- The `pointerenter` constraint is verified, not assumed: a delegated listener on the grid
  sees `pointerover` and `focusin` and never `pointerenter`.
- Prefetch hit rate is worth observing after this ships. If the hovered tile is usually
  not the clicked tile, the mechanism is spending requests for nothing and wants
  reconsidering rather than tuning.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.3", "2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["2.5"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2", "5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["5.3", "6.1"] },
    { "id": 9, "tasks": ["6.2"] },
    { "id": 10, "tasks": ["6.3"] },
    { "id": 11, "tasks": ["8.1"] },
    { "id": 12, "tasks": ["8.2", "8.3"] }
  ]
}
```
