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

  it('clamps overshooting easing output before using it for frame geometry', () => {
    const overshootingProfile: MotionProfile = {
      ...profile,
      easing: () => 1.25,
    };

    const overshot = buildPaperFrame(source, destination, 'top-right', 0.5, overshootingProfile);
    const completed = buildPaperFrame(source, destination, 'top-right', 1, profile);

    expect(Array.from(overshot.positions)).toEqual(Array.from(completed.positions));
    expect(Array.from(overshot.shade)).toEqual(Array.from(completed.shade));
    expect(overshot.revealClipPath).toBe(completed.revealClipPath);
  });

  it('clamps undershooting easing output before using it for frame geometry', () => {
    const undershootingProfile: MotionProfile = {
      ...profile,
      easing: () => -0.25,
    };

    const undershot = buildPaperFrame(source, destination, 'top-right', 0.5, undershootingProfile);
    const start = buildPaperFrame(source, destination, 'top-right', 0, profile);

    expect(Array.from(undershot.positions)).toEqual(Array.from(start.positions));
    expect(Array.from(undershot.shade)).toEqual(Array.from(start.shade));
    expect(undershot.revealClipPath).toBe(start.revealClipPath);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite easing output %s', (eased) => {
    const invalidProfile: MotionProfile = {
      ...profile,
      easing: () => eased,
    };

    expect(() => buildPaperFrame(source, destination, 'top-right', 0.5, invalidProfile)).toThrow(
      /profile\.easing/,
    );
  });

  it.each([
    ['profile.meshColumns', { meshColumns: 0 }],
    ['profile.meshColumns', { meshColumns: 1.5 }],
    ['profile.meshColumns', { meshColumns: NaN }],
    ['profile.meshRows', { meshRows: 0 }],
    ['profile.meshRows', { meshRows: 1.5 }],
    ['profile.meshRows', { meshRows: Infinity }],
    ['profile.foldSoftness', { foldSoftness: 0 }],
    ['profile.foldSoftness', { foldSoftness: -0.01 }],
    ['profile.foldSoftness', { foldSoftness: NaN }],
  ] as const)('rejects invalid %s in buildPaperFrame profile validation', (field, overrides) => {
    expect(() =>
      buildPaperFrame(source, destination, 'top-right', 0.5, {
        ...profile,
        ...overrides,
      }),
    ).toThrow(field);
  });

  it.each([
    ['source.left', { source: { ...source, left: NaN }, destination }],
    ['source.width', { source: { ...source, width: 0 }, destination }],
    ['destination.top', { source, destination: { ...destination, top: Infinity } }],
    ['destination.height', { source, destination: { ...destination, height: 0 } }],
  ] as const)('rejects invalid %s in buildPaperFrame rectangle validation', (field, rects) => {
    expect(() =>
      buildPaperFrame(rects.source, rects.destination, 'top-right', 0.5, profile),
    ).toThrow(field);
  });

  it.each([
    ['rect.width', { ...destination, width: 0 }],
    ['rect.height', { ...destination, height: NaN }],
    ['rect.left', { ...destination, left: Infinity }],
  ] as const)('rejects invalid %s in revealClipPath', (field, rect) => {
    expect(() => revealClipPath(rect, 'top-right', 0.5)).toThrow(field);
  });
});
