# Demo hosting options for the Spectrum paper-turn prototype

**Date:** 2026-08-29
**Status:** Research complete — recommendation below. Nothing has been deployed or configured.
**Scope:** How to publish this prototype as a live, interactive demo people can try in a browser.

---

## Recommendation

**Deploy to GitHub Pages using a GitHub Actions workflow.**

The repository is public and will stay public, which makes this the obvious answer: Pages
is free for public repositories on every GitHub plan, needs no third-party account, no
OAuth app installation, and — critically — **no stored secret**. The deploy job
authenticates with the repository's own OIDC token. That is one less credential to
manage than any alternative that reaches the same result.

The build is already fully static (four files, ~1.2 MB of JS), so nothing about the app
resists static hosting. Exactly one change is required: set Vite's `base` to `'./'` so
assets resolve under the `/spectrum-paper-turn-prototype/` subpath. That change is
**documented below but deliberately not applied**, per the research-only constraint on
this task.

Cloudflare Pages is the alternative worth naming, and the only reason to pick it would be
per-PR preview deployments, which GitHub Pages does not offer. It is not worth switching
for that unless previews become a real requirement.

---

## Comparison

| Option | Setup effort | Ongoing cost | Public repo | Private repo | Custom domain | PR previews | App-specific blockers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **GitHub Pages + Actions** | Medium — write ~30 lines of workflow YAML, flip Settings → Pages → Source | Free | ✅ Free | ❌ Needs Pro ($4/mo) | ✅ + free HTTPS | ❌ None | Serves at `/<repo>/` subpath → **requires `base: './'`** |
| **Cloudflare Pages** | Low — connect repo in dashboard, set build command | Free (unlimited bandwidth, 500 builds/mo) | ✅ | ✅ Free | ✅ (up to 100) | ✅ Unlimited | None — serves at domain root |
| **Vercel (Hobby)** | Low — connect repo, auto-detects Vite | Free (100 GB/mo transfer) | ✅ | ✅ Free | ✅ | ✅ | None — domain root. Hobby ToS forbids commercial use |
| **Netlify** | Low — connect repo, auto-detects Vite | Free but **credit-capped**: 300 credits/mo, ~15/deploy → roughly 18–20 production deploys | ✅ | ✅ Free | ✅ | ✅ Unlimited | None — domain root. Credits are genuinely exhaustible |
| **Surge.sh** | Lowest manually (`surge ./dist`); highest for CI | Free (limits undocumented) | N/A — no repo link | N/A | ✅ | ❌ Manual only | None technically, but **only option needing a repo secret** (`SURGE_TOKEN`) for automated deploys |
| **StackBlitz link** | Trivial — a URL in the README | Free | ✅ No login needed | ⚠️ Paid ($18–25/mo) | ❌ | N/A | Works (WebGL, Shadow DOM, all deps pure-JS) but **20–60 s cold start** |
| **CodeSandbox link** | — | — | ❌ **Not available** | ❌ | ❌ | N/A | **GitHub import ended 1 Apr 2026; full EOL 1 Jul 2026** |
| **Prebuilt `gh-pages` branch** | Low, but commits build output to git | Free | ✅ | — | ✅ via Pages | ❌ | Same `base` problem; hashed filenames bloat git history; staleness risk |
| **README video / GIF** | Low | Free | ✅ | ✅ | N/A | N/A | Not interactive. MP4 won't embed inline in a README — use animated AVIF |

---

## Technical findings

These come from actually building and running the app, not from reading the config.

### What the production build produces

`npm run build` runs `tsc --noEmit && vite build` (Vite 8.2.2, TypeScript 7.0.2). It
completes in about 250 ms and emits exactly four files:

```
dist/index.html                        453 B
dist/assets/index-<hash>.css         3,610 B
dist/assets/index-<hash>.js      1,204,057 B   (231 kB gzipped)
dist/assets/focus-visible-<hash>.js  3,076 B   (lazy chunk)
```

The output is **fully static**. There is no server, no SSR, no API route, no service
worker, and no environment variable read at build or runtime. Any static file host can
serve it.

Vite prints a chunk-size warning because the main bundle exceeds 500 kB — that is Three.js
plus Spectrum Web Components, and it is cosmetic. 231 kB gzipped over the wire is fine for
a demo.

### The `base` path question — verified, not assumed

With the default `base: '/'`, `index.html` references assets absolutely:

```html
<script type="module" crossorigin src="/assets/index-BlRf_l-c.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-B7oNKT0J.css">
```

I served that build under a `/spectrum-paper-turn-prototype/` prefix with a local static
server and drove it with headless Chromium. Result:

```
HTTP 404  /assets/index-BlRf_l-c.js
HTTP 404  /assets/index-B7oNKT0J.css
appChildren: 0, cardTriggers: 0, spectrumUpgraded: false
```

A blank page. This is the one real blocker for Pages project-site hosting.

Rebuilding with `--base=./` emits `./assets/...` instead. Under the identical subpath
server:

```
failures: []          consoleErrors: []
cardTriggers: 3       spectrumUpgraded: true    spThemePresent: true
webgl2: true          computedStyleMap: true    paperTurnGlobal: true
transition reached state: "open"
```

A separate run with a `MutationObserver` on `document.body` confirmed
`maxCanvasesDuringTransition: 1` and `canvasesNow: 0` — the WebGL canvas is genuinely
created during the transition and torn down afterwards. The full WebGL path runs under
subpath hosting, not just the DOM fallback.

### Why `base: './'` is safe here specifically

Relative base breaks apps that resolve URLs at runtime. This app does not. A grep across
`src/` for `fetch(`, `new URL(`, `import.meta.url`, `import.meta.env`, image/font/svg
extensions, `url(`, `@font-face`, and `http(s)://` literals returns **zero matches**.
`src/styles.css` has no `@import`, `url()`, or `@font-face`.

Two consequences worth stating:

- **Fonts.** Adobe Clean is neither bundled nor fetched; Spectrum falls back to system
  fonts identically in dev and prod. So `html-to-image`'s `foreignObject` rasterisation
  never touches a cross-origin resource, and the capture canvas is never tainted.
- **Dynamic import.** The lazy chunk is emitted as `import('./focus-visible-<hash>.js')`
  and resolved against `import.meta.url` by the runtime, so relative base is correct for
  dynamic imports too — this is the case that most often bites.

### Routing

There is no client-side router. All state lives in query parameters (`?duration=`,
`?fallback=`, `?debug=`), which every static host preserves without configuration. **No
SPA history-fallback rewrite rule is needed on any provider.** That removes the single
most common static-hosting misconfiguration from the picture entirely.

### Cross-origin isolation

Not required. No `SharedArrayBuffer`, no COOP/COEP headers. This matters because GitHub
Pages cannot set custom response headers at all — a real limitation for some WebGL apps,
but not for this one.

### WebGL

WebGL availability is a property of the visitor's browser and GPU, not of the host. No
hosting choice can improve or degrade it. `src/transition/capabilities.ts` already
degrades to a DOM fallback when WebGL or capture is unavailable, so visitors on
unsupported hardware get a working, if less impressive, transition. Note also that
`themeTokenCss()` in `src/transition/capture.ts` uses `computedStyleMap()`, which is
Chromium-only — the same fallback covers Safari and Firefox.

### Existing CI

None. There is no `.github/` directory, so the workflow would be the first one in the
repo. Pages is not currently enabled (`GET /repos/.../pages` returns 404).

---

## Notes on the individual options

### GitHub Pages

Free for public repositories on all plans. Soft limits are 1 GB site size and 100 GB/month
bandwidth — this site is under 1.3 MB, so neither is reachable in practice. The 10
builds/hour limit applies to legacy branch-based publishing, not to custom Actions
workflows.

The modern deploy path is `actions/configure-pages@v5` → `actions/upload-pages-artifact@v4`
(`path: dist/`) → `actions/deploy-pages@v4`, with `permissions: { pages: write, id-token:
write }` and `environment: { name: github-pages }`. Authentication is OIDC — **no PAT, no
repository secret**.

One quiet advantage of the Actions path: GitHub Pages runs Jekyll by default and Jekyll
suppresses files and directories beginning with `_` unless a `.nojekyll` marker exists.
`upload-pages-artifact` handles that automatically. Publishing a `dist/` folder to a branch
by hand does not, and it is an easy way to lose assets silently.

Two facts I could not confirm from primary sources and am therefore flagging rather than
asserting: whether Pages serves brotli in addition to gzip (community evidence says gzip
yes, brotli no), and the official MIME-type table for ES modules (it works in practice;
there is no documented table). Neither affects the recommendation.

### Cloudflare Pages

The strongest alternative. Free tier includes unlimited bandwidth, 500 builds/month,
unlimited preview deployments, up to 100 custom domains, and support for both public and
private repositories. Connection is via a GitHub App, so no repository secret. Supports
`_headers` and `_redirects` if custom headers are ever needed. Serves brotli.

Cloudflare is developing "Workers Static Assets" as a successor product, but Pages remains
first-class and is not deprecated.

### Vercel

Hobby tier is free with 100 GB/month transfer and 1M edge requests. At 231 kB gzipped per
visit that is roughly 431,000 visits/month — effectively unlimited for a demo. PR previews
are included; only *customising* the preview domain suffix costs money. Worth noting the
Hobby terms prohibit commercial use, which a personal prototype demo does not trip.

### Netlify

Now credit-based, and the free tier is a **hard cap** rather than a soft one: 300
credits/month, with production deploys costing 15 credits each and bandwidth at 20
credits/GB. That works out to roughly 18–20 production deploys per month before the site
stops building. Fine for a stable demo, awkward during active iteration. Technically
capable in every other respect.

### Surge.sh

Genuinely the lowest-friction manual option — `npm run build && surge ./dist` and you are
done, with no repository connection at all (so repo visibility is irrelevant). The
trade-off is that automating it is the *only* option in this comparison that requires
storing a credential (`SURGE_TOKEN`) in the repository, which the brief explicitly rules
out. Free-tier bandwidth and storage limits are not published on any accessible official
page and should be treated as unknown.

### StackBlitz

Worth adding as a *secondary* link, not as the demo itself.

`https://stackblitz.com/github/roboweaver/spectrum-paper-turn-prototype?startScript=dev`
opens the repo in a WebContainer and runs `npm run dev`. Public repos need no login and
cost nothing. The preview pane is a real browser iframe, so WebGL2, custom elements, and
Shadow DOM all work natively — StackBlitz sets the COOP/COEP headers its WASM runtime
needs, and the app requires no header configuration of its own. Every dependency here
(`three`, `@spectrum-web-components/*`, `html-to-image`) is pure JavaScript, so the
native-addon ban that breaks many projects in WebContainers does not apply.

The problem is cold start: 20–60 seconds of `npm install` before anything renders. For a
stranger deciding whether a transition effect is worth their attention, that is an
abandonment risk. Use it as a "remix the code" invitation for developers, with the Pages
URL as the actual demo link.

### CodeSandbox — no longer an option

CodeSandbox has **stopped accepting new GitHub repository imports as of 1 April 2026**,
with full support for the GitHub integration ending 1 July 2026. Both dates are in the
past. Do not add a CodeSandbox link; it would either fail immediately or rot.

### Prebuilt `dist/` on a `gh-pages` branch

Technically works — `git subtree push --prefix dist origin gh-pages` — and needs no CI at
all. Two reasons not to:

- **History bloat.** Vite emits content-hashed filenames, so every deploy adds ~1.2 MB of
  new, undeltifiable blobs rather than modifying existing ones. Git cannot delta-compress
  minified JS across hash changes. The cost compounds with each deploy and is only
  recoverable with `git filter-repo` surgery.
- **Staleness.** The demo and `main` are coupled only by someone remembering to run the
  command. Nothing detects drift.

It also reintroduces the `.nojekyll` problem that `upload-pages-artifact` solves for free.
Since the Actions path deploys an artifact without committing to any branch, it avoids
both issues — there is no reason to prefer the manual route here.

### README video or GIF

A reasonable supplement, not a substitute — but the format matters more than it looks.

GitHub's Markdown renderer strips `<video>` and `<iframe>` tags, and an uploaded MP4 URL
renders in a README as a plain hyperlink rather than an inline player. (It *does* embed as
a player in issue and PR comments — the README is the exception.) So MP4 is out for an
autoplaying inline preview.

Animated GIF works inline everywhere, but it is the wrong format for this content
specifically: GIF's 256-colour palette cannot represent the smooth gradients and specular
shading of a WebGL surface without visible banding, and a 720p clip runs 4–8 MB against
GitHub's 10 MB image limit. **Animated AVIF or WebP** renders inline, autoplays, loops,
and carries full colour — published measurements put a comparable 720p/24fps clip at
around 557 KB in AVIF versus 8.2 MB as GIF. Encode with `ffmpeg`, embed as
`![Demo](demo.avif)`.

### A note on Firefox, which is not a hosting question

`themeTokenCss()` in `src/transition/capture.ts` uses `computedStyleMap()`, which ships in
Chromium and Safari 16.4+ but not Firefox. This is worth knowing but is **not** a blocker
and **not** affected by hosting choice: the call is optional-chained and guarded
(`const styleMap = (themeHost as MaybeStyleMapped).computedStyleMap?.()` followed by
`if (styleMap)`), so Firefox degrades to a capture without inlined Spectrum tokens rather
than throwing.

Separately, `html-to-image` is used via `toCanvas` only — `toDataURL` is never called on
the result. The `<foreignObject>` canvas-tainting issue that affects some `html-to-image`
usage therefore does not arise, which my headless-Chromium run confirms empirically: the
WebGL canvas was created and the transition completed rather than falling back to DOM
mode.

---

## If this ever goes private

Recorded for completeness; not the current situation.

GitHub Pages on a private repository requires a paid plan — GitHub Pro at $4/month for a
personal account. If the repository were made private and the demo still needed to be
public, the cheapest path would be **Cloudflare Pages**, which supports private
repositories on its free tier with no functional restrictions. Vercel and Netlify also
support private repositories free. Surge is unaffected either way, since it never connects
to the repository.

## What becomes world-readable

This has been decided and accepted: the repository is public and stays public. For the
record, that means `docs/superpowers/specs/`, `docs/superpowers/plans/`, this research
document, `docs/architecture.md`, and the full commit history are all publicly visible —
including AI-assisted development artifacts and the design reasoning behind the prototype.
For a prototype whose whole point is to be shown to people, that is an accepted and
informed trade, and it is what makes the free hosting path available.

---

## Next steps to implement

1. **Set the Vite base path.** In `vite.config.ts`, add `base: './'` to the config object.
   Prefer `'./'` over `'/spectrum-paper-turn-prototype/'`: the relative form produces one
   artifact that works at a subpath, at a domain root, and inside a sandbox, whereas the
   absolute form hardcodes the Pages URL and breaks everywhere else.
2. **Add the deploy workflow** at `.github/workflows/deploy-pages.yml`: trigger on push to
   `main` plus `workflow_dispatch`; `permissions: { contents: read, pages: write, id-token:
   write }`; `concurrency: { group: pages, cancel-in-progress: false }`; steps are checkout
   → setup-node (Node 22+, `cache: npm`) → `npm ci` → `npm run build` →
   `actions/configure-pages@v5` → `actions/upload-pages-artifact@v4` with `path: dist` →
   `actions/deploy-pages@v4` in a `github-pages` environment.
3. **Enable Pages.** Settings → Pages → Build and deployment → Source → **GitHub Actions**.
   This is a one-time manual toggle; the workflow cannot set it.
4. **Verify.** After the first run, load
   `https://roboweaver.github.io/spectrum-paper-turn-prototype/`, confirm the cards render,
   trigger a transition, and check DevTools for zero 404s on `/assets/`.
5. **Link it.** Add the live URL to the top of `README.md`. Optionally add a
   `https://stackblitz.com/github/roboweaver/spectrum-paper-turn-prototype?startScript=dev`
   link as a secondary "remix the code" invitation, and an animated AVIF clip for visitors
   who land on a browser that takes the DOM fallback path.

Optional follow-ups: a custom domain (add a `CNAME` file plus a DNS record; HTTPS is
provisioned free), and a `pull_request` trigger that builds without deploying, as a cheap
substitute for the PR previews Pages does not provide.

---

## How this was verified

Build output, file sizes, the subpath 404 reproduction, the working `base: './'` run, and
the canvas create/dispose observation were all measured directly: the app was built both
ways and served under a `/spectrum-paper-turn-prototype/` prefix by a local static server,
then driven with headless Chromium. The claims about `computedStyleMap` guarding and
`toCanvas` versus `toDataURL` were read from `src/transition/capture.ts`.

Provider pricing, limits, and behaviour come from vendor documentation. Three items could
not be confirmed from primary sources and are flagged as such above rather than asserted:
whether GitHub Pages serves brotli as well as gzip, the official MIME-type handling for ES
modules on Pages, and Surge's free-tier bandwidth and storage limits.

Nothing in this document has been applied. No deployment was made, no repository settings
were changed, no secrets were added, and no application or build configuration was
modified.
