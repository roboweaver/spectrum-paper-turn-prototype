import { describe, expect, it } from 'vitest';
import {
  backFaceUvs,
  buildPaperFrame,
  cornerPoint,
  cornerUv,
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
  foldSoftness: 0.6,
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

    expect(frame.positions[grabbed * 3]).toBeCloseTo(start.x, 6);
    expect(frame.positions[grabbed * 3 + 1]).toBeCloseTo(start.y, 6);
  });

  it.each(corners)('exchanges diagonal positions within the destination for %s', (grabbedCorner) => {
    const frame = buildPaperFrame(source, destination, grabbedCorner, 1, profile);
    const opposite = oppositeCorner(grabbedCorner);
    const grabbedIndex = vertexIndex(grabbedCorner, profile.meshColumns, profile.meshRows);
    const oppositeIndex = vertexIndex(opposite, profile.meshColumns, profile.meshRows);
    const grabbedEnd = cornerPoint(destination, opposite);
    const tuckedEnd = cornerPoint(destination, grabbedCorner);

    expect(frame.positions[grabbedIndex * 3]).toBeCloseTo(grabbedEnd.x, 6);
    expect(frame.positions[grabbedIndex * 3 + 1]).toBeCloseTo(grabbedEnd.y, 6);
    expect(frame.positions[oppositeIndex * 3]).toBeCloseTo(tuckedEnd.x, 6);
    expect(frame.positions[oppositeIndex * 3 + 1]).toBeCloseTo(tuckedEnd.y, 6);
  });

  it.each(corners)('holds the fold axis corners still for %s', (grabbedCorner) => {
    const axisCorners = corners.filter(
      (corner) => corner !== grabbedCorner && corner !== oppositeCorner(grabbedCorner),
    );
    const frame = buildPaperFrame(source, destination, grabbedCorner, 1, profile);

    for (const corner of axisCorners) {
      const index = vertexIndex(corner, profile.meshColumns, profile.meshRows);
      const expected = cornerPoint(destination, corner);

      expect(frame.positions[index * 3]).toBeCloseTo(expected.x, 6);
      expect(frame.positions[index * 3 + 1]).toBeCloseTo(expected.y, 6);
    }
  });

  it('lifts the grabbed half forward and tucks the opposite half behind at peak curl', () => {
    const peak = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const depths = Array.from(peak.positions.filter((_, index) => index % 3 === 2));

    expect(Math.max(...depths)).toBeGreaterThan(profile.bendDepth * 0.6);
    expect(Math.min(...depths)).toBeLessThan(-profile.bendDepth * 0.6);
  });

  it('flattens depth at both endpoints', () => {
    const start = buildPaperFrame(source, destination, 'top-right', 0, profile);
    const end = buildPaperFrame(source, destination, 'top-right', 1, profile);

    for (const frame of [start, end]) {
      const depths = Array.from(frame.positions.filter((_, index) => index % 3 === 2));

      expect(Math.max(...depths)).toBeCloseTo(0, 6);
      expect(Math.min(...depths)).toBeCloseTo(0, 6);
    }
  });

  it('keeps the mid-turn sheet spread across the viewport instead of collapsing to a line', () => {
    const peak = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const xs = Array.from(peak.positions.filter((_, index) => index % 3 === 0));
    const ys = Array.from(peak.positions.filter((_, index) => index % 3 === 1));

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(destination.width * 0.4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(destination.height * 0.4);
  });

  it('grows the sheet from the source rect toward the destination rect', () => {
    const spans = [0, 0.5, 1].map((progress) => {
      const frame = buildPaperFrame(source, destination, 'top-right', progress, profile);
      const xs = Array.from(frame.positions.filter((_, index) => index % 3 === 0));

      return Math.max(...xs) - Math.min(...xs);
    });

    expect(spans[0]).toBeCloseTo(source.width, 4);
    expect(spans[1]!).toBeGreaterThan(spans[0]!);
    expect(spans[2]!).toBeGreaterThan(spans[1]!);
    expect(spans[2]).toBeCloseTo(destination.width, 4);
  });

  it('keeps the reveal inside the turning sheet footprint and completes at the end', () => {
    const start = buildPaperFrame(source, destination, 'top-right', 0, profile);
    const mid = buildPaperFrame(source, destination, 'top-right', 0.5, profile);
    const end = buildPaperFrame(source, destination, 'top-right', 1, profile);

    expect(start.revealClipPath).toBe(
      'polygon(34% 11.428571428571429%, 34% 11.428571428571429%, 34% 11.428571428571429%)',
    );
    expect(end.revealClipPath).toBe('polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)');

    // Half-way the sheet only spans the lerped rect, so the reveal must not
    // wipe past it into parts of the page the sheet has not reached.
    const points = [...mid.revealClipPath.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
    const halfRect = {
      left: (source.left + destination.left) / 2,
      top: (source.top + destination.top) / 2,
      width: (source.width + destination.width) / 2,
      height: (source.height + destination.height) / 2,
    };
    const maxX = ((halfRect.left + halfRect.width) / destination.width) * 100;
    const maxY = ((halfRect.top + halfRect.height) / destination.height) * 100;

    expect(points.length).toBeGreaterThan(2);

    for (const point of points) {
      expect(point.x).toBeLessThanOrEqual(maxX + 1e-6);
      expect(point.y).toBeLessThanOrEqual(maxY + 1e-6);
    }
  });

  it('holds the sheet opaque until it dissolves into the settled page', () => {
    expect(buildPaperFrame(source, destination, 'top-right', 0, profile).alpha).toBe(1);
    expect(buildPaperFrame(source, destination, 'top-right', 0.5, profile).alpha).toBe(1);
    expect(buildPaperFrame(source, destination, 'top-right', 1, profile).alpha).toBe(0);
  });

  it('reports zero lift at both endpoints and full lift at peak curl', () => {
    expect(buildPaperFrame(source, destination, 'top-right', 0, profile).lift).toBeCloseTo(0, 6);
    expect(buildPaperFrame(source, destination, 'top-right', 0.5, profile).lift).toBeCloseTo(1, 6);
    expect(buildPaperFrame(source, destination, 'top-right', 1, profile).lift).toBeCloseTo(0, 6);
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

describe('back-face uvs', () => {
  const readUv = (uvs: Float32Array, corner: Corner, columns: number, rows: number): [number, number] => {
    const index = vertexIndex(corner, columns, rows) * 2;
    return [uvs[index]!, uvs[index + 1]!];
  };

  it('sizes the attribute to the mesh', () => {
    expect(backFaceUvs('top-right', 4, 3)).toHaveLength((4 + 1) * (3 + 1) * 2);
  });

  it.each([
    ['top-right', 'bottom-left'],
    ['bottom-left', 'top-right'],
    ['top-left', 'bottom-right'],
    ['bottom-right', 'top-left'],
  ] as const)('mirrors the %s corner onto %s', (grabbedCorner, mirroredCorner) => {
    const uvs = backFaceUvs(grabbedCorner, 4, 4);
    const [u, v] = readUv(uvs, grabbedCorner, 4, 4);
    const expected = cornerUv[mirroredCorner];

    expect(u).toBeCloseTo(expected.x, 6);
    expect(v).toBeCloseTo(expected.y, 6);
  });

  it.each(corners)('holds the fold-axis corners still for %s', (grabbedCorner) => {
    const uvs = backFaceUvs(grabbedCorner, 4, 4);
    const axisCorners = corners.filter(
      (corner) => corner !== grabbedCorner && corner !== oppositeCorner(grabbedCorner),
    );

    for (const corner of axisCorners) {
      const [u, v] = readUv(uvs, corner, 4, 4);
      expect(u).toBeCloseTo(cornerUv[corner].x, 6);
      expect(v).toBeCloseTo(cornerUv[corner].y, 6);
    }
  });

  it('stays inside the unit square so the back never samples outside the page', () => {
    for (const grabbedCorner of corners) {
      for (const value of backFaceUvs(grabbedCorner, 6, 4)) {
        expect(value).toBeGreaterThanOrEqual(-1e-6);
        expect(value).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('rejects a degenerate mesh', () => {
    expect(() => backFaceUvs('top-right', 0, 3)).toThrow(/greater than or equal to 1/);
    expect(() => backFaceUvs('top-right', 3, 0)).toThrow(/greater than or equal to 1/);
  });
});
