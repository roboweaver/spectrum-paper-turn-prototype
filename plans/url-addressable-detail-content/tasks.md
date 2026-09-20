# Implementation Plan: URL-addressable detail content (Phase 1)

## Overview

The work lands in dependency order: the demo's own detail pages first, because nothing
can be fetched until something is served, then the two independent pure cores — the
fragment extractor and the content resolver — then the three DOM-owning modules that
consume them (`app.ts`, `main.ts`, the capture path), then the browser suites, then the
documents.

Language is TypeScript throughout. **No new runtime or development dependency is added.**
The resolver uses `fetch`, the extractor uses `DOMParser`, and the generator is a Node
script run from an npm lifecycle hook. No sanitiser, no router, no property-testing
library.

The transition subsystem is not touched. `geometry.ts`, `paper-turn-renderer.ts`,
`paper-shaders.ts`, `timeline.ts`, `fallback-transition.ts`, `motion-profile.ts`, and
`grab-anchor.ts` have no task against them, and `TransitionView.prepareDetail` keeps its
`(sourceId: string): void` signature. The fragment reaches the view through a setter
called *before* `coordinator.open()`, which is what lets the state machine stay ignorant
of the network. If a task appears to require editing a transition module, that is a
signal the design has been misread, not a licence to widen the diff.

Two changes ripple into existing suites and are mechanical: the tile trigger becomes an
`<a>`, which touches any test asserting `button` or `type="button"`; and the five
`[data-detail-*]` field assignments collapse into one adopted region, which touches the
tests reading those fields. `tests/e2e/visual.spec.ts` and its twelve committed images
must not be regenerated — Requirement 12 makes that a criterion, and task 14.1 verifies
it.

## Tasks

- [x] 1. Give every record a URL and generate the pages behind them
  - [x] 1.1 Add `url` to `CardRecord` and populate all sixteen records
    - Add `url: string` to the `CardRecord` interface in `src/data/cards.ts`, documented
      as same-origin and resolved against the document base URL
    - Populate all sixteen records with a path under the generated detail directory,
      derived from each record's existing `id`
    - Keep the array exactly sixteen records, keep the existing record order, and keep
      every existing `id` value, so `MAX_TILE_COUNT` stays reachable and
      `DEFAULT_TILE_COUNT` renders the same first three tiles
    - Leave `sections` and `footer` in place: they stop being read at activation time and
      become the generator's input
    - Additive only, so the project keeps compiling before the generator exists
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x] 1.2 Write `scripts/generate-detail-pages.ts`
    - Emit one HTML file per record into `public/detail/<id>.html`, importing `cards`
      directly so the records stay the single source of truth and the pages cannot drift
    - Inside each page emit `<template data-paper-turn-detail data-paper-turn-color="…">`
      whose content reproduces **exactly** what `renderDetail` produces today: the
      `<p class="eyebrow">` subtitle, the `<h2 data-detail-heading tabindex="-1">`, the
      description `<p>`, a `<div class="detail-body">` holding one `<section>` per
      `sections` entry with an `<h3>` and a `<p>`, and the `<p class="detail-footer">`
    - Same element types, same class names, same order, same text. This is what keeps the
      five content-bearing visual baselines valid, and it is the whole reason the pages
      are generated rather than hand-authored
    - Wrap the template in a standalone layout — `<html>`, `<head>`, a `<title>`, the
      stylesheet link — so the page renders correctly when opened directly
    - Set `data-paper-turn-color` from the record's `color`, so `--detail-color` comes
      from the page and not from a local lookup
    - Deterministic: the same records produce byte-identical output on every run
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.2_

  - [x] 1.3 Wire the generator into the lifecycle and ignore its output
    - Add `predev` and `prebuild` scripts to `package.json` invoking the generator.
      Both are required: `prebuild` covers `npm run build` in `ci.yml` and
      `deploy-pages.yml`, and `predev` covers the dev server *and* Playwright, whose
      `webServer.command` is `npm run dev -- --strictPort`
    - Add `public/detail/` to `.gitignore`, so generated pages are not reviewed as source
    - Confirm Vite copies `public/` verbatim into `dist/` and that `base: './'` keeps the
      emitted paths working at the domain root, under the Pages subpath, and from the
      filesystem
    - Do not edit any workflow file: the hooks are what make that unnecessary
    - _Requirements: 11.6, 11.7_

  - [x] 1.4 Add the deliberately awkward contract fixtures
    - Add a small number of fixtures under `public/detail/` (or a sibling fixture
      directory) whose markup is unlike the generated skeleton: nested structure, an
      `<img>`, arbitrary heading depth, and an element carrying an inline event-handler
      attribute
    - Add negative fixtures too: a page with no `[data-paper-turn-detail]`, one where the
      marked region is a `<div>` rather than a `<template>`, one with no
      `[data-detail-heading]`, and one whose body is not parseable as a document
    - These exist for the unit and interaction suites. **No visual spec may reference
      them** — that is what keeps realism from costing baselines
    - _Requirements: 11.8_

  - [x] 1.5 Unit-test the generator in `tests/unit/detail-page-generator.test.ts`
    - Assert one page per record, each satisfying the fragment contract: a `<template>`
      marked `[data-paper-turn-detail]` containing exactly one `[data-detail-heading]`
    - Assert the emitted template's structure matches the structure `renderDetail`
      produces today, element for element and class for class, so a drift that would move
      a baseline fails here first and cheaply
    - Assert `data-paper-turn-color` equals the record's `color`, and that output is
      byte-identical across two runs
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.2_

- [x] 2. Build the fragment extractor
  - [x] 2.1 Create `src/content/fragment.ts`
    - Export `extractFragment(html: string): FragmentResult`, a discriminated union of a
      success carrying the `DocumentFragment` plus the optional colour and document title,
      and a failure carrying which contract obligation was unmet
    - Parse with `DOMParser.parseFromString(html, 'text/html')`. Never assign
      `innerHTML` — the inert parsed document is what keeps subresource loading under the
      control of the capture sequencing in task 9
    - Select `[data-paper-turn-detail]`, require it to be a `<template>`, and require its
      content to hold exactly one `[data-detail-heading]`
    - Read `data-paper-turn-color` and the document `<title>` as optional, deriving no
      behaviour from either being absent
    - Return a failure rather than throwing for every contract violation, so the
      activation path treats it as an ordinary outcome
    - Pure: no network access, no live-document mutation, equal output for equal input
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

  - [x] 2.2 Unit-test extraction in `tests/unit/fragment.test.ts`
    - Well-formed: the generated pages from task 1.2 all extract successfully, and the
      returned fragment's structure matches the source template
    - Contract-violating, one case per obligation, each asserting the failure names the
      unmet obligation: missing region, region is not a `<template>`, no heading, two
      headings, unparseable body
    - Assert the parsed document is inert — an `<img>` in the fragment has not begun
      loading, and a `<script>` in it has not executed — before adoption
    - Assert the extractor mutates neither the input string nor the live document, and
      that the awkward fixtures from task 1.4 extract successfully, including the one
      carrying an inline handler attribute, which is adopted unchanged by design
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 10.1_

- [x] 3. Checkpoint - pages and extraction complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Build the content resolver
  - [ ] 4.1 Create `src/content/resolver-config.ts`
    - Export `ResolverConfig` with the capture-readiness bound consumed in task 9, and a
      documented default
    - Record on the type that the latency budget and cache policy are Phase 2 fields and
      are deliberately absent here
    - **Do not touch `MotionProfile`.** Keeping the resolver's tunables out of it is what
      leaves the four suites that build a `MotionProfile` literal compiling unmodified
    - _Requirements: 9.5_

  - [ ] 4.2 Create `src/content/content-resolver.ts` with `resolve`
    - Export a resolver owning `resolve(url): Promise<FragmentResult>`: fetch, check
      response OK, read the body, delegate to `extractFragment`
    - Treat a non-OK response and a rejected request as failures of the same shape the
      extractor returns, so the activation path has exactly one failure type to handle
    - Reject a URL that is absent, empty, or not same-origin once resolved against the
      document base URL, without issuing a request
    - Read no tile geometry, call no coordinator method, and mutate no detail surface
    - _Requirements: 1.7, 6.4, 8.1, 8.2_

  - [ ] 4.3 Add the single-flight guard and supersession
    - Deduplicate concurrent resolutions of the same URL onto one in-flight request
    - Track at most one non-superseded pending activation; a second activation supersedes
      the first rather than queueing behind it
    - A superseded activation's later completion resolves to a superseded outcome its
      caller discards — and a superseded activation's later *failure* must also be
      discarded, not turned into a fall-through navigation, or an abandoned click would
      navigate the page out from under the live one
    - This guard is the one piece of new machinery the design accepts: the coordinator
      rejects `open()` unless state is `idle`, but during a pending fetch the state *is*
      `idle`, so a second click would otherwise slip past it
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 4.4 Unit-test the resolver in `tests/unit/content-resolver.test.ts`
    - Single-flight: two concurrent resolutions of one URL issue one request and both
      observe the same result
    - Supersession: a second activation supersedes the first; the first's late success is
      reported as superseded; the first's late failure is reported as superseded and not
      as a failure
    - Failure mapping: non-OK status, network rejection, and extraction failure each
      produce the single failure shape, and a cross-origin or empty URL fails without a
      request being issued
    - Assert the resolver holds no fragment cache across activations, which Phase 2 adds
      and Phase 1 excludes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.4, 8.1, 8.2, 13.3_

- [ ] 5. Checkpoint - resolver complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Replace the five-field skeleton with one adopted region
  - [ ] 6.1 Collapse the detail skeleton in `src/app.ts` to a single content region
    - Replace the five `[data-detail-subtitle]`, `[data-detail-heading]`,
      `[data-detail-description]`, `[data-detail-body]`, `[data-detail-footer]` children
      of `.detail-content` with one empty adoptable region
    - Keep `.detail-toolbar` and its `[data-close-button]` in the shell, outside the
      adopted region, so page content never supplies the close affordance
    - Keep the region inside the existing `<sp-theme>` element. `themeTokenCss` finds the
      theme by `closest('sp-theme')`, so moving the injection point outside it
      reintroduces the collapsed-padding, wrong-greys capture bug `docs/architecture.md`
      documents
    - Keep `.detail-content`'s class and the surrounding structure, since the settled
      baseline is sensitive to both
    - _Requirements: 4.1, 4.2, 4.4_

  - [ ] 6.2 Replace `renderDetail(sourceId)` with fragment adoption
    - Add a setter on the view for the resolved fragment, called before
      `coordinator.open()`, and have the view's detail rendering adopt that fragment with
      `document.importNode(fragment, true)`
    - Keep `DomTransitionView.prepareDetail(sourceId: string): void` synchronous and keep
      the `TransitionView` interface unchanged — the fragment arrives out of band, which
      is precisely what keeps the coordinator ignorant of the network
    - Adopt faithfully: no rewriting, stripping, reordering, or sanitising
    - Replace previously adopted content entirely on a subsequent activation, leaving no
      element of the prior fragment behind
    - Apply the fragment's `data-paper-turn-color` to `--detail-color`, falling back to a
      documented default when absent
    - Delete the per-field `textContent` assignments and the `cardById` lookup inside the
      detail path; the tile face still reads the record
    - _Requirements: 4.3, 4.6, 3.4, 1.3, 9.1_

  - [ ] 6.3 Move the settle focus target into the adopted fragment
    - Have the settle step focus the adopted fragment's `[data-detail-heading]`, which the
      extractor has already guaranteed to exist exactly once
    - Verify the existing keyboard open/close focus-restoration behaviour is preserved,
      since `[data-detail-heading]` is no longer a fixed shell element
    - _Requirements: 4.5, 3.3_

  - [ ] 6.4 Update the view suites
    - Update `tests/unit/app.test.ts` and `tests/unit/dom-transition-view.test.ts` for the
      collapsed skeleton and the adoption path, replacing assertions that read the five
      detail fields
    - Add adoption assertions: structure preserved exactly, previous content fully
      replaced, colour applied, adopted region inside `<sp-theme>`, toolbar outside the
      adopted region
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

- [ ] 7. Make tiles real anchors
  - [ ] 7.1 Build the tile trigger as an `<a>` in `src/app.ts`
    - Change `createCardItem`'s trigger from `<button type="button">` to
      `<a href="{card.url}">`, keeping `[data-card-trigger]`, the `card-trigger` class,
      and the `data-source-id` dataset entry
    - Keep the anchor label a **sibling** of the trigger, not a descendant. The existing
      comment states both reasons and both still hold: `captureElement` captures the
      trigger subtree, and the grab-anchor resolver measures it
    - Keep the Spectrum heading and subheading text slotted in light DOM rather than
      attribute-only, so the capture keeps reproducing it
    - Verify the tile is still keyboard-activatable and that focus styling is unchanged —
      an `<a href>` is focusable, but the `:focus-visible` rules were authored against a
      `<button>`
    - _Requirements: 5.1, 5.2, 5.6, 12.1_

  - [ ] 7.2 Add the modified-click guard in `src/main.ts`
    - In the delegated `click` handler, return without `preventDefault()`, without
      resolving, and without opening when `metaKey`, `ctrlKey`, `shiftKey`, or `altKey` is
      set, or when `button !== 0`
    - Call `preventDefault()` only for a primary unmodified click, and only before
      resolution begins
    - Swallowing a modified click is the classic way a transition breaks the browser, so
      this guard is load-bearing rather than defensive
    - _Requirements: 5.3, 5.4, 5.5_

  - [ ] 7.3 Test the anchor change in the unit and interaction suites
    - Unit: the trigger is an `<a>` with the record's `href`, the label is a sibling, and
      `tests/unit/tile-grid.test.ts` still passes for every tile count
    - Interaction: a cmd-click, a ctrl-click, a shift-click, and a middle-click each leave
      the transition state `idle` and the detail surface hidden; a primary click opens
      normally
    - Interaction: with the transition's script prevented from running, a tile click
      performs an ordinary navigation to the detail page, which is the progressive
      enhancement claim made concrete
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 8. Checkpoint - adoption and anchors complete
  - Ensure all tests pass, ask the user if questions arise. Run
    `npm run test:visual` here specifically: this is the first point at which the twelve
    committed images could have moved, and finding that now is much cheaper than after
    the activation path is rewired.

- [ ] 9. Make the capture wait for content
  - [ ] 9.1 Await fonts and images before capture
    - After adopting the fragment and before the destination is captured, await
      `document.fonts.ready`
    - Await every `<img>` in the adopted content to resolve `decode()` or report
      `complete`
    - Bound the whole wait with the `ResolverConfig` value from task 4.1 and proceed to
      capture when it elapses, so a hung subresource costs the fidelity of one frame
      rather than the activation
    - Proceed to capture when an individual image fails to decode: one broken image must
      not cost the transition
    - This runs in the activation path before `open()`, not inside the coordinator
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 1.1_

  - [ ] 9.2 Log a tainted capture distinguishably in `src/transition/capture.ts`
    - Detect the tainted-canvas failure and log it distinguishably from other capture
      failures, naming cross-origin subresources as the likely cause
    - Change no capture behaviour otherwise: theme-token inlining, `cacheBust`, DPR and
      pixel-area caps all stay exactly as they are
    - The existing degradation is already correct — capture failure settles through the
      fallback — so this task adds diagnosability, not recovery
    - _Requirements: 8.5, 7.5_

  - [ ] 9.3 Test capture readiness
    - Unit, in `tests/unit/capture.test.ts` and a readiness suite: fonts awaited before
      capture, images awaited, a failing `decode()` still proceeds, the bound elapsing
      still proceeds, and the tainted-capture log is distinguishable
    - Assert no assertion anywhere claims the full turn survives a tainted capture; the
      asserted behaviour is that it degrades through the fallback
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.4, 8.5, 8.6_

- [ ] 10. Rewire the activation path
  - [ ] 10.1 Resolve, then measure, then open in `src/main.ts`
    - In the delegated handler: guard the click (task 7.2), `preventDefault()`, resolve
      the trigger's URL, and only on success measure tiles, resolve the grab anchor, hand
      the fragment to the view, await capture readiness, and call `coordinator.open()`
    - Measurement must follow resolution with no network access between them, so the rects
      cannot go stale across a round trip
    - Leave the list surface scrollable, `aria-busy` false, and not inert while a
      resolution is pending; nothing may freeze before content is in hand
    - Discard a result whose activation was superseded, and discard any result arriving
      while the coordinator state is not `idle`, rather than calling `open()` and
      provoking its state guard to throw
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 2.3, 2.4, 2.6_

  - [ ] 10.2 Fall through to navigation on every resolution failure
    - On a non-OK response, a request failure, or an extraction failure, perform an
      ordinary navigation to the trigger's `href`
    - Leave the list scrollable and not inert, the detail surface hidden, and the
      coordinator state `idle` when falling through
    - Do not fall through on behalf of a superseded activation
    - _Requirements: 8.1, 8.2, 8.3, 2.4_

  - [ ] 10.3 Extend `tests/e2e/interaction.spec.ts`
    - Activation against a stubbed slow response: the list stays scrollable and
      `aria-busy` stays `false` while pending, and the turn runs once content arrives
    - Activation against a failing response: the browser navigates to the detail page and
      the detail page renders standalone
    - A second activation during a pending resolution opens the second tile's content, and
      the first neither opens nor navigates
    - Escape during a pending resolution leaves the state `idle` with nothing to unwind
    - The existing reverse-close, keyboard, touch, Escape, resize, reduced-motion, and
      fallback tests continue to pass, since none of their paths were touched
    - _Requirements: 1.4, 1.5, 1.6, 2.2, 2.3, 8.1, 8.2, 8.3, 9.2_

- [ ] 11. Checkpoint - the feature works end to end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Document the contract and the posture
  - [ ] 12.1 Write the fragment contract documentation
    - Document the required `[data-paper-turn-detail]` `<template>` and the required
      `[data-detail-heading]`, the optional `data-paper-turn-color` and `<title>`, and a
      minimal working example
    - Include the two authoring rules that are facts about the capture rather than about
      the contract: Spectrum component text must be slotted rather than attribute-only,
      and images on turnable pages should be same-origin or carry `crossorigin`
    - State that a page whose content depends on its own scripts renders inert when
      adopted and should fall through to normal navigation
    - _Requirements: 3.8, 8.5_

  - [ ] 12.2 Record the security posture where an operator will find it
    - State that fragments are adopted unchanged and that nothing is sanitised
    - State the assumption that licenses it: the detail page's content must be no less
      trusted than the page adopting it, and the layer producing the page is the security
      boundary
    - State that `importNode` does not run `<script>` elements but **does** activate
      inline handler attributes such as `onerror` once nodes are live, so the parsed
      document's inertness is not a general safety property
    - State the deployment shape that breaks the assumption — an adopting page holding
      privileges the content's authors do not — and that it needs a sanitisation layer out
      of scope for Phase 1
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 12.3 Update `docs/architecture.md` and `README.md`
    - Record the activation path's new shape: resolve, measure, ready, open — and why the
      network wait lives outside the state machine
    - Record that the detail surface is now an adopted region rather than five named
      fields, and that the injection point must stay inside `<sp-theme>`
    - Record that tiles are anchors and that modified clicks are deliberately not
      intercepted
    - Record the generated `public/detail/` pages, that they are gitignored build output,
      and that the generator runs from `predev`/`prebuild`
    - Note in the README that `?tiles=`, `?duration=`, `?fallback=`, and `?debug=` keep
      their existing seed-only semantics
    - _Requirements: 9.6, 11.6, 11.7_

- [ ] 13. Verify the Phase 1 boundary holds
  - [ ] 13.1 Assert the deferred work is absent
    - Grep the source tree to confirm no `pushState`, no `replaceState`, and no `popstate`
      listener; no `pointerenter`, `focusin`, or `touchstart` prefetch; no cross-activation
      fragment cache; no latency-budget fallback commit; no pending affordance; no
      `iframe`; no per-route init contract; and no navigation performed on settle
    - Confirm no sanitiser dependency and no other runtime or development dependency was
      added, and that the lockfile declares the same packages at the same pinned versions
      as before this feature
    - Confirm `geometry.ts`, `paper-turn-renderer.ts`, `paper-shaders.ts`, `timeline.ts`,
      `fallback-transition.ts`, `motion-profile.ts`, and `grab-anchor.ts` are untouched by
      `git diff`, and that the `MotionProfile` shape is unchanged
    - Confirm the coordinator's state set is still exactly `idle`, `preparing`, `opening`,
      `open`, `closing`, that its `close()` path and reverse transition are unchanged, and
      that both sheet faces are still captured in a single pass so the reverse performs no
      second capture
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ] 13.2 Run the full suite and confirm the baselines did not move
    - `npm run test:unit`, `npm run test:e2e`, and `npm run test:visual`
    - Confirm the geometry, renderer, coordinator, and grab-anchor suites pass
      **unmodified**, the only permitted edits across the existing suites being those
      asserting the tile trigger's element type and those reading a detail field the
      skeleton no longer owns. Any other edit to those files means a transition contract
      moved and needs explaining before this task closes
    - The visual suite must pass against its existing twelve committed images with none
      regenerated and none added
    - IF a frame has moved, stop and report which one and why before regenerating
      anything. Regeneration requires both platforms and review by eye, and the Linux
      images may come only from the `update-visual-baselines` workflow on an ubuntu
      runner
    - _Requirements: 9.7, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 13.3 Run the build and lint gates
    - `npm run lint`, `npm run typecheck`, and `npm run build`
    - Confirm the generator ran from `prebuild` and that `dist/detail/` holds sixteen
      pages
    - Clean up any scratch files created while debugging
    - _Requirements: 11.6, 13.8_

## Notes

- **The transition subsystem has no task against it.** That is the design's central claim
  made checkable: if a task seems to require editing `geometry.ts`, the renderer, the
  timeline, the fallback, or the coordinator's state machine, re-read the design before
  widening the diff. Task 13.1 verifies it by `git diff`.
- Task 1.2 is the load-bearing one for Requirement 12. The generated template must
  reproduce today's `renderDetail` output exactly, because five of the six visual frames
  carry captured detail content and only `paper-turn-start` is grid-only. Task 1.5 catches
  drift cheaply; task 8 catches it early; task 13.2 is the backstop.
- Tasks 1 and 2 are independent of task 4 once `extractFragment`'s signature exists, and
  the pure modules (1.2, 2.1, 4.2) can proceed in parallel with each other.
- Task 6.1 must land before task 6.2, and both before task 10.1 — the activation path
  cannot hand a fragment to a view that has no region to adopt it into.
- Task 9.1 runs in the activation path, not in the coordinator. Putting the readiness wait
  inside `open()` would recreate exactly the unbounded-wait-in-the-state-machine problem
  the design rejected.
- The awkward fixtures from task 1.4 are deliberately excluded from every visual spec.
  Realism in the contract tests must not be paid for in baselines.
- No new dependency. `fetch`, `DOMParser`, and a Node script are the whole toolkit.

### Learned during execution

Recorded here because each one constrains a task that has not run yet.

- **Task 6.1 must convert the parity test, not delete it.** Task 1.5's strongest
  assertion compares the generated template against `renderDetail`'s *live* output
  for all sixteen records, and that comparison is only possible while the
  five-field skeleton still exists. When 6.1 removes the skeleton, capture the
  normalised structures as golden strings from the passing test and compare against
  those. Deleting it would drop the only mechanical guarantee behind Requirement 12.
- **Task 10.3's failing-response test must intercept the route.** Vite's dev server
  SPA-falls back to `index.html` for unknown paths under `/detail/`, returning
  **200** with the index document rather than a 404. So a missing page cannot
  simulate a failed response; it lands on `missing-region` instead. Use Playwright
  route interception to produce a genuine non-OK status.
- **`allowImportingTsExtensions` is now `true` in `tsconfig.json`.** Node's native
  type stripping resolves relative specifiers by ESM rules and so requires the
  explicit `.ts` extension, which `tsc` rejected. Enabling the flag was the
  alternative to adding a transpiler dependency, and is safe because the project is
  `noEmit` and Vite owns the build. `scripts` was added to the tsconfig `include`
  so the generator is genuinely typechecked. Application code under `src/` stays
  extensionless. No dependency was added, so Requirement 13.8 still holds.
- **A `<template>`'s content is invisible to document-level `querySelectorAll`.**
  Its content lives in a separate `DocumentFragment`. This is why
  `extractFragment` scopes the "exactly one heading" check to `template.content`,
  and it is asserted in both new suites so a future refactor cannot quietly widen
  the query to the document and start matching a page's visible copy.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2"] },
    { "id": 3, "tasks": ["1.5", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3"] },
    { "id": 6, "tasks": ["4.4", "6.1"] },
    { "id": 7, "tasks": ["6.2", "7.1"] },
    { "id": 8, "tasks": ["6.3", "7.2"] },
    { "id": 9, "tasks": ["6.4", "7.3"] },
    { "id": 10, "tasks": ["9.1", "9.2"] },
    { "id": 11, "tasks": ["9.3", "10.1"] },
    { "id": 12, "tasks": ["10.2"] },
    { "id": 13, "tasks": ["10.3"] },
    { "id": 14, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 15, "tasks": ["13.1"] },
    { "id": 16, "tasks": ["13.2", "13.3"] }
  ]
}
```
