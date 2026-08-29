import type { FullMotionPrerequisites, MotionMode } from './types';

function probeContext(
  canvas: HTMLCanvasElement,
  contextName: 'webgl2' | 'webgl',
): boolean {
  try {
    return canvas.getContext(contextName) !== null;
  } catch {
    return false;
  }
}

export function hasWebGl(documentRef: Document = document): boolean {
  let canvas: HTMLCanvasElement;

  try {
    canvas = documentRef.createElement('canvas');
  } catch {
    return false;
  }

  return probeContext(canvas, 'webgl2') || probeContext(canvas, 'webgl');
}

export function selectMotionMode(prerequisites: FullMotionPrerequisites): MotionMode {
  return prerequisites.reducedMotion || !prerequisites.webglAvailable || !prerequisites.captureAvailable
    ? 'fallback'
    : 'full';
}

export function browserMotionMode(): MotionMode {
  if (
    typeof globalThis.matchMedia !== 'function' ||
    globalThis.document === undefined ||
    typeof globalThis.document.createElement !== 'function' ||
    globalThis.HTMLCanvasElement === undefined
  ) {
    return 'fallback';
  }

  return selectMotionMode({
    reducedMotion: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
    webglAvailable: hasWebGl(globalThis.document),
    captureAvailable: true,
  });
}
