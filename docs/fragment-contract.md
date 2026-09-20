# The Fragment Contract

How a page makes itself turnable.

The paper-turn fetches the page a tile links to, lifts one region out of it, and
prints that region onto the reverse face of the turning sheet. This document is the
whole contract between a page author and the transition. You should not need to read
the transition's source.

Everything here is same-origin only. Cross-origin content is out of scope by
construction — `captureElement` rasterises through an SVG `foreignObject`, which does
not render nested browsing contexts, so an `iframe` would produce a blank reverse
face no matter how the origin question landed.

---

## The minimum

```html
<template data-paper-turn-detail>
  <h2 data-detail-heading tabindex="-1">Your page title</h2>
  <!-- whatever this page's content actually is -->
</template>
```

Two obligations, and a page that misses either falls through to ordinary navigation:
the link still works, the animation is simply not applied.

| Element | Purpose | Required |
| --- | --- | --- |
| `[data-paper-turn-detail]` on a `<template>` | Marks the adoptable region | **Yes** |
| `[data-detail-heading]`, exactly one, inside it | Focus target on settle | **Yes** |
| `data-paper-turn-color` on the region | Feeds `--detail-color` | No — defaults to `#1473e6` |
| Document `<title>` | Reserved for the Phase 3 history entry | No |

### Why a `<template>` specifically

A `<template>`'s content is not rendered. That lets your page lay out its own
visible copy around the region without the content appearing twice — you serve one
page that reads correctly on a direct visit *and* carries an adoptable copy. A
marked `<div>` is rejected rather than accepted, because otherwise you would have to
choose between a page that renders and a page that turns.

A consequence worth knowing: because template content lives in a separate
`DocumentFragment`, a document-level `querySelectorAll` cannot see inside it. Your
page's visible heading and the region's heading do not collide.

### Why exactly one heading

The settle step moves focus there. Two would make the choice arbitrary, and the cost
of guessing lands on assistive technology while the page still looks correct to you.
Zero would land the turn with focus detached from the surface entirely.

---

## Failure modes

All of these are ordinary outcomes. None throws, none leaves a half-open surface,
and every one of them ends with the reader on the page they asked for.

| Reason | What happened | Result |
| --- | --- | --- |
| `invalid-url` | Absent, empty, or not same-origin | No request is made |
| `response-not-ok` | Server answered, not 2xx | Ordinary navigation |
| `request-failed` | Offline, DNS, CORS, transport | Ordinary navigation |
| `missing-region` | No `[data-paper-turn-detail]` | Ordinary navigation |
| `region-not-template` | Marked, but not a `<template>` | Ordinary navigation |
| `missing-heading` | Region has no `[data-detail-heading]` | Ordinary navigation |
| `ambiguous-heading` | Region has more than one | Ordinary navigation |

One case warns instead of failing. **More than one marked region** takes the first in
document order and logs the count. Document order is a defensible default and its
consequence is visible content, where a second heading has neither — but the mistake
is worth surfacing, because its realistic cause is a detail partial rendered twice
(a sidebar widget alongside the article), which puts the wrong copy first and shows
one page's content while the URL is another's. A stricter rule belongs in a
build-time authoring lint, where it can fail for pages you control without switching
the enhancement off on hosts where duplication is routine.

Note that HTML parsing never fails. `DOMParser.parseFromString(html, 'text/html')`
does not throw and produces no `parsererror` node — that is XML-mode behaviour. A
non-HTML body simply yields a document with no marked region and reports
`missing-region`.

---

## Authoring rules that are really facts about the capture

These are not contract requirements. They are consequences of how the reverse face
is rasterised, and each one has cost real debugging time.

**Slot your component text; do not use attribute-only labels.** `html-to-image`
flattens slots via `assignedNodes()`. With an attribute-only heading it gets an empty
list and drops the text, so the component visibly loses its label on the turning
sheet while the live DOM is perfectly correct.

```html
<!-- Good: the text is in light DOM -->
<sp-card><h3 slot="heading">Title</h3></sp-card>

<!-- Bad: silently blank on the sheet -->
<sp-card heading="Title"></sp-card>
```

**Serve images same-origin, or with `crossorigin`.** A cross-origin subresource
without it taints the capture canvas and `texImage2D` throws. This is deliberately
not mitigated: the transition settles through its fallback, so your page still opens,
just with the opacity/scale transition instead of the turn. It is logged
distinguishably so the cause is visible rather than inferred — the symptom otherwise
reads as "the turn works on every page except that one" and sends someone hunting
through the geometry for a fault that is not there.

**Keep a turnable page's content free of script dependencies.** Adoption does not run
`<script>` elements, so a page that depends on its own scripts to produce content
renders inert on the sheet. Such a page should fall through to normal navigation.
Making script-driven pages turnable is Phase 5 work and needs a per-route
initialisation contract.

**Images are awaited, fonts are awaited imperfectly.** Every `<img>` in the adopted
region is awaited to `decode()` before the capture, bounded by a timeout. Fonts are
awaited via `document.fonts.ready`, but the surface is still `display: none` at that
moment and font loading is not reliably triggered by content without layout — so a
page bringing its own webfont may capture with fallback metrics. Nothing in this
prototype loads a webfont, so it has never arisen here.

---

## Security posture

**Fragments are adopted unchanged. Nothing is sanitised.** That is deliberate: the
goal is that the reverse face be the real page, and rewriting the markup defeats the
feature.

What makes that sound is an assumption, not the origin:

> The detail page's content must be no less trusted than the page adopting it.

A WordPress post body is authored outside this project but inside the host site, and
the destination page already renders it on ordinary navigation — so adopting it adds
no exposure the site did not already have.

**The assumption fails in one shape.** Where the adopting page holds privileges the
content's authors do not — a component embedded in an admin screen while posts come
from lower-trust contributors — an inline handler in a post body runs with that
session attached. Such a deployment needs a sanitisation layer, and that is out of
scope here.

**Do not rely on `DOMParser` inertness as a general safety property.** It is often
stated that adoption is safe because `importNode` does not run `<script>` elements.
That is true of `<script>` specifically and narrower than it sounds: inline
event-handler attributes *do* fire once the nodes are live in the document, so
`<img src=x onerror="…">` executes on insertion. The inertness belongs to the parse,
not to the adoption.

The layer that produces the detail page is the security boundary. From Phase 3 the
exposure narrows considerably, because the adopted fragment exists only to be
photographed — it lives for one animation and is then replaced by a real navigation —
but it does not reach zero.

---

## Testing a page against the contract

Fixtures under [`public/fixtures/`](../public/fixtures/) cover each obligation, with
a README explaining what each one probes. The extractor's unit suite
(`tests/unit/fragment.test.ts`) reads them, so adding a fixture is the cheapest way
to pin down a shape the contract should accept or reject.

For the demo's own pages, `scripts/generate-detail-pages.ts` emits one per
`CardRecord`. It is the reference implementation of a conforming page, and worth
reading before authoring one by hand.
