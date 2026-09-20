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
import { DEFAULT_RESOLVER_CONFIG, type ResolverConfig } from './resolver-config';

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
}

export interface ContentResolver {
  /**
   * Resolves one activation.
   *
   * Supersedes any activation still pending, which will then observe
   * `{ kind: 'superseded' }` rather than its own outcome.
   */
  resolve(url: string): Promise<ResolveOutcome>;
  readonly config: ResolverConfig;
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
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const readBaseUrl = options.baseUrl ?? (() => document.baseURI);
  const readOrigin = options.origin ?? (() => globalThis.location.origin);

  /**
   * Response bodies for requests currently in flight, keyed by absolute URL.
   *
   * The *text* is shared rather than the extracted fragment, so two joined callers
   * each get an independent `DocumentFragment` from their own `extractFragment`
   * call. Sharing the fragment would hand two callers one mutable DOM subtree.
   *
   * Entries are deleted the moment a request settles. That is what makes this a
   * single-flight guard and not a cache: only genuinely concurrent requests join,
   * and nothing survives to be served staler than the network. Requirement 13.3
   * excludes a cross-activation cache from Phase 1; Phase 2 adds one deliberately.
   */
  const inFlight = new Map<string, Promise<string>>();

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

  async function fetchText(absolute: string): Promise<string> {
    const pending = inFlight.get(absolute);
    if (pending) {
      return pending;
    }

    const request = (async () => {
      const response = await fetchImpl(absolute);
      if (!response.ok) {
        throw new HttpStatusError(response.status, absolute);
      }
      return response.text();
    })();

    inFlight.set(absolute, request);
    try {
      return await request;
    } finally {
      inFlight.delete(absolute);
    }
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

  return { resolve, config };
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
