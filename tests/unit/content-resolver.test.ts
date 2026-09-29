import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderDetailPage } from '../../scripts/generate-detail-pages';
import {
  type ContentResolverOptions,
  createContentResolver,
  type ResolveOutcome,
} from '../../src/content/content-resolver';
import { DEFAULT_RESOLVER_CONFIG } from '../../src/content/resolver-config';
import { cards } from '../../src/data/cards';

function fixture(name: string): string {
  return readFileSync(resolvePath(process.cwd(), 'public/fixtures', name), 'utf8');
}

const CONFORMING_PAGE = fixture('minimal.html');

interface Deferred<T> {
  promise: Promise<T>;
  settle: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let settle!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    settle = res;
    reject = rej;
  });
  return { promise, settle, reject };
}

function okResponse(body: string): Response {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

function statusResponse(status: number): Response {
  return { ok: false, status, text: async () => '' } as unknown as Response;
}

/** A resolver whose fetch returns whatever the recorded handler says. */
function resolverWith(
  handler: (url: string) => Promise<Response>,
  overrides: Partial<ContentResolverOptions> = {},
) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  });

  const resolver = createContentResolver({
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    ...overrides,
  });

  return { resolver, calls, fetchImpl };
}

describe('createContentResolver', () => {
  describe('resolving a conforming page', () => {
    it('returns the fragment, the colour, the title, and the absolute url', async () => {
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      const outcome = await resolver.resolve('detail/spectrum.html');

      expect(outcome.kind).toBe('resolved');
      if (outcome.kind !== 'resolved') return;

      expect(outcome.fragment.querySelector('[data-detail-heading]')?.textContent).toBe(
        'Minimal',
      );
      expect(outcome.title).toBe('Minimal conforming page');
      expect(outcome.url).toBe('http://localhost:3000/detail/spectrum.html');
      expect(calls).toEqual(['http://localhost:3000/detail/spectrum.html']);
    });

    it('resolves every generated page', async () => {
      for (const card of cards) {
        const { resolver } = resolverWith(async () => okResponse(renderDetailPage(card)));
        const outcome = await resolver.resolve(card.url);

        expect(outcome.kind, card.id).toBe('resolved');
        if (outcome.kind !== 'resolved') continue;
        expect(outcome.color, card.id).toBe(card.color);
        expect(outcome.title, card.id).toBe(card.title);
      }
    });
  });

  describe('single-flight', () => {
    it('joins a concurrent resolution of the same url onto one request', async () => {
      const gate = deferred<Response>();
      const { resolver, calls } = resolverWith(async () => gate.promise);

      const first = resolver.resolve('detail/spectrum.html');
      const second = resolver.resolve('detail/spectrum.html');

      gate.settle(okResponse(CONFORMING_PAGE));
      const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

      // One request for two activations of the same url.
      expect(calls).toHaveLength(1);

      // The second activation superseded the first, so only it may act. Joining a
      // request and being entitled to its result are separate things.
      expect(firstOutcome.kind).toBe('superseded');
      expect(secondOutcome.kind).toBe('resolved');
    });

    it('gives each resolution its own fragment, never a shared one', async () => {
      // The in-flight entry shares the response *text*, not the extracted fragment,
      // so no two callers can be handed one mutable DOM subtree. Two sequential
      // resolutions of the same url are the clean way to see it: same bytes, two
      // independent fragments.
      const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      const first = await resolver.resolve('detail/a.html');
      const second = await resolver.resolve('detail/a.html');

      expect(first.kind).toBe('resolved');
      expect(second.kind).toBe('resolved');
      if (first.kind !== 'resolved' || second.kind !== 'resolved') return;

      expect(second.fragment).not.toBe(first.fragment);

      // Adopting one leaves the other intact, which is what `importNode`'s deep
      // copy buys and a bare `appendChild` would have destroyed.
      const host = document.createElement('div');
      host.append(document.importNode(first.fragment, true));
      expect(second.fragment.querySelector('[data-detail-heading]')).not.toBeNull();
      expect(first.fragment.querySelector('[data-detail-heading]')).not.toBeNull();
    });

    it('serves a second sequential resolution from the cache', async () => {
      // Rewritten for Phase 2, and called out rather than absorbed. Through Phase 1
      // this asserted the opposite — two requests — because Requirement 13.3 kept a
      // cross-activation cache out of that phase deliberately. Phase 2 adds the cache,
      // so the assertion inverts. It is the one existing test whose expectation
      // legitimately changed.
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      await resolver.resolve('detail/spectrum.html');
      await resolver.resolve('detail/spectrum.html');

      expect(calls).toHaveLength(1);
    });
  });

  describe('supersession', () => {
    it('lets the later activation win and supersedes the earlier', async () => {
      const first = deferred<Response>();
      const second = deferred<Response>();
      const { resolver } = resolverWith(async (url) =>
        url.endsWith('first.html') ? first.promise : second.promise,
      );

      const firstActivation = resolver.resolve('detail/first.html');
      const secondActivation = resolver.resolve('detail/second.html');

      second.settle(okResponse(CONFORMING_PAGE));
      first.settle(okResponse(CONFORMING_PAGE));

      expect((await firstActivation).kind).toBe('superseded');
      expect((await secondActivation).kind).toBe('resolved');
    });

    it('discards a superseded activation late FAILURE rather than reporting it', async () => {
      // The sharp edge. If a superseded failure were reported as a failure, the
      // activation path would fall through to navigation on behalf of a click the
      // reader already abandoned — navigating the page out from under the
      // activation they are actually watching.
      const abandoned = deferred<Response>();
      const watched = deferred<Response>();
      const { resolver } = resolverWith(async (url) =>
        url.endsWith('abandoned.html') ? abandoned.promise : watched.promise,
      );

      const abandonedActivation = resolver.resolve('detail/abandoned.html');
      const watchedActivation = resolver.resolve('detail/watched.html');

      abandoned.reject(new TypeError('network down'));
      watched.settle(okResponse(CONFORMING_PAGE));

      const abandonedOutcome = await abandonedActivation;
      expect(abandonedOutcome.kind).toBe('superseded');
      expect(abandonedOutcome.kind).not.toBe('failed');
      expect((await watchedActivation).kind).toBe('resolved');
    });

    it('discards a superseded non-OK status the same way', async () => {
      const abandoned = deferred<Response>();
      const watched = deferred<Response>();
      const { resolver } = resolverWith(async (url) =>
        url.endsWith('abandoned.html') ? abandoned.promise : watched.promise,
      );

      const abandonedActivation = resolver.resolve('detail/abandoned.html');
      const watchedActivation = resolver.resolve('detail/watched.html');

      abandoned.settle(statusResponse(500));
      watched.settle(okResponse(CONFORMING_PAGE));

      expect((await abandonedActivation).kind).toBe('superseded');
      expect((await watchedActivation).kind).toBe('resolved');
    });

    it('discards a superseded contract violation the same way', async () => {
      const abandoned = deferred<Response>();
      const watched = deferred<Response>();
      const { resolver } = resolverWith(async (url) =>
        url.endsWith('abandoned.html') ? abandoned.promise : watched.promise,
      );

      const abandonedActivation = resolver.resolve('detail/abandoned.html');
      const watchedActivation = resolver.resolve('detail/watched.html');

      abandoned.settle(okResponse(fixture('no-region.html')));
      watched.settle(okResponse(CONFORMING_PAGE));

      expect((await abandonedActivation).kind).toBe('superseded');
      expect((await watchedActivation).kind).toBe('resolved');
    });

    it('admits exactly one non-superseded activation however many are pending', async () => {
      const gates = new Map<string, Deferred<Response>>();
      const { resolver } = resolverWith(async (url) => {
        const gate = gates.get(url) ?? deferred<Response>();
        gates.set(url, gate);
        return gate.promise;
      });

      const urls = ['a', 'b', 'c', 'd', 'e'].map((name) => `detail/${name}.html`);
      const activations = urls.map((url) => resolver.resolve(url));

      // Settle them out of order, so winning cannot be an artefact of ordering.
      for (const url of [...urls].reverse()) {
        const absolute = `http://localhost:3000/${url}`;
        gates.get(absolute)?.settle(okResponse(CONFORMING_PAGE));
      }

      const outcomes = await Promise.all(activations);
      const acted = outcomes.filter((outcome: ResolveOutcome) => outcome.kind !== 'superseded');

      expect(acted).toHaveLength(1);
      // The last activation is the one entitled to act.
      expect(outcomes[outcomes.length - 1]?.kind).toBe('resolved');
    });
  });

  describe('failure mapping', () => {
    it('maps a non-OK response to response-not-ok, carrying the status', async () => {
      const { resolver } = resolverWith(async () => statusResponse(404));

      const outcome = await resolver.resolve('detail/missing.html');

      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.reason).toBe('response-not-ok');
      expect(outcome.status).toBe(404);
      expect(outcome.message).toContain('404');
    });

    it('maps a rejected request to request-failed', async () => {
      const { resolver } = resolverWith(async () => {
        throw new TypeError('Failed to fetch');
      });

      const outcome = await resolver.resolve('detail/spectrum.html');

      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.reason).toBe('request-failed');
      expect(outcome.message).toContain('Failed to fetch');
    });

    it('passes an extraction failure through with the extractor reason', async () => {
      const cases = [
        ['no-region.html', 'missing-region'],
        ['region-not-template.html', 'region-not-template'],
        ['no-heading.html', 'missing-heading'],
        ['two-headings.html', 'ambiguous-heading'],
      ] as const;

      for (const [file, reason] of cases) {
        const { resolver } = resolverWith(async () => okResponse(fixture(file)));
        const outcome = await resolver.resolve('detail/spectrum.html');

        expect(outcome.kind, file).toBe('failed');
        if (outcome.kind !== 'failed') continue;
        expect(outcome.reason, file).toBe(reason);
      }
    });

    it('rejects an unusable url without issuing a request', async () => {
      const unusable = [
        '', // absent
        '   ', // whitespace only
        'http://elsewhere.invalid/detail.html', // absolute, cross-origin
        'http://', // no host, genuinely unparseable
        '//', // genuinely unparseable
        'foo://bar', // parses, but its origin is null
      ];

      for (const url of unusable) {
        const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));
        const outcome = await resolver.resolve(url);

        expect(outcome.kind, JSON.stringify(url)).toBe('failed');
        if (outcome.kind !== 'failed') continue;
        expect(outcome.reason, JSON.stringify(url)).toBe('invalid-url');
        expect(calls, JSON.stringify(url)).toHaveLength(0);
      }
    });

    it('refuses a protocol-relative url, which silently leaves the origin', async () => {
      // `//evil.com/x` looks like a path and is not one: resolved against an http
      // base it becomes `http://evil.com/x`. Easy to author by accident, and the
      // same-origin check is the only thing standing between that and adopting
      // someone else's DOM into this document.
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      const outcome = await resolver.resolve('//evil.com/detail.html');

      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.reason).toBe('invalid-url');
      expect(calls).toHaveLength(0);
    });

    it('does issue a request for an odd-looking but same-origin relative url', async () => {
      // Almost any string is a valid *relative* url: `not a url::` resolves to
      // `http://localhost:3000/not%20a%20url::`, which is same-origin and therefore
      // worth asking about. It fails on the response, not on the url — the same way
      // `DOMParser` gives no parse-failure branch, `new URL` with a base gives
      // barely any. Pinned so the distinction is not mistaken for a bug.
      const { resolver, calls } = resolverWith(async () => statusResponse(404));

      const outcome = await resolver.resolve('not a url::');

      expect(calls).toHaveLength(1);
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.reason).toBe('response-not-ok');
    });

    it('treats a cross-origin url as unusable even when it would have resolved', async () => {
      // Same-origin is a hard constraint, not a preference: the transition adopts
      // real DOM into this document, and an iframe would rasterise blank through
      // the SVG foreignObject the capture uses.
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      const outcome = await resolver.resolve('https://example.invalid/detail/spectrum.html');

      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.reason).toBe('invalid-url');
      expect(calls).toHaveLength(0);
    });
  });

  describe('separation of concerns', () => {
    it('does not touch the document while resolving', async () => {
      const before = document.body.innerHTML;
      const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      await resolver.resolve('detail/spectrum.html');

      expect(document.body.innerHTML).toBe(before);
    });

    it('exposes its config without reaching into MotionProfile', async () => {
      const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      // An exact set rather than a subset, so the config cannot grow by accident —
      // every field here is a decision recorded in the design.
      expect(Object.keys(resolver.config).sort()).toEqual([
        'cacheMaxAgeMs',
        'cacheMaxEntries',
        'captureReadinessTimeoutMs',
        'latencyBudgetMs',
        'pendingAffordanceDelayMs',
      ]);

      // The one relationship that must hold, or the fallback commit fires before the
      // tile has acknowledged the click.
      expect(resolver.config.pendingAffordanceDelayMs).toBeLessThan(
        resolver.config.latencyBudgetMs,
      );
    });
  });
});

describe('warm', () => {
  describe('cannot swallow an activation', () => {
    /**
     * The load-bearing test of Phase 2.
     *
     * `resolve` takes the activation token on every call. A prefetch implemented as an
     * early `resolve` would therefore supersede a pending click, and the activation
     * path treats a superseded outcome as "do nothing at all" — so the click would
     * vanish with no error, no log, and nothing visible but a tile that did not
     * respond. Moving the pointer would be enough to lose a click.
     *
     * These assert the property directly, because nothing else would catch its loss.
     */
    it('leaves a pending activation entitled to its own result', async () => {
      const gate = deferred<Response>();
      const { resolver, calls } = resolverWith(async (url) =>
        url.endsWith('clicked.html') ? gate.promise : okResponse(CONFORMING_PAGE),
      );

      const click = resolver.resolve('detail/clicked.html');

      // The pointer wanders across several other tiles while the click is in flight.
      resolver.warm('detail/a.html');
      resolver.warm('detail/b.html');
      resolver.warm('detail/c.html');
      await Promise.resolve();

      gate.settle(okResponse(CONFORMING_PAGE));
      const outcome = await click;

      expect(outcome.kind).toBe('resolved');
      expect(outcome.kind).not.toBe('superseded');
      expect(calls.filter((url) => url.endsWith('clicked.html'))).toHaveLength(1);
    });

    it('leaves it entitled even when warming the very url it is resolving', async () => {
      const gate = deferred<Response>();
      const { resolver } = resolverWith(async () => gate.promise);

      const click = resolver.resolve('detail/spectrum.html');
      resolver.warm('detail/spectrum.html');
      resolver.warm('detail/spectrum.html');
      await Promise.resolve();

      gate.settle(okResponse(CONFORMING_PAGE));

      expect((await click).kind).toBe('resolved');
    });

    it('still lets a later activation supersede an earlier one', async () => {
      // The fix must not have disabled the Phase 1 behaviour it sits beside.
      const first = deferred<Response>();
      const second = deferred<Response>();
      const { resolver } = resolverWith(async (url) =>
        url.endsWith('first.html') ? first.promise : second.promise,
      );

      const a = resolver.resolve('detail/first.html');
      const b = resolver.resolve('detail/second.html');
      resolver.warm('detail/third.html');

      second.settle(okResponse(CONFORMING_PAGE));
      first.settle(okResponse(CONFORMING_PAGE));

      expect((await a).kind).toBe('superseded');
      expect((await b).kind).toBe('resolved');
    });

    it('admits one non-superseded activation however many warms are in flight', async () => {
      const gate = deferred<Response>();
      const { resolver } = resolverWith(async () => gate.promise);

      const activation = resolver.resolve('detail/spectrum.html');
      for (let index = 0; index < 20; index += 1) {
        resolver.warm(`detail/warm-${index}.html`);
      }
      gate.settle(okResponse(CONFORMING_PAGE));

      expect((await activation).kind).toBe('resolved');
    });
  });

  describe('shape', () => {
    it('returns undefined rather than a promise, so it cannot be awaited', () => {
      const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      expect(resolver.warm('detail/spectrum.html')).toBeUndefined();
    });

    it('never throws and never rejects, whatever the response', async () => {
      const cases: Array<() => Promise<Response>> = [
        async () => statusResponse(500),
        async () => {
          throw new TypeError('network down');
        },
        async () => okResponse(fixture('no-region.html')),
        async () => okResponse('not html at all'),
      ];

      for (const handler of cases) {
        const { resolver } = resolverWith(handler);
        expect(() => resolver.warm('detail/spectrum.html')).not.toThrow();
      }

      // Let every swallowed rejection settle; an unhandled one would fail the run.
      await new Promise((settle) => setTimeout(settle, 10));
    });

    it('issues no request for an unusable url', () => {
      for (const url of ['', '   ', 'http://elsewhere.invalid/x.html', '//evil.com/x.html']) {
        const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));
        resolver.warm(url);
        expect(calls, JSON.stringify(url)).toHaveLength(0);
      }
    });

    it('does not touch the document', () => {
      const before = document.body.innerHTML;
      const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      resolver.warm('detail/spectrum.html');

      expect(document.body.innerHTML).toBe(before);
    });
  });

  describe('feeds the cache', () => {
    it('makes a subsequent activation issue no request at all', async () => {
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));

      resolver.warm('detail/spectrum.html');
      await new Promise((settle) => setTimeout(settle, 0));
      expect(calls).toHaveLength(1);

      const outcome = await resolver.resolve('detail/spectrum.html');

      expect(outcome.kind).toBe('resolved');
      expect(calls).toHaveLength(1);
    });

    it('issues one request for repeated warms, in flight or cached', async () => {
      // `pointerover` fires repeatedly as the pointer moves within one tile, so this
      // is the property that keeps the handler cheap.
      const gate = deferred<Response>();
      const { resolver, calls } = resolverWith(async () => gate.promise);

      resolver.warm('detail/spectrum.html');
      resolver.warm('detail/spectrum.html');
      resolver.warm('detail/spectrum.html');
      expect(calls).toHaveLength(1);

      gate.settle(okResponse(CONFORMING_PAGE));
      await new Promise((settle) => setTimeout(settle, 0));

      resolver.warm('detail/spectrum.html');
      expect(calls).toHaveLength(1);
    });
  });

  describe('metered connections', () => {
    it('issues no request when saveData is set', () => {
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE), {
        saveData: () => true,
      });

      resolver.warm('detail/spectrum.html');

      expect(calls).toHaveLength(0);
    });

    it('warms normally when the connection API is absent', () => {
      // Absence is not a signal to abstain: the API is Chromium-only, so treating
      // missing as metered would disable prefetch in Safari and Firefox.
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE), {
        saveData: () => false,
      });

      resolver.warm('detail/spectrum.html');

      expect(calls).toHaveLength(1);
    });

    it('does not withhold an activation the user actually made', async () => {
      const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE), {
        saveData: () => true,
      });

      const outcome = await resolver.resolve('detail/spectrum.html');

      expect(outcome.kind).toBe('resolved');
      expect(calls).toHaveLength(1);
    });
  });
});

describe('the cache', () => {
  it('evicts the least recently used entry past the cap', async () => {
    const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE), {
      config: { ...DEFAULT_RESOLVER_CONFIG, cacheMaxEntries: 2 },
    });

    await resolver.resolve('detail/a.html');
    await resolver.resolve('detail/b.html');
    // Touching `a` makes `b` the least recently used.
    await resolver.resolve('detail/a.html');
    await resolver.resolve('detail/c.html');

    expect(calls).toHaveLength(3);

    // `a` and `c` are still cached; `b` was evicted.
    await resolver.resolve('detail/a.html');
    await resolver.resolve('detail/c.html');
    expect(calls).toHaveLength(3);

    await resolver.resolve('detail/b.html');
    expect(calls).toHaveLength(4);
  });

  it('treats an entry past its age cap as absent', async () => {
    let now = 0;
    const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE), {
      config: { ...DEFAULT_RESOLVER_CONFIG, cacheMaxAgeMs: 1000 },
      now: () => now,
    });

    await resolver.resolve('detail/spectrum.html');
    expect(calls).toHaveLength(1);

    now = 999;
    await resolver.resolve('detail/spectrum.html');
    expect(calls).toHaveLength(1);

    now = 1001;
    await resolver.resolve('detail/spectrum.html');
    expect(calls).toHaveLength(2);
  });

  it('drops an entry on invalidate, so a retry re-fetches', async () => {
    // Called when an activation fails after resolution succeeded: the body may have
    // been the cause, so replaying it would replay the failure.
    const { resolver, calls } = resolverWith(async () => okResponse(CONFORMING_PAGE));

    await resolver.resolve('detail/spectrum.html');
    expect(calls).toHaveLength(1);

    resolver.invalidate('detail/spectrum.html');
    await resolver.resolve('detail/spectrum.html');

    expect(calls).toHaveLength(2);
  });

  it('tolerates invalidating something never cached', () => {
    const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

    expect(() => resolver.invalidate('detail/never.html')).not.toThrow();
    expect(() => resolver.invalidate('')).not.toThrow();
  });

  it('caches no failure, so the next attempt asks again', async () => {
    let attempt = 0;
    const { resolver, calls } = resolverWith(async () => {
      attempt += 1;
      return attempt === 1 ? statusResponse(503) : okResponse(CONFORMING_PAGE);
    });

    expect((await resolver.resolve('detail/spectrum.html')).kind).toBe('failed');
    expect((await resolver.resolve('detail/spectrum.html')).kind).toBe('resolved');
    expect(calls).toHaveLength(2);
  });

  it('gives cached resolutions independent fragments', async () => {
    const { resolver } = resolverWith(async () => okResponse(CONFORMING_PAGE));

    const first = await resolver.resolve('detail/spectrum.html');
    const second = await resolver.resolve('detail/spectrum.html');

    expect(first.kind).toBe('resolved');
    expect(second.kind).toBe('resolved');
    if (first.kind !== 'resolved' || second.kind !== 'resolved') return;

    // Bodies are cached, not fragments — so extraction still runs per consumer and no
    // two activations share one mutable DOM subtree.
    expect(second.fragment).not.toBe(first.fragment);

    const host = document.createElement('div');
    host.append(document.importNode(first.fragment, true));
    expect(second.fragment.querySelector('[data-detail-heading]')).not.toBeNull();
  });
});

describe('validateResolverConfig', () => {
  it('rejects an affordance delay at or past the latency budget', () => {
    // The relationship exists because getting it backwards produces a subtle,
    // plausible-looking bug: every slow activation degrades to the fallback while the
    // tile never acknowledges the press.
    expect(() =>
      createContentResolver({
        config: { ...DEFAULT_RESOLVER_CONFIG, latencyBudgetMs: 100, pendingAffordanceDelayMs: 100 },
      }),
    ).toThrow(/must be less than latencyBudgetMs/);

    expect(() =>
      createContentResolver({
        config: { ...DEFAULT_RESOLVER_CONFIG, latencyBudgetMs: 100, pendingAffordanceDelayMs: 150 },
      }),
    ).toThrow(/must be less than latencyBudgetMs/);
  });

  it('rejects non-positive and non-finite tunables by name', () => {
    for (const field of [
      'captureReadinessTimeoutMs',
      'latencyBudgetMs',
      'pendingAffordanceDelayMs',
      'cacheMaxEntries',
      'cacheMaxAgeMs',
    ] as const) {
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          () => createContentResolver({ config: { ...DEFAULT_RESOLVER_CONFIG, [field]: value } }),
          `${field}=${value}`,
        ).toThrow(new RegExp(field));
      }
    }
  });

  it('rejects a non-integer entry cap', () => {
    expect(() =>
      createContentResolver({ config: { ...DEFAULT_RESOLVER_CONFIG, cacheMaxEntries: 2.5 } }),
    ).toThrow(/cacheMaxEntries must be an integer/);
  });

  it('accepts the shipped default', () => {
    expect(() => createContentResolver({ config: DEFAULT_RESOLVER_CONFIG })).not.toThrow();
  });
});
