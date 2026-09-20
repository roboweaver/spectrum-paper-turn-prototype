# Fragment contract fixtures

Hand-authored pages that probe the edges of the fragment contract. Committed
source, unlike the generated pages under `public/detail/`, and deliberately in a
sibling directory so `scripts/generate-detail-pages.ts` — which wipes its own
output directory each run — cannot reach them.

They are served from `public/`, so both the unit suite (reading them off disk) and
the interaction suite (fetching them same-origin) can use them.

**No visual spec may reference these.** The generated pages exist to keep the
twelve committed reference images valid; these exist to break things. Mixing the
two would pay for contract realism in cross-platform baseline reviews.

## Should extract

| File | Probes |
| --- | --- |
| `rich-content.html` | Nested structure, an `<img>`, heading depth beyond `<h3>`, `<figure>`, `<blockquote>`, `<table>`, an inline `<style>` |
| `inline-handler.html` | An inline `onerror` attribute. Adopted **unchanged** — the design's position is to adopt faithfully, and this fixture is what stops a future sanitiser being added without a decision |
| `minimal.html` | The smallest page satisfying the contract: a marked `<template>` and one heading, nothing else |
| `two-regions.html` | Two marked regions. Extracts the **first in document order** and warns — see below |

## Should fail extraction

| File | Obligation it violates |
| --- | --- |
| `no-region.html` | No `[data-paper-turn-detail]` anywhere |
| `region-not-template.html` | The marked region is a `<div>`, not a `<template>` |
| `no-heading.html` | Marked `<template>` with no `[data-detail-heading]` |
| `two-headings.html` | Marked `<template>` with two `[data-detail-heading]` elements |
| `not-html.json` | Body is JSON, not a document |

### On `two-regions.html`, which warns rather than failing

Two marked regions is the one ambiguity that does *not* fail, and the asymmetry
with `two-headings.html` is deliberate.

Two headings has no defensible default. Focus has to land somewhere, choosing one
is arbitrary, and the cost falls on assistive technology while the page still looks
correct to whoever authored it. Two regions has a defensible default in document
order, and its consequence is visible content on the sheet.

What makes silence wrong here is how the mistake presents. The realistic cause is a
duplicated detail partial — a sidebar widget rendering the same template as the
article — which puts the sidebar's copy first. The sheet then shows one page's
content while the URL is another's, which reads as a fault in the geometry or the
renderer and sends the reader looking where the fault is not. Once Phase 3 adds
navigation on settle it gets stranger still: the turn shows one article and the
browser arrives at another.

So the extractor defaults to document order and logs distinguishably. That is the
same posture the design took for cross-origin tainted captures: do not mitigate, do
not refuse, make it known rather than mysterious. A stricter rule belongs in the
Phase 6 authoring lint, where it can be a build-time error for pages the team
controls without switching the enhancement off on hosts where duplication is
routine.

### On `not-html.json`

`DOMParser.parseFromString(body, 'text/html')` is extremely lenient: it does not
throw and it does not produce a `parsererror` node, which is an XML-mode
behaviour. So the "body does not parse" branch of Requirement 3.6 is effectively
unreachable for `text/html` — a non-HTML body parses into a document that simply
contains no marked region, and fails as `missing-region`.

This fixture exists to prove that, rather than to exercise a parse-failure path
the platform will not give us. The extractor documents the same thing.
