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
  // html-to-image applies `style` to its detached clone only, so the live page
  // never flickers while the destination is captured through its closed clip.
  return toCanvas(element, {
    ...options,
    cacheBust: true,
    ...(styleOverrides ? { style: styleOverrides } : {}),
  });
}
