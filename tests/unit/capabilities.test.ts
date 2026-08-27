import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserMotionMode, hasWebGl, selectMotionMode } from '../../src/transition/capabilities';

describe('selectMotionMode', () => {
  it('returns full only when every full-motion prerequisite is satisfied', () => {
    expect(
      selectMotionMode({
        reducedMotion: false,
        webglAvailable: true,
        captureAvailable: true,
      }),
    ).toBe('full');
  });

  it('returns fallback for every reduced-motion or capability failure combination', () => {
    const fallbackCases = [
      { reducedMotion: true, webglAvailable: true, captureAvailable: true },
      { reducedMotion: false, webglAvailable: false, captureAvailable: true },
      { reducedMotion: false, webglAvailable: true, captureAvailable: false },
      { reducedMotion: true, webglAvailable: false, captureAvailable: true },
      { reducedMotion: true, webglAvailable: true, captureAvailable: false },
      { reducedMotion: false, webglAvailable: false, captureAvailable: false },
      { reducedMotion: true, webglAvailable: false, captureAvailable: false },
    ] as const;

    for (const prerequisites of fallbackCases) {
      expect(selectMotionMode(prerequisites)).toBe('fallback');
    }
  });
});

describe('hasWebGl', () => {
  it('accepts a WebGL2 context', () => {
    const getContext = vi.fn((name: string) => (name === 'webgl2' ? { label: 'webgl2' } : null));
    const documentRef = {
      createElement: vi.fn(() => ({ getContext })),
    } as unknown as Document;

    expect(hasWebGl(documentRef)).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2');
  });

  it('falls back to a WebGL context when WebGL2 is unavailable', () => {
    const getContext = vi.fn((name: string) => (name === 'webgl' ? { label: 'webgl' } : null));
    const documentRef = {
      createElement: vi.fn(() => ({ getContext })),
    } as unknown as Document;

    expect(hasWebGl(documentRef)).toBe(true);
    expect(getContext).toHaveBeenNthCalledWith(1, 'webgl2');
    expect(getContext).toHaveBeenNthCalledWith(2, 'webgl');
  });

  it('returns false when no WebGL context is available', () => {
    const documentRef = {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => null),
      })),
    } as unknown as Document;

    expect(hasWebGl(documentRef)).toBe(false);
  });

  it('treats probing errors as unavailable', () => {
    const documentRef = {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => {
          throw new Error('context blocked');
        }),
      })),
    } as unknown as Document;

    expect(hasWebGl(documentRef)).toBe(false);
  });

  it('falls back to WebGL when the WebGL2 probe throws', () => {
    const getContext = vi.fn((name: string) => {
      if (name === 'webgl2') {
        throw new Error('webgl2 blocked');
      }
      return { label: 'webgl' };
    });
    const documentRef = {
      createElement: vi.fn(() => ({ getContext })),
    } as unknown as Document;

    expect(hasWebGl(documentRef)).toBe(true);
    expect(getContext).toHaveBeenNthCalledWith(1, 'webgl2');
    expect(getContext).toHaveBeenNthCalledWith(2, 'webgl');
  });
});

describe('browserMotionMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns full when reduced motion is off, WebGL is available, and capture exists', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false } as MediaQueryList)));
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: vi.fn((name: string) => (name === 'webgl2' ? { label: 'webgl2' } : null)),
    } as unknown as HTMLCanvasElement);
    vi.stubGlobal('HTMLCanvasElement', class HTMLCanvasElementStub {});

    expect(browserMotionMode()).toBe('full');
  });

  it('returns fallback when matchMedia is unavailable and reduced-motion preference is unknown', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: vi.fn((name: string) => (name === 'webgl2' ? { label: 'webgl2' } : null)),
    } as unknown as HTMLCanvasElement);
    vi.stubGlobal('HTMLCanvasElement', class HTMLCanvasElementStub {});

    expect(browserMotionMode()).toBe('fallback');
  });

  it('returns fallback when DOM or canvas globals are unavailable', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false } as MediaQueryList)));
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('HTMLCanvasElement', undefined);

    expect(browserMotionMode()).toBe('fallback');
  });

  it('returns fallback when required DOM canvas APIs are unavailable', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false } as MediaQueryList)));
    vi.stubGlobal('document', {} as Document);
    vi.stubGlobal('HTMLCanvasElement', class HTMLCanvasElementStub {});

    expect(browserMotionMode()).toBe('fallback');
  });

  it('returns fallback when any browser prerequisite is missing', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true } as MediaQueryList)));
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement);
    vi.stubGlobal('HTMLCanvasElement', class HTMLCanvasElementStub {});

    expect(browserMotionMode()).toBe('fallback');
  });
});
