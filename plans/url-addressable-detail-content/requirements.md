# Requirements Document

## Introduction

Every detail page is currently a compile-time constant. `src/data/cards.ts` holds a
frozen sixteen-element `CardRecord[]` of plain strings, and `renderDetail` writes five
named fields of it into a fixed skeleton with `textContent`. There is no `url`, no
`fetch`, and no router anywhere in the repo.

This feature makes that content come from a URL **on the same origin**, so the
paper-turn becomes the navigation transition of a real multi-page application rather
than a fixture of a demo. Content resolves to a ready-to-adopt DOM fragment *before*
the transition coordinator is involved, which leaves the coordinator, the geometry, the
renderer, the timeline, and the fallback entirely untouched.

**These requirements cover Phase 1 only.** Phase 1 proves the mechanism against detail
pages the prototype generates for itself: a content resolver, a fragment contract,
tiles as real anchors, capture that waits for fonts and images, and failure that falls
through to ordinary navigation. Speculative prefetch and the latency budget are Phase 2.
`pushState`, deep linking, and **navigation on settle** are Phase 3. Component
packaging is Phase 4 and the OmnisTools init contract is Phase 5. Requirement 13 states
the Phase 1 boundary explicitly so that scope creep is visible as a requirement
violation rather than a judgement call.

These requirements are derived from the approved design document
[`design.md`](./design.md) and are traceable to its sections. They restate what the
system shall do; the design remains authoritative for how. Every acceptance criterion
below is consistent with the design's central decision to resolve ahead of `open()`,
its fragment contract, its capture-fidelity analysis, and its preserved-contract
guarantees, and re-decides none of them.

---

## Glossary

- **Detail page**: a same-origin HTML document, served at its own URL, that renders
  standalone and carries an adoptable region marked `[data-paper-turn-detail]`.
- **Fragment**: the parsed, inert DOM subtree extracted from a detail page's
  `[data-paper-turn-detail]` template, ready to be adopted into the shell.
- **Fragment contract**: the set of markup obligations a detail page must satisfy to be
  adoptable — the marked region and the focus target being required, the colour hint and
  the document title being optional.
- **Adoption**: importing a fragment into the live document with
  `document.importNode(fragment, true)` and inserting it into the detail content region.
- **Resolution**: the act of turning a URL into a fragment, comprising fetch, parse, and
  extraction, and completing before the transition coordinator is called.
- **Activation**: a primary, unmodified click on a tile that is intended to open the
  detail surface with the full turn.
- **Supersession**: the outcome in which a second activation begins while a first
  resolution is still pending, and the first resolution's result is discarded.
- **Fall-through**: the degradation in which the enhancement does not apply and the
  browser performs an ordinary navigation to the tile's `href`.
- **Capture readiness**: the condition in which every webfont the adopted fragment uses
  has loaded and every `<img>` in it has decoded, so a rasterisation reproduces the live
  DOM's text metrics and imagery.
- **Content_Resolver**: the new module owning `resolve(url)`, the single-flight guard,
  and supersession. It performs no measurement and calls no coordinator method.
- **Fragment_Extractor**: the pure surface of the resolver that maps a response body to
  a fragment or to an extraction failure, performing no network access.
- **Resolver_Config**: the configuration object owning the resolver's tunables, separate
  from `MotionProfile`.
- **Activation_Handler**: the delegated click path in `main.ts` that decides whether an
  activation is enhanced, resolves content, measures tiles, and opens the transition.
- **Tile_Factory**: `createCardItem` in `app.ts`, which builds one grid tile.
- **Transition_View**: the view object returned by `createDemoApp` in `app.ts`,
  including `renderDetail` and the detail content region.
- **Transition_Coordinator**: `transition-coordinator.ts`, owning the transition state
  machine.
- **Capture_Module**: `capture.ts`, owning `captureElement` and theme-token inlining.
- **Card_Record**: the tile record shape exported by `src/data/cards.ts`.
- **Detail_Page_Generator**: the build-time script that emits the demo's detail pages
  from `Card_Record` data.
- **Build_Configuration**: the project manifest, the ignore file, and the CI and
  deployment workflows.
- **Unit_Test_Suite**: the Vitest suites under `tests/unit`.
- **Interaction_Test_Suite**: the Playwright functional suite
  `tests/e2e/interaction.spec.ts`.
- **Visual_Regression_Suite**: the Chromium-desktop baseline suite
  `tests/e2e/visual.spec.ts` and its twelve committed reference images.

---

## Requirements

### Requirement 1: Content resolves before the transition opens

**User Story:** As a developer of the transition, I want network work to happen entirely
outside the transition state machine, so that adding real content introduces no new
state, no new cancellation path, and no new failure mode in the most heavily tested
module in the system.

*Derived from: design — The central decision: resolve before opening.*

#### Acceptance Criteria

1. THE Activation_Handler SHALL complete resolution of the activated tile's URL to a
   fragment before invoking any Transition_Coordinator method for that activation.
2. THE Activation_Handler SHALL measure tile rects and resolve the grab anchor only
   after resolution has completed, so that the measurement immediately precedes
   `open()` with no network access between them.
3. THE Transition_View SHALL keep `prepareDetail` synchronous, returning `void` and not
   a promise, and THE Transition_Coordinator SHALL await no network operation between
   entering the `preparing` state and the transition's first frame.
4. WHILE a resolution is pending, THE Activation_Handler SHALL leave the list surface
   scrollable, SHALL leave `aria-busy` on the list surface as `false`, and SHALL NOT
   inert the list surface, so that no scroll freeze is applied before content is in
   hand.
5. WHILE a resolution is pending, THE Transition_Coordinator state SHALL remain `idle`.
6. WHEN a resolution is abandoned, THE Activation_Handler SHALL NOT call `open()` for
   that activation, and SHALL leave no transition to unwind.
7. THE Content_Resolver SHALL NOT read tile geometry, SHALL NOT call any
   Transition_Coordinator method, and SHALL NOT mutate the detail surface.

### Requirement 2: Single-flight resolution and supersession

**User Story:** As a user, I want a second click during a slow load to open what I
clicked second, so that an impatient double activation does not open the wrong page or
throw.

*Derived from: design — The central decision, the new guard.*

#### Acceptance Criteria

1. WHERE a resolution for a given URL is already pending, WHEN a further resolution for
   that same URL is requested, THE Content_Resolver SHALL join the pending resolution
   and SHALL issue no second network request for it.
2. WHEN an activation begins while a resolution from an earlier activation is still
   pending, THE Content_Resolver SHALL supersede the earlier activation rather than
   queue the later one behind it.
3. WHEN an earlier activation has been superseded and its resolution subsequently
   completes, THE Activation_Handler SHALL discard that result and SHALL NOT call
   `open()` for it.
4. WHEN an earlier activation has been superseded and its resolution subsequently
   fails, THE Activation_Handler SHALL discard that failure and SHALL NOT fall through
   to navigation on its behalf.
5. THE Content_Resolver SHALL admit at most one non-superseded pending activation at any
   time, so that `open()` is called at most once per activation.
6. IF a resolution completes while the Transition_Coordinator state is not `idle`, THEN
   THE Activation_Handler SHALL discard that result rather than call `open()` and
   provoke the coordinator's state guard to throw.

### Requirement 3: The fragment contract

**User Story:** As an author of a detail page, I want one documented markup contract that
says which part of my page becomes the turning sheet, so that I can make a page turnable
without reading the transition's source.

*Derived from: design — The fragment contract.*

#### Acceptance Criteria

1. THE Fragment_Extractor SHALL parse a response body with
   `DOMParser.parseFromString(html, 'text/html')` and SHALL NOT assign it to
   `innerHTML`, so that the parsed document is inert and its subresources do not begin
   loading before adoption.
2. THE Fragment_Extractor SHALL select the adoptable region by the
   `[data-paper-turn-detail]` attribute and SHALL require it to be a `<template>`
   element, so that a standalone render of the same page does not display the region
   twice.
3. THE Fragment_Extractor SHALL require the selected region to contain exactly one
   element matching `[data-detail-heading]`, that element being the focus target the
   settle step moves focus to.
4. WHERE the selected region carries a `data-paper-turn-color` attribute, THE
   Transition_View SHALL apply its value to the detail surface's `--detail-color`
   custom property, and WHERE it does not, THE Transition_View SHALL apply a documented
   default.
5. THE Fragment_Extractor SHALL treat the parsed document's `<title>` as optional in
   Phase 1 and SHALL derive no behaviour from its absence.
6. IF the response body does not parse, or contains no `[data-paper-turn-detail]`
   region, or that region is not a `<template>`, or that region contains no
   `[data-detail-heading]`, THEN THE Fragment_Extractor SHALL report an extraction
   failure naming which obligation was unmet and SHALL return no fragment.
7. THE Fragment_Extractor SHALL perform no network access, SHALL mutate no live
   document, and SHALL return an equal fragment for an equal response body on every
   invocation.
8. THE fragment contract SHALL be documented alongside the feature, including the
   requirement that Spectrum component text be slotted rather than attribute-only, and
   the guidance that images used on turnable pages be served same-origin or with
   `crossorigin`.

### Requirement 4: Fragment adoption replaces the five-field skeleton

**User Story:** As an author of a detail page, I want my page's own structure to appear on
the detail surface, so that real content is not squeezed through five named string slots.

*Derived from: design — The fragment contract; Capture fidelity, token inlining.*

#### Acceptance Criteria

1. THE Transition_View SHALL own a single detail content region and SHALL replace that
   region's children with the adopted fragment, in place of assigning
   `[data-detail-subtitle]`, `[data-detail-heading]`, `[data-detail-description]`,
   `[data-detail-body]`, and `[data-detail-footer]` individually with `textContent`.
2. THE Transition_View SHALL retain the detail toolbar and its `[data-close-button]` in
   the shell, outside the adopted region, so that the close affordance is not supplied
   by page content.
3. THE Transition_View SHALL adopt the fragment with `document.importNode(fragment,
   true)`, preserving the fragment's element structure, attributes, and text exactly as
   authored and SHALL NOT rewrite, strip, or reorder it.
4. THE Transition_View SHALL insert the adopted fragment at a point inside the shell's
   existing `<sp-theme>` element, so that `themeTokenCss` continues to find an
   `sp-theme` ancestor by `closest()` and the capture clone continues to inherit theme
   tokens.
5. THE Transition_View SHALL move focus on settle to the adopted fragment's
   `[data-detail-heading]` element.
6. WHEN a subsequent activation adopts a different fragment, THE Transition_View SHALL
   replace the previously adopted content entirely, leaving no element of the previous
   fragment in the detail content region.

### Requirement 5: Tiles are real anchors

**User Story:** As a user, I want a tile to behave like the link it is, so that
cmd-click, middle-click, and opening in a new tab work, and so that the index still
works before the transition's JavaScript has loaded.

*Derived from: design — Tiles become anchors.*

#### Acceptance Criteria

1. THE Tile_Factory SHALL build each tile trigger as an `<a>` element carrying an `href`
   set to the tile's URL, in place of a `<button type="button">`, and SHALL keep the
   `[data-card-trigger]` attribute and the `data-source-id` dataset entry on it.
2. THE Tile_Factory SHALL keep the anchor label element a **sibling** of the tile
   trigger and not a descendant of it, so that `captureElement` does not print the label
   onto the turning sheet and the grab-anchor resolver does not measure it.
3. WHEN a click on a tile has `metaKey`, `ctrlKey`, `shiftKey`, or `altKey` set, THE
   Activation_Handler SHALL NOT call `preventDefault()`, SHALL NOT resolve content, and
   SHALL NOT open the transition, allowing the browser's native handling to proceed.
4. WHEN a click on a tile has `button` not equal to `0`, THE Activation_Handler SHALL
   NOT call `preventDefault()` and SHALL NOT open the transition.
5. WHEN a click on a tile is primary and unmodified, THE Activation_Handler SHALL call
   `preventDefault()` before resolving content, so that the browser does not navigate
   while the enhancement is running.
6. THE Tile_Factory SHALL keep the tile's Spectrum heading and subheading text slotted
   in light DOM rather than attribute-only, so that the capture continues to reproduce
   it.

### Requirement 6: Card records address a URL

**User Story:** As a developer, I want each tile to name the page it opens, so that the
tile's destination is data rather than a hardcoded lookup.

*Derived from: design — The fragment contract, `CardRecord` gains `url`.*

#### Acceptance Criteria

1. THE Card_Record SHALL gain a `url` field of type `string`, and SHALL retain `id`,
   `title`, `subtitle`, `description`, and `color` as the locally authored tile face.
2. THE Card_Record array SHALL retain exactly sixteen records, so that
   `MAX_TILE_COUNT` remains reachable and a four-by-four grid continues to exercise all
   eight grab anchors.
3. THE Card_Record array SHALL retain its existing record order and its existing `id`
   values, so that `DEFAULT_TILE_COUNT` continues to render the same first three tiles.
4. IF a record's `url` is absent, empty, or not same-origin when resolved against the
   document base URL, THEN the Activation_Handler SHALL treat activation of that tile as
   a fall-through and SHALL NOT attempt resolution.
5. THE Card_Record's `sections` and `footer` fields SHALL remain the input to the
   Detail_Page_Generator, and SHALL no longer be read by the Transition_View at
   activation time.

### Requirement 7: Capture waits for fonts and images

**User Story:** As a user, I want the turning sheet to show what the page actually looks
like, so that the reverse face does not carry different text metrics or blank gaps where
images belong.

*Derived from: design — Capture fidelity.*

#### Acceptance Criteria

1. WHEN a fragment has been adopted and before the destination is captured, THE
   Activation_Handler SHALL await `document.fonts.ready`.
2. WHEN a fragment has been adopted and before the destination is captured, THE
   Activation_Handler SHALL await every `<img>` element in the adopted content to either
   resolve `decode()` or report `complete`.
3. IF an image in the adopted content fails to decode, THEN THE Activation_Handler SHALL
   proceed to capture rather than abandon the activation, so that one broken image does
   not cost the whole transition.
4. THE Activation_Handler SHALL bound the wait for capture readiness, and WHEN the bound
   elapses SHALL proceed to capture rather than wait indefinitely.
5. THE Capture_Module SHALL keep inlining theme tokens from the nearest `sp-theme`
   ancestor, and its behaviour SHALL be unchanged by this feature.

### Requirement 8: Every failure degrades to a working link

**User Story:** As a user, I want a tile to always take me to its page, so that a network
failure, a contract violation, or an unsupported device costs me the animation and not the
destination.

*Derived from: design — Latency, fetch failure; Capture fidelity, cross-origin
subresources.*

#### Acceptance Criteria

1. IF a fetch returns a non-OK response, or the request fails, THEN THE
   Activation_Handler SHALL fall through to an ordinary browser navigation to the tile's
   `href`.
2. IF the Fragment_Extractor reports an extraction failure, THEN THE Activation_Handler
   SHALL fall through to an ordinary browser navigation to the tile's `href`.
3. WHEN a fall-through occurs, THE Activation_Handler SHALL leave the list surface
   scrollable and not inert, SHALL leave the detail surface hidden, and SHALL leave the
   Transition_Coordinator state `idle`.
4. IF a capture fails because the canvas is tainted by a cross-origin subresource, THEN
   THE Transition_Coordinator SHALL settle the activation through the existing fallback
   motion mode, so that the page still opens without the turn.
5. WHEN a capture fails because the canvas is tainted, THE Capture_Module SHALL log that
   outcome distinguishably from other capture failures, so that the cause is visible
   rather than inferred.
6. No acceptance criterion in this document SHALL assert that the full turn survives a
   tainted capture.

### Requirement 9: The transition subsystem is unchanged

**User Story:** As a maintainer, I want this feature to leave the geometry, renderer,
timeline, and state machine exactly as they are, so that the risk of the change is
confined to the activation path.

*Derived from: design — What this buys; What this design does not do.*

#### Acceptance Criteria

1. THE Transition_Coordinator's state set SHALL remain exactly `idle`, `preparing`,
   `opening`, `open`, and `closing`, with no state added, removed, or renamed.
2. THE Transition_Coordinator SHALL retain its existing `close()` path, its reverse
   transition, and its re-measurement of the source tile on close, unchanged.
3. THE Transition_Coordinator SHALL continue to capture both sheet faces in a single
   pass, so that the reverse transition performs no second capture.
4. `geometry.ts`, `paper-turn-renderer.ts`, `paper-shaders.ts`, `timeline.ts`,
   `fallback-transition.ts`, `motion-profile.ts`, and `grab-anchor.ts` SHALL be
   unchanged by this feature.
5. THE `MotionProfile` shape SHALL be unchanged by this feature, and the resolver's
   tunables SHALL live in Resolver_Config instead, so that the four test suites
   constructing a `MotionProfile` literal keep compiling unmodified.
6. THE existing `?tiles=`, `?duration=`, `?fallback=`, and `?debug=` query parameters
   SHALL retain their current seed-only semantics and SHALL NOT be rewritten.
7. THE existing unit tests for the geometry, the renderer, the coordinator, and the
   grab-anchor resolver SHALL pass unmodified, except where a test asserts the tile
   trigger's element type or reads a detail field the skeleton no longer owns.

### Requirement 10: Security posture and the trust boundary

**User Story:** As an operator embedding this, I want the trust assumption written down,
so that the decision not to sanitise is a recorded position rather than an oversight.

*Derived from: design — Security posture.*

#### Acceptance Criteria

1. THE Transition_View SHALL adopt fragment content faithfully and SHALL NOT sanitise,
   strip, or rewrite it, so that a page renders as its author wrote it.
2. THE design and the fragment contract documentation SHALL record that adoption
   requires the detail page's content to be no less trusted than the page performing the
   adoption, and that the layer producing the detail page is the security boundary.
3. THE documentation SHALL record that adoption via `importNode` does not execute
   `<script>` elements but **does** activate inline event-handler attributes such as
   `onerror` once the nodes are live, so the inertness of `DOMParser` is not relied on
   as a general safety property.
4. THE documentation SHALL record that the assumption in criterion 2 fails where the
   adopting page holds privileges the detail page's authors do not, and that such a
   deployment requires a sanitisation layer that is out of scope for Phase 1.
5. No sanitisation dependency SHALL be added to Build_Configuration in Phase 1.

### Requirement 11: The demo generates its own detail pages

**User Story:** As a developer running the prototype, I want real same-origin URLs to
fetch, so that Phase 1 exercises the resolver and the fragment contract against actual
files rather than a test stub.

*Derived from: design — History and real URLs, static fixtures in `public/`; Open
question 8.*

#### Acceptance Criteria

1. THE Detail_Page_Generator SHALL emit one detail page per Card_Record into a
   directory served same-origin by the dev server and copied verbatim into the build
   output.
2. THE Detail_Page_Generator SHALL derive every emitted page from the Card_Record array,
   so that the records remain the single source of truth and the emitted pages cannot
   drift from them.
3. THE Detail_Page_Generator SHALL emit, inside each page's `[data-paper-turn-detail]`
   template, markup that reproduces the structure `renderDetail` produces today — the
   eyebrow subtitle, the `[data-detail-heading]` with `tabindex="-1"`, the description,
   one section per `sections` entry with its heading and body, and the footer — with the
   same element types, the same class names, and the same order.
4. THE Detail_Page_Generator SHALL set each page's `data-paper-turn-color` from the
   record's `color`, so that `--detail-color` is supplied by the page rather than by a
   local lookup.
5. THE Detail_Page_Generator SHALL emit a standalone layout around the template on each
   page, so that the page renders correctly when opened directly.
6. THE Build_Configuration SHALL run the Detail_Page_Generator before both `dev` and
   `build`, so that the dev server, the Playwright web server, the CI build, and the
   Pages deployment all serve generated pages without a workflow file change.
7. THE Build_Configuration SHALL exclude the generated output from version control, so
   that generated pages are not reviewed as source.
8. THE Unit_Test_Suite and Interaction_Test_Suite SHALL additionally exercise at least
   two fixtures whose markup is deliberately unlike the generated skeleton — including
   nested structure, an image, and arbitrary heading depth — and the
   Visual_Regression_Suite SHALL NOT reference those fixtures.

### Requirement 12: Visual baselines are preserved

**User Story:** As a maintainer, I want the twelve committed reference images to stay
valid, so that a change in where the DOM comes from is not paid for in a
cross-platform baseline review.

*Derived from: design — Test strategy.*

#### Acceptance Criteria

1. THE index page SHALL remain visually identical after this feature, retaining the same
   hero copy, the same grid, and the same three-tile default, so that the
   `paper-turn-start` frame is unchanged.
2. THE detail content rendered from a generated page SHALL be visually identical to the
   detail content `renderDetail` produces today, so that the `paper-turn-peak-curl`,
   `paper-turn-diagonal-midpoint`, `paper-turn-settled`,
   `paper-turn-midline-peak-curl`, and `paper-turn-midline-midpoint` frames are
   unchanged.
3. THE Visual_Regression_Suite SHALL pass against its existing twelve committed
   reference images with no image regenerated and no new baseline added.
4. THE change of the tile trigger from `<button>` to `<a>` SHALL be verified by the
   Interaction_Test_Suite rather than by a new reference image.
5. IF criterion 3 cannot be met, THEN the affected frames SHALL be regenerated on both
   platforms and reviewed by eye, and the Linux images SHALL be produced only by the
   `update-visual-baselines` workflow on an ubuntu runner.

### Requirement 13: The Phase 1 boundary

**User Story:** As a reviewer, I want the things Phase 1 deliberately does not do listed
as requirements, so that scope creep shows up as a violated criterion instead of a
debate.

*Derived from: design — Phasing; What this design does not do.*

#### Acceptance Criteria

1. THE Activation_Handler SHALL NOT perform a browser navigation when the transition
   settles open. Navigation on settle is Phase 3 work, and performing it in Phase 1
   would destroy the reverse turn that `close()` currently provides, because a document
   change discards the coordinator instance.
2. THE Activation_Handler SHALL NOT call `pushState` or `replaceState`, and SHALL
   register no `popstate` listener.
3. THE Activation_Handler SHALL NOT prefetch on `pointerenter`, `focusin`, or
   `touchstart`, and THE Content_Resolver SHALL NOT retain a cross-activation fragment
   cache.
4. THE Activation_Handler SHALL NOT implement a latency budget that commits to the
   fallback motion mode on a slow resolve, and SHALL NOT render a pending affordance on
   the activated tile.
5. THE feature SHALL NOT fetch cross-origin content, SHALL NOT introduce a proxy, and
   SHALL NOT render detail content in an `iframe`.
6. THE feature SHALL NOT scope or shadow the shell's CSS, SHALL NOT generalise theme
   token inlining beyond the `--spectrum` prefix, SHALL NOT move the detail surface into
   the top layer, and SHALL NOT make the Three.js import dynamic.
7. THE feature SHALL NOT define or consume a per-route initialisation contract, and
   SHALL NOT attempt to make adopted page scripts execute.
8. THE feature SHALL NOT add a runtime or development dependency to
   Build_Configuration.

---

## Known gaps carried into later phases

Recorded so they are not mistaken for oversights:

- **Phase 1 does not validate the feature against a page it did not author.** Every
  detail page it fetches is emitted by the Detail_Page_Generator from the same records
  the tiles are built from. The messy fixtures in Requirement 11.8 cover part of the
  contract's surface on purpose, but they remain fixtures. Whether foreign markup
  captures faithfully stays unproven until a real host serves the pages, and closing
  that gap needs a same-origin real page the prototype has no server to provide.
- **Adopted content is the permanent destination in Phase 1, and only in Phase 1.** From
  Phase 3 the fragment exists solely to be photographed and is replaced by a real
  navigation, which narrows the contract to pixels and shortens the window in which
  unsanitised content is live. Requirements written here should not be read as
  committing to adopted content remaining interactive.
- **Script-dependent detail pages render inert when adopted.** Phase 1's generated pages
  have no scripts, so this does not arise. It becomes the central problem of Phase 5.
