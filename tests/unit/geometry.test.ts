import { describe, expect, it } from 'vitest';
import {
  buildPaperFrame,
  cornerPoint,
  oppositeCorner,
  revealClipPath,
  vertexIndex,
} from '../../src/transition/geometry';
import type { Corner, MotionProfile, Rect } from '../../src/transition/types';

const source: Rect = { left: 100, top: 80, width: 240, height: 160 };
const destination: Rect = { left: 0, top: 0, width: 1000, height: 700 };
const profile: MotionProfile = {
  durationMs: 720,
  fallbackDurationMs: 200,
  bendDepth: 110,
  foldSoftness: 0.16,
  edgeCurvature: 18,
  shadowStrength: 0.42,
  meshColumns: 2,
  meshRows: 2,
  maxTextureDpr: 2,
  maxTexturePixels: 4_194_304,
  easing: (progress) => progress,
};

const corners: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

describe('paper geometry', () => {
  it.each([
    ['top-left', 'bottom-right'],
    ['top-right', 'bottom-left'],
    ['bottom-right', 'top-left'],
    ['bottom-left', 'top-right'],
  ] as const)('maps %s to opposite %s', (corner, opposite) => {
    expect(oppositeCorner(corner)).toBe(opposite);
  });

  it.each(corners)('starts aligned to the source for %s', (grabbedCorner) => {
    const frame = buildPaperFrame(source, destination, grabbedCorner, 0, profile);
    const grabbed = vertexIndex(grabbedCorner, profile.meshColumns, profile.meshRows);
    const start = cornerPoint(source, grabbedCorner);

    expect(Array.from(frame.positions.slice(grabbed * 3, grabbed * 3 + 2))).toEqual([start.x, start.y]);
  });

  it.each(corners)('exchanges diagonal positions for %s', (grabbedCorner) => {
    const frame = buildPaperFrame(source, destination, grabbedCorner, 1, profile);
    const opposite = oppositeCorner(grabbedCorner);
    const grabbedIndex = vertexIndex(grabbedCorner, profile.meshColumns, profile.meshRows);
    const oppositeIndex = vertexIndex(opposite, profile.meshColumns, profile.meshRows);
    const grabbedEnd = cornerPoint(destination, opposite);
    const tuckedEnd = cornerPoint(source, grabbedCorner);

    expect(Array.from(frame.positions.slice(grabbedIndex * 3, grabbedIndex * 3 + 2))).toEqual([
      grabbedEnd.x,
      grabbedEnd.y,
    ]);
    expect(Array.from(frame.positions.slice(oppositeIndex * 3, oppositeIndex * 3 + 2))).toEqual([
      tuckedEnd.x,
      tuckedEnd.y,
    ]);
  });

  it('creates depth at peak curl and no depth at either endpoint', () => {
    const start = buildPaperFrame(source, destination, 'top-right', 0, profile);
    const peak = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const end = buildPaperFrame(source, destination, 'top-right', 1, profile);

    expect(Math.max(...start.positions.filter((_, index) => index % 3 === 2))).toBe(0);
    expect(Math.max(...peak.positions.filter((_, index) => index % 3 === 2))).toBeGreaterThan(100);
    expect(Math.max(...end.positions.filter((_, index) => index % 3 === 2))).toBeCloseTo(0, 5);
  });

  it('curves a side edge away from a straight endpoint interpolation', () => {
    const frame = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const leftY = frame.positions[1]!;
    const middleY = frame.positions[4]!;
    const rightY = frame.positions[7]!;

    expect(middleY).not.toBeCloseTo((leftY + rightY) / 2, 3);
  });

  it('reveals no viewport at zero and the full viewport at one', () => {
    expect(revealClipPath(destination, 'top-right', 0)).toBe('polygon(100% 0%, 100% 0%, 100% 0%)');
    expect(revealClipPath(destination, 'top-right', 1)).toBe(
      'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)',
    );
  });
});
