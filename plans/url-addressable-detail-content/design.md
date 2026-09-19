# Design Document: URL-addressable detail content

**Status:** Proposed — not yet approved. `requirements.md` and `tasks.md` are
derived from this document once it is, per the repo's design-first workflow.
**Branch:** `url-addressable-detail-content`
**Supersedes nothing.** Extends [`docs/architecture.md`](../../docs/architecture.md);
the geometry, renderer, and coordinator contracts described there are preserved.

---

## Introduction

Today every detail page is a compile-time constant. `src/data/cards.ts` holds a
frozen 16-element `CardRecord[]` of plain strings, and `DemoApp.renderDetail`
writes those strings into a fixed skeleton with `textContent`. There is no
`url`, no `href`, no `fetch`, and no router anywhere in the repo.

This feature makes the detail surface's content come from **a URL on the same
origin**, so the paper-turn becomes the navigation transition of a real
multi-page application rather than a fixture of a demo. A tile points at a page;
activating the tile turns that page into view.

The originating question was whether *arbitrary* URLs could back the content.
The answer depended entirely on origin, and the answer here is same-origin —
the pages are served by the same app. That single constraint removes most of the
difficulty, and the design below is shaped by what it removes as much as by what
it adds.

---

## What same-origin removes

Worth stating explicitly, because a cross-origin version of this feature is a
substantially harder and less pleasant piece of work, and the distinction is
easy to lose later:

| Concern | Cross-origin | Same-origin (this design) |
| --- | --- | --- |
| Server-side proxy | Required | Not needed |
| Third-party HTML sanitisation | Required, and the permanent hazard | Not needed for app-authored pages |
| CORS preflight / opaque responses | Required | Not applicable |
| `iframe` + `foreignObject` conflict | Fatal — `html-to-image` cannot rasterise iframe content at all, so the sheet turns blank | Not applicable; content is real DOM in our document |
| Canvas tainting on `texImage2D` | Near-certain | Only via a page's own cross-origin subresources — see [Capture fidelity](#capture-fidelity) |

The fatal one is the fourth. The paper-turn is not a CSS effect: `captureElement`
rasterises the destination through an SVG `foreignObject` and uploads the result
as a WebGL texture. `foreignObject` does not render nested browsing contexts, so
any design that reached for an `iframe` would produce a blank reverse face no
matter how the origin question landed. Inlining real same-origin DOM is what
keeps the existing capture path working untouched.

---

## The central decision: resolve before opening

Content now arrives over the network, and the turn cannot begin until it is in
the DOM and laid out — `runFull` measures the destination and captures it in the
same breath. So an unbounded wait has to live *somewhere* in the activation
path. Where it lives is the main architectural choice, and the two candidates
differ enormously in blast radius.

### Rejected: make `prepareDetail` async

The obvious move. `TransitionCoordinator.open()` is already `async`, and
`this.view.prepareDetail(request.sourceId)` sits at `transition-coordinator.ts:101`
inside a `try` whose `catch` already calls `recoverOpenSetupFailure`. Changing
`TransitionView.prepareDetail` from `(sourceId: string): void` to
`Promise<void>` and awaiting it looks like a two-line change, and the existing
throw-path tests would extend to rejection almost for free.

**It is the wrong place.** Awaiting inside `open()` puts an unbounded network
wait *inside the state machine*, between `freezeScroll()` and the first frame.
That has consequences the two lines do not show:

- `preparing` stops being a transient bookkeeping state and becomes a
  long-lived, user-visible one that needs its own cancellation semantics. Escape
  during a fetch, a second activation during a fetch, and a resize during a fetch
  are each new states to reason about in the most intricate and most heavily
  tested module in the system.
- The page is already frozen and inert by then — `setBusy(true)` and
  `freezeScroll()` run first — so a slow page locks scrolling with nothing on
  screen to explain why.
- It breaks the invariant `docs/architecture.md` is emphatic about: everything
  is measured and settled before the turn commits. Measurement happens in
  `main.ts` *before* `open()`; inserting a network round trip after it means the
  measured rects can go stale mid-prepare from a scroll or a reflow.

### Chosen: a content resolver ahead of `coordinator.open()`

Resolve the content to a ready-to-adopt DOM fragment **before** the coordinator
is involved at all. The click handler awaits a resolver; only once the fragment
is in hand does it measure tiles and call `open()`. `prepareDetail` stays
synchronous and adopts an already-resolved fragment.

```
click ─▶ ContentResolver.resolve(url) ────────────── async, cancellable
           │  (cache hit → synchronous, the common case)
           ▼
         measure tiles ─▶ resolveGrabAnchor ─▶ coordinator.open()
                                                 │
                                                 ├─ prepareDetail  (sync, as today)
                                                 ├─ capture × 2
                                                 └─ animate ─▶ settleOpen ─▶ pushState
```

What this buys:

- **The entire transition subsystem is unchanged.** `TransitionView`,
  `TransitionCoordinator`, `geometry.ts`, the renderer, the timeline, and the
  fallback keep their current contracts and their current tests. No new state,
  no new cancellation path, no new failure mode in the state machine.
- Cancelling a pending fetch is just *not calling* `open()` — there is no
  in-flight transition to unwind.
- Nothing is frozen or inert while the network is working, so a slow page leaves
  the list scrollable and the other tiles usable.
- The prefetch cache and the activation path share one abstraction, because both
  are simply `resolve(url)`.

The cost is a new guard. The coordinator throws if `open()` is called while
state is not `idle`, but during a pending fetch the state *is* `idle`, so a
second click would slip past it. The resolver layer therefore owns a
single-flight guard keyed on the activation, and a second activation supersedes
the first rather than queueing behind it.

---

## The fragment contract

A fetched page is a whole HTML document. Something has to say which part of it
becomes the detail surface, and that contract is the feature's public API for
page authors.

The current skeleton in `app.ts` is field-shaped — `[data-detail-subtitle]`,
`[data-detail-heading]`, `[data-detail-description]`, `[data-detail-body]`,
`[data-detail-footer]` — and `renderDetail` assigns each one. Arbitrary pages
cannot be squeezed through five named string slots, so the skeleton splits in
two: the **shell owns the toolbar**, and the fetched fragment owns the whole
content region.

```html
<!-- any detail page served by the app -->
<template data-paper-turn-detail data-paper-turn-color="#1473e6">
  <p class="eyebrow">Design systems</p>
  <h2 data-detail-heading tabindex="-1">Spectrum foundations</h2>
  <!-- whatever this page's content actually is -->
</template>
```

| Contract element | Purpose | Required |
| --- | --- | --- |
| `[data-paper-turn-detail]` | Marks the adoptable region. A `<template>` so the standalone page can render its own full layout around it without the fragment being displayed twice. | Yes |
| `[data-detail-heading]` | Focus target on settle. `settleOpen` moves focus here; without it the turn lands with focus detached. | Yes |
| `data-paper-turn-color` | Feeds `--detail-color`, replacing `CardRecord.color`. | No — falls back to a default |
| Document `<title>` | Drives the pushed history entry's title. | No |

Extraction is `DOMParser.parseFromString(html, 'text/html')`, select the
template, then `document.importNode(template.content, true)`. Parsing through
`DOMParser` rather than assigning `innerHTML` matters: the parsed document is
inert, so scripts do not run and lazy subresources do not begin loading until
the node is adopted, which is what makes the preload/settle sequencing in
[Capture fidelity](#capture-fidelity) controllable.

`CardRecord` gains `url: string` and keeps `title`/`subtitle`/`description`/
`color` for the *tile* face, which is still authored locally — the tile is part
of the index page, not of the destination. `cardById` is unchanged. The 16-record
array remains as the demo's index; a real app would generate it.

### Tiles become anchors

`createCardItem` currently builds a `<button type="button">`. It becomes an
`<a href="{card.url}">`, which is a correctness change independent of the
transition:

- The index works with JavaScript disabled or still loading.
- Crawlers and assistive technology see real navigable links.
- Cmd-click, middle-click, and "open in new tab" work natively.

That last point needs an explicit guard: the delegated handler must **not**
`preventDefault()` when `event.metaKey`, `ctrlKey`, `shiftKey`, or `altKey` is
set, or when `event.button !== 0`. Swallowing a modified click is the classic
way a fancy transition breaks the browser.

The existing capture-boundary comment in `createCardItem` still applies and
still constrains the markup: the anchor label is a *sibling* of the trigger, not
a child, because `captureElement` captures the trigger subtree and because the
grab-anchor resolver measures it. Changing the element type does not change
that.

---

## Latency, and what the user sees while waiting

Click-to-animate today is a couple of frames. A fetch makes it unbounded, and no
amount of shader work hides a 400 ms stall before the sheet moves. Three
mechanisms, in descending order of how much they actually help:

**1. Speculative prefetch — the one that matters.** Prefetch on `pointerenter`,
`focusin`, and `touchstart`, cache the parsed fragment keyed by URL. On desktop
a hovered tile is nearly always the activated tile, so the common case becomes a
cache hit and a synchronous resolve, and click-to-animate returns to its current
latency. This is what makes the feature feel native rather than merely correct.

**2. A latency budget with a fallback commit.** If the fragment is not ready
within a budget (~120 ms is a reasonable starting value; it is a tunable, so it
belongs in `MotionProfile` alongside the other timings), stop waiting for the
full turn and commit to the **existing** fallback transition — the coordinator
already has `runFallbackTo` and a `fallback` motion mode, and
`selectMotionMode()` is already an injected dependency. A slow page degrades to
the opacity/scale path instead of stalling. No new failure machinery; the
degradation target already exists and is already tested.

**3. A pending affordance on the tile.** Beyond roughly 100 ms the activated
tile needs to show it was heard. Scoped to the tile rather than the page, since
nothing is frozen yet and the rest of the list is still live.

Fetch failure is an ordinary outcome, not an exception: on a non-OK response, a
parse failure, or a missing `[data-paper-turn-detail]`, fall through to a normal
browser navigation to the href. The link still works; the enhancement simply
does not apply. That is the correct degradation for a feature layered on real
navigation, and it is why the tiles being real anchors is load-bearing rather
than cosmetic.

---

## Capture fidelity

This is where real content bites, and it is the part of the design most likely
to produce a visibly wrong texture. `docs/architecture.md` already records two
capture traps that cost real debugging time — dropped slot fallback content and
the `<sp-theme>` token detachment — and both have new implications once content
is authored elsewhere.

**Fonts must be settled before capture.** `html-to-image` rasterises at a
moment in time; if a webfont lands after the capture, the texture carries
different text metrics from the live DOM, which is exactly the class of bug the
token-inlining fix addressed. Today no font is fetched at all, so it has never
arisen. Awaiting `document.fonts.ready` after adopting the fragment and before
the capture closes it.

**Images must be decoded before capture.** New: the current cards have no
images. Real pages will. Any `<img>` in the adopted fragment must be awaited to
`decode()` (or `complete`) before capture, or the sheet's reverse face shows
gaps where images will be.

**Cross-origin subresources are the one remaining taint risk.** Same-origin
*documents* do not guarantee same-origin *assets*. A detail page embedding an
image from a third-party CDN without `crossorigin` can taint the capture canvas,
and `texImage2D` then throws. This is not fatal — `capabilities.ts` and the
coordinator already treat capture failure as an explicit outcome that degrades
to the fallback — but it will read as "the fancy transition randomly stops
working on some pages," so it needs a diagnostic rather than silence. The
authoring rule is to serve detail-page images same-origin or with CORS.

**Slotted text remains mandatory.** If page authors use Spectrum components with
attribute-only headings, `html-to-image` flattens the slot via `assignedNodes()`,
gets an empty list, and drops the text — the component visibly loses its label
on the turning sheet while the live DOM is correct. This is now an authoring
rule in someone else's file rather than a fact about `app.ts`, so it belongs in
the documented fragment contract.

**Token inlining keeps working, but only inside `<sp-theme>`.** `themeTokenCss`
walks up to the nearest `sp-theme` ancestor. The adopted fragment must be
injected *inside* the existing `<sp-theme>` in the shell, not as a sibling of it.
The current skeleton already sits inside it; the requirement is simply that the
injection point does not move out.

**Capture cost now scales with content.** DPR and total pixel area are capped by
`MotionProfile`, so the texture cannot grow unboundedly, but rasterisation time
still tracks subtree size and a content-heavy page costs more than a
five-field skeleton. This lands *after* the fetch and also before the first
frame, so it belongs in the same latency budget rather than being treated
separately.

---

## History and standalone pages

A multi-page app means the detail URL is real and must work cold. Two
independent requirements fall out:

- **Every detail page renders standalone**, server-side, at its own URL, with
  its own full layout around the `[data-paper-turn-detail]` template. The
  paper-turn is an enhancement on top of working navigation, never a
  precondition for it.
- **The transition keeps the URL honest.** `pushState` to the detail URL on
  `settleOpen`; `popstate` drives `coordinator.close()`; closing returns to the
  index URL. The coordinator's `close()` already re-measures the source card
  because bounds may have changed, so a browser-driven close needs no special
  handling beyond being routed into the existing path.

One interaction to get right: `popstate` can fire mid-turn. The coordinator
already rejects `close()` unless state is `open`, so the history listener has to
respect the state machine rather than assume it can close at will.

The existing query parameters are untouched. `?tiles=`, `?duration=`,
`?fallback=`, and `?debug=` remain seed-only and are not rewritten, which the
README documents as a guarantee; pushing a *path* does not disturb them, but
they must be carried across the pushed entry or a deep-linked detail page would
silently drop a debug session's setup.

---

## Security posture

Same-origin removes the need to sanitise, but only for content the app itself
authors. Two things are worth keeping in view:

The current `textContent`-only rendering **is** the sanitisation boundary, and
this feature removes it. Adopting parsed nodes is where markup gains the ability
to carry structure, so if any detail page's content is user-authored — a CMS
field, a comment, anything not written by the team — it needs sanitising at
whatever layer produces the page, and that layer is now the security boundary.
Worth recording because it stops being visible in this repo.

`DOMParser` does not execute scripts, and `importNode` of parsed content does
not run `<script>` elements. So adoption does not execute page scripts, which
means any detail page that *depends* on its own scripts for content will render
inert when adopted. That is a real functional limit of the transition path, not
a bug: such a page should fall through to normal navigation.

---

## Phasing

Deliberately more than one PR. The first is self-contained and reviewable; the
later ones are each independently valuable.

| Phase | Scope | Ships |
| --- | --- | --- |
| **1** | `ContentResolver`, fragment contract, `CardRecord.url`, tiles as anchors, generic detail region, `renderDetail` adopts a fragment, fonts/images awaited before capture, failure falls through to navigation | A working URL-backed turn, transition subsystem untouched |
| **2** | Prefetch on hover/focus/touch, fragment cache, latency budget, fallback commit on slow resolve, pending affordance | The turn feels native rather than merely correct |
| **3** | `pushState`/`popstate`, standalone server-rendered detail pages, deep linking, query-param carry-over | Real navigation |
| **4** | Cross-origin subresource diagnostics, capture-cost telemetry, authoring lint for the fragment contract | Operability |

**This branch is Phase 1.** Phases 2–4 get their own branches and their own PRs.

---

## Test strategy

The existing layering holds — unit for pure logic, Playwright for interaction,
Chromium-desktop baselines for pixels. What is new:

| Layer | Adds |
| --- | --- |
| Unit | Fragment extraction against well-formed, malformed, and contract-violating HTML. Resolver cache behaviour, single-flight, supersession. Modified-click guard. `CardRecord.url` validation. |
| Interaction | Activation with a stubbed slow response, activation with a failing response falling through to navigation, second activation superseding a pending one, Escape during a pending fetch. |
| Visual | **No new baselines in Phase 1 if it can be avoided.** |

That last line is a deliberate constraint, not laziness. `docs/architecture.md`
records that the hero copy is frozen because the hero sits above the grid in
every baseline, that the midline baselines run at 400 × 1200 with roughly 60 px
of slack before a `fullPage` capture would scroll and fire the resize the
coordinator treats as an interruption, and that Linux baselines may only be
produced by the `update-visual-baselines` workflow on an ubuntu runner. Phase 1
should therefore keep the *index* page visually identical — same hero, same grid,
same three-tile default — so that changing `<button>` to `<a>` is proven by
interaction tests and by the corner-parity golden test rather than by six
screenshots on two platforms.

If the anchor change does move pixels, the six frames must be regenerated on
both platforms and **reviewed by eye**, per the existing rule, and the Linux set
must come from the workflow rather than from a Darwin machine.

---

## Open questions

These need answers before `requirements.md` can be derived, and I do not think
any of them should be settled unilaterally:

1. **What serves the pages?** The prototype is a static Vite build deployed to
   GitHub Pages by `deploy-pages.yml`. "Same server, many pages" implies
   something that renders detail pages — a static multi-page Vite build with an
   input per page, or a framework, or an existing app this is being grafted onto.
   Phase 1 can be developed against static fixture pages in `public/`, but Phase
   3 cannot be designed without knowing this.
2. **Is any detail-page content user-authored?** Decides whether a sanitisation
   layer is in scope at all.
3. **Is the 16-record demo index kept** as a fixture alongside real content, or
   replaced? It is what every visual baseline and the tile-count control are
   written against, so replacing it is a larger change than it looks.
4. **Does the latency budget belong in `MotionProfile`?** It is a timing and a
   designer-tunable, which argues yes; but `MotionProfile` is constructed as a
   literal by four test suites, and `docs/architecture.md` records that widening
   it is a deliberate cost. A separate resolver config may be cleaner.

---

## What this design does not do

- No cross-origin content, no proxy, no `iframe`. Out of scope by construction,
  and the `foreignObject` limitation means an `iframe` path could not render the
  turn at all.
- No change to the geometry, the shaders, the renderer, the timeline, or the
  coordinator's state machine.
- No client-side router. Phase 3 adds history integration to real navigation; it
  does not add a routing layer.
- No change to `?tiles=`, `?duration=`, `?fallback=`, or `?debug=` semantics.
