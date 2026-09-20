/**
 * Emits the demo's detail pages, one per `CardRecord`.
 *
 * Phase 1 of the URL-addressable detail content plan needs real same-origin URLs
 * to fetch, and the prototype has no server. These pages simulate what a real
 * host — Grimoire, WordPress, OmnisTools — serves for free.
 *
 * Two properties are load-bearing and both are asserted by
 * `tests/unit/detail-page-generator.test.ts`:
 *
 * 1. **The template content reproduces `renderDetail`'s output exactly.** Five of
 *    the six committed visual frames carry *captured detail content*; only
 *    `paper-turn-start` is grid-only. So when the fragment is adopted in place of
 *    the five-field skeleton, the rendered DOM has to be identical or ten
 *    reference images across two platforms move. Same elements, same classes,
 *    same order, same text.
 * 2. **Output is derived from the records.** Nothing here is hand-authored, so a
 *    page cannot drift from the record whose tile links to it.
 *
 * Run from the `predev` and `prebuild` npm hooks. Node executes this TypeScript
 * natively via type stripping, which is why the relative imports carry their
 * `.ts` extension and why no transpiler dependency was added.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DETAIL_PAGE_DIR, type CardRecord, cards, detailPagePath } from '../src/data/cards.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');

/** Escapes text for an HTML text node or a double-quoted attribute value. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The detail content, matching what `renderDetail` builds in `app.ts`.
 *
 * `forAdoption` controls only whether the contract's focus-target attributes are
 * present. The adopted copy carries `data-detail-heading` and `tabindex="-1"`
 * because the fragment contract requires exactly one of them; the page's own
 * visible copy omits them so the document holds exactly one focus target and the
 * extractor's "exactly one heading" rule is unambiguous.
 *
 * Indentation is fixed rather than derived so output is byte-stable.
 */
function renderDetailContent(card: CardRecord, forAdoption: boolean): string {
  const headingAttrs = forAdoption ? ' data-detail-heading tabindex="-1"' : '';
  const sections = card.sections
    .map(
      (section) =>
        `        <section><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p></section>`,
    )
    .join('\n');

  return [
    `      <p class="eyebrow">${escapeHtml(card.subtitle)}</p>`,
    `      <h2${headingAttrs}>${escapeHtml(card.title)}</h2>`,
    `      <p>${escapeHtml(card.description)}</p>`,
    '      <div class="detail-body">',
    sections,
    '      </div>',
    `      <p class="detail-footer">${escapeHtml(card.footer)}</p>`,
  ].join('\n');
}

/**
 * Enough CSS for the page to be readable when opened directly.
 *
 * Deliberately minimal and deliberately *not* `src/styles.css`. It styles only
 * the page's own visible copy: a `<template>`'s content is not rendered and only
 * that content is adopted, so nothing here can reach the turning sheet. The
 * adopted copy is styled by the shell it lands in, which is what keeps the
 * visual baselines insensitive to this block.
 */
const STANDALONE_CSS = `      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: clamp(24px, 5vw, 72px);
        font-family: adobe-clean, 'Source Sans Pro', -apple-system, system-ui, sans-serif;
        color: #2c2c2c;
        background: #f5f5f5;
      }
      main { max-width: 900px; margin: 0 auto; }
      .eyebrow { margin: 0 0 8px; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: #6e6e6e; }
      h2 { margin: 0 0 12px; font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.1; }
      .detail-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 8px 32px; margin-top: 32px; }
      .detail-body h3 { margin: 0 0 6px; font-size: 1.1rem; }
      .detail-body p { margin: 0; font-size: 0.95rem; line-height: 1.5; }
      .detail-footer { margin: 48px 0 0; padding-top: 24px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
      .back { display: inline-block; margin-bottom: 32px; color: #1473e6; }`;

/** The full standalone page for one record. */
export function renderDetailPage(card: CardRecord): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(card.title)}</title>
    <style>
${STANDALONE_CSS}
    </style>
  </head>
  <body>
    <!-- The adoptable region. A <template> so this page can render its own
         layout below without the content being displayed twice. The paper-turn
         adopts this content; everything outside it belongs to this page alone. -->
    <template data-paper-turn-detail data-paper-turn-color="${escapeHtml(card.color)}">
${renderDetailContent(card, true)}
    </template>

    <!-- This page's own visible rendering, for a direct visit. -->
    <main>
      <a class="back" href="../index.html">Back to cards</a>
${renderDetailContent(card, false)}
    </main>
  </body>
</html>
`;
}

export async function generateDetailPages(): Promise<number> {
  const outputDir = join(PUBLIC_DIR, DETAIL_PAGE_DIR);

  // Wiped so a removed record cannot leave an orphaned page behind, which is
  // what makes the output a pure function of the records. Scoped to the
  // generated directory only; the committed fixtures live in a sibling.
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await Promise.all(
    cards.map((card) =>
      writeFile(join(PUBLIC_DIR, detailPagePath(card.id)), renderDetailPage(card), 'utf8'),
    ),
  );

  process.stdout.write(
    `generate-detail-pages: wrote ${cards.length} pages to ${relative(PROJECT_ROOT, outputDir)}/\n`,
  );

  return cards.length;
}

// Only when run as a script. The unit suite imports `renderDetailPage` to check
// it against `renderDetail`'s live output, and importing a module must not write
// to the working tree as a side effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateDetailPages();
}
