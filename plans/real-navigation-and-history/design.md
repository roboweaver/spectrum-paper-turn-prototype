# Design Document: Real navigation and history

**Status:** Proposed — not yet approved. `requirements.md` and `tasks.md` are derived
from this document once it is, per the repo's design-first workflow.

**Branch:** `phase-3-real-navigation`

**This is Phase 3 of the six-phase plan** in
[`../url-addressable-detail-content/design.md`](../url-addressable-detail-content/design.md).
Phase 1 is merged. Phase 2 is planned in
[`../prefetch-and-latency-budget/design.md`](../prefetch-and-latency-budget/design.md)
and is independent of this — neither blocks the other, though the two touch the same
activation path and should not be built concurrently.

**Supersedes a decision made during Phase 1 planning.** See
[Correcting the navigation-on-settle plan](#correcting-the-navigation-on-settle-plan).

---

## Introduction

The detail content is real, and the URL is a lie.

Phase 1 fetches `detail/spectrum.html`, adopts it, and turns the sheet over onto it —
while the address bar still reads `/`. Reload and you are back at the index. Copy the
URL and you send someone the grid. Press Back and you leave the site. The transition
is navigation in every respect except the one the browser can see.

Phase 3 makes the URL honest. It is a smaller change than it sounds, and the reason is
the subject of the next section.

---

## Correcting the navigation-on-settle plan

During Phase 1 planning I argued that "the back of the tile should be an actual live
page" required a **real navigation once the turn settles** — fetch and adopt for the
snapshot, then `location.assign` to land on the genuinely live page. It was scheduled
into this phase on that basis.

**That was wrong, and the mistake was assuming adopted content is not already live.**

It is. `document.importNode` produces real nodes in the real document. Links work,
CSS applies, forms focus, `:hover` responds, the text is selectable. What adoption
does *not* do is run the page's own `<script>` elements. So the honest statement is
narrower than "adopted content is inert":

> Adopted content is fully live for **document-like** pages, and inert only in the
> parts of **application-like** pages that depend on their own scripts.

A WordPress post, a Grimoire archive entry, a documentation page: live. A dashboard
with a date picker and a sortable table: the markup arrives, the behaviour does not.

That distinction is already the Phase 5 boundary. The OmnisTools work exists precisely
because its destinations are applications rather than documents, and it is where the
per-route `PaperTurnPage` init contract and the load-on-settle escape hatch belong.

So navigation on settle is not a Phase 3 mechanism. It is a **Phase 5 escape hatch for
script-dependent routes**, and putting it here would have bought nothing while costing
something specific and expensive.

### What it would have cost

`close()` is a fully built reverse turn, and every part of it assumes the document
survives:

- It refuses unless `state === 'open'` **and** `this.active` exists — an in-memory
  record holding the request, the resolved source element, the trigger, the grab
  anchor, and the progress.
- It re-resolves the source element (`transition-coordinator.ts:139`) because bounds
  may have changed, which requires the tile to still be in the document.
- `settleIdle` restores focus to `request.trigger` when it is still connected
  (`:389`), falling back to re-resolving the source by id.
- Both sheet faces are captured in a single pass specifically so the reverse pays for
  no second capture.

Navigate away on settle and all of it is gone: new document, no coordinator instance,
no `active`, no tile elements, and — the part with no workaround — **the detail page's
pixels are no longer available**, because you are on the detail page, not looking at
it from the index. Reconstructing a reverse turn would mean landing on a freshly
loaded index, detecting that you arrived via Back, re-fetching the page you just left,
re-capturing it, and playing the turn backwards. That is a second implementation of
the whole feature, running in reverse, to recover something that currently works.

**So: no navigation on settle in Phase 3.** The adopted content stays as the
destination, and history is updated around it.

---

## The mechanism

```
activation  ─▶ resolve ─▶ adopt ─▶ turn ─▶ settleOpen ─▶ pushState(detailUrl)
Back        ─▶ popstate ─▶ coordinator.close()  (the existing reverse turn)
close button ─▶ history.back()  ─▶ popstate ─▶ coordinator.close()
```

Three properties make this cheap:

**`pushState` happens after the turn, not before.** At `settleOpen` the transition is
finished, the state is `open`, and nothing is in flight. A failed or interrupted turn
therefore never leaves a history entry describing a page the reader is not on.

**The close button stops closing directly and goes back instead.** Today it calls
`coordinator.close()`. It must call `history.back()`, letting `popstate` drive the
close — otherwise clicking it would reverse the turn while leaving the detail URL in
the address bar, and the reader's next Back press would try to return to a detail page
they are no longer on. One route in, one route out.

**`popstate` respects the state machine rather than assuming it can close.**
`close()` throws unless the state is `open`. `popstate` can arrive mid-turn — the
reader pressing Back while the sheet is still moving — so the listener has to consult
the state and, when a turn is in flight, route the interruption through the existing
`cancel()` path instead. The coordinator already models this: `cancel()` sets
`requestedEndpoint` from the current progress, settling to whichever endpoint is
nearer.

---

## Deep linking works already, and that is worth stating

A reader arriving directly at `/detail/spectrum.html` gets the standalone page the host
serves. No shell, no transition, no JavaScript required — the page simply renders,
because Phase 1's fragment contract requires every detail page to render standalone
around its `[data-paper-turn-detail]` template.

So deep linking needs **no implementation**. The obligation is only that Phase 3 must
not break it, and the temptation it must resist is a client-side router that intercepts
a cold load of a detail URL and tries to reconstruct the shell around it. That would
mean fetching the index, building the grid, and playing a turn nobody asked for, to
arrive at content the reader already had.

One consequence to accept honestly: **a reload while open loses the shell.** After
`pushState`, reloading serves the standalone detail page rather than the index-with-
adopted-detail. The DOM differs, the close button is gone, and Back leaves the site.
That is not a bug to fix; it is what a real URL means. The alternative is a URL that
does not survive a reload, which is the thing this phase exists to remove.

---

## Query parameters, and a guarantee that must not break

`?tiles=`, `?duration=`, `?fallback=`, and `?debug=` are seed-only, and the README
documents that as a guarantee: they are read at startup and not rewritten, except by
the debug panel's own `replaceState` for `?debug=`.

Pushing a **path** does not disturb a query string — but it does not carry one either,
and `pushState(null, '', '/detail/spectrum.html')` silently drops every one of them.
A debug session would lose its setup at the moment the turn completes, which is
precisely when someone debugging the turn is looking.

So the pushed URL must preserve the current search string. And the reverse: on
`popstate` back to the index, the parameters must still be there. This is a small
detail with a bad failure mode — it fails only for the people using the debug tools,
who will reasonably assume the tools are broken rather than the history integration.

---

## Scroll position

`freezeScroll` pins the body at activation and `restoreScroll` restores it on
`settleIdle`, which is correct for a same-document turn and needs no change.

What is new is that the browser now also has opinions. A `popstate` from a real history
entry triggers the browser's own scroll restoration, which can fight `restoreScroll`.
`history.scrollRestoration = 'manual'` is the usual answer, and it is the right one
here because the coordinator already owns scroll across the transition — but it is a
global setting on `history`, so it belongs with the history integration rather than
buried in the view.

---

## What could go wrong

Worth naming the failure modes rather than discovering them:

**A double history entry.** If both the activation path and something else push, Back
appears to do nothing on the first press. Exactly one push per settled open.

**A history entry for a turn that failed.** Mitigated by pushing at `settleOpen`
rather than at activation, but the fallback and reduced-motion paths also reach a
settled-open state and must push exactly once too — not zero times, and not twice.

**`popstate` for something that is not ours.** On a host page, other scripts push
entries. The listener must identify its own entries via `history.state` rather than
assuming every `popstate` means "close the detail surface".

**A close that leaves the URL behind.** The reason the close button must go through
`history.back()` rather than calling `close()` directly.

---

## Test strategy

| Layer | Adds |
| --- | --- |
| Unit | The pushed URL preserves the existing search string, for each of the four parameters and for combinations. `popstate` while `opening` or `closing` routes to `cancel()` rather than `close()`. State identification rejects a foreign `history.state`. |
| Interaction | Open, then Back, reverses the turn and restores focus to the tile. The close button produces the same result as Back, with the URL returning to the index. Back pressed mid-turn settles to the nearer endpoint without throwing. Exactly one history entry per open, asserted by pressing Back once. A cold load of a detail URL renders the standalone page and does not attempt a turn. Reduced-motion and explicit-fallback opens push exactly one entry. |
| Visual | **No new baselines.** Nothing about history changes a pixel, and the pending affordance that might have is Phase 2's problem. |

The existing close, Escape, resize, reduced-motion, and fallback interaction tests
must keep passing **unmodified**, exactly as they did through Phase 1. That is the
signal that history was layered on rather than woven in.

---

## What this design does not do

- **No navigation on settle.** Moved to Phase 5 as a per-route escape hatch for
  script-dependent pages. See above.
- **No client-side router.** History integration is not routing. There is no route
  table, no view registry, and no interception of cold loads.
- **No change to the coordinator's state machine, the geometry, the renderer, the
  timeline, or the fallback.** `popstate` and the close button drive the existing
  `close()` and `cancel()`; the reverse turn is used as built.
- **No change to the fragment contract.** A page turnable in Phase 1 is turnable here.
- **No change to `MotionProfile`.**
- **No reconstruction of the shell on a cold detail-page load.** The host serves a real
  page; that is the whole point.
- **No prefetch and no latency budget.** Phase 2.
- **No new dependency.** `history` and `popstate` are platform.

---

## Open questions

1. **Should the pushed entry use a `<title>` from the fetched page?** The fragment
   contract already collects it and Phase 1 deliberately derives no behaviour from it.
   Setting `document.title` on open would make browser history and tab labels correct,
   and would need restoring on close. Cheap, but it is a behaviour change beyond
   history and should be chosen rather than assumed.
2. **What should Back do when the reader arrived by deep link and then turned?** They
   land on a detail page, click through to the index, open a tile: Back now returns to
   the index rather than to where they started. Probably correct, but it is worth
   agreeing it is not surprising.
3. **Does `scrollRestoration = 'manual'` belong to this component at all?** It is a
   global, and a component that sets it changes behaviour for a host page's own
   navigations. Phase 4 will have to revisit this; the question is whether Phase 3
   should already scope it or accept the global and note the debt.
4. **Should the close button remain a button?** Once it means "go back", an `<a
   href>` to the index URL would make it work without JavaScript and behave natively
   on modified clicks — the same argument that made the tiles anchors in Phase 1. It
   would also change the focus and keyboard story, which the existing interaction
   tests cover closely.
