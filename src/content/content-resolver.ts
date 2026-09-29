/**
 * Content resolution: turning a tile's URL into a fragment ready to adopt.
 *
 * This module exists so that the network wait lives **outside** the transition
 * state machine. The activation path resolves first and only then measures tiles
 * and calls `coordinator.open()`, which keeps `TransitionView`,
 * `TransitionCoordinator`, the geometry, the renderer, the timeline, and the
 * fallback untouched along with their tests. Nothing here reads tile geometry,
 * calls a coordinator method, or mutates the detail surface.
 *
 * It owns one piece of genuinely new machinery, and the design accepted it
 * explicitly: the coordinator refuses `open()` unless its state is `idle`, but
 * during a pending fetch the state *is* `idle`, so a second click would slip past
 * that guard. The single-flight and supersession logic below is what stands in for
 * it.
 */

import { type FragmentFailureReason, extractFragment } from './fragment';
import {
  DEFAULT_RESOLVER_CONFIG,
  type ResolverConfig,
  validateResolverConfig,
} from './resolver-config';

export type ResolveFailureReason =
  /** Absent, empty, unparseable, or cross-origin. No request is issued. */
  | 'invalid-url'
  /** The server answered, but not with a 2xx. */
  | 'response-not-ok'
  /** The request itself failed — offline, DNS, CORS, aborted transport. */
  | 'request-failed'
  /** The response arrived and parsed, but violated the fragment contract. */
  | FragmentFailureReason;

export interface ResolveResolved {
  readonly kind: 'resolved';
  /** Inert until adopted. `document.importNode(fragment, true)` makes it live. */
  readonly fragment: DocumentFragment;
  readonly color: string;
  readonly title: string | null;
  /** The absolute URL that produced this, for the caller to navigate to later. */
  readonly url: string;
}

export interface ResolveFailed {
  readonly kind: 'failed';
  readonly reason: ResolveFailureReason;
  readonly message: string;
  /** Present for `response-not-ok`. */
  readonly status?: number;
}

/**
 * A later activation took over, so this one's result is owed to nobody.
 *
 * Its own outcome — success *or* failure — must be dropped. Treating a superseded
 * failure as a failure is the subtle bug this exists to prevent: a click the reader
 * already abandoned would navigate the page out from under the activation they are
 * actually watching.
 */
export interface ResolveSuperseded {
  readonly kind: 'superseded';
}

export type ResolveOutcome = ResolveResolved | ResolveFailed | ResolveSuperseded;

export interface ContentResolverOptions {
  readonly config?: ResolverConfig;
  /** Injected for tests, matching how `capture.ts` takes its `toCanvas`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Injected for tests. Defaults to the document's base URL. */
  readonly baseUrl?: () => string;
  /** Injected for tests. Defaults to the page's own origin. */
  readonly origin?: () => string;
  /** Injected for tests. Defaults to `performance.now()`, for cache ages. */
  readonly now?: () => number;
  /**
   * Injected for tests. Reports whether the user has asked to save data.
   *
   * Defaults to reading `navigator.connection.saveData`, which is Chromium-only —
   * so this is best-effort courtesy rather than a guarantee.
   */
  readonly saveData?: () => boolean;
}

export interface ContentResolver {
  /**
   * Warms the cache for a URL. Speculative, and owed to nobody.
   *
   * **Never takes the activation token.** That is the entire reason this is a
   * separate method rather than a flag on `resolve`, and it is not a stylistic
   * preference. `resolve` increments the token on every call, so a prefetch
   * implemented as an early `resolve` would supersede a pending click — and the
   * activation path treats a superseded outcome as "do nothing at all". The click
   * would vanish with no error, no log, and nothing visible but a tile that did
   * not respond. Moving the pointer would be enough to lose a click.
   *
   * Returns `void` rather than a promise so no caller can await a speculative
   * fetch, and swallows every outcome: a prefetch failure is not actionable,
   * because the activation will make the same request and report properly.
   */
  warm(url: string): void;
  /**
   * Resolves one activation.
   *
   * Supersedes any activation still pending, which will then observe
   * `{ kind: 'superseded' }` rather than its own outcome. Deliberately
   * single-argument: a `{ prefetch: true }` option would switch off supersession,
   * outcome reporting, and failure propagation at once — three behaviours behind
   * one flag — and would leave both modes returning `Promise<ResolveOutcome>` for
   * a caller to confuse. `warm` exists so that mistake is unrepresentable.
   */
  resolve(url: string): Promise<ResolveOutcome>;
  /**
   * Drops a cached body.
   *
   * Called when an activation fails *after* resolution succeeded, because the body
   * may have been the cause — so a retry must re-fetch rather than re-serve it.
   */
  invalidate(url: string): void;
  readonly config: ResolverConfig;
}

interface CacheEntry {
  readonly body: string;
  readonly storedAt: number;
}

function failed(
  reason: ResolveFailureReason,
  message: string,
  status?: number,
): ResolveFailed {
  return status === undefined
    ? { kind: 'failed', reason, message }
    : { kind: 'failed', reason, message, status };
}

export function createContentResolver(options: ContentResolverOptions = {}): ContentResolver {
  const config = options.config ?? DEFAULT_RESOLVER_CONFIG;
  validateResolverConfig(config);
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const readBaseUrl = options.baseUrl ?? (() => document.baseURI);
  const readOrigin = options.origin ?? (() => globalThis.location.origin);
  const readNow = options.now ?? (() => performance.now());
  const readSaveData =
    options.saveData ??
    (() => {
      const connection = (
        globalThis.navigator as Navigator & { connection?: { saveData?: boolean } } | undefined
      )?.connection;
      // Absence is not a signal to abstain: the API is Chromium-only, so treating
      // "missing" as "metered" would disable prefetch in Safari and Firefox.
      return connection?.saveData === true;
    });

  /**
   * Response bodies for requests currently in flight, keyed by absolute URL.
   *
   * The *text* is shared rather than the extracted fragment, so two joined callers
   * each get an independent `DocumentFragment` from their own `extractFragment`
   * call. Sharing the fragment would hand two callers one mutable DOM subtree.
   *
   * Entries are deleted the moment a request settles, so only genuinely concurrent
   * requests join. This is the single-flight guard; the cache below is what
   * survives a settle, and the two are deliberately separate.
   */
  const inFlight = new Map<string, Promise<string>>();

  /**
   * Response bodies that outlive their request, keyed by absolute URL.
   *
   * Bodies rather than extracted fragments, for the same reason `inFlight` shares
   * text: `extractFragment` must run per consumer so each gets an independent
   * `DocumentFragment`. Caching the fragment would hand two activations one mutable
   * DOM subtree. The extra parse is a fraction of a millisecond against a round
   * trip.
   *
   * A `Map` is its own LRU here, because JavaScript `Map` preserves insertion order
   * and `delete`-then-`set` moves a key to the end. So the oldest key is simply the
   * first one iteration yields.
   */
  const cache = new Map<string, CacheEntry>();

  /** Reads a live entry, treating an expired one as absent and evicting it. */
  function cachedBody(absolute: string): string | null {
    const entry = cache.get(absolute);
    if (!entry) {
      return null;
    }

    if (readNow() - entry.storedAt > config.cacheMaxAgeMs) {
      cache.delete(absolute);
      return null;
    }

    // Touch: re-inserting moves this key to the end, making it most-recently-used.
    cache.delete(absolute);
    cache.set(absolute, entry);
    return entry.body;
  }

  function storeBody(absolute: string, body: string): void {
    cache.delete(absolute);
    cache.set(absolute, { body, storedAt: readNow() });

    while (cache.size > config.cacheMaxEntries) {
      // Insertion order makes the first key the least recently used.
      const oldest = cache.keys().next();
      if (oldest.done) {
        break;
      }
      cache.delete(oldest.value);
    }
  }

  /**
   * Identity of the activation entitled to act on its result.
   *
   * Incremented on every `resolve`, so a token that no longer matches means a
   * later activation has taken over.
   */
  let currentActivation = 0;

  function absoluteUrl(url: string): string | null {
    if (typeof url !== 'string' || url.trim().length === 0) {
      return null;
    }
    try {
      const resolved = new URL(url, readBaseUrl());
      // Same-origin is a hard constraint, not a configurable one. The transition
      // adopts real DOM from this document; a cross-origin one cannot be adopted,
      // and an iframe would rasterise blank through `foreignObject`.
      return resolved.origin === readOrigin() ? resolved.href : null;
    } catch {
      return null;
    }
  }

  /**
   * Starts or joins a request for one URL, caching the body on success.
   *
   * Three layers, in order: a live cache entry short-circuits entirely, an
   * in-flight request is joined rather than duplicated, and only a genuine miss
   * reaches the network.
   */
  function fetchText(absolute: string): Promise<string> {
    const cached = cachedBody(absolute);
    if (cached !== null) {
      return Promise.resolve(cached);
    }

    const pending = inFlight.get(absolute);
    if (pending) {
      return pending;
    }

    const request = (async () => {
      const response = await fetchImpl(absolute);
      if (!response.ok) {
        throw new HttpStatusError(response.status, absolute);
      }
      const body = await response.text();
      // Only successful bodies are cached. A failure is not worth remembering: the
      // next attempt should ask again rather than replay the error.
      storeBody(absolute, body);
      return body;
    })();

    inFlight.set(absolute, request);
    // Settled either way, so a failure leaves nothing to join. Not awaited, so the
    // caller's `await` is on the request itself rather than on this bookkeeping.
    void request.catch(() => undefined).finally(() => inFlight.delete(absolute));
    return request;
  }

  async function resolve(url: string): Promise<ResolveOutcome> {
    currentActivation += 1;
    const activation = currentActivation;
    const isCurrent = () => activation === currentActivation;

    const absolute = absoluteUrl(url);
    if (!absolute) {
      // Checked before the token, because an unusable URL is the caller's mistake
      // whether or not it was superseded — and reporting it costs no request.
      return isCurrent()
        ? failed(
            'invalid-url',
            `"${url}" is absent, unparseable, or not same-origin, so it cannot be adopted.`,
          )
        : { kind: 'superseded' };
    }

    let html: string;
    try {
      html = await fetchText(absolute);
    } catch (error) {
      // Order matters. A superseded activation's *failure* is discarded too, or an
      // abandoned click would navigate away from the activation being watched.
      if (!isCurrent()) {
        return { kind: 'superseded' };
      }
      if (error instanceof HttpStatusError) {
        return failed(
          'response-not-ok',
          `${absolute} answered ${error.status}.`,
          error.status,
        );
      }
      return failed(
        'request-failed',
        `${absolute} could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isCurrent()) {
      return { kind: 'superseded' };
    }

    const extracted = extractFragment(html);
    if (!extracted.ok) {
      return failed(extracted.reason, extracted.message);
    }

    return {
      kind: 'resolved',
      fragment: extracted.fragment,
      color: extracted.color,
      title: extracted.title,
      url: absolute,
    };
  }

  /**
   * Warms the cache. Fire-and-forget, and deliberately not `async`.
   *
   * Note what is *absent* from this function: any read or write of
   * `currentActivation`. That omission is the feature. Everything else here —
   * `void` return, swallowed failures, no outcome — exists to make it impossible for
   * a caller to treat a warm as an activation by mistake.
   */
  function warm(url: string): void {
    // The click the user actually made is never subject to this; only speculation is.
    if (readSaveData()) {
      return;
    }

    const absolute = absoluteUrl(url);
    if (!absolute) {
      return;
    }

    // Cheap and idempotent, which `pointerover` requires: it fires repeatedly as the
    // pointer moves within one tile, so the common path here is a map lookup.
    if (cachedBody(absolute) !== null || inFlight.has(absolute)) {
      return;
    }

    // Swallowed on purpose. A prefetch failure is not actionable — the activation
    // will make the same request and report properly — and an unhandled rejection
    // from a speculative fetch would be noise in the console.
    void fetchText(absolute).catch(() => undefined);
  }

  function invalidate(url: string): void {
    const absolute = absoluteUrl(url);
    if (absolute) {
      cache.delete(absolute);
    }
  }

  return { warm, resolve, invalidate, config };
}

/** Internal marker so a non-OK response is distinguishable from a transport failure. */
class HttpStatusError extends Error {
  public readonly status: number;

  constructor(status: number, url: string) {
    super(`${url} answered ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}
