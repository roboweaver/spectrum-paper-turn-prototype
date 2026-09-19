import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  buildPaperFrame,
  oppositeAnchor,
  vertexIndex,
} from '../../src/transition/geometry';
import type {
  Corner,
  EdgeMidpoint,
  MotionProfile,
  Point,
  Rect,
} from '../../src/transition/types';

/**
 * Property 6: Midline reflection is exact at arbitrary aspect ratios.
 *
 * **Validates: Requirements 10.3, 10.4, 16.8, 16.9**
 *
 * This is the one property in the feature that genuinely wants varied input
 * rather than enumeration: the anchor domain is eight values, but the claim is
 * about *rect shape*, and the failure mode it rules out — a mirror that only
 * lands for a square rect — hides at aspect ratios nobody hand-picks. It gets
 * its own file so the aspect sweep's fixed seed, iteration count, and rect
 * bounds sit in one place instead of being read as incidental constants in the
 * eight-anchor suite.
 *
 * No generator library is used. `fast-check` is deliberately not introduced
 * (requirement 16.6): the sweep below is a seeded LCG local to this suite, so a
 * repeated run evaluates the identical sequence of rect pairs and a failure is
 * reproducible from the reported rect pair alone, with no shrinking step
 * (requirements 16.8, 16.9).
 */

/** Fixed, so the sweep is a fixture rather than a sample. */
const SWEEP_SEED = 0x5f37_2b91;
/** At least 200 rect pairs per requirement 16.8. */
const RECT_PAIR_COUNT = 256;
/** Requirements 10.3 and 10.4 bound each side to `[1, 4096]` CSS pixels. */
const MIN_SIDE_PX = 1;
const MAX_SIDE_PX = 4096;
/**
 * Rect origins are swept too, over a range that straddles `0`, so the property
 * cannot pass by accident on rects anchored at the viewport origin — the
 * centerline mirror has to be taken about the destination's own centerline and
 * not about `y = 0`.
 */
const MIN_ORIGIN_PX = -1024;
const MAX_ORIGIN_PX = 1024;

/**
 * Numerical Recipes' 32-bit LCG. `Math.imul` keeps the product in 32 bits, so
 * the sequence is exactly reproducible across engines rather than drifting once
 * the multiply exceeds `Number.MAX_SAFE_INTEGER`.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    return state / 2 ** 32;
  };
}

interface SweptPair {
  index: number;
  source: Rect;
  destination: Rect;
}

/**
 * Widths and heights are drawn independently, so the sweep spans aspect ratios
 * from far past `1:20` to far past `20:1` rather than scaling a fixed shape.
 * Draw order — left, top, width, height, source before destination — is part of
 * the fixture: changing it changes every pair.
 */
function sweepRectPairs(): readonly SweptPair[] {
  const random = createSeededRandom(SWEEP_SEED);
  const side = (): number => MIN_SIDE_PX + random() * (MAX_SIDE_PX - MIN_SIDE_PX);
  const origin = (): number => MIN_ORIGIN_PX + random() * (MAX_ORIGIN_PX - MIN_ORIGIN_PX);
  const rect = (): Rect => {
    const left = origin();
    const top = origin();
    const width = side();
    const height = side();

    return { left, top, width, height };
  };
  const pairs: SweptPair[] = [];

  for (let index = 0; index < RECT_PAIR_COUNT; index += 1) {
    pairs.push({ index, source: rect(), destination: rect() });
  }

  return pairs;
}

const rectPairs = sweepRectPairs();

const edgeMidpoints: readonly EdgeMidpoint[] = [
  'top-center',
  'middle-right',
  'bottom-center',
  'middle-left',
];

const corners: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/** Even in both dimensions, so the edge-midpoint vertices are addressable. */
const sweepProfile: MotionProfile = {
  durationMs: 720,
  fallbackDurationMs: 200,
  bendDepth: 110,
  foldSoftness: 0.6,
  edgeCurvature: 18,
  shadowStrength: 0.42,
  meshColumns: 6,
  meshRows: 4,
  maxTextureDpr: 2,
  maxTexturePixels: 4_194_304,
  easing: (progress) => progress,
};

/**
 * Requirements 10.3 and 10.4 state their budget as `1e-6` CSS pixels, and the
 * frame publishes positions in a `Float32Array`. A landing coordinate near
 * `4096` px is not representable in single precision, so it is quantized on the
 * way out of a double-precision computation that was already correct. The
 * comparison therefore allows one single-precision step at the magnitude under
 * test on top of the stated budget — the same reasoning, and the same
 * expression, as the sibling `geometry.test.ts` position checks. Anything
 * larger than that step is real error, not storage width.
 */
const positionTolerance = (expected: number): number =>
  1e-6 + Math.max(Math.abs(expected), 1) * 2 ** -23;

/** Mirror of `point` about the infinite line through `start` and `end`. */
function mirrorAcrossPixelLine(start: Point, end: Point, point: Point): Point {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const axis = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const offset = { x: point.x - start.x, y: point.y - start.y };
  const along = offset.x * axis.x + offset.y * axis.y;

  return {
    x: start.x + 2 * along * axis.x - offset.x,
    y: start.y + 2 * along * axis.y - offset.y,
  };
}

/**
 * The centerline each midline anchor mirrors about, in pixel space: horizontal
 * for `top-center`/`bottom-center`, vertical for `middle-left`/`middle-right`.
 * Written as two endpoints and fed through the general line mirror above rather
 * than as the algebraic shortcut `y → 2·cy − y`, so the test is not the same
 * substitution the module performs.
 */
const centerline: Record<EdgeMidpoint, (rect: Rect) => readonly [Point, Point]> = {
  'top-center': (rect) => [
    { x: rect.left, y: rect.top + rect.height / 2 },
    { x: rect.left + rect.width, y: rect.top + rect.height / 2 },
  ],
  'bottom-center': (rect) => [
    { x: rect.left, y: rect.top + rect.height / 2 },
    { x: rect.left + rect.width, y: rect.top + rect.height / 2 },
  ],
  'middle-left': (rect) => [
    { x: rect.left + rect.width / 2, y: rect.top },
    { x: rect.left + rect.width / 2, y: rect.top + rect.height },
  ],
  'middle-right': (rect) => [
    { x: rect.left + rect.width / 2, y: rect.top },
    { x: rect.left + rect.width / 2, y: rect.top + rect.height },
  ],
};

/**
 * The pixel-space diagonal a corner grab would mirror about if the fold were
 * taken in pixel space instead of in the unit square. Used only to show the
 * corner family is exempt.
 */
const pixelDiagonal: Record<Corner, readonly [Corner, Corner]> = {
  'top-right': ['top-left', 'bottom-right'],
  'bottom-left': ['top-left', 'bottom-right'],
  'top-left': ['bottom-left', 'top-right'],
  'bottom-right': ['bottom-left', 'top-right'],
};

const formatRect = (rect: Rect): string =>
  `{ left: ${rect.left.toFixed(4)}, top: ${rect.top.toFixed(4)}, ` +
  `width: ${rect.width.toFixed(4)}, height: ${rect.height.toFixed(4)} }`;

/** Everything needed to replay one failing case without rerunning the sweep. */
const formatPair = (pair: SweptPair): string =>
  `seed 0x${SWEEP_SEED.toString(16)} pair ${pair.index} of ${RECT_PAIR_COUNT}: ` +
  `source ${formatRect(pair.source)}, destination ${formatRect(pair.destination)}`;

interface WorstCase {
  detail: string;
  deviation: number;
  tolerance: number;
  /** Deviation measured in tolerances, so the worst case is comparable across magnitudes. */
  ratio: number;
}

const noFailure: WorstCase = { detail: 'no vertex checked', deviation: 0, tolerance: 1, ratio: 0 };

function worse(current: WorstCase, deviation: number, tolerance: number, detail: () => string): WorstCase {
  const ratio = deviation / tolerance;

  return ratio > current.ratio ? { detail: detail(), deviation, tolerance, ratio } : current;
}

describe('paper geometry aspect-ratio sweep', () => {
  /**
   * Property 6, midline half.
   *
   * **Validates: Requirements 10.3, 10.4, 16.8, 16.9**
   *
   * At `progress = 1` a midline fold has to land every vertex on the pixel-space
   * mirror of its own destination-frame position about the destination rect's
   * centerline — the horizontal centerline for `top-center`/`bottom-center`,
   * the vertical one for `middle-left`/`middle-right`. This is exactly what a
   * *diagonal* fold cannot promise in pixel space, which is why the module
   * reflects in the unit square: for a midline the unit-square reflection and
   * the pixel-space mirror coincide at every aspect ratio, and this sweep is
   * what says so out loud.
   *
   * One assertion per anchor reports the worst vertex across all 256 pairs, so
   * a regression names the anchor, the rect pair, and the vertex rather than
   * drowning the reporter in ~72,000 individual expectations.
   */
  it.each(edgeMidpoints)('mirrors every vertex about the destination centerline for %s', (anchor) => {
    let worst = noFailure;

    for (const pair of rectPairs) {
      const { destination } = pair;
      const frame = buildPaperFrame(pair.source, destination, anchor, 1, sweepProfile);
      const [axisStart, axisEnd] = centerline[anchor](destination);

      for (let row = 0; row <= sweepProfile.meshRows; row += 1) {
        for (let column = 0; column <= sweepProfile.meshColumns; column += 1) {
          const atRest: Point = {
            x: destination.left + (column / sweepProfile.meshColumns) * destination.width,
            y: destination.top + (row / sweepProfile.meshRows) * destination.height,
          };
          const expected = mirrorAcrossPixelLine(axisStart, axisEnd, atRest);
          const index = (row * (sweepProfile.meshColumns + 1) + column) * 3;
          const landed: Point = { x: frame.positions[index]!, y: frame.positions[index + 1]! };
          const describeVertex = (axis: string) => () =>
            `${anchor} ${axis} at vertex (${column}, ${row}), ${formatPair(pair)}`;

          worst = worse(worst, Math.abs(landed.x - expected.x), positionTolerance(expected.x), describeVertex('x'));
          worst = worse(worst, Math.abs(landed.y - expected.y), positionTolerance(expected.y), describeVertex('y'));
        }
      }
    }

    expect(worst.deviation, worst.detail).toBeLessThanOrEqual(worst.tolerance);
  });

  /**
   * Property 6, corner half: the corner family is deliberately **not** subject
   * to the pixel-space claim.
   *
   * A corner grab reflects in the unit square and maps out through the rect, so
   * its grabbed vertex lands exactly on the destination's pivot corner. Mirror
   * the same corner about the destination's pixel diagonal instead and the
   * answer is a different point whenever width and height differ — the two
   * halves of the sheet end up short of each other, which is the bowtie the
   * contract rules out. Asserting the gap here keeps a future "fix" from
   * quietly switching the corner family to a pixel-space mirror.
   */
  it.each(corners)('exempts %s from the pixel-space mirror at differing width and height', (anchor) => {
    const pivot = oppositeAnchor(anchor);
    const index = vertexIndex(anchor, sweepProfile.meshColumns, sweepProfile.meshRows);
    const [axisStart, axisEnd] = pixelDiagonal[anchor];
    let worstLanding = noFailure;
    let smallestGap = Number.POSITIVE_INFINITY;
    let smallestGapDetail = 'no pair checked';
    let checkedPairs = 0;

    for (const pair of rectPairs) {
      const { destination } = pair;
      // A square destination is excluded on purpose: there the unit-square
      // reflection and the pixel mirror agree, so it says nothing either way.
      if (Math.abs(destination.width - destination.height) < 1) {
        continue;
      }

      checkedPairs += 1;

      const frame = buildPaperFrame(pair.source, destination, anchor, 1, sweepProfile);
      const landed: Point = { x: frame.positions[index * 3]!, y: frame.positions[index * 3 + 1]! };
      const unitSquareLanding = anchorPoint(destination, pivot);
      const pixelMirror = mirrorAcrossPixelLine(
        anchorPoint(destination, axisStart),
        anchorPoint(destination, axisEnd),
        anchorPoint(destination, anchor),
      );
      const detail = `${anchor} → ${pivot}, ${formatPair(pair)}`;

      worstLanding = worse(
        worstLanding,
        Math.abs(landed.x - unitSquareLanding.x),
        positionTolerance(unitSquareLanding.x),
        () => `${detail}: x`,
      );
      worstLanding = worse(
        worstLanding,
        Math.abs(landed.y - unitSquareLanding.y),
        positionTolerance(unitSquareLanding.y),
        () => `${detail}: y`,
      );

      const gap = Math.hypot(landed.x - pixelMirror.x, landed.y - pixelMirror.y);

      if (gap < smallestGap) {
        smallestGap = gap;
        smallestGapDetail = detail;
      }
    }

    // The sweep draws both sides independently over `[1, 4096]`, so all but a
    // handful of pairs clear the one-pixel squareness gate.
    expect(checkedPairs, `${anchor}: non-square destinations in the sweep`).toBeGreaterThan(200);
    expect(worstLanding.deviation, worstLanding.detail).toBeLessThanOrEqual(worstLanding.tolerance);
    // `|w² − h²| / hypot(w, h)`, which is at least ~1.3 px once the sides
    // differ by a pixel — orders of magnitude past the `1e-6` budget, so the
    // exemption is structural rather than a rounding artifact.
    expect(smallestGap, `${anchor}: smallest gap to the pixel mirror, ${smallestGapDetail}`).toBeGreaterThan(0.5);
  });

  /**
   * The sweep itself, per requirement 16.8: a fixed seed and a fixed iteration
   * count, so a repeated run evaluates the identical sequence of rect pairs and
   * a reported pair index replays the same rects.
   */
  it('replays an identical rect-pair sequence on every run', () => {
    const repeated = sweepRectPairs();

    expect(repeated.length).toBe(RECT_PAIR_COUNT);
    expect(repeated.length).toBeGreaterThanOrEqual(200);
    expect(repeated).toStrictEqual(rectPairs);
  });

  /**
   * Requirements 10.3 and 10.4 bound each side to `[1, 4096]` CSS pixels and
   * ask for aspect ratios from `1:20` through `20:1`. Independent sampling gets
   * there, but only a coverage check proves this seed actually did.
   */
  it('covers the required side bounds and aspect-ratio range', () => {
    const aspectRatios = rectPairs.flatMap(({ source, destination }) =>
      [source, destination].map((rect) => rect.width / rect.height),
    );

    for (const { index, source, destination } of rectPairs) {
      for (const rect of [source, destination]) {
        expect(rect.width, `pair ${index}: ${formatRect(rect)} width`).toBeGreaterThanOrEqual(MIN_SIDE_PX);
        expect(rect.width, `pair ${index}: ${formatRect(rect)} width`).toBeLessThanOrEqual(MAX_SIDE_PX);
        expect(rect.height, `pair ${index}: ${formatRect(rect)} height`).toBeGreaterThanOrEqual(MIN_SIDE_PX);
        expect(rect.height, `pair ${index}: ${formatRect(rect)} height`).toBeLessThanOrEqual(MAX_SIDE_PX);
      }
    }

    expect(Math.max(...aspectRatios)).toBeGreaterThanOrEqual(20);
    expect(Math.min(...aspectRatios)).toBeLessThanOrEqual(1 / 20);
  });
});
