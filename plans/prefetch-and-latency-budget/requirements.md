# Requirements Document

## Introduction

Phase 1 made the turn correct. It did not make it feel like navigation.
Click-to-animate was a couple of frames before Phase 1 and is now a fetch, so on a real
connection the tile is pressed and nothing happens — which reads as a dead click rather
than as loading.

Phase 2 addresses that with three mechanisms, in descending order of how much they
help: **speculative prefetch** on hover, focus, and touch, which turns the common case
into a cache hit; a **latency budget** that commits to the existing fallback transition
rather than stalling; and a **pending affordance** on the activated tile for the waits
that remain.

The one piece of genuinely new machinery is the separation of warming from resolving.
`ContentResolver.resolve()` takes the activation token on every call, which is correct
for activations and catastrophic for prefetch — a hover during a pending click would
supersede that click, and the activation path treats a superseded outcome as "do nothing
at all", so the click would be silently swallowed. Requirement 1 exists to make that
impossible, and Requirement 2 to keep it impossible.

These requirements are derived from the approved design document
[`design.md`](./design.md) and are traceable to its sections. They restate what the
system shall do; the design remains authoritative for how.

---

## Glossary

- **Warming**: fetching a URL speculatively into the cache, with no activation attached
  and no outcome reported to anyone.
- **Activation**: a primary, unmodified click on a tile, intended to open the detail
  surface with the full turn.
- **Cold activation**: an activation whose URL is not in the cache, so it waits for the
  network.
- **Warm activation**: an activation whose URL is in the cache, so it issues no request.
- **The activation token**: the counter inside `ContentResolver` that identifies which
  activation is entitled to act on a result. Taking it supersedes any pending
  activation.
- **Latency budget**: the bound on how long an activation waits for *resolution* before
  giving up on the full turn and committing to the fallback transition.
- **Fallback commit**: the outcome in which an activation proceeds with the existing
  `fallback` motion mode rather than the full turn, because the budget elapsed.
- **Pending affordance**: the visual and assistive-technology signal on an activated tile
  that its resolution is still in flight.
- **Content_Resolver**: `content-resolver.ts`, owning `warm`, `resolve`, the
  single-flight guard, supersession, and the cache.
- **Fragment_Cache**: the cache inside `Content_Resolver` holding response bodies by
  absolute URL.
- **Resolver_Config**: `resolver-config.ts`, owning resolution's tunables. Not
  `MotionProfile`.
- **Prefetch_Listener**: the delegated listeners on the tile grid that call
  `Content_Resolver.warm`.
- **Activation_Handler**: the delegated click path in `main.ts` that guards the click,
  resolves, adopts, awaits capture readiness, and opens.
- **Motion_Mode_Selector**: the `selectMotionMode` function injected into
  `TransitionCoordinator`, supplied by `main.ts`.
- **Transition_View**: the view object returned by `createDemoApp` in `app.ts`.
- **Transition_Coordinator**: `transition-coordinator.ts`, owning the state machine.
- **Tile_Factory**: `createCardItem` in `app.ts`, which builds one grid tile.
- **Build_Configuration**: the project manifest and lockfile.
- **Unit_Test_Suite**: the Vitest suites under `tests/unit`.
- **Interaction_Test_Suite**: `tests/e2e/interaction.spec.ts`.
- **Visual_Regression_Suite**: `tests/e2e/visual.spec.ts` and its twelve committed
  reference images.

---

## Requirements

### Requirement 1: Warming is a different verb from resolving

**User Story:** As a developer, I want prefetching to be impossible to confuse with
activating, so that a speculative fetch cannot take over a real one.

*Derived from: design — The central problem: prefetch must not supersede an activation.*

#### Acceptance Criteria

1. THE Content_Resolver SHALL expose `warm(url)` as a distinct method from
   `resolve(url)`, and SHALL NOT expose a parameter, flag, or option on `resolve` that
   changes it into a warming call.
2. THE Content_Resolver SHALL NOT modify the activation token when `warm` is called, so
   that warming while an activation is pending leaves that activation entitled to act on
   its own result.
3. THE `warm` method SHALL return `void` rather than a promise, so that no caller can
   await a speculative fetch or branch on its outcome.
4. THE `warm` method SHALL report no outcome: it SHALL NOT throw, SHALL NOT reject, and
   SHALL NOT surface a non-OK response, a transport failure, or a fragment-contract
   violation to its caller.
5. WHEN `warm` is called for a URL that is already cached or already in flight, THE
   Content_Resolver SHALL perform no additional network request.
6. WHEN `warm` is called for a URL that is absent, empty, or not same-origin, THE
   Content_Resolver SHALL issue no request and SHALL report nothing.
7. THE `warm` method SHALL read no tile geometry, SHALL call no Transition_Coordinator
   method, and SHALL NOT mutate the detail surface.

### Requirement 2: A warm can never swallow an activation

**User Story:** As a user, I want moving the pointer during a slow load to be harmless,
so that a click I already made still opens the page I clicked.

*Derived from: design — The central problem; What this buys, measured.*

#### Acceptance Criteria

1. WHILE an activation's resolution is pending, WHEN any number of `warm` calls are made
   for any URLs, THE Content_Resolver SHALL still report that activation's own outcome to
   the Activation_Handler, and SHALL NOT report it as superseded.
2. THE Content_Resolver SHALL continue to supersede an earlier **activation** when a
   later activation begins, as established in Phase 1.
3. THE Content_Resolver SHALL admit at most one non-superseded pending activation at any
   time, regardless of how many warms are in flight.
4. THE Unit_Test_Suite SHALL assert criterion 1 directly, the regression being silent —
   a swallowed click produces no error, no log, and no visible change beyond a tile that
   did not respond.

### Requirement 3: Prefetch triggers

**User Story:** As a user, I want the page I am about to open to already be loading, so
that the turn starts when I click rather than after a wait.

*Derived from: design — Prefetch triggers, and the one that cannot be delegated.*

#### Acceptance Criteria

1. THE Prefetch_Listener SHALL warm a tile's URL on `pointerover`, on `focusin`, and on
   `touchstart`.
2. THE Prefetch_Listener SHALL be attached to the tile grid and SHALL identify the tile
   by `closest('[data-card-trigger]')`, rather than being bound to individual triggers,
   because the tile-count control re-renders the grid and discards any listener bound to
   a trigger.
3. THE Prefetch_Listener SHALL NOT use `pointerenter` or `pointerleave`, which do not
   bubble and therefore never reach a delegated listener.
4. THE Prefetch_Listener SHALL be idempotent and cheap, performing at most a cache
   lookup and returning, because `pointerover` fires repeatedly as the pointer moves
   within one tile.
5. THE Prefetch_Listener SHALL NOT warm on `mousedown`, which also fires for
   click-and-drag, text selection, and non-primary buttons.
6. THE Prefetch_Listener SHALL NOT warm tiles on the basis of their visibility in the
   viewport.
7. THE Prefetch_Listener SHALL NOT call `preventDefault()` and SHALL NOT interfere with
   the tile's native link behaviour.

### Requirement 4: The fragment cache

**User Story:** As a developer, I want a bounded cache that cannot serve stale content
or grow without limit, so that a long-lived page stays correct.

*Derived from: design — The cache.*

#### Acceptance Criteria

1. THE Fragment_Cache SHALL store response **bodies** keyed by absolute URL, and SHALL
   NOT store extracted `DocumentFragment` values, so that every consumer receives an
   independent fragment from its own extraction.
2. WHEN a cached URL is resolved, THE Content_Resolver SHALL issue no network request and
   SHALL extract a fragment from the cached body.
3. THE Fragment_Cache SHALL bound its size by a maximum number of entries from
   Resolver_Config, evicting the least recently used entry when that maximum would be
   exceeded.
4. THE Fragment_Cache SHALL bound entry age by a maximum from Resolver_Config, and SHALL
   treat an entry older than that maximum as absent.
5. WHEN an activation fails at any step after resolution has succeeded, THE
   Content_Resolver SHALL drop that URL's cache entry, so that a retry re-fetches rather
   than re-serving a body that may have been the cause.
6. THE Content_Resolver SHALL NOT parse or honour `ETag`, `Cache-Control`, or any other
   HTTP caching header, and SHALL NOT revalidate, the browser's own cache beneath `fetch`
   being the layer that owns those semantics.
7. THE Fragment_Cache SHALL retain the Phase 1 single-flight behaviour, joining
   concurrent requests for one URL onto a single network request.

### Requirement 5: Metered connections

**User Story:** As a user on a metered connection, I want a site not to spend my data on
pages I have not asked for.

*Derived from: design — Metered connections.*

#### Acceptance Criteria

1. WHERE `navigator.connection.saveData` is `true`, THE Content_Resolver SHALL NOT issue
   a network request in response to `warm`.
2. WHERE the connection API, the `connection` object, or the `saveData` property is
   absent, THE Content_Resolver SHALL warm normally rather than treating absence as a
   signal to abstain.
3. THE Content_Resolver SHALL NOT consult `effectiveType`, `downlink`, `rtt`, or any
   other connection property, `saveData` alone being a stated user preference where the
   others are ambiguous for prefetching.
4. A `saveData` preference SHALL NOT affect `resolve`, which serves an activation the
   user has explicitly made.
5. THE documentation SHALL record that this is best-effort and Chromium-only, so that no
   reader takes it for a guarantee that prefetching never happens on a metered
   connection.

### Requirement 6: The latency budget and the fallback commit

**User Story:** As a user, I want a slow page to still open, so that a bad connection
costs me the animation rather than the destination.

*Derived from: design — The latency budget.*

#### Acceptance Criteria

1. THE Activation_Handler SHALL bound the wait for resolution by a latency budget from
   Resolver_Config.
2. WHEN the latency budget elapses before resolution completes, THE Activation_Handler
   SHALL cause that activation to proceed in the `fallback` motion mode once resolution
   does complete, rather than abandoning the activation or continuing to wait for the
   full turn.
3. THE fallback commit SHALL be effected through the existing injected
   Motion_Mode_Selector, and THE Transition_Coordinator, `runFallbackTo`, and the
   `fallback` motion mode SHALL be unchanged.
4. THE fallback commit SHALL be scoped to the activation that exceeded the budget, and
   SHALL be cleared when that activation settles, so that one slow page does not degrade
   every subsequent turn in the session.
5. WHERE the Motion_Mode_Selector would already have returned `fallback` — reduced
   motion, absent WebGL, or an explicit `?fallback=` — the budget SHALL NOT change that
   outcome.
6. A warm activation SHALL NOT reach the budget, resolution for a cached URL issuing no
   request.

### Requirement 7: The budget covers resolution, not capture readiness

**User Story:** As a user, I want a page whose images are merely slow to still get the
full turn, so that the degradation matches the problem.

*Derived from: design — Which wait the budget covers.*

#### Acceptance Criteria

1. THE latency budget SHALL measure only the interval from activation to the completion
   of resolution.
2. THE latency budget SHALL NOT include the capture-readiness wait, which Phase 1 bounds
   separately by `captureReadinessTimeoutMs`.
3. WHEN the capture-readiness bound elapses, THE Activation_Handler SHALL proceed to
   capture in the full motion mode as established in Phase 1, and SHALL NOT commit to the
   fallback.
4. THE Resolver_Config SHALL carry the latency budget and the capture-readiness bound as
   separate fields.

### Requirement 8: The pending affordance

**User Story:** As a user, I want the tile I clicked to show it was heard, so that a wait
does not read as a dead click.

*Derived from: design — The pending affordance; Chosen: dim the card.*

#### Acceptance Criteria

1. WHEN an activation's resolution has been pending for longer than a delay from
   Resolver_Config, THE Activation_Handler SHALL mark the activated tile's trigger with
   `data-paper-turn-pending="true"` and `aria-busy="true"`.
2. THE pending affordance SHALL reduce the opacity of the tile's card and SHALL draw no
   additional element, so that it introduces no pseudo-element, no animation, and no
   second focal point.
3. THE pending affordance SHALL change no property that affects layout — not size, not
   position, not margin, not padding, not border width — so that the
   Visual_Regression_Suite's reference images remain valid.
4. THE `aria-busy` attribute SHALL be applied for the whole time the affordance is
   present, opacity alone signalling through appearance only and therefore not
   perceivable by assistive technology.
5. THE affordance delay SHALL be shorter than the latency budget, so that a tile
   acknowledges the click before the fallback commit fires.
6. WHEN an activation leaves the pending state by any route — settling open, falling
   through to navigation, or being superseded — THE Activation_Handler SHALL remove both
   `data-paper-turn-pending` and `aria-busy` from that trigger.
7. A warm activation SHALL NOT display the affordance, resolving from cache before the
   delay elapses.
8. THE affordance's opacity transition SHALL be retained under `prefers-reduced-motion`,
   a fade not being motion in the sense that preference addresses.

### Requirement 9: Preserved contracts

**User Story:** As a maintainer, I want Phase 2 confined to the activation path, so that
the transition subsystem's risk is unchanged.

*Derived from: design — It needs no coordinator change; What this design does not do.*

#### Acceptance Criteria

1. `geometry.ts`, `paper-turn-renderer.ts`, `paper-shaders.ts`, `timeline.ts`,
   `fallback-transition.ts`, `motion-profile.ts`, `grab-anchor.ts`, `capture.ts`, and
   `transition-coordinator.ts` SHALL be unchanged by this feature.
2. THE `MotionProfile` shape SHALL be unchanged, all of this feature's tunables living in
   Resolver_Config.
3. THE Transition_Coordinator's state set SHALL remain exactly `idle`, `preparing`,
   `opening`, `open`, and `closing`.
4. THE fragment contract SHALL be unchanged: a page turnable under Phase 1 SHALL remain
   turnable, with no new or altered markup obligation.
5. THE `TransitionView` interface SHALL be unchanged, and `prepareDetail` SHALL remain
   synchronous.
6. THE existing `?tiles=`, `?duration=`, `?fallback=`, and `?debug=` parameters SHALL
   retain their seed-only semantics.
7. THE existing unit and interaction tests SHALL pass unmodified, except where a test
   asserts a request count that prefetching legitimately changes.
8. THE Visual_Regression_Suite SHALL pass against its existing twelve committed reference
   images with none regenerated and none added.

### Requirement 10: The Phase 2 boundary

**User Story:** As a reviewer, I want what Phase 2 deliberately omits stated as criteria,
so that scope creep reads as a violation rather than a debate.

*Derived from: design — What this design does not do.*

#### Acceptance Criteria

1. THE feature SHALL NOT call `pushState` or `replaceState`, and SHALL NOT register a
   `popstate` listener. History integration is Phase 3.
2. THE feature SHALL NOT perform a browser navigation when the transition settles open.
3. THE feature SHALL NOT introduce a client-side router.
4. THE feature SHALL NOT render detail content in an `iframe`, SHALL NOT fetch
   cross-origin content, and SHALL NOT introduce a proxy.
5. THE feature SHALL NOT define or consume a per-route initialisation contract.
6. THE feature SHALL NOT scope or shadow the shell's CSS, SHALL NOT generalise theme
   token inlining beyond the `--spectrum` prefix, and SHALL NOT move the detail surface
   into the top layer.
7. THE feature SHALL NOT add a runtime or development dependency to Build_Configuration.
8. THE Fragment_Cache SHALL NOT be shared across documents, persisted to storage, or
   exposed on `window`.

---

## Deferred, and deliberately so

- **The latency budget's value.** The mechanism is asserted above; `~120 ms` ships as a
  documented default. Measuring it wants a throttled connection and a real host, which is
  a follow-up rather than a prerequisite — and the suspicion that it should differ between
  pointer and touch is a thing to look for in that data rather than a decision to make
  now.
- **A per-route cache age cap.** A global cap ships. Per-route overrides are Phase 5's
  business if OmnisTools needs them; the choice does not affect the mechanism specified
  here.
- **Prefetch hit-rate measurement.** Worth knowing whether the hovered tile is usually
  the clicked tile, because if it is not then prefetch is spending requests for nothing.
  That is an observation to make after this ships, not a criterion.
