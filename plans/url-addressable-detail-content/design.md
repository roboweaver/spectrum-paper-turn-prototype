# Design Document: URL-addressable detail content

**Status:** Approved. [`requirements.md`](./requirements.md) is derived from this
document and covers **Phase 1 only**; `tasks.md` follows from it. Open questions
1–4 and 7–9 are answered below. Questions 5 and 6 remain open and gate Phase 5
rather than Phase 1.

One scope change was made at approval: **navigation on settle moved from Phase 1
to Phase 3.** See [Phasing](#phasing) for why.
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

The eventual delivery target is **a component embedded in existing sites**
(Grimoire, WordPress, OPA) rather than an application of its own, which means it
needs no server: the host serves the pages, and same-origin holds for free. See
[Packaging as a component](#packaging-as-a-component). That target does not change
the mechanism this document specifies, but it does add a set of host-interaction
hazards, and it is why phase 1 is scoped to prove the mechanism in the
prototype's own page first.

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
                                                 └─ animate ─▶ settleOpen
                                                                 │
                                                                 └─ pushState, then
                                                                    navigate  (Phase 3)
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
within a budget (~120 ms is a reasonable starting value), stop waiting for the
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

**Resolved: the budget does not live in `MotionProfile`.** It is a timing and a
tunable, which argued for putting it there, but `MotionProfile` is constructed as
a literal by four test suites and `docs/architecture.md` records that widening it
is a deliberate cost. The resolver's tunables — the latency budget, the
capture-readiness bound, the cache policy — go in a separate `ResolverConfig`
instead. That keeps this feature's blast radius off the motion contract entirely,
and the two objects have different owners in practice: a designer tunes motion, an
engineer tunes network behaviour.

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

**Cross-origin subresources are an accepted risk, documented and not solved.**
Same-origin *documents* do not guarantee same-origin *assets*. A page embedding
an image from a third-party CDN without `crossorigin` can taint the capture
canvas, and `texImage2D` then throws.

This is deliberately **not** something this design mitigates. The degradation
path already exists and is already correct: `capabilities.ts` and the coordinator
treat capture failure as an explicit outcome that settles through the fallback,
so the affected page still opens, just with the opacity/scale transition instead
of the turn. Building detection, per-asset rewriting, or a proxy to recover the
full turn would cost more than the outcome is worth.

What it needs is to be **known** rather than mysterious, because the symptom —
"the turn works on most pages and not on that one" — invites a hunt for a
geometry or renderer bug that isn't there. So:

- The authoring guidance is to serve images used on turnable pages same-origin
  or with `crossorigin`, and that guidance lives with the fragment contract.
- The failure is logged distinguishably from other capture failures, so the
  cause is visible in a console rather than inferred.
- No requirement will be derived asserting the full turn survives a tainted
  capture. The asserted behaviour is that it degrades cleanly.

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

## History and real URLs

A multi-page app means the detail URL is real and must work cold. Two
independent requirements fall out — and the first is **already satisfied by any
real host**, which is the main practical benefit of the component framing:

- **Every detail page renders standalone**, server-side, at its own URL, with its
  own full layout around the `[data-paper-turn-detail]` template. The paper-turn
  is an enhancement on top of working navigation, never a precondition for it.
  Grimoire, WordPress, and OPA all do this already by being ordinary
  server-rendered sites, so nothing needs building here; the obligation is only
  that the component must not *break* it. For the prototype's own page this is
  the one part that has to be simulated, with static fixtures in `public/`.
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

**Correction, and it matters more than the sentence above implies.** "Adoption
does not execute page scripts" is true of `<script>` elements specifically and is
narrower than it reads. Inline event-handler attributes *do* fire once the nodes
are live in the document — `<img src=x onerror="…">` executes on insertion. So
the inertness of the parsed document is a property of the *parse*, not of the
adoption, and it cannot be leaned on as a general safety guarantee. It does not
change the Phase 1 position below, but Phase 4 must not carry the stronger
reading into WordPress.

### Resolved: no sanitiser, and the assumption that licenses it

**Decision: adopt faithfully, do not sanitise.** The goal is that the reverse face
be the real page, so rewriting the markup defeats the feature. The trust
assumption that makes this sound is narrower than "same-origin", and is worth
stating precisely:

> Adoption is safe where the detail page's content is no less trusted than the
> page performing the adoption.

A WordPress post body is authored outside *this project* but inside *the host
site*, and the destination page already renders it on ordinary navigation. So
adopting it into the index page adds no exposure that the site did not already
have. The assumption fails in exactly one shape: where the adopting page holds
privileges the detail page's authors do not — a component embedded in an admin
screen while posts come from lower-trust contributors. Then an `onerror` in a post
body runs with the admin session attached. That deployment needs a sanitisation
layer, and it is out of scope here.

Two things narrow the exposure further, and only the first applies in Phase 1:

- The adopted fragment is never interactive in the sense that matters — Phase 1
  adopts it as the destination, but no page script runs, so the surface is markup
  and CSS.
- **From Phase 3 the fragment exists only to be photographed.** It lives for one
  animation duration and is then replaced by a real navigation. Hostile markup
  gets a window of one turn rather than a live page. Not zero — an `onerror` still
  fires during the capture — but a much smaller blast radius than Phase 1's, which
  is a further reason the phases are ordered this way.

---

## Packaging as a component

The intent is to embed this in existing sites — Grimoire, WordPress, and OPA —
rather than to run it as its own application. **It needs no server of its own,**
and the same-origin requirement is satisfied for free because the pages it
fetches are the host's own.

This is a better fit than the standalone framing, not a compromise. A real site
already has working links to real pages, so the component becomes a genuine
progressive enhancement: intercept a click that already worked, turn the page
into view, and fall through to ordinary navigation on any failure. It also
answers the phase-3 question outright — nothing needs building to serve detail
pages, because the host already does.

What it costs is a packaging change the prototype has not begun, plus a set of
host-interaction hazards that do not exist in a page we control.

### The inversion: adopt the host's tiles, don't render them

Today `createDemoApp(root)` assigns `root.innerHTML` with an entire application
shell — hero, eyebrow, grid, detail surface. There is **no custom element and no
shadow root anywhere in `src/`**. It is an app, not a component.

As a component it should not render tiles at all. The tiles are the host's:
a WordPress post grid, a Grimoire archive listing. So the component's input
becomes *a selector for links that already exist*, and its job is to enhance
them:

```js
paperTurn.enhance({ links: '.post-grid a.post-link' });
```

This inverts much of the current data path out of the critical case.
`CardRecord`, `cards.ts`, `createCardItem`, and `sp-card` become the **demo's**
index — a fixture the prototype keeps for its own page and its visual baselines
— rather than the mechanism. The grab-anchor resolver is unaffected and is the
part that carries over cleanly, because it already derives everything from
measured rects and knows nothing about who authored the markup.

### Host-interaction hazards

Each of these is verified against the current source, not anticipated.

**Global CSS would restyle the host.** `src/styles.css` opens with `:root`,
`* { box-sizing: border-box }`, `html, body { margin: 0 }`, and
`button { font: inherit }`, then uses generic names like `.hero`, `.eyebrow`,
`.list-surface`, and `.demo-shell`. Loading that into a WordPress theme changes
the entire page. The component's styles must be scoped — shadow root, or a
mandatory prefix — and the resets must not ship at all.

**The token-inlining fix does not generalise, and this is the significant one.**
`THEME_TOKEN_PREFIX` is `'--spectrum'` (`capture.ts:83`) and the walk is
`element.closest('sp-theme')` (`capture.ts:109`). On a host that is not
Spectrum, there is no `sp-theme` to find and no `--spectrum*` property to
enumerate, so `themeTokenCss` returns an empty string and the capture proceeds
with nothing inlined.

That is *exactly* the bug `docs/architecture.md` records — the `foreignObject`
clone is detached and inherits nothing, so every custom property silently falls
back, producing collapsed padding, wrong greys, and text metrics that no longer
match the box they were measured into. It was fixed narrowly, for Spectrum, and
a component capturing host DOM reintroduces it in general form for whatever
custom properties the host's cascade provides. The fix is to inline **all**
inherited custom properties from the capture root's ancestor chain rather than a
hardcoded prefix from a hardcoded element.

Note the same doc's warning about how this failure presents: it reproduced on a
designer's Mac and not in headless Chromium, because a machine that resolves the
same fallbacks on both sides sees nothing wrong. A CI suite running on one host
is not evidence of absence here.

**`position: fixed` is not reliable inside a host page.** `.detail-surface` is
`position: fixed; z-index: 20; inset: 0` and the WebGL overlay is the same at
`z-index: 30`. Two independent ways that breaks:

- Any ancestor with `transform`, `filter`, `perspective`, `backdrop-filter`,
  `contain: paint`, or `will-change: transform` becomes the containing block, and
  the "full-viewport" surface silently becomes container-sized. Animation-heavy
  WordPress themes do this routinely.
- `z-index: 20`/`30` loses to a WordPress admin bar at `99999` or a sticky header
  at `9999`, so the detail surface would render *underneath* host chrome.

The clean answer is the **top layer** — a `<dialog>` opened with `showModal()`
escapes both z-index competition and transformed-ancestor containing blocks by
definition. Whether `html-to-image` rasterises a top-layer element correctly, and
where the WebGL overlay has to sit relative to it, I have **not** verified. It
should be spiked before being committed to.

**`freezeScroll()` mutates the host's `<body>`,** setting `position: fixed` and a
negative `top`. In our own page that is safe. In a host page it fights sticky
headers, scroll-linked animations, and anything else reading scroll position, and
it must become overridable.

**Bundle size is a real objection in a WordPress context.** The build is 1.22 MB
raw and 237 kB gzipped, the bulk of it Three.js, to animate a transition. Three
is a static import today, but the fallback path needs no WebGL at all, so it
should be loaded dynamically only once a full-motion turn is actually committed.
That moves most of the weight off the critical path for every visitor who never
clicks, and off it entirely for visitors who take the fallback.

**Custom element name collisions.** Nothing in `src/` calls
`customElements.define` yet, but the Spectrum components do it on import.
`define` throws on a duplicate name, so a host that already loads Spectrum — or
two plugins that each bundle this component — breaks. Registration has to be
guarded.

**Firefox already degrades, and it will show more.** `computedStyleMap()` is
Chromium-only and `themeTokenCss` is guarded to skip inlining without it. That is
tolerable when the only tokens at stake are Spectrum's own; it is more visible
when host CSS is what the capture is missing.

### What this means for the phasing

The component packaging is **not** phase 1 work, and phase 1 does not need to
guess at it. Phase 1's deliverable — a content resolver, a fragment contract, and
a sync `renderDetail` that adopts a fragment — is the same mechanism either way,
and is best proven in the prototype's own page where the CSS and the theme are
known. The component form then becomes its own phase, with the hazards above as
its checklist.

One thing phase 1 should avoid on account of it: do not deepen the assumption
that the component renders its own tiles. Keeping the resolver keyed on a URL
rather than on a `CardRecord` id is enough to leave the inversion open.

---

## The navigation-surface use case (OmnisTools)

The intended use in OPA — OmnisTools — is to **replace** the navigation, not to
decorate it. Today it is a Bootstrap navbar with dropdowns (`Tracking` → List,
Add, Report, Actions ▸, Activities ▸, Topics ▸). The proposal is that the
dropdown goes away and each destination becomes a tile, so the tile grid *is* the
navigation and turning a tile over is how you arrive at a page.

### What this framing fixes

A grid is a much better fit than a dropdown, and several problems evaporate:

- **The full anchor vocabulary works as designed.** A vertical dropdown is a
  single column, so every item would resolve through the degenerate
  single-column rule and the eight-anchor variety would collapse to one axis
  family. A real grid is exactly the shape the resolver was built for.
- **No dropdown clipping.** A tile grid inside a Bootstrap `.dropdown-menu` would
  have fought that element's overflow and positioning. A grid that is the page
  body does not.
- **The list-surface model is already correct.** The grid is a page, not transient
  chrome, so hiding the list on settle (`setListVisible(false)`) is the right
  behaviour rather than something to work around.

### The blocker: these destinations are applications, not documents

This is the significant finding, and nothing above addresses it.

The destination pages are interactive. The Tracking list has a search field, an
Advanced Search control, and sortable column headers. The Add page has date and
time pickers, dependent multi-selects, and a checkbox table. All of that is
script-driven.

`DOMParser` does not execute scripts, and `importNode` of parsed content does not
run `<script>` elements. So **adopting one of these pages yields dead HTML**: the
markup arrives, the pickers never initialise, the table never sorts.
[Security posture](#security-posture) already says a page depending on its own
scripts should fall through to normal navigation — but for OmnisTools that is
*every* page, so the enhancement would never engage and the feature would do
nothing.

### Resolved: render live, through an app-provided init contract

OmnisTools is a plain TypeScript Node application with no Turbo, htmx, or
similar navigation layer, and a refactor on the scale of its earlier move to Node
and Bootstrap is acceptable. Live rendering is preferred, with load-on-settle
acceptable as a fallback. That settles the architecture, and it rules out the two
obvious candidates for different reasons.

**Generic script re-execution is the wrong tool.** Turbo Drive works by fetching
a page, replacing the body, and evaluating the response's scripts, with dedup,
ordering, history, and cache invalidation all handled. Without Turbo already
present, that is a navigation framework built from scratch underneath a
transition effect. It is also **unnecessary here**: in a single-bundle TypeScript
app the client code is *already loaded* on the grid page. The code is present; the
only thing missing is its binding to newly arrived DOM. So the mechanism is not
"re-run the scripts" but "initialise a subtree", which is a far smaller thing.

**Preview-only is less than what is wanted.** It sidesteps initialisation
entirely, but the reverse face is then a static approximation rather than the
page, and live was the stated preference.

So the target is **live, via a contract the application implements**:

```ts
// OmnisTools side, one per turnable route
interface PaperTurnPage {
  /** Bind behaviour to a freshly adopted subtree. Root-scoped, never document-wide. */
  init(root: HTMLElement): void | Promise<void>;
  /** Release listeners, timers, and observers when the page is turned away from. */
  destroy?(root: HTMLElement): void;
}
```

Four properties are load-bearing, and each is a real constraint on the refactor
rather than a formality:

- **Root-scoped.** Init must bind within a passed element, not query `document`.
  Anything reaching for `document.querySelector` will bind to the grid page or to
  nothing.
- **Idempotent.** The same route will be initialised repeatedly across a session.
- **Awaitable when not synchronous.** If the page's content is not settled when
  `init` returns — a table fetching its own rows is the obvious case — it must
  return a promise that resolves when it is. See below; this is the constraint
  that matters most.
- **Tear-down-able.** Without `destroy`, every navigation leaks whatever `init`
  attached, and in a tool used all day that accumulates.

The server side needs **a partial render mode per route**: the same template
rendered without the surrounding layout, exposing `[data-paper-turn-detail]`.
Worth noting that both the live path and the preview path need exactly this, so it
is the shared foundation and the first thing the refactor should establish.

### The sequencing constraint that decides whether "live" looks right

This is the sharp edge, and it is not obvious.

`runFull` captures the destination to a texture **before the first frame**, and
the sheet prints that texture on its reverse face. `docs/architecture.md` is
explicit about why that matters: at progress 1 the sheet's geometry equals the
destination rect exactly, so the handoff from texture to real DOM lands
pixel-for-pixel and is invisible.

If `init` — or a data fetch it triggers — completes *after* the capture, that
property breaks. The sheet turns over showing an uninitialised skeleton: no date
picker, an unsorted table, quite possibly an empty one. Then at settle the real
DOM appears fully populated and the content visibly pops. The turn would be
technically correct and look broken.

So the order must be:

```
adopt fragment → init(root) → await ready → capture → animate → settle
```

which puts initialisation *and any data it fetches* on the pre-turn critical
path. A list view that AJAXes its rows could add hundreds of milliseconds there.

**The answer is prefetch plus pre-initialisation, offscreen.** On
`pointerenter`/`focusin`, adopt the fragment into the detail surface, run `init`,
and let its data land — so that by the time the tile is clicked the destination is
already adopted, initialised, settled, and capturable. This composes directly with
the prefetch work in phase 2 rather than needing its own machinery.

It also builds on a mechanism that already exists and is already tested. During
`preparing` the detail surface is displayed but clipped to a degenerate point, and
the capture passes `{ clipPath: 'none' }` as a style override so `html-to-image`
rasterises the clone unclipped while the live element stays collapsed. "Rendered,
initialised, and measurable, but not visible" is therefore an established idea in
this codebase; pre-initialisation moves it earlier rather than inventing it.

Two escape hatches, both reusing paths that already exist:

- A route that cannot be ready inside the latency budget commits to the
  **fallback** transition, exactly as a slow resolve does.
- A route whose `init` cannot be made safely idempotent serves a **preview
  fragment** instead and does a real navigation on settle. Same server partial
  mode, different client handling — so keeping this available costs nothing beyond
  the branch.

**Phase 5 therefore spans two repositories.** This one defines the contract, the
resolver, the pre-init sequencing, and the fallback behaviour. OmnisTools
implements `PaperTurnPage` per route and the partial render mode. The contract is
the interface between them, and it should be pinned down here before the app-side
refactor starts.

### Grid shape policy is wrong for arbitrary navigation

`gridShapeFor` derives its column count from the most balanced **exact factor
pair**, deliberately so the shape is always full with no ragged last row. That
serves the demo's purpose — clean, namable shapes that reach all eight anchors —
but it is the wrong policy for a real navigation set, whose size is whatever it
happens to be. Eleven destinations is prime, so it asks for a single row of
eleven, which is not a launcher layout.

Navigation wants *"N columns, filled left to right, ragged last row allowed."*
The measurement side already supports that — `gridPositionFromRects` clusters
measured rects, and `gridShapeFor`'s own contract notes a capped shape "reports
its real, possibly partial, last row" — so this is a policy change in the demo's
layout chooser, not a change to anchor resolution.

Related: `MAX_TILE_COUNT` is `16` and `clampTileCount` hard-clamps to it, with
the `cards` array a second ceiling at the same number, so a 20-destination grid
would silently lose four tiles. Both caps live in the **demo layer**, not the
mechanism — `resolveGrabAnchor` works purely from measured rects and knows
nothing about tile counts — so raising them is small. But note
`docs/architecture.md` records the resolution table as verified against an
independent expectation over "all 64 grid shapes," which is the 1–16 range.
Beyond it is untested rather than broken, and wants coverage before a real nav
set depends on it.

### Duration is tuned for a demo, not for work

The shipped full-motion duration is 720 ms. That is right for a prototype whose
purpose is to be admired. As the primary navigation of a tracking application it
would be traversed dozens of times a day, and 720 ms on every navigation will
wear badly.

This needs retuning — materially shorter — for the navigation case, and the
existing machinery already allows it: `durationMs` is a `MotionProfile` field and
the debug speed control exists precisely to find a value by feel.
`prefers-reduced-motion` already routes to the fallback, so the accessibility
floor is covered; this is about the default for everyone else.

### Stacking, concretely

`.detail-surface` is `z-index: 20` and the WebGL overlay is `z-index: 30`.
Bootstrap's `$zindex-fixed` is **1030**, so a fixed OmnisTools navbar renders
*over* both, and a modal backdrop (1040+) higher still. This is the concrete
instance of the hazard in [Packaging as a component](#packaging-as-a-component),
and it is why the top layer via `<dialog>.showModal()` is the preferred answer
rather than an escalating z-index. That spike is load-bearing for this use case
rather than optional.

---

## Phasing

Deliberately more than one PR. The first is self-contained and reviewable; the
later ones are each independently valuable.

| Phase | Scope | Ships |
| --- | --- | --- |
| **1** | `ContentResolver`, fragment contract, `CardRecord.url`, tiles as anchors, generic detail region, `renderDetail` adopts a fragment, fonts/images awaited before capture, failure falls through to navigation | A working URL-backed turn, transition subsystem untouched |
| **2** | Prefetch on hover/focus/touch, fragment cache, latency budget, fallback commit on slow resolve, pending affordance | The turn feels native rather than merely correct |
| **3** | `pushState`/`popstate`, deep linking, query-param carry-over, **navigation on settle**, and what the reverse turn means once a real navigation has replaced the document. *Not* standalone page rendering — the host already serves real pages. | Real navigation, on real pages |
| **4** | **Component packaging.** Generalise token inlining beyond `--spectrum`, scope or shadow the CSS, top-layer surface, dynamic Three import, guarded element registration, adopt host tiles instead of rendering them, overridable scroll freeze | Embeddable in Grimoire, WordPress, OPA |
| **5** | `PaperTurnPage` init contract, pre-init during prefetch, capture-after-ready sequencing, preview escape hatch, nav grid layout policy, raised tile ceiling, retuned duration. **Spans two repos** — OmnisTools implements the contract and a per-route partial render mode. | Usable as OmnisTools navigation |
| **6** | Cross-origin taint logging, capture-cost telemetry, authoring lint for the fragment contract | Operability |

**This branch is Phase 1.** Phases 2–6 get their own branches and their own PRs.

### Why navigation on settle is Phase 3 and not Phase 1

The end goal is the full turn onto real pages, and a turn that lands on adopted
DOM only reaches that goal for pages with no script dependency. So the instinct is
to put "navigate to the real URL once the turn settles" in Phase 1 and have the
mechanism be honest from the start. Two things say otherwise.

**Phase 1 is not dead without it.** Its destinations are the pages the
Detail_Page_Generator emits from `cards.ts` — the five-field skeleton, plain text,
no scripts. Adopted, those are completely live, because there is nothing to
hydrate. Phase 1 demonstrates end to end with no navigation at all. The inertness
problem is a property of *foreign script-dependent* pages, which Phase 1 does not
have by construction.

**Navigating on settle destroys the reverse turn, and repairing it is history
work.** `close()` is fully built: `runTransition('close')`, a `closing` state, the
close button and Escape both wired in `main.ts`, and both faces captured in one
pass specifically so the reverse pays for no second capture. Navigate away on
settle and none of that survives — the document is replaced, the coordinator
instance is gone, and "close" degrades into a back-navigation to a freshly loaded
index that must re-measure from scratch. Reconstructing a reverse turn across a
document boundary is real design work, and it is the same subject as
`pushState`/`popstate`: what the history entries are, what Back means mid-turn,
and what the close affordance does once it is a navigation. Doing it in Phase 1
means doing that thinking twice.

Keeping them together also clarifies the fragment contract. In Phase 1 the adopted
fragment *is* the destination. From Phase 3 it exists only to be photographed —
one animation duration, then a real page load replaces it. That is a narrower
obligation (pixels only, never interactive, never needs to survive), and it is
easier to specify once than to specify one way and then loosen.

Phase 4 is the largest and is gated on the host stacks. Grimoire is Go with
server-rendered templates under `themes/` and a separate React admin SPA, so its
public site is a straightforward host. WordPress is the hard one: unknown theme
CSS, plugin soup, an admin bar above our stacking context, and near-certain
user-authored content. OmnisTools is a Bootstrap application whose pages are
script-driven, which is what makes phase 5 a distinct piece of work rather than a
configuration of phase 4 — see
[The navigation-surface use case](#the-navigation-surface-use-case-omnistools).

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

1. ~~**What serves the pages?**~~ **Answered: the host application does.** This
   ships as a component embedded in an existing site, so it needs no server of
   its own. See [Packaging as a component](#packaging-as-a-component) — this
   answer simplifies the design rather than complicating it, because the host's
   links already work and the component becomes a true progressive enhancement.
2. ~~**What is OPA?**~~ **Answered: OmnisTools**, a Bootstrap application whose
   navbar dropdowns would be replaced by a tile grid. See
   [The navigation-surface use case](#the-navigation-surface-use-case-omnistools).
   It raises its own blocking question, below.
3. ~~**Does OmnisTools already use Turbo or htmx?**~~ **Answered: no** — a plain
   TypeScript Node application, and a refactor on the scale of its move to Node
   and Bootstrap is acceptable. Generic script re-execution is therefore both
   unavailable and unnecessary; the resolution is an app-provided init contract.
4. ~~**Is a preview fragment acceptable?**~~ **Answered: live is preferred,
   load-on-settle acceptable.** So live is the target and preview becomes a
   per-route escape hatch rather than the default.
5. **Can every turnable route's `init` be made idempotent and root-scoped?** The
   live path depends on it. Any route that cannot falls back to a preview
   fragment, so this determines how much of the app gets the full effect rather
   than whether the feature works at all.
6. **Which routes fetch their own data after init, and how slow are they?** This
   sets the pre-init prefetch budget, and decides which routes can realistically
   be capture-ready by click time.
7. ~~**Is any detail-page content user-authored?**~~ **Answered: yes, and it is
   adopted unchanged — no sanitiser.** The goal is that the reverse face be the
   real page, so rewriting the markup defeats the feature. What makes this sound
   is a stated assumption rather than the origin: the detail page's content must be
   no less trusted than the page adopting it. See
   [Resolved: no sanitiser](#resolved-no-sanitiser-and-the-assumption-that-licenses-it),
   which also records the one deployment shape that breaks the assumption and the
   correction to the `importNode` safety claim.
8. ~~**Is the 16-record demo index kept?**~~ **Answered: kept in full, and it
   generates the detail pages.** All sixteen stay — `MAX_TILE_COUNT` is 16 and the
   four-by-four is what reaches all eight grab anchors, so dropping below it would
   discard coverage two merged PRs established. Each record gains a `url`, and a
   build-time generator emits one page per record.

   The cost here was never proxying — same-origin settled that. It is baselines:
   five of the six frames carry *captured detail content* (`peak-curl`,
   `diagonal-midpoint`, `settled`, `midline-peak-curl`, `midline-midpoint`), and
   only `paper-turn-start` is grid-only. So generating the pages from the same
   `cards.ts` with the same markup `renderDetail` emits today is what lets Phase 1
   change where the DOM comes from without changing the DOM. Hand-authored files
   would drift from the records and the drift would surface as a ten-image,
   two-platform baseline review. Realism is bought separately, with a few
   deliberately messy fixtures that no visual spec touches.
9. ~~**Does the latency budget belong in `MotionProfile`?**~~ **Answered: no, a
   separate `ResolverConfig`.** See
   [Latency](#latency-and-what-the-user-sees-while-waiting). Keeps the motion
   contract untouched and the four test suites that build a `MotionProfile` literal
   compiling unmodified.

### Still open, and gating Phase 5 rather than Phase 1

Questions 5 and 6 need access to the OmnisTools source and constrain the init
contract, not the resolver. They are recorded here and carried into the Phase 5
spec; Phase 1 neither answers nor depends on them.

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
- **No server of any kind.** The host application serves the pages. Nothing here
  requires a proxy, an API, a build-time page generator, or a runtime.
- No mitigation of cross-origin subresource tainting. It is documented as an
  accepted risk that degrades to the fallback, and logged so it is diagnosable.
- No component packaging in phase 1. The mechanism is proven in the prototype's
  own page first; phase 4 makes it embeddable.
- **No navigation on settle in phase 1.** Moved to phase 3, with the history work
  and the reverse-turn question it is inseparable from. See
  [Why navigation on settle is Phase 3](#why-navigation-on-settle-is-phase-3-and-not-phase-1).
- **No validation against a page this repo did not author.** Every page Phase 1
  fetches is emitted from the same records the tiles are built from. The messy
  fixtures probe the contract's edges deliberately, but they are still fixtures.
  Whether foreign markup captures faithfully stays unproven until a real host
  serves the pages, and closing that gap needs a same-origin real page the
  prototype has no server to provide. Recorded as a known gap rather than
  something Phase 1 pretends to cover.
