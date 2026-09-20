import { describe, expect, it, vi } from 'vitest';
import { awaitCaptureReadiness } from '../../src/content/capture-readiness';

/**
 * jsdom does not decode images, so `decode()` is stubbed per element. That is the
 * behaviour under test anyway: whether the wait is paid, bounded, and survivable.
 */
function hostWith(images: Array<{ complete: boolean; decode: () => Promise<void> }>): HTMLElement {
  const host = document.createElement('div');

  for (const spec of images) {
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { value: spec.complete, configurable: true });
    Object.defineProperty(image, 'decode', { value: spec.decode, configurable: true });
    host.append(image);
  }

  return host;
}

const settledFonts = { ready: Promise.resolve() } as unknown as FontFaceSet;

describe('awaitCaptureReadiness', () => {
  it('resolves immediately when there is nothing to wait for', async () => {
    const result = await awaitCaptureReadiness(document.createElement('div'), {
      timeoutMs: 500,
      fonts: settledFonts,
    });

    expect(result).toEqual({ timedOut: false, imagesAwaited: 0, imagesFailed: 0 });
  });

  it('skips images already complete', async () => {
    const decode = vi.fn(async () => undefined);
    const host = hostWith([
      { complete: true, decode },
      { complete: true, decode },
    ]);

    const result = await awaitCaptureReadiness(host, { timeoutMs: 500, fonts: settledFonts });

    expect(decode).not.toHaveBeenCalled();
    expect(result.imagesAwaited).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('awaits decode for every incomplete image', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const host = hostWith([
      { complete: false, decode: first },
      { complete: false, decode: second },
      { complete: true, decode: vi.fn(async () => undefined) },
    ]);

    const result = await awaitCaptureReadiness(host, { timeoutMs: 500, fonts: settledFonts });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.imagesAwaited).toBe(2);
    expect(result.imagesFailed).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('counts a failed decode and proceeds rather than abandoning the activation', async () => {
    // One broken image must not cost the transition. The sheet then shows the same
    // gap the live page shows, which is honest.
    const host = hostWith([
      {
        complete: false,
        decode: async () => {
          throw new Error('decode failed');
        },
      },
      { complete: false, decode: async () => undefined },
    ]);

    const result = await awaitCaptureReadiness(host, { timeoutMs: 500, fonts: settledFonts });

    expect(result.imagesFailed).toBe(1);
    expect(result.imagesAwaited).toBe(2);
    expect(result.timedOut).toBe(false);
  });

  it('reports timing out and still resolves, when an asset never settles', async () => {
    const host = hostWith([{ complete: false, decode: () => new Promise<void>(() => undefined) }]);

    const result = await awaitCaptureReadiness(host, { timeoutMs: 5, fonts: settledFonts });

    expect(result.timedOut).toBe(true);
    expect(result.imagesAwaited).toBe(1);
  });

  it('waits for fonts as well as images', async () => {
    let releaseFonts: () => void = () => undefined;
    const fonts = {
      ready: new Promise<void>((resolveFonts) => {
        releaseFonts = () => resolveFonts();
      }),
    } as unknown as FontFaceSet;

    const host = hostWith([{ complete: true, decode: async () => undefined }]);
    let settled = false;
    const wait = awaitCaptureReadiness(host, { timeoutMs: 1000, fonts }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseFonts();
    const result = await wait;

    expect(result.timedOut).toBe(false);
  });

  it('proceeds when the Font Loading API is absent', async () => {
    const result = await awaitCaptureReadiness(document.createElement('div'), {
      timeoutMs: 500,
      fonts: null,
    });

    expect(result.timedOut).toBe(false);
  });

  it('survives a rejected fonts.ready', async () => {
    const fonts = { ready: Promise.reject(new Error('font load failed')) } as unknown as FontFaceSet;

    await expect(
      awaitCaptureReadiness(document.createElement('div'), { timeoutMs: 500, fonts }),
    ).resolves.toEqual({ timedOut: false, imagesAwaited: 0, imagesFailed: 0 });
  });

  it('clears its timer, so a fast settle leaves nothing holding the event loop', async () => {
    const clear = vi.fn();
    const host = hostWith([{ complete: true, decode: async () => undefined }]);

    await awaitCaptureReadiness(host, {
      timeoutMs: 500,
      fonts: settledFonts,
      clearTimeout: clear as unknown as typeof globalThis.clearTimeout,
    });

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('treats a negative bound as zero rather than throwing', async () => {
    const host = hostWith([{ complete: false, decode: () => new Promise<void>(() => undefined) }]);

    const result = await awaitCaptureReadiness(host, {
      timeoutMs: -1,
      fonts: settledFonts,
    });

    expect(result.timedOut).toBe(true);
  });

  it('never throws, whatever the content', async () => {
    const host = hostWith([
      {
        complete: false,
        decode: () => {
          throw new Error('synchronous throw');
        },
      },
    ]);

    await expect(
      awaitCaptureReadiness(host, { timeoutMs: 50, fonts: settledFonts }),
    ).resolves.toBeDefined();
  });
});
