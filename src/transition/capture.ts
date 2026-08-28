import { toCanvas as htmlToCanvas } from 'html-to-image';

import type { CaptureOptions, MotionProfile } from './types';

type ToCanvas = (element: HTMLElement, options: {
  pixelRatio: number;
  width: number;
  height: number;
  cacheBust: boolean;
}) => Promise<HTMLCanvasElement>;

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function textureCaptureOptions(
  width: number,
  height: number,
  devicePixelRatio: number,
  profile: MotionProfile,
): CaptureOptions {
  if (!isFinitePositive(width) || !isFinitePositive(height)) {
    throw new Error('Capture dimensions must be finite positive numbers');
  }

  if (!isFinitePositive(devicePixelRatio)) {
    throw new Error('Device pixel ratio must be a finite positive number');
  }

  if (!isFinitePositive(profile.maxTextureDpr) || !isFinitePositive(profile.maxTexturePixels)) {
    throw new Error('Motion profile texture caps must be finite positive numbers');
  }

  const boundedWidth = Math.max(1, width);
  const boundedHeight = Math.max(1, height);
  const requestedDpr = Math.min(devicePixelRatio, profile.maxTextureDpr);
  const maxTextureEdge = Math.sqrt(profile.maxTexturePixels);
  const boundedArea = boundedWidth * boundedHeight;

  if (!Number.isFinite(boundedArea) || !isFinitePositive(maxTextureEdge)) {
    throw new Error('Capture dimensions exceed supported range');
  }

  const requestedPixels = boundedArea * requestedDpr * requestedDpr;
  const requestedPhysicalWidth = boundedWidth * requestedDpr;
  const requestedPhysicalHeight = boundedHeight * requestedDpr;

  if (
    !Number.isFinite(requestedPixels) ||
    !Number.isFinite(requestedPhysicalWidth) ||
    !Number.isFinite(requestedPhysicalHeight)
  ) {
    throw new Error('Capture dimensions exceed supported range');
  }

  const totalPixelScale =
    requestedPixels > profile.maxTexturePixels
      ? Math.sqrt(profile.maxTexturePixels / requestedPixels)
      : 1;
  const widthScale =
    requestedPhysicalWidth > maxTextureEdge ? maxTextureEdge / requestedPhysicalWidth : 1;
  const heightScale =
    requestedPhysicalHeight > maxTextureEdge ? maxTextureEdge / requestedPhysicalHeight : 1;
  const pixelScale = Math.min(totalPixelScale, widthScale, heightScale);
  let pixelRatio = requestedDpr * pixelScale;
  const totalPixels = boundedArea * pixelRatio * pixelRatio;

  if (!isFinitePositive(pixelRatio) || !Number.isFinite(totalPixels)) {
    throw new Error('Capture dimensions exceed supported range');
  }

  if (totalPixels > profile.maxTexturePixels) {
    pixelRatio *= Math.sqrt(profile.maxTexturePixels / totalPixels);
  }

  return {
    pixelRatio,
    width: boundedWidth,
    height: boundedHeight,
  };
}

const THEME_TOKEN_PREFIX = '--spectrum';

const themeTokenCssCache = new WeakMap<HTMLElement, string>();

type MaybeStyleMapped = HTMLElement & {
  computedStyleMap?: () => { keys: () => Iterable<string> };
};

/**
 * Spectrum declares its ~3.4k design tokens on the `<sp-theme>` element rather
 * than on `:root`, so descendants only resolve them by inheritance. html-to-image
 * renders its clone detached inside an SVG `foreignObject`, which inherits
 * nothing — every `var(--spectrum-*)` in the clone silently falls back, giving
 * the texture the wrong padding, greys and text metrics. Inlining the resolved
 * tokens on the capture root restores the whole cascade for the clone.
 *
 * Enumerating and serialising the tokens costs a few milliseconds, so the result
 * is cached per element; a page captures at most a handful of distinct roots.
 */
function themeTokenCss(element: HTMLElement): string {
  const cached = themeTokenCssCache.get(element);

  if (cached !== undefined) {
    return cached;
  }

  const styleMap = (element as MaybeStyleMapped).computedStyleMap?.();
  // Without `computedStyleMap` the tokens cannot be enumerated, so the capture
  // proceeds untouched rather than failing outright.
  const declarations: string[] = [];

  if (styleMap) {
    const computed = window.getComputedStyle(element);

    for (const property of styleMap.keys()) {
      if (property.startsWith(THEME_TOKEN_PREFIX)) {
        declarations.push(`${property}: ${computed.getPropertyValue(property)}`);
      }
    }
  }

  const css = declarations.join('; ');
  themeTokenCssCache.set(element, css);
  return css;
}

export async function captureElement(
  element: HTMLElement,
  profile: MotionProfile,
  styleOverrides?: Partial<CSSStyleDeclaration>,
  toCanvas: ToCanvas = htmlToCanvas,
  devicePixelRatio: number = window.devicePixelRatio,
): Promise<HTMLCanvasElement> {
  const { width, height } = element.getBoundingClientRect();

  if (width <= 0 || height <= 0) {
    throw new Error('Cannot capture an element with empty bounds');
  }

  const options = textureCaptureOptions(width, height, devicePixelRatio, profile);
  const tokens = themeTokenCss(element);
  const previousStyle = element.getAttribute('style');

  if (tokens) {
    element.setAttribute('style', previousStyle ? `${tokens}; ${previousStyle}` : tokens);
  }

  try {
    // html-to-image applies `style` to its detached clone only, so the live page
    // never flickers while the destination is captured through its closed clip.
    return await toCanvas(element, {
      ...options,
      cacheBust: true,
      ...(styleOverrides ? { style: styleOverrides } : {}),
    });
  } finally {
    if (tokens) {
      if (previousStyle === null) {
        element.removeAttribute('style');
      } else {
        element.setAttribute('style', previousStyle);
      }
    }
  }
}
