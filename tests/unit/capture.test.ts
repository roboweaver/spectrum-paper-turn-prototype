import { describe, expect, it, vi } from 'vitest';

import { defaultMotionProfile } from '../../src/transition/motion-profile';
import { captureElement, textureCaptureOptions } from '../../src/transition/capture';

describe('textureCaptureOptions', () => {
  it('caps texture DPR and total texture pixels to the motion profile budget', () => {
    const options = textureCaptureOptions(1800, 1200, 3, defaultMotionProfile);
    const totalPixels = options.width * options.height * options.pixelRatio * options.pixelRatio;

    expect(options.pixelRatio).toBeLessThanOrEqual(defaultMotionProfile.maxTextureDpr);
    expect(totalPixels).toBeLessThanOrEqual(defaultMotionProfile.maxTexturePixels);
    expect(options.width).toBe(1800);
    expect(options.height).toBe(1200);
  });

  it('rejects non-finite dimensions', () => {
    expect(() => textureCaptureOptions(Number.NaN, 1200, 2, defaultMotionProfile)).toThrow(
      'Capture dimensions must be finite positive numbers',
    );
    expect(() => textureCaptureOptions(1800, Number.POSITIVE_INFINITY, 2, defaultMotionProfile)).toThrow(
      'Capture dimensions must be finite positive numbers',
    );
  });

  it('rejects invalid device pixel ratios and profile caps', () => {
    expect(() => textureCaptureOptions(1800, 1200, 0, defaultMotionProfile)).toThrow(
      'Device pixel ratio must be a finite positive number',
    );
    expect(() =>
      textureCaptureOptions(1800, 1200, 2, {
        ...defaultMotionProfile,
        maxTextureDpr: 0,
      }),
    ).toThrow('Motion profile texture caps must be finite positive numbers');
    expect(() =>
      textureCaptureOptions(1800, 1200, 2, {
        ...defaultMotionProfile,
        maxTexturePixels: Number.NaN,
      }),
    ).toThrow('Motion profile texture caps must be finite positive numbers');
  });

  it('clamps subpixel dimensions and keeps each physical texture edge within the budget-derived cap', () => {
    const options = textureCaptureOptions(0.5, 5_000_000, 2, defaultMotionProfile);
    const maxTextureEdge = Math.sqrt(defaultMotionProfile.maxTexturePixels);
    const totalPixels = options.width * options.height * options.pixelRatio * options.pixelRatio;

    expect(options.width).toBe(1);
    expect(Number.isFinite(options.pixelRatio)).toBe(true);
    expect(options.pixelRatio).toBeGreaterThan(0);
    expect(options.width * options.pixelRatio).toBeLessThanOrEqual(maxTextureEdge);
    expect(options.height * options.pixelRatio).toBeLessThanOrEqual(maxTextureEdge);
    expect(totalPixels).toBeLessThanOrEqual(defaultMotionProfile.maxTexturePixels);
  });

  it('rejects finite dimensions that overflow capture math', () => {
    expect(() => textureCaptureOptions(Number.MAX_VALUE, Number.MAX_VALUE, 2, defaultMotionProfile)).toThrow(
      'Capture dimensions exceed supported range',
    );
  });
});

describe('captureElement', () => {
  function createSourceElement(width: number, height: number): HTMLElement {
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 10 + width,
      bottom: 20 + height,
      width,
      height,
      toJSON: () => ({}),
    });
    return element;
  }

  it('captures the source element with bounded dimensions, DPR, and cache busting', async () => {
    const element = createSourceElement(800, 600);
    const canvas = document.createElement('canvas');
    const toCanvas = vi.fn(async () => canvas);

    const result = await captureElement(element, defaultMotionProfile, undefined, toCanvas, 3);

    expect(result).toBe(canvas);
    expect(toCanvas).toHaveBeenCalledWith(element, {
      pixelRatio: 2,
      width: 800,
      height: 600,
      cacheBust: true,
    });
  });

  it('applies style overrides to the clone so a clipped destination still captures', async () => {
    const element = createSourceElement(800, 600);
    const canvas = document.createElement('canvas');
    const toCanvas = vi.fn(async () => canvas);

    await captureElement(element, defaultMotionProfile, { clipPath: 'none' }, toCanvas, 3);

    expect(toCanvas).toHaveBeenCalledWith(element, {
      pixelRatio: 2,
      width: 800,
      height: 600,
      cacheBust: true,
      style: { clipPath: 'none' },
    });
  });

  it('omits the style option when no overrides are supplied', async () => {
    const element = createSourceElement(800, 600);
    const toCanvas = vi.fn(async (_element: HTMLElement, _options: Record<string, unknown>) =>
      document.createElement('canvas'),
    );

    await captureElement(element, defaultMotionProfile, undefined, toCanvas, 3);

    expect(toCanvas.mock.calls[0]?.[1]).not.toHaveProperty('style');
  });

  it('rethrows capture failures by identity', async () => {
    const element = createSourceElement(800, 600);
    const error = new Error('tainted source');
    const toCanvas = vi.fn(async () => {
      throw error;
    });

    await expect(captureElement(element, defaultMotionProfile, undefined, toCanvas, 3)).rejects.toBe(error);
  });

  it('rejects empty bounds before calling html-to-image', async () => {
    const element = createSourceElement(0, 600);
    const toCanvas = vi.fn();

    await expect(captureElement(element, defaultMotionProfile, undefined, toCanvas, 3)).rejects.toThrow(
      'Cannot capture an element with empty bounds',
    );
    expect(toCanvas).not.toHaveBeenCalled();
  });
});
