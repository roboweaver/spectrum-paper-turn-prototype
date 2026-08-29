import { describe, expect, it, vi } from 'vitest';
import {
  type DebugUrlTarget,
  debugSearchFor,
  debugUrlFor,
  isDebugPanelVisible,
  syncDebugParam,
} from '../../src/debug/debug-visibility';

function target(href: string, state: unknown = null) {
  const replaceState = vi.fn<History['replaceState']>();
  const stub: DebugUrlTarget = { history: { replaceState, state }, location: { href } };

  return { stub, replaceState };
}

describe('isDebugPanelVisible', () => {
  it('shows the panel when no parameters are present at all', () => {
    expect(isDebugPanelVisible('')).toBe(true);
  });

  it('shows the panel when other parameters are present but debug is not', () => {
    expect(isDebugPanelVisible('?duration=2000&fallback=1')).toBe(true);
  });

  it.each(['?debug', '?debug=', '?debug=1'])(
    'keeps the pre-existing %s links showing the panel',
    (search) => {
      expect(isDebugPanelVisible(search)).toBe(true);
    },
  );

  it.each(['?debug=0', '?debug=false', '?debug=off', '?debug=no'])('hides the panel for %s', (search) => {
    expect(isDebugPanelVisible(search)).toBe(false);
  });

  it.each(['?debug=OFF', '?debug=False', '?debug=%20no%20'])(
    'normalises case and surrounding space in %s',
    (search) => {
      expect(isDebugPanelVisible(search)).toBe(false);
    },
  );

  it.each(['?debug=banana', '?debug=2', '?debug=true', '?debug=-0'])(
    'refuses to let the unrecognised value %s hide the panel',
    (search) => {
      expect(isDebugPanelVisible(search)).toBe(true);
    },
  );

  it('accepts URLSearchParams as well as a raw string', () => {
    expect(isDebugPanelVisible(new URLSearchParams({ debug: '0' }))).toBe(false);
  });
});

describe('debugSearchFor', () => {
  it('drops the parameter entirely when shown so the default has one URL', () => {
    expect(debugSearchFor(true, '?debug=0')).toBe('');
  });

  it('writes the canonical off value when hidden', () => {
    expect(debugSearchFor(false, '')).toBe('?debug=0');
  });

  it('collapses any recognised off value to the canonical one', () => {
    expect(debugSearchFor(false, '?debug=off')).toBe('?debug=0');
  });

  it('preserves other parameters when hiding', () => {
    expect(debugSearchFor(false, '?duration=2000&fallback=1')).toBe('?duration=2000&fallback=1&debug=0');
  });

  it('preserves other parameters when showing', () => {
    expect(debugSearchFor(true, '?duration=2000&debug=0&fallback=1')).toBe('?duration=2000&fallback=1');
  });

  it('does not mutate a URLSearchParams passed in by the caller', () => {
    const params = new URLSearchParams('?duration=2000');
    debugSearchFor(false, params);
    expect(params.has('debug')).toBe(false);
  });
});

describe('debugUrlFor', () => {
  it('keeps the path and hash while rewriting the query', () => {
    expect(debugUrlFor(false, 'https://example.test/spectrum-paper-turn-prototype/#detail')).toBe(
      '/spectrum-paper-turn-prototype/?debug=0#detail',
    );
  });

  it('leaves a bare path bare when the last parameter is removed', () => {
    expect(debugUrlFor(true, 'https://example.test/demo?debug=0')).toBe('/demo');
  });
});

describe('syncDebugParam', () => {
  it('replaces the URL instead of navigating', () => {
    const { stub, replaceState } = target('https://example.test/demo?duration=2000');

    syncDebugParam(false, stub);

    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/demo?duration=2000&debug=0');
  });

  it('carries the existing history state through so back/forward is untouched', () => {
    const state = { scroll: 12 };
    const { stub, replaceState } = target('https://example.test/demo?debug=0', state);

    syncDebugParam(true, stub);

    expect(replaceState).toHaveBeenCalledWith(state, '', '/demo');
  });
});
