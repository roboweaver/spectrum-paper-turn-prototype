/** Query parameter that controls whether the debug panel is on screen. */
export const DEBUG_PARAM = 'debug';

/** The single value written back to the URL when the panel is hidden. */
export const DEBUG_HIDDEN_VALUE = '0';

/**
 * The only values that hide the panel.
 *
 * The demo is published so people can inspect the turn, so the panel is on by
 * default and hiding is the opt-in. That makes an allow-list the safe shape: an
 * unrecognised value such as `?debug=banana` must fall through to *visible*,
 * because the alternative — a typo silently removing the controls the page
 * exists to show — is the failure worth designing against.
 *
 * `?debug` and `?debug=` are indistinguishable through `URLSearchParams` (both
 * read back as an empty string), so neither is listed and both stay visible,
 * which also keeps the pre-existing bare `?debug` links working.
 */
const HIDDEN_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'off', 'no']);

function toParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string' ? new URLSearchParams(search) : search;
}

/** True unless `debug` is present with a recognised off value. */
export function isDebugPanelVisible(search: string | URLSearchParams): boolean {
  const raw = toParams(search).get(DEBUG_PARAM);

  if (raw === null) {
    return true;
  }

  return !HIDDEN_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Rewrites just the `debug` parameter, leaving every other one in place.
 *
 * Showing removes the parameter rather than setting `debug=1`, so the shown
 * state — which is the default — always has the same canonical URL whether it
 * was reached by loading the page or by clicking the chip.
 */
export function debugSearchFor(visible: boolean, search: string | URLSearchParams): string {
  const params = new URLSearchParams(toParams(search).toString());

  if (visible) {
    params.delete(DEBUG_PARAM);
  } else {
    params.set(DEBUG_PARAM, DEBUG_HIDDEN_VALUE);
  }

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** Same-document URL for the given visibility, preserving path, query, and hash. */
export function debugUrlFor(visible: boolean, href: string): string {
  const url = new URL(href);
  return `${url.pathname}${debugSearchFor(visible, url.search)}${url.hash}`;
}

/** The subset of `window` this module needs, so tests can supply a double. */
export interface DebugUrlTarget {
  readonly history: Pick<History, 'replaceState' | 'state'>;
  readonly location: Pick<Location, 'href'>;
}

/**
 * Points the address bar at the current visibility without navigating.
 *
 * `replaceState` is deliberate: a redirect would reload the page, discarding
 * the transition state and the live speed setting the panel exists to expose.
 * Hiding must be a pure view change that still leaves a copy-pasteable URL.
 */
export function syncDebugParam(visible: boolean, target: DebugUrlTarget = window): void {
  target.history.replaceState(target.history.state, '', debugUrlFor(visible, target.location.href));
}
