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
  const canvas = documentRef.createElement('canvas');
  return probeContext(canvas, 'webgl2') || probeContext(canvas, 'webgl');
}

export function selectMotionMode(prerequisites: FullMotionPrerequisites): MotionMode {
  return prerequisites.reducedMotion || !prerequisites.webglAvailable || !prerequisites.captureAvailable
    ? 'fallback'
    : 'full';
}

export function browserMotionMode(): MotionMode {
  return selectMotionMode({
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    webglAvailable: hasWebGl(),
    captureAvailable: typeof HTMLCanvasElement !== 'undefined',
  });
}
