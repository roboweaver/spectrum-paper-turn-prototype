# Design Document: Real navigation and history

**Status:** Proposed — not yet approved, but **all four open questions are now
answered**: two by spike and two by decision. `requirements.md` and `tasks.md` are
derived from this document once it is approved, per the repo's design-first workflow.

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
startup      ─▶ replaceState(indexState)        (mark the index entry as ours)
activation   ─▶ resolve ─▶ adopt ─▶ turn ─▶ settleOpen ─▶ pushState(detailState, detailUrl)
Back         ─▶ popstate(indexState) ─▶ coordinator.close()  (the existing reverse turn)
close button ─▶ owns-current-entry? ─▶ history.back()  ─▶ popstate ─▶ coordinator.close()
                                   └▶ no: close() + replaceState(indexUrl) directly
```

Four properties make this cheap:

**The index entry is marked at startup.** Before any turn, the component calls
`replaceState` once to stamp its own namespaced marker onto the entry the reader
landed on (see [History state schema](#history-state-schema)). Without this the index
entry carries `null` or host-owned state, and the close `popstate` — which enters the
index entry, not the detail entry — would be rejected as foreign. Marking it at startup
is what lets `popstate` recognise its own close.

**`pushState` happens after the turn, not before.** At `settleOpen` the transition is
finished, the state is `open`, and nothing is in flight. A failed or interrupted turn
therefore never leaves a history entry describing a page the reader is not on. The push
is a single hook on the one settle, guarded so it fires exactly once per activation —
see [The push hook and the one-push guard](#the-push-hook-and-the-one-push-guard).

**The close button goes back instead of closing directly — but only when it owns the
current entry.** Today it calls `coordinator.close()`. The default route is
`history.back()`, letting `popstate` drive the close — otherwise clicking it would
reverse the turn while leaving the detail URL in the address bar, and the reader's next
Back press would try to return to a detail page they are no longer on. One route in, one
route out.

The catch is that `history.back()` is only safe when the component's detail entry is
still the current entry. Two situations break that assumption:

- **A settle that pushed nothing.** If the open settled without a push — the interrupted
  history-driven close in [What could go wrong](#what-could-go-wrong) is one way, and the
  zero-push consequence of any missed push is another — then the current entry is still
  the index entry (or whatever preceded the shell), and `history.back()` navigates the
  reader *off the page* rather than closing the surface.
- **A foreign entry pushed on top.** A host script (analytics, an intercepted in-content
  link) can push its own entry while the detail surface is open. `history.back()` then
  steps into that foreign entry instead of closing.

So the close control checks ownership before stepping back: if `history.state` carries
the component's detail marker, call `history.back()`; otherwise fall through to a direct
`close()` and a `replaceState` that corrects the URL back to the index. This is the same
ownership check the `popstate` listener applies, used on the exit path as well — see
[History state schema](#history-state-schema).

The close button stays an `<sp-button>` rather than becoming an anchor, which was open
question 4 and is now settled below.

**`popstate` respects the state machine rather than assuming it can close.**
`close()` throws unless the state is `open`. `popstate` can arrive mid-turn — the
reader pressing Back while the sheet is still moving — so the listener has to consult
the state and, when a turn is in flight, route the interruption through the existing
`cancel()` path instead of calling `close()`.

**The interruption must be target-driven, not progress-driven, for a history-initiated
turn.** The coordinator's `cancel()` settles to whichever endpoint is *nearer* —
`progress >= 0.5 ? 'open' : 'idle'`. That is right for a pointer-driven cancel, but
wrong when the interruption came from history: if a `closing` turn driven by `popstate`
is interrupted past the midpoint, `cancel()` settles it back *open*, while history has
already moved to the index entry. The result is an open detail surface sitting under the
index URL — the mirror image of "a close that leaves the URL behind". So a history-driven
turn carries an **explicit endpoint** for the traversal (the direction the reader asked
for by pressing Back or Forward), and the coordinator/seam settles to that endpoint
rather than deriving one from progress. When the explicit endpoint cannot be honoured —
the turn still settles open against a history position that expects idle — the listener
**reconciles** the URL with a `re-push`/`replaceState` so the surface and the address bar
agree. The reverse case is named in [What could go wrong](#what-could-go-wrong).

**Back during `opening` is an ordinary browser navigation, not a mid-turn
interception.** The detail entry is not pushed until `settleOpen`, so between activation
and settlement there is no entry the component owns. Any `popstate` that arrives during
`opening` therefore belongs to the host or is a cross-document navigation — the component
has nothing on the stack to leave. The listener's ownership check (below) rejects it as
foreign and lets the browser navigate normally; `opening` is deliberately *not* a
mid-turn interception point, and the `popstate` contract and the test plan cover only
`closing` as an in-flight state. (The alternative — pushing a sentinel entry at
activation so the `opening` window is covered — was considered and rejected: it reopens
the "history entry for a turn that failed" problem the deferred push exists to avoid.)

### History state schema

Both endpoints the component owns carry a **namespaced marker** in `history.state`, so
the `popstate` listener and the close control can recognise entries that are theirs and
reject entries that are not. The namespace keeps the markers from colliding with host
state, and both markers are written by *merging* onto the existing `history.state`
rather than replacing it — reusing the pattern the debug-query updater already uses to
carry `history.state` through its `replaceState` calls:

```
history.state = {
  ...existingState,                 // never clobber host-owned keys
  spectrumPaperTurn: {
    endpoint: 'index' | 'detail',   // which surface this entry represents
    url:      string,               // the URL this entry restores to
  },
}
```

- **The index entry is marked at startup** with `replaceState`, because `popstate` on
  close *enters* the index entry and exposes *its* state. An unmarked index entry
  carries `null` or host state and would be rejected as foreign, so the component's own
  close would never be recognised. Marking it once at startup fixes that.
- **The detail entry is marked at `settleOpen`** by the `pushState` that creates it.

**Ownership is a single check used on both paths.** An entry is the component's when
`history.state?.spectrumPaperTurn` is present with the expected `endpoint`. The
`popstate` listener uses it to decide whether a traversal is its close (index endpoint,
coordinator `open`) or its forward re-open (detail endpoint, coordinator `idle` — see
[Forward traversal](#forward-traversal)), and rejects everything else as foreign. The
close control uses the *same* check before calling `history.back()`: if the current
entry is the component's detail entry, go back; otherwise a host script has pushed an
entry on top, so fall through to a direct `close()` plus a `replaceState` that restores
the index URL. Applying the check to the exit path as well as the listener closes the
gap where `history.back()` would otherwise step into a foreign entry.

### The push hook and the one-push guard

The push must land at the single moment the turn has settled open, without touching the
coordinator's private state machine. `settleOpen` is private, so the only seam available
is the `statechange` event that `main.ts` already consumes. The naive listener —
`push on state === 'open'` — produces the double-push and the stranded-open failures,
because a cancelled-then-resettled turn reaches `open` more than once.

So the hook is **the `statechange` transition *into* `open` from an opening turn**, and
it is guarded by a one-push-per-activation flag:

- The flag is set when an activation begins and cleared when the surface returns to
  `idle` (a completed close), so each open/close cycle gets exactly one push.
- The hook fires the push only when the flag is unset *and* the transition is a genuine
  first settle (opening → open), not a re-settle after a cancellation (closing → open,
  which the target-driven interruption above already reconciles without a new entry).
- The fallback and reduced-motion paths also reach a settled-open state and run through
  the same guarded hook, so they push exactly once too — not zero times, and not twice.

This keeps the push observable from `main.ts` without a new coordinator state, and makes
"exactly one push per settled open" an explicit rule rather than an emergent hope.

### The close button stays a button

Once the close button means "go back", the Phase 1 argument for making the tiles anchors
appears to transfer: an `<a href>` works without JavaScript and handles modified clicks
natively. **Spiked, and it does not transfer.** Two findings, either of which is
sufficient.

**`href` on `<sp-button>` is deprecated.** Setting it works — 21 of 22 interaction tests
passed, including close focus restoration and the keyboard paths — but Spectrum Web
Components 1.12.2 logs on every render:

> DEPRECATION NOTICE: The "href" attribute on `<sp-button>` is deprecated and will be
> removed in a future release. Use a native HTML anchor (`<a>`) element with Spectrum
> global element styling instead.

Worth noting *how* that surfaced: the one failing test was
`an authored data-grabbed-corner attribute cannot move the published anchor`, which
asserts no console output matches `/anchor|corner|grab/i`. It was written to catch
grab-anchor warnings and caught a Spectrum deprecation instead, because the notice
contains the word "anchor". A console-noise assertion earning its keep by accident.

**The sanctioned alternative is worse here.** A native `<a>` styled by
`@spectrum-web-components/styles/global-elements.css` means class-based Spectrum styling
— `.spectrum-Button`, `.spectrum-Button--secondary` — pulling in roughly 31 KB of
`global-button.css`, much of it written as `::slotted(.spectrum-Button)` and so
dependent on slot context. Adding a global, class-based stylesheet is precisely the
CSS-leaks-into-the-host problem Phase 4 exists to solve. Doing it now to gain a benefit
Phase 4 would then have to undo is the wrong trade.

**And the benefits do not apply to a close affordance anyway.** This is the part that
settles it independently of Spectrum. A tile's destination is a page a reader might
plausibly want in a new tab; "the page I just came from" is not. And without JavaScript
there is no open detail surface to close — the reader is on the standalone detail page,
where linking back is the host's markup to provide, not this component's. The arguments
that made tiles anchors were about *destinations*; a close button has no destination,
only a direction.

So: keep `<sp-button>`, and have it call `history.back()` rather than
`coordinator.close()`.

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

**The same consequence has a second shape**, found while settling open question 2. If
the reader follows a link *inside* the adopted content to somewhere else and then
presses Back, they land on the standalone detail page rather than the shell they were
looking at. Same content, no close button. It is the reload caveat arriving by a
different route, and it has the same answer.

Back itself needs no special handling beyond that. A reader who arrives by deep link,
clicks through to the index, opens a tile, and presses Back gets the reverse turn and
the index; pressing it again returns them to where they started. Each press undoes one
step, which is what Back does everywhere. Worth stating only because it was asked, and
because the answer is "nothing to build".

---

## The document title

`document.title` is set from the fetched page's `<title>` on open, and restored on
close. The fragment contract already collects it (`FragmentSuccess.title`) and Phase 1
deliberately derives no behaviour from it, so this consumes data that is already in
hand.

The reason is history rather than tabs. A browser's Back long-press menu labels entries
from `document.title` **as it stood when the entry was created**, so without this every
entry reads "Spectrum Paper Turn" and the menu is useless for navigating back through
several turns.

**The ordering is a real constraint, not a detail.** Set `document.title` *before*
`pushState`. The natural-looking order — push, then retitle — labels the new entry with
the previous page's title, which is the exact failure this is meant to fix. It wants an
explicit requirement rather than a comment.

**Capture the title immediately before the component writes it, not at startup.** A
startup capture assumes the component is the page's only title writer. On an embedded
host that updates its own `document.title` — a single-page host, an analytics tag, the
host's own routing — restoring a load-time value on close clobbers whatever the host set
in the meantime. So the component reads `document.title` *at the moment it is about to
overwrite it* and stashes that value, then restores it on close. And the restore is
**scoped to the value the component itself installed**: close only writes the saved title
back if the current `document.title` is still the fetched title the component set,
leaving a host-updated title untouched. A page whose `<title>` is absent still leaves the
title alone rather than blanking it, exactly as before — nothing is captured and nothing
is restored.

This is a **host-global mutation**, and belongs on the Phase 4 list for that reason —
see [Host globals](#host-globals) below.

---

## Host globals

Three questions in this phase turned out to be the same question: *does this component
get to mutate global browser state that a host page also relies on?*

- `history.scrollRestoration` — **no**, and the spike showed it is unnecessary anyway.
- `document.title` — **yes**, because a wrong title is a visible defect.
- `freezeScroll` mutating the host's `<body>` — already the case since before Phase 1,
  and already on the Phase 4 list as an overridable scroll freeze.

The standing rule, so the next instance is a one-line decision rather than a debate:

> A host-global mutation is permitted in Phases 2–3, and every one goes on the Phase 4
> list to be made overridable.

That keeps the phases moving without accumulating surprises for the packaging work. The
Phase 4 row of the master phasing table has been updated to name the document title
alongside the scroll freeze.

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

**The merge rule, and precedence on collision.** The prototype cannot surface a
collision — its card URLs are derived paths with no query of their own — but a named
host will. Phase 4's WordPress target addresses posts as `?p=123`, so a detail URL can
arrive carrying its own query that shares a key with the shell's seed parameters. The
policy is **merge, destination wins on collision**: start from the shell's current search
params, then overlay the destination URL's own params, so a key present on both takes the
destination's value while shell-only keys (the `?tiles=`/`?duration=`/`?fallback=`/
`?debug=` seeds) carry over untouched. The destination's own addressing is never dropped
to preserve a shell seed, because the destination query is what actually identifies the
page. The same merge runs in reverse on close, restoring the shell's seed params onto the
index URL. A unit test covers a detail URL that carries its own query against the shell's
seed parameters, asserting the destination key wins and the non-colliding seeds survive.

---

## Scroll position

`freezeScroll` pins the body at activation and `restoreScroll` restores it on
`settleIdle`, which is correct for a same-document turn and needs no change.

The worry was that a `popstate` from a real history entry brings the browser's own
scroll restoration, which could fight `restoreScroll` — with
`history.scrollRestoration = 'manual'` as the usual remedy.

**Spiked, and it does not.** A harness reproduced the Phase 3 mechanism — open a tile
from a scrolled position, push the entry `settleOpen` would push, press Back, drive
`close()` from the `popstate` — and measured drift under both settings, three runs each:

| `scrollRestoration` | Before | After | Drift |
| --- | --- | --- | --- |
| `auto` (default) | 400 | 400 | **0** |
| `manual` | 400 | 400 | **0** |
| control, no history entry | 400 | 400 | **0** |

The reason is `freezeScroll` itself: it pins the body with `position: fixed`, so the
document never actually scrolls during a turn. There is no scroll offset for the
browser to restore that differs from where `restoreScroll` is going to put things
anyway.

So **do not set `scrollRestoration`.** That resolves open question 3 in the better
direction: it is a global, and a component that sets it changes behaviour for a host
page's own navigations — a problem Phase 4 would then have had to unpick. Not setting it
costs nothing.

The spike's finding is guarded by a kept test, `closing restores the scroll position the
turn was opened from`, which characterises the current behaviour so that this conclusion
failing later is visible rather than silent.

Two measurement traps the spike hit, recorded because the Phase 3 tests will hit them
too. Playwright's `click` scrolls the target into view *before* clicking, which moves
the page before `freezeScroll` records a position and produced a phantom 192 px drift
in every condition until the clicks became `dispatchEvent`. And `open()` calls
`setDetailVisible(true)` early, while the surface is still clipped and the state is
`opening`, so waiting on visibility and then closing throws — the wait has to be on the
coordinator's state.

---

## Forward traversal

A `history.back()` close does not discard the detail entry — it leaves it in the
**forward** list. So after a reader opens a tile and presses Back to close, pressing
Forward returns to the detail entry, and `popstate` fires with the coordinator sitting
`idle`. The close-only `popstate` contract does not cover this: `close()` rejects from
`idle`, and the result is the detail URL restored to the address bar while the grid stays
on screen — exactly the URL/surface mismatch this phase exists to remove.

So the Forward endpoint is specified rather than left to fall through. A Forward arrival
is recognised by the ownership check: `history.state` carries the component's **detail**
marker while the coordinator is `idle`. The listener treats that as a **re-open** —
re-run resolution for the entry's stored URL and drive the turn open again, landing back
on the detail surface the entry describes. The detail state marker therefore stores the
source/destination the re-open needs (the `url`, and the source identity resolution
already keys on), not just the URL string.

Where a faithful re-open is not possible — the source tile is gone, or resolution fails —
the listener **deliberately falls back to a real navigation** to the stored URL rather
than leaving the mismatch in place. That keeps the invariant (URL and surface agree) even
when the turn cannot be reconstructed.

---

## What could go wrong

Worth naming the failure modes rather than discovering them:

**A double history entry.** If both the activation path and something else push, Back
appears to do nothing on the first press. Exactly one push per settled open, enforced by
the one-push guard in [The push hook and the one-push guard](#the-push-hook-and-the-one-push-guard).

**A history entry for a turn that failed.** Mitigated by pushing at `settleOpen`
rather than at activation, but the fallback and reduced-motion paths also reach a
settled-open state and must push exactly once too — not zero times, and not twice.

**A history-driven close interrupted past the midpoint settles back open and strands the
URL.** The reverse of "a close that leaves the URL behind": `popstate` has already moved
history to the index entry, but a progress-driven `cancel()` settles the turn back open,
leaving an open detail surface under the index URL. Prevented by the target-driven
interruption contract, with URL reconciliation when a settle-open cannot be avoided — see
[the `popstate` state-machine property](#the-mechanism).

**A close with no owned entry navigates off the page.** If an open settled without a
push, the current entry is still the index (or whatever preceded the shell), so a blind
`history.back()` on the close control exits the site. Prevented by the ownership check on
the close path, which falls through to a direct `close()` + `replaceState` when the
component does not own the current entry.

**`popstate` for something that is not ours.** On a host page, other scripts push
entries. The listener must identify its own entries via the namespaced `history.state`
marker rather than assuming every `popstate` means "close the detail surface". This also
covers `history.back()` finding a foreign entry on top of the component's detail entry —
the close control's ownership check sends it to the direct-close fallback instead.

**A close that leaves the URL behind.** The reason the close button must go through
`history.back()` rather than calling `close()` directly — when it owns the current entry.

**A Forward press re-shows the detail URL over the grid.** The detail entry survives in
the forward list after a Back-driven close; a Forward arrival with the coordinator `idle`
would restore the URL without the surface. Prevented by the Forward re-open endpoint
above.

---

## Test strategy

| Layer | Adds |
| --- | --- |
| Unit | The pushed URL preserves the existing search string, for each of the four parameters and for combinations. A detail URL that carries its own query merges against the shell's seed parameters, destination winning on key collision while non-colliding seeds survive. `popstate` while `closing` routes to `cancel()` with the traversal's **explicit** endpoint rather than a progress-derived one. State identification: the index entry is marked at startup and recognised as the component's; a foreign `history.state` is rejected; the detail marker merges onto rather than replaces host-owned state. `document.title` is captured immediately before the component writes it (not at startup), set **before** the push, restored on close only when the current title is still the one the component installed, and left alone when the fetched page has no `<title>`. |
| Interaction | Open, then Back, reverses the turn and restores focus to the tile. The close button produces the same result as Back, with the URL returning to the index. Exactly one history entry per open, asserted by pressing Back once. A cold load of a detail URL renders the standalone page and does not attempt a turn. Reduced-motion and explicit-fallback opens push exactly one entry. Scroll position survives a history-driven close, extending the kept test that already covers the same-document one. **Failure paths that break the invariants** (added alongside the #1–#6 resolutions): Forward into the pushed detail entry re-opens the surface rather than restoring the URL over the grid; a history-driven close interrupted past the midpoint settles to the traversal's endpoint (idle) and does not strand the URL; the close control with no owned entry falls through to a direct close + `replaceState` instead of navigating off the page; `history.back()` with a foreign entry on top takes the same direct-close fallback; Back during `opening`, both with and without a preceding entry, is left to the browser and not intercepted; the initial index entry is owned (marked at startup) so its close `popstate` is accepted. |
| Visual | **No new baselines.** Nothing about history changes a pixel, and the pending affordance that might have is Phase 2's problem. |

Two harness details, learned from the scroll spike and applicable to every test above.
Clicks must be `dispatchEvent` rather than `click`, because Playwright scrolls a target
into view first and that moves the page before `freezeScroll` reads it. And a wait for
"open" must poll the coordinator's state rather than the surface's visibility, because
`open()` makes the surface visible early while still clipped and in state `opening`.

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
- **No change to the fragment contract — and this reconciles the approved plan.** A page
  turnable in Phase 1 is turnable here, and the adopted content is the *live* destination:
  links work, forms focus, `:hover` responds. That is consistent with the approved
  [`url-addressable-detail-content/design.md`](../url-addressable-detail-content/design.md),
  whose "pixels only, never interactive, never needs to survive" narrowing has been
  corrected to apply **only** to the Phase 5 navigation-on-settle escape hatch — the one
  place a fragment is photographed and then replaced by a real page load. Because Phase 3
  keeps the fragment live rather than photographing-then-replacing it, there is no
  contradiction: both documents now agree that adopted content is live everywhere except
  behind the Phase 5 escape hatch.
- **No change to `MotionProfile`.**
- **No `history.scrollRestoration`.** Spiked and shown unnecessary; see
  [Scroll position](#scroll-position).
- **No native anchor for the close button.** Spiked and rejected; see
  [The close button stays a button](#the-close-button-stays-a-button).
- **No reconstruction of the shell on a cold detail-page load.** The host serves a real
  page; that is the whole point.
- **No prefetch and no latency budget.** Phase 2.
- **No new dependency.** `history` and `popstate` are platform.

---

## Open questions

1. ~~**Should the pushed entry use a `<title>` from the fetched page?**~~ **Answered:
   yes, set it and restore it on close.** Not tab polish — the browser's Back long-press
   menu takes entry titles from `document.title` as it stands when the entry is created,
   so leaving it alone makes every history entry read "Spectrum Paper Turn" and be
   mutually indistinguishable. The data is already collected and discarded. See
   [The document title](#the-document-title) for the ordering constraint.
2. ~~**What should Back do when the reader arrived by deep link and then turned?**~~
   **Answered: it is correct, and needs recording rather than engineering.** Each Back
   undoes one step, which is Back working as it does everywhere. One edge found while
   confirming it is folded into
   [Deep linking](#deep-linking-works-already-and-that-is-worth-stating).
3. ~~**Does `scrollRestoration = 'manual'` belong to this component at all?**~~
   **Answered: do not set it.** Spiked under both settings and a no-history control,
   three runs each: drift was zero in all three, because `freezeScroll` pins the body so
   the document never scrolls during a turn. See
   [Scroll position](#scroll-position). This avoids a global that Phase 4 would have had
   to unpick, and a kept test guards the conclusion.
4. ~~**Should the close button remain a button?**~~ **Answered: yes, keep it a button
   that calls `history.back()`.** Spiked both routes; see
   [The close button stays a button](#the-close-button-stays-a-button).
