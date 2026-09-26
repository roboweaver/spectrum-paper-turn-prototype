# Design Document: Prefetch and the latency budget

**Status:** Proposed — not yet approved. `requirements.md` and `tasks.md` are derived
from this document once it is, per the repo's design-first workflow.

**Branch:** `phase-2-prefetch-and-latency`

**This is Phase 2 of the six-phase plan** in
[`../url-addressable-detail-content/design.md`](../url-addressable-detail-content/design.md).
Phase 1 is merged: content resolves from a same-origin URL ahead of
`coordinator.open()`, the fragment contract is documented, tiles are real anchors, and
every failure falls through to ordinary navigation. Nothing in Phase 1 is revisited
here.

---

## Introduction

Phase 1 made the turn *correct*. It did not make it feel like navigation.

Click-to-animate was a couple of frames before Phase 1. It is now a fetch, and no
amount of shader work hides a 400 ms stall before the sheet moves. On a fast local
network the delay is invisible; on a real one the tile is pressed and nothing happens,
which reads as a dead click rather than as loading. That is the whole problem Phase 2
addresses, and the fix is mostly not about speed — it is about the wait being either
already over or visibly acknowledged.

Three mechanisms, in descending order of how much they actually help:

1. **Speculative prefetch.** On desktop the hovered tile is nearly always the
   activated tile, so warming the cache on hover turns the common case into a
   synchronous resolve and returns click-to-animate to its pre-Phase-1 latency.
2. **A latency budget with a fallback commit.** When the fragment is not ready in
   time, stop waiting for the full turn and take the existing opacity/scale fallback
   instead of stalling.
3. **A pending affordance on the tile.** Past roughly 100 ms the tile has to show it
   was heard.

The first is doing most of the work. The other two exist for when it misses.

---

## The central problem: prefetch must not supersede an activation

This is the one thing that makes Phase 2 more than a cache, and it is a property of
the code as it stands rather than a hypothetical.

`ContentResolver.resolve()` opens with:

```ts
async function resolve(url: string): Promise<ResolveOutcome> {
  currentActivation += 1;
  const activation = currentActivation;
```

Every call takes the activation token. That is exactly right for activations — a
second click must supersede the first — and catastrophic for prefetch. A hover over
tile B while tile A's click is still resolving would silently supersede A, and A
would return `{ kind: 'superseded' }`. Phase 1's activation path treats that as "do
nothing at all", so **the click would be swallowed**: no turn, no navigation, no
error. Moving the pointer is enough to lose a click.

**Verified, not reasoned.** Against the merged resolver: start `resolve('clicked')`,
then `resolve('hovered')` as a naive prefetch would, then let the click's response
arrive. The click's outcome is `superseded`. So this is the behaviour today, not a
risk to watch for.

So prefetching cannot be "call `resolve()` earlier". The resolver needs two distinct
verbs.

### Chosen: split warming from resolving

```ts
interface ContentResolver {
  /** Warms the cache. Never takes the activation token, never reports an outcome. */
  warm(url: string): void;
  /** Resolves one activation. Supersedes any pending activation, as today. */
  resolve(url: string): Promise<ResolveOutcome>;
  readonly config: ResolverConfig;
}
```

`warm` is fire-and-forget by design, not by laziness. It returns `void` rather than a
promise, because there is no caller who should be waiting on a speculative fetch and
a returned promise invites exactly that. It swallows every failure: a prefetch that
404s tells us nothing actionable, because the activation will make the same request
and report properly. And it never touches `currentActivation`.

`resolve` keeps its current contract exactly, gaining only a cache lookup before the
network. An activation for a warmed URL resolves synchronously in the sense that
matters — no request is issued — though it still returns a promise, so the activation
path is unchanged.

### Rejected: a `prefetch` flag on `resolve`

`resolve(url, { prefetch: true })` is fewer lines and worse. A boolean parameter that
switches off supersession, switches off outcome reporting, and switches off failure
propagation is three behaviours hiding behind one flag, and the type system stops
helping: the return value is `Promise<ResolveOutcome>` in both cases, so a caller can
forget which mode they are in and act on a prefetch's outcome. Two names with two
signatures make the mistake unrepresentable.

---

## The cache

Phase 1 deliberately holds no cross-activation cache — Requirement 13.3 asserts its
absence, and `content-resolver.ts` says so where the in-flight map is defined. Phase 2
adds one.

### What is cached

The **response text**, not the extracted fragment, continuing what single-flight
already does and for the same reason: `extractFragment` must run per consumer so each
gets an independent `DocumentFragment`. Caching the fragment would hand two
activations one mutable DOM subtree. The extra parse is a fraction of a millisecond
against a network round trip.

### Bounds

`MAX_TILE_COUNT` is 16 (`tile-grid.ts:15`), so the reachable URL set in the demo is
sixteen small HTML documents. A bound is still specified rather than omitted, because
the component is meant for hosts with far more destinations:

- **Entry cap**, evicting least-recently-used. A cap on entries rather than bytes:
  byte accounting for strings is unreliable across engines, and entry count is what
  actually protects against unbounded growth on a long-lived page.
- **Age cap**, so a page open for hours does not turn over showing yesterday's
  content. A detail page is not immutable; the reverse face claiming otherwise is a
  correctness problem, not a freshness nicety.

Both belong in `ResolverConfig`, which already has a comment block naming cache
policy as the Phase 2 field it expects to gain.

### Invalidation

Deliberately minimal. No `ETag`, no `Cache-Control` parsing, no revalidation. The
browser's own HTTP cache already sits under `fetch` and honours whatever the host
sends; duplicating that in application code would be a second cache disagreeing with
the first. The age cap exists to bound *our* staleness, not to reimplement caching.

One exception worth specifying: a **cache entry must be dropped when its activation
fails downstream of resolution**. If a fragment resolves and then the capture fails,
retrying should re-fetch rather than re-serve a body that may have been the problem.

---

## Prefetch triggers, and the one that cannot be delegated

The Phase 1 design named `pointerenter`, `focusin`, and `touchstart`. One of those is
wrong, and the reason matters.

**`pointerenter` does not bubble.** Neither does `pointerleave`. The grid's listeners
must be delegated — `main.ts:105` says why, and it is not stylistic: the tile-count
control re-renders the grid, so a listener bound to a trigger is discarded with it.
A delegated `pointerenter` would never fire. The trigger is **`pointerover`**, which
does bubble, with the handler reading `event.target.closest('[data-card-trigger]')`
exactly as the click handler does.

Verified in Chromium against the real page rather than taken from the spec: with
listeners for all four candidates attached to the grid and events dispatched on a
tile, the delegated listener saw `pointerover` and `focusin` and never
`pointerenter`.

`pointerover` fires repeatedly as the pointer moves within a tile, so the handler must
be cheap and idempotent. It is: `warm` on an already-warmed or in-flight URL is a map
lookup and a return.

| Trigger | Bubbles | Why |
| --- | --- | --- |
| `pointerover` | Yes | Desktop hover. The hovered tile is nearly always the activated one. |
| `focusin` | Yes | Keyboard traversal, so tabbing to a tile warms it too. |
| `touchstart` | Yes | Touch, where there is no hover and the gap between touch and click is small but real. |

`touchstart` is the weakest of the three — perhaps 100 ms of warning — but it is free
and it is the only signal touch offers.

### What not to do

**No viewport prefetching.** Warming every tile as it scrolls into view would fetch
sixteen pages to use one, and on a real host with a hundred destinations it is a
self-inflicted load test. Hover is a strong signal; visibility is not.

**No prefetch on `mousedown`.** It sounds like a free 50 ms, but it fires for
click-and-drag, text selection, and middle-click, none of which are activations.

---

## The latency budget

When a fragment is not ready in time, the turn should degrade rather than stall. The
degradation target already exists, is already tested, and needs no new machinery.

### It needs no coordinator change

`selectMotionMode` is an injected dependency (`types.ts:141`) called inside `open()`
at `transition-coordinator.ts:121`, and `main.ts:77` currently supplies:

```ts
selectMotionMode: () => (searchParams.has('fallback') ? 'fallback' : browserMotionMode()),
```

So the budget is expressible entirely in the activation path: when resolution exceeds
the budget, set a flag that this injected function also consults, and the coordinator
takes the fallback path it already has. `runFallbackTo` and the `fallback` motion mode
are untouched. This is the same discipline as Phase 1 — the transition subsystem gains
no task.

The flag must be per-activation and cleared on settle, or one slow page would
permanently degrade the session.

### Which wait the budget covers

The budget starts at activation and covers **resolution only**, not capture
readiness. Those are different failures with different remedies: a slow *fetch* means
the content is not there yet, where the fallback is the right answer because there is
nothing to photograph. A slow *decode* means the content is there but not yet
paintable, and Phase 1 already bounds that separately with
`captureReadinessTimeoutMs`, proceeding to capture rather than degrading. Conflating
them would take the fallback for a page whose images were merely slow, losing the turn
for no reason.

### The value

~120 ms is the Phase 1 design's suggested starting point and is a reasonable default,
but it should be treated as unvalidated. It wants measuring against a real host on a
throttled connection, not reasoning about. It goes in `ResolverConfig`, not
`MotionProfile` — settled in Phase 1 and not reopened here.

---

## The pending affordance

Past roughly 100 ms the activated tile needs to show it was heard.

**Scoped to the tile, not the page.** Nothing is frozen or inert at this point —
Phase 1's Requirement 1.4 asserts the list stays scrollable and un-inert while
resolution is pending — so a page-level spinner would contradict the state the page
is actually in. The other tiles are still usable and should still look it.

**It must not move layout.** Every visual baseline contains the grid, and the
`paper-turn-start` frame is grid-only. An affordance that changes a tile's size or
position moves every frame. A colour, opacity, or `::after` overlay change inside the
existing tile bounds does not.

**It must not appear on the fast path.** A flash of pending state on a cache hit is
worse than no affordance, because it draws the eye to something already finished. It
appears only after a delay, and a warmed activation must never reach that delay.

This is the piece most likely to need design iteration rather than engineering, and
the first place to accept a smaller answer: a subtle `aria-busy` plus an opacity shift
is defensible, and a spinner inside a tile probably is not.

---

## What this buys, measured

Worth stating how success is judged, because "feels native" is not testable:

- **Cache hit rate on desktop hover**, which is the mechanism's whole premise. If the
  hovered tile is not usually the clicked tile, prefetch is a waste of requests and
  should be reconsidered rather than tuned.
- **Click-to-animate on a warm activation**, which should return to the pre-Phase-1
  couple of frames.
- **Requests issued per activation**, which should stay at or below one. Above one
  means prefetch is fetching pages nobody opens.

The third is the one that catches a prefetch strategy that is too eager, and it is
cheap to assert in an interaction test.

---

## Test strategy

The existing layering holds.

| Layer | Adds |
| --- | --- |
| Unit | `warm` does not take the activation token — the load-bearing test. Cache hit, miss, LRU eviction, age expiry, entry drop after a downstream failure. Budget elapsing sets the fallback flag; the flag clears on settle. |
| Interaction | Hover then click issues **one** request. Hover over a second tile during a pending activation does not swallow the first click. A slow resolve takes the fallback transition and still opens. The pending affordance appears on a cold activation and never on a warm one. |
| Visual | **No new baselines.** The pending affordance must not move layout, which is what makes that achievable. |

The regression this suite exists to prevent is the one named at the top: a prefetch
superseding a live activation and swallowing a click. It should be asserted directly
in both layers, because it is silent — no error, no log, nothing but a tile that did
not respond.

---

## What this design does not do

- **No navigation on settle, no `pushState`, no `popstate`.** Phase 3.
- **No change to the fragment contract.** A page that was turnable in Phase 1 is
  turnable here, unchanged.
- **No change to the coordinator, the geometry, the renderer, the timeline, or the
  fallback.** The budget reaches the fallback through the existing injected
  `selectMotionMode`.
- **No change to `MotionProfile`.** Settled in Phase 1.
- **No HTTP cache semantics.** No `ETag`, no revalidation, no `Cache-Control`
  parsing. The browser already does this beneath `fetch`.
- **No viewport or eager prefetching.** Hover, focus, and touch only.
- **No new dependency.**
- **No component packaging.** Phase 4.

---

## Open questions

1. **Is the ~120 ms budget right?** It is inherited as a suggestion and has never been
   measured. It needs a throttled-connection test against a real host, and the answer
   may well be that it should differ between pointer and touch.
2. **What should the pending affordance actually look like?** The constraints above
   rule out a lot — no layout movement, nothing on the fast path — but do not pick
   one. This is a design question, not an engineering one.
3. **Should `warm` be disabled under a data-saving or metered-connection signal?**
   `navigator.connection.saveData` exists and is unevenly supported. Prefetching
   sixteen pages to use one is defensible on a desktop and rude on a metered phone.
4. **Does the age cap need to be per-route rather than global?** A dashboard page goes
   stale in seconds; an article does not. A single global cap is simpler and may be
   wrong for the OmnisTools case in Phase 5.
