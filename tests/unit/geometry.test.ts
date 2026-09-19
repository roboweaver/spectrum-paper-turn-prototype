import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  anchorUv,
  backFaceUvs,
  buildPaperFrame,
  foldBasis,
  oppositeAnchor,
  revealClipPath,
  vertexIndex,
} from '../../src/transition/geometry';
import type { FoldBasis } from '../../src/transition/geometry';
import type {
  Corner,
  EdgeMidpoint,
  FoldAxis,
  FoldAxisKind,
  GrabAnchor,
  MotionProfile,
  Point,
  Rect,
} from '../../src/transition/types';

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
    expect(oppositeAnchor(corner)).toBe(opposite);
  });

  it.each(corners)('starts aligned to the source for %s', (corner) => {
    const frame = buildPaperFrame(source, destination, corner, 0, profile);
    const grabbed = vertexIndex(corner, profile.meshColumns, profile.meshRows);
    const start = anchorPoint(source, corner);

    expect(frame.positions[grabbed * 3]).toBeCloseTo(start.x, 6);
    expect(frame.positions[grabbed * 3 + 1]).toBeCloseTo(start.y, 6);
  });

  /**
   * Property 1: Destination-frame reflection.
   *
   * **Validates: Requirements 10.5, 10.6, 11.1**
   *
   * Replaces the earlier `holds the fold axis corners still` assertion, which
   * was a corner-fold-only claim and is false for a midline fold: under a
   * `top-center` fold the `top-left` vertex lands on `bottom-left`, not on
   * itself. Stating the reflection at every vertex subsumes that claim along
   * with anchor exchange and the fold-axis points held still, so it replaces
   * the old test rather than extending it to eight anchors.
   *
   * The anchor vocabulary is closed and finite, so all eight are enumerated
   * rather than sampled, and every mesh vertex of every rect pair is checked
   * rather than a hand-picked few.
   */
  const allAnchors: readonly GrabAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
  ];

  /**
   * The unit-square reflection each anchor folds through, written from the
   * design's anchor table rather than read back from the module: the two
   * diagonal forms are the reflections about `u = v` and `u + v = 1`, and the
   * two midline forms are `(u, 1 − v)` and `(1 − u, v)`.
   */
  const unitSquareReflection: Record<GrabAnchor, (uv: Point) => Point> = {
    'top-right': (uv) => ({ x: uv.y, y: uv.x }),
    'bottom-left': (uv) => ({ x: uv.y, y: uv.x }),
    'top-left': (uv) => ({ x: 1 - uv.y, y: 1 - uv.x }),
    'bottom-right': (uv) => ({ x: 1 - uv.y, y: 1 - uv.x }),
    'top-center': (uv) => ({ x: uv.x, y: 1 - uv.y }),
    'bottom-center': (uv) => ({ x: uv.x, y: 1 - uv.y }),
    'middle-left': (uv) => ({ x: 1 - uv.x, y: uv.y }),
    'middle-right': (uv) => ({ x: 1 - uv.x, y: uv.y }),
  };

  /** A denser even mesh than the suite default, so the sweep reads interior vertices too. */
  const reflectionProfile: MotionProfile = { ...profile, meshColumns: 6, meshRows: 4 };

  const reflectionRectPairs: readonly (readonly [string, Rect, Rect])[] = [
    ['the suite rects', source, destination],
    // A wide destination and a shrinking tall one, so the property never leans
    // on the destination being the larger or the wider rect.
    [
      'a wide destination',
      { left: 12, top: 340, width: 320, height: 320 },
      { left: 40, top: 8, width: 1024, height: 256 },
    ],
    [
      'a shrinking tall destination',
      { left: 0, top: 0, width: 900, height: 640 },
      { left: 220, top: 60, width: 180, height: 720 },
    ],
  ];

  /**
   * Requirement 11.1 states its budget as `1e-6` CSS pixels, and the frame
   * publishes positions in a `Float32Array`. A landing position that is not
   * representable in single precision is quantized on the way out, so the
   * comparison allows one single-precision step at the magnitude under test on
   * top of the stated budget. Anything larger than that step is real error.
   */
  const positionTolerance = (expected: number): number =>
    1e-6 + Math.max(Math.abs(expected), 1) * 2 ** -23;

  it.each(allAnchors)('lands every vertex on its destination-frame reflection for %s', (anchor) => {
    const reflect = unitSquareReflection[anchor];

    for (const [label, from, to] of reflectionRectPairs) {
      const frame = buildPaperFrame(from, to, anchor, 1, reflectionProfile);

      for (let row = 0; row <= reflectionProfile.meshRows; row += 1) {
        for (let column = 0; column <= reflectionProfile.meshColumns; column += 1) {
          const reflected = reflect({
            x: column / reflectionProfile.meshColumns,
            y: row / reflectionProfile.meshRows,
          });
          // The reflection is taken in unit-square coordinates and only then
          // mapped out through the destination rect, per requirement 10.5.
          const expected = {
            x: to.left + reflected.x * to.width,
            y: to.top + reflected.y * to.height,
          };
          // Indexing row-major asserts front-face vertex order as well as the
          // reflection: a transposed or shifted layout fails here.
          const index = (row * (reflectionProfile.meshColumns + 1) + column) * 3;
          const detail = `${anchor} on ${label} at vertex (${column}, ${row})`;

          expect(Math.abs(frame.positions[index]! - expected.x), `${detail}: x`).toBeLessThanOrEqual(
            positionTolerance(expected.x),
          );
          expect(
            Math.abs(frame.positions[index + 1]! - expected.y),
            `${detail}: y`,
          ).toBeLessThanOrEqual(positionTolerance(expected.y));
        }
      }
    }
  });

  /**
   * The corner case of requirement 10.6: on a destination rect whose width and
   * height differ, the unit-square reflection mapped through the rect is a
   * different landing position from the pixel-space mirror about that rect's
   * own diagonal. Reflecting in pixel space is what would leave the grabbed
   * corner and its pivot short of each other — the bowtie the contract rules
   * out — so the two answers must not be confused.
   */
  const pixelFoldAxisCorners: Record<Corner, readonly [Corner, Corner]> = {
    'top-right': ['top-left', 'bottom-right'],
    'bottom-left': ['top-left', 'bottom-right'],
    'top-left': ['bottom-left', 'top-right'],
    'bottom-right': ['bottom-left', 'top-right'],
  };

  const mirrorAcrossPixelLine = (start: Point, end: Point, point: Point): Point => {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const axis = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const offset = { x: point.x - start.x, y: point.y - start.y };
    const along = offset.x * axis.x + offset.y * axis.y;

    return {
      x: start.x + 2 * along * axis.x - offset.x,
      y: start.y + 2 * along * axis.y - offset.y,
    };
  };

  it.each(corners)('reflects %s through the unit square, not about the destination diagonal', (corner) => {
    const frame = buildPaperFrame(source, destination, corner, 1, profile);
    const index = vertexIndex(corner, profile.meshColumns, profile.meshRows);
    const landed = { x: frame.positions[index * 3]!, y: frame.positions[index * 3 + 1]! };
    const unitSquareLanding = anchorPoint(destination, oppositeAnchor(corner));
    const [axisStart, axisEnd] = pixelFoldAxisCorners[corner];
    const pixelMirror = mirrorAcrossPixelLine(
      anchorPoint(destination, axisStart),
      anchorPoint(destination, axisEnd),
      anchorPoint(destination, corner),
    );

    expect(landed.x).toBeCloseTo(unitSquareLanding.x, 6);
    expect(landed.y).toBeCloseTo(unitSquareLanding.y, 6);
    // The destination is 1000 × 700, so the two answers sit hundreds of CSS
    // pixels apart rather than differing by rounding.
    expect(
      Math.hypot(pixelMirror.x - unitSquareLanding.x, pixelMirror.y - unitSquareLanding.y),
    ).toBeGreaterThan(100);
    expect(Math.hypot(landed.x - pixelMirror.x, landed.y - pixelMirror.y)).toBeGreaterThan(100);
  });

  /**
   * Property 2: Anchor exchange.
   *
   * **Validates: Requirements 1.3, 1.6, 11.2**
   *
   * Generalizes the earlier `exchanges diagonal positions within the
   * destination` test, which enumerated the four corners only and stated the
   * contract's success criterion in its literal, corner-fold wording. The
   * criterion itself — the point that was grabbed and its opposite visibly
   * trade places — holds for all eight anchors, so all eight are enumerated
   * here rather than sampled.
   *
   * Property 1 already pins every vertex at `progress = 1`, and the two
   * vertices checked here are among them. Anchor exchange is nonetheless
   * stated on its own because it is the claim written in terms the contract
   * uses — named anchor points on the destination rect — rather than in terms
   * of a reflection formula, so a regression that got the fold axis right and
   * the anchor table wrong is reported against the criterion it breaks.
   *
   * The suite default mesh is `2 × 2`, which is even, so every edge midpoint
   * lands on a mesh vertex and `vertexIndex` can address it. An odd dimension
   * has no vertex at the half-step, and `vertexIndex` rejects it rather than
   * rounding to a neighbour, so this property is only samplable on an even
   * mesh.
   */
  it.each(allAnchors)('exchanges the grab anchor and its pivot within the destination for %s', (anchor) => {
    const pivot = oppositeAnchor(anchor);
    const frame = buildPaperFrame(source, destination, anchor, 1, profile);
    const grabbedLanding = anchorPoint(destination, pivot);
    const pivotLanding = anchorPoint(destination, anchor);

    // Requirement 11.2, both halves of the exchange: the vertex sitting at the
    // grab anchor ends on the destination's pivot anchor, and the vertex at the
    // pivot ends on the destination's grab anchor.
    const exchange: readonly (readonly [string, GrabAnchor, Point])[] = [
      [`${anchor} vertex lands on destination ${pivot}`, anchor, grabbedLanding],
      [`${pivot} vertex lands on destination ${anchor}`, pivot, pivotLanding],
    ];

    for (const [detail, vertexAnchor, expected] of exchange) {
      const index = vertexIndex(vertexAnchor, profile.meshColumns, profile.meshRows) * 3;

      // Requirement 11.2 states its budget as `1e-6` CSS pixels, and positions
      // ship in a `Float32Array`. A landing position that is not representable
      // in single precision is quantized on the way out, so the comparison
      // allows one single-precision step at the magnitude under test on top of
      // the stated budget, exactly as the Property 1 sweep above does. Anything
      // larger than that step is real error, not storage quantization.
      expect(Math.abs(frame.positions[index]! - expected.x), `${detail}: x`).toBeLessThanOrEqual(
        positionTolerance(expected.x),
      );
      expect(
        Math.abs(frame.positions[index + 1]! - expected.y),
        `${detail}: y`,
      ).toBeLessThanOrEqual(positionTolerance(expected.y));
    }

    // Requirement 1.3: the two landing points are each other's reflection
    // through the destination centre, so this is a genuine swap of opposite
    // points rather than two vertices happening to meet somewhere convenient.
    // A pivot table that paired, say, `top-center` with `middle-right` would
    // still land both vertices somewhere on the rect and pass the checks above.
    expect(grabbedLanding.x + pivotLanding.x).toBeCloseTo(2 * destination.left + destination.width, 6);
    expect(grabbedLanding.y + pivotLanding.y).toBeCloseTo(2 * destination.top + destination.height, 6);
    expect(grabbedLanding).not.toEqual(pivotLanding);

    // Requirement 1.6: each landing point lies on the destination boundary, so
    // the exchange happens on the rect's edge and not somewhere in its interior.
    for (const [detail, landing] of [
      [`destination ${pivot}`, grabbedLanding],
      [`destination ${anchor}`, pivotLanding],
    ] as const) {
      const onBoundary =
        landing.x === destination.left ||
        landing.x === destination.left + destination.width ||
        landing.y === destination.top ||
        landing.y === destination.top + destination.height;

      expect(onBoundary, `${detail} at (${landing.x}, ${landing.y}) is on the rect boundary`).toBe(
        true,
      );
    }
  });

  /**
   * Property 3: Fold axis stationary in the growing frame.
   *
   * **Validates: Requirements 11.3, 12.5**
   *
   * Properties 1 and 2 pin the two endpoints of the turn. This one pins the
   * hinge for the whole of it: whatever the sheet does in between, the two
   * anchors the fold line passes through never leave the growing rectangle, and
   * never leave the plane either — `z` is `0` at both of them at every
   * progress. A deformation term that read the fold-axis kind, or a bulge that
   * did not vanish at the axis ends, would move the hinge and be caught here
   * where the endpoint-only properties cannot see it.
   *
   * The two endpoints are the two anchors of the grab anchor's own family that
   * are neither the grab anchor nor its pivot. For the midline family those are
   * EDGE MIDPOINTS, whose unit-square coordinates carry a `0.5`. A mesh vertex
   * only sits on a half-step when the corresponding mesh dimension is even, and
   * `vertexIndex` rejects the unrepresentable half-step rather than rounding to
   * a neighbour — so this property cannot be SAMPLED at all on an odd mesh, and
   * every profile below uses even dimensions. That is the sampling side of the
   * even-mesh rule of requirement 12.5.
   */
  const foldAxisEndpoints: Record<GrabAnchor, readonly [GrabAnchor, GrabAnchor]> = {
    // Main diagonal `(0, 0)–(1, 1)`.
    'top-right': ['top-left', 'bottom-right'],
    'bottom-left': ['top-left', 'bottom-right'],
    // Anti-diagonal `(0, 1)–(1, 0)`.
    'top-left': ['bottom-left', 'top-right'],
    'bottom-right': ['bottom-left', 'top-right'],
    // Horizontal midline `(0, 0.5)–(1, 0.5)`.
    'top-center': ['middle-left', 'middle-right'],
    'bottom-center': ['middle-left', 'middle-right'],
    // Vertical midline `(0.5, 0)–(0.5, 1)`.
    'middle-left': ['top-center', 'bottom-center'],
    'middle-right': ['top-center', 'bottom-center'],
  };

  /**
   * The sheet's footprint at `progress`, written out here from
   * `lerpRect(source, destination, eased)` rather than read back from
   * `geometry.ts`, so the hinge is checked against the documented formula and
   * not against whatever the module happens to compute. `lerpRect` is
   * module-private, so this is also the only way to state the claim.
   */
  const baseRectAt = (from: Rect, to: Rect, progress: number, meshProfile: MotionProfile): Rect => {
    const eased = meshProfile.easing(progress);
    const lerp = (start: number, end: number): number => start + (end - start) * eased;

    return {
      left: lerp(from.left, to.left),
      top: lerp(from.top, to.top),
      width: lerp(from.width, to.width),
      height: lerp(from.height, to.height),
    };
  };

  /**
   * Both mesh dimensions are even in every entry, for the reason given above.
   * The eased profile is included so the base rect is genuinely
   * `lerpRect(…, eased)` and not `lerpRect(…, progress)` — under the suite's
   * identity easing the two are indistinguishable, so a frame that lerped by
   * raw progress would pass unnoticed.
   */
  const stationaryProfiles: readonly (readonly [string, MotionProfile])[] = [
    ['the 2 × 2 suite mesh', profile],
    ['a 6 × 4 mesh', reflectionProfile],
    [
      'a 6 × 4 mesh under a non-linear easing',
      { ...reflectionProfile, easing: (progress: number) => 1 - (1 - progress) ** 3 },
    ],
  ];

  /** Dense enough to cross peak curl, and inclusive of both endpoints. */
  const stationaryProgressSweep: readonly number[] = [
    0, 0.01, 0.08, 0.2, 0.25, 1 / 3, 0.5, 0.62, 0.75, 0.9, 0.99, 1,
  ];

  it.each(allAnchors)('holds both fold-axis endpoints on the growing base rect for %s', (anchor) => {
    const [origin, far] = foldAxisEndpoints[anchor];
    const pivot = oppositeAnchor(anchor);

    // The endpoint table is written independently above, so it is worth
    // confirming it names the remaining pair of the anchor's own family: the two
    // endpoints are each other's pivot, and neither is the grab anchor or its
    // pivot. A table that named the grab anchor itself would turn this property
    // into a restatement of anchor exchange.
    expect(oppositeAnchor(origin), `${anchor}: fold-axis endpoints are opposite`).toBe(far);
    expect([origin, far]).not.toContain(anchor);
    expect([origin, far]).not.toContain(pivot);

    for (const [profileLabel, meshProfile] of stationaryProfiles) {
      for (const [rectLabel, from, to] of reflectionRectPairs) {
        for (const progress of stationaryProgressSweep) {
          const base = baseRectAt(from, to, progress, meshProfile);
          const frame = buildPaperFrame(from, to, anchor, progress, meshProfile);

          for (const endpoint of [origin, far]) {
            const expected = anchorPoint(base, endpoint);
            const index = vertexIndex(endpoint, meshProfile.meshColumns, meshProfile.meshRows) * 3;
            const detail = `${anchor} on ${rectLabel} with ${profileLabel} at progress ${progress}: ${endpoint} endpoint`;

            // Requirement 11.3 states its budget as `1e-6` CSS pixels in each of
            // `x`, `y`, and `z`, and positions ship in a `Float32Array`, so the
            // comparison allows one single-precision step at the magnitude under
            // test on top of that budget, as the sweeps above do.
            expect(
              Math.abs(frame.positions[index]! - expected.x),
              `${detail}: x`,
            ).toBeLessThanOrEqual(positionTolerance(expected.x));
            expect(
              Math.abs(frame.positions[index + 1]! - expected.y),
              `${detail}: y`,
            ).toBeLessThanOrEqual(positionTolerance(expected.y));
            // The hinge stays in the plane of the growing rect for the whole
            // turn: the perpendicular offset is `0` on the axis and the ridge
            // term vanishes at its ends, so neither depth term can lift it.
            expect(
              Math.abs(frame.positions[index + 2]!),
              `${detail}: z`,
            ).toBeLessThanOrEqual(positionTolerance(0));
          }
        }
      }
    }
  });

  /**
   * Property 4: Flatness and exactness at both endpoints.
   *
   * **Validates: Requirements 11.4, 11.5, 15.1**
   *
   * Properties 1 through 3 say where individual vertices land. This one says
   * the sheet is a flat, correctly framed rectangle at both ends of the turn:
   * nothing sticks out of the rect it is supposed to occupy, nothing is left
   * lifted out of the plane, and the two scalar outputs the renderer reads —
   * `lift` for the contact shadow and `alpha` for compositing — hit their
   * documented endpoint values. A deformation term that failed to vanish with
   * `lift` would leave a visible seam exactly at the handoff to real DOM, which
   * is the one frame where the sheet's geometry has to match the destination
   * rect for the swap to be invisible.
   *
   * All eight anchors are enumerated rather than sampled, because the anchor
   * vocabulary is closed and finite, and every mesh vertex of every rect pair is
   * checked rather than a hand-picked few.
   *
   * Reveal progress is not published directly — it is module-private — so the
   * exactly-`0`-then-exactly-`1` claim of requirement 15.1 is read off the one
   * observable it drives: `frame.revealClipPath`, which is three coincident
   * points while reveal progress is `0` and the four destination corners when it
   * is `1`. The keying is on EASED progress, not raw progress, so the sweep
   * below includes easings that reach `1` early and that never reach it.
   */
  const easedAt = (progress: number, meshProfile: MotionProfile): number => {
    const clamp = (value: number): number => Math.min(1, Math.max(0, value));

    return clamp(meshProfile.easing(clamp(progress)));
  };

  /**
   * Asserts a landed vertex sits inside `rect` — that is what "lies on the
   * source rect" means for the interior vertices of the mesh, whose landing
   * positions are the undeformed grid rather than the boundary.
   */
  const expectWithinRect = (rect: Rect, point: Point, detail: string): void => {
    const slack = positionTolerance(Math.max(Math.abs(rect.left) + rect.width, Math.abs(rect.top) + rect.height));

    expect(point.x, `${detail}: x within [${rect.left}, ${rect.left + rect.width}]`).toBeGreaterThanOrEqual(
      rect.left - slack,
    );
    expect(point.x, `${detail}: x within [${rect.left}, ${rect.left + rect.width}]`).toBeLessThanOrEqual(
      rect.left + rect.width + slack,
    );
    expect(point.y, `${detail}: y within [${rect.top}, ${rect.top + rect.height}]`).toBeGreaterThanOrEqual(
      rect.top - slack,
    );
    expect(point.y, `${detail}: y within [${rect.top}, ${rect.top + rect.height}]`).toBeLessThanOrEqual(
      rect.top + rect.height + slack,
    );
  };

  it.each(allAnchors)('lays every vertex flat on the source rect at progress zero for %s', (anchor) => {
    for (const [label, from, to] of reflectionRectPairs) {
      const frame = buildPaperFrame(from, to, anchor, 0, reflectionProfile);

      for (let row = 0; row <= reflectionProfile.meshRows; row += 1) {
        for (let column = 0; column <= reflectionProfile.meshColumns; column += 1) {
          // At `progress = 0` the turn has not started, so the sheet is the
          // undeformed grid of the source rect: no reflection, no bulge, no
          // perspective scale. Writing the expectation as the plain grid states
          // the exactness half of the property, and containment follows from it.
          const expected = {
            x: from.left + (column / reflectionProfile.meshColumns) * from.width,
            y: from.top + (row / reflectionProfile.meshRows) * from.height,
          };
          const index = (row * (reflectionProfile.meshColumns + 1) + column) * 3;
          const landed = { x: frame.positions[index]!, y: frame.positions[index + 1]! };
          const detail = `${anchor} on ${label} at vertex (${column}, ${row})`;

          // Requirement 11.4 states its budget as `1e-6` CSS pixels in each of
          // `x`, `y`, and `z`, and positions ship in a `Float32Array`, so the
          // comparison allows one single-precision step at the magnitude under
          // test on top of that budget, as the sweeps above do.
          expect(Math.abs(landed.x - expected.x), `${detail}: x`).toBeLessThanOrEqual(
            positionTolerance(expected.x),
          );
          expect(Math.abs(landed.y - expected.y), `${detail}: y`).toBeLessThanOrEqual(
            positionTolerance(expected.y),
          );
          expect(Math.abs(frame.positions[index + 2]!), `${detail}: z`).toBeLessThanOrEqual(
            positionTolerance(0),
          );
          expectWithinRect(from, landed, detail);
        }
      }
    }
  });

  it.each(allAnchors)('lays every vertex flat on the destination rect at progress one for %s', (anchor) => {
    for (const [label, from, to] of reflectionRectPairs) {
      const frame = buildPaperFrame(from, to, anchor, 1, reflectionProfile);

      for (let row = 0; row <= reflectionProfile.meshRows; row += 1) {
        for (let column = 0; column <= reflectionProfile.meshColumns; column += 1) {
          const index = (row * (reflectionProfile.meshColumns + 1) + column) * 3;
          const landed = { x: frame.positions[index]!, y: frame.positions[index + 1]! };
          const detail = `${anchor} on ${label} at vertex (${column}, ${row})`;

          // Property 1 above pins WHERE each vertex lands at `progress = 1`.
          // What requirement 11.4 adds is that the whole sheet is inside the
          // destination rect and back in the plane on that final frame, so the
          // handoff to live DOM has nothing hanging over the edge and no
          // residual depth.
          expectWithinRect(to, landed, detail);
          expect(Math.abs(frame.positions[index + 2]!), `${detail}: z`).toBeLessThanOrEqual(
            positionTolerance(0),
          );
        }
      }
    }
  });

  /**
   * Easings chosen so `eased` and `progress` are distinguishable: the identity
   * pair would hide a frame that read raw progress, the cubic reaches `1` only
   * at `progress = 1`, and the last two are the degenerate saturating and
   * stalled cases used below to show the reveal keys off `eased`.
   */
  const endpointProfiles: readonly (readonly [string, MotionProfile])[] = [
    ['the 2 × 2 suite mesh under identity easing', profile],
    ['a 6 × 4 mesh under identity easing', reflectionProfile],
    [
      'a 6 × 4 mesh under a cubic ease-out',
      { ...reflectionProfile, easing: (progress: number) => 1 - (1 - progress) ** 3 },
    ],
  ];

  const endpointProgressSweep: readonly number[] = [
    0, 0.05, 0.2, 1 / 3, 0.5, 0.66, 0.8, 0.95, 0.999, 1,
  ];

  it.each(allAnchors)('computes lift as the sine of eased progress for %s', (anchor) => {
    for (const [profileLabel, meshProfile] of endpointProfiles) {
      for (const progress of endpointProgressSweep) {
        const frame = buildPaperFrame(source, destination, anchor, progress, meshProfile);
        const eased = easedAt(progress, meshProfile);
        const detail = `${anchor} with ${profileLabel} at progress ${progress}`;

        // `lift` is a plain number rather than a `Float32Array` entry, and both
        // sides evaluate the same two double-precision operations on the same
        // `eased`, so requirement 11.5's formula is checked as exact agreement
        // rather than within a budget.
        expect(frame.lift, `${detail}: lift is sin(pi * eased)`).toBe(Math.sin(Math.PI * eased));
        // `eased` is clamped into `[0, 1]`, so the sine never turns negative:
        // the shadow scale downstream reads `lift` directly and a negative value
        // would invert the contact shadow.
        expect(frame.lift, `${detail}: lift is within [0, 1]`).toBeGreaterThanOrEqual(0);
        expect(frame.lift, `${detail}: lift is within [0, 1]`).toBeLessThanOrEqual(1);
        // Requirement 11.5, second half: the sheet is opaque for the whole turn,
        // at every progress and for every anchor, not merely at the endpoints.
        expect(frame.alpha, `${detail}: alpha`).toBe(1);
      }
    }
  });

  it.each(allAnchors)('reports zero lift at both endpoints and full lift at the eased midpoint for %s', (anchor) => {
    // `Math.sin(Math.PI)` is `1.2246e-16` in double precision, not literally
    // `0`, so requirement 11.5's `1e-6` budget is the operative claim at
    // `progress = 1`. At `progress = 0` the sine is exactly `0`, and at an
    // `eased` of exactly `0.5` it is exactly `1`, so those two are stated as
    // equalities.
    expect(buildPaperFrame(source, destination, anchor, 0, profile).lift).toBe(0);
    expect(
      Math.abs(buildPaperFrame(source, destination, anchor, 1, profile).lift),
    ).toBeLessThanOrEqual(1e-6);
    expect(buildPaperFrame(source, destination, anchor, 0.5, profile).lift).toBe(1);

    // The peak is at the midpoint of EASED progress, not of raw progress. Under
    // the cubic ease-out that arrives at `progress = 1 − ∛0.5 ≈ 0.206`, which is
    // where a frame that squared `progress` into the sine would disagree.
    const easeOut: MotionProfile = {
      ...reflectionProfile,
      easing: (progress: number) => 1 - (1 - progress) ** 3,
    };
    const easedMidpoint = 1 - Math.cbrt(0.5);

    expect(easedAt(easedMidpoint, easeOut)).toBeCloseTo(0.5, 12);
    expect(
      Math.abs(buildPaperFrame(source, destination, anchor, easedMidpoint, easeOut).lift - 1),
    ).toBeLessThanOrEqual(1e-6);
  });

  /**
   * Splits a `polygon()` clip into its points, as percentages of the reference
   * rect. Parsing rather than string-comparing keeps the assertions numeric, so
   * a point that is correct to within a rounding step is not reported as a
   * textual mismatch.
   */
  const clipPoints = (clip: string): Point[] => {
    const body = /^polygon\((.*)\)$/.exec(clip);

    expect(body, `${clip} is a polygon()`).not.toBeNull();

    return body![1]!.split(', ').map((pair) => {
      const [x, y] = pair.split(' ');

      return { x: Number.parseFloat(x!), y: Number.parseFloat(y!) };
    });
  };

  it.each(allAnchors)('withholds the reveal until eased progress reaches one for %s', (anchor) => {
    /**
     * The saturating and stalled easings are the discriminators: a reveal keyed
     * off raw progress would stay shut at `progress = 0.2` under the first and
     * would open at `progress = 1` under the second. Requirement 15.1 keys it
     * off `eased`, so it opens in the first case and never in the second.
     */
    const revealProfiles: readonly (readonly [string, MotionProfile])[] = [
      ...endpointProfiles,
      ['a saturating easing', { ...reflectionProfile, easing: () => 1 }],
      ['an easing that stalls just short of one', { ...reflectionProfile, easing: () => 0.999 }],
    ];

    for (const [profileLabel, meshProfile] of revealProfiles) {
      for (const progress of endpointProgressSweep) {
        const frame = buildPaperFrame(source, destination, anchor, progress, meshProfile);
        const eased = easedAt(progress, meshProfile);
        const points = clipPoints(frame.revealClipPath);
        const detail = `${anchor} with ${profileLabel} at progress ${progress} (eased ${eased})`;

        if (eased >= 1) {
          // Reveal progress is exactly `1`, so the sheet has landed and the
          // clip is the whole destination rect in corner winding order.
          expect(points, `${detail}: reveals the four destination corners`).toEqual([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ]);
          continue;
        }

        // Reveal progress is exactly `0`, so the clip is the degenerate
        // three-point polygon pinned to the grab anchor of the sheet's own
        // footprint — the growing base rect — expressed in percentages of the
        // destination. A reveal progress anywhere in `(0, 1)` would emit four or
        // five distinct points instead.
        const base = baseRectAt(source, destination, progress, meshProfile);
        const collapsed = anchorPoint(base, anchor);
        const expected = {
          x: ((collapsed.x - destination.left) / destination.width) * 100,
          y: ((collapsed.y - destination.top) / destination.height) * 100,
        };

        expect(points, `${detail}: collapses to three points`).toHaveLength(3);

        for (const point of points) {
          expect(Math.abs(point.x - expected.x), `${detail}: x percentage`).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(point.y - expected.y), `${detail}: y percentage`).toBeLessThanOrEqual(1e-6);
        }
      }
    }
  });

  /**
   * Property 5: Continuity across the fold axis.
   *
   * **Validates: Requirements 11.6, 11.7, 11.8, 15.6**
   *
   * The sheet is one piece of paper, so the two halves have to meet along the
   * fold line. Requirement 11.7 states that as a claim about the source — every
   * deformation term is computed from `acrossFold` and the ridge alone, with no
   * branch on `sign(acrossFold)` — and requirement 11.6 states the observable
   * consequence: the position delta between two mesh-adjacent vertices that span
   * the axis is bounded by `C / min(meshColumns, meshRows)` for one constant `C`
   * fixed by the rects and the profile. That bound is what rules out a tear. A
   * `sign()`-style step would hold its magnitude however fine the mesh got, so
   * refining the mesh is the discriminator, and this block sweeps mesh density
   * for exactly that reason.
   *
   * `acrossFold`, `along`, and `perp` are module-private intermediates, so they
   * are reconstructed here from the public `foldBasis` — the same reconstruction
   * the reveal-front block below performs for `frontDistance`.
   *
   * Two shapes of adjacency span the axis, and both count:
   *
   * - Opposite signs of `perp`: the axis passes between the two vertices. This
   *   is the strict reading of "straddling", and for the MIDLINE family it is
   *   always empty on a legal mesh — requirement 12.1 makes both dimensions
   *   even, which puts the centerline exactly on a vertex line, so no midline
   *   pair can bracket it. Restricting to opposite signs alone would therefore
   *   leave the property vacuous for half the anchor vocabulary.
   * - Exactly one endpoint with `perp` of `0`: the pair runs from a vertex on
   *   the axis to its neighbour off it. This is where the midline family's
   *   crossing lives, and it is the same claim — the step from the fold line to
   *   the first vertex off it is an ordinary mesh step, not a jump.
   *
   * Deltas are compared within a direction, horizontal against horizontal and
   * vertical against vertical, because a cell is not square: on a `1024 × 256`
   * destination an ordinary horizontal step is four times an ordinary vertical
   * one, and mixing the two would report that aspect ratio as a discontinuity.
   */
  const continuityMeshes: readonly (readonly [string, MotionProfile])[] = [
    ['the 2 × 2 suite mesh', profile],
    ['a 4 × 4 mesh', { ...profile, meshColumns: 4, meshRows: 4 }],
    ['a 6 × 4 mesh', reflectionProfile],
    ['an 8 × 6 mesh', { ...profile, meshColumns: 8, meshRows: 6 }],
    ['a 16 × 12 mesh', { ...profile, meshColumns: 16, meshRows: 12 }],
    ['a 32 × 24 mesh', { ...profile, meshColumns: 32, meshRows: 24 }],
  ];

  /** Inclusive of both endpoints and dense through the first half, where `lift` climbs fastest. */
  const continuityProgressSweep: readonly number[] = [
    0, 0.05, 0.17, 0.25, 0.4, 0.5, 0.63, 0.75, 0.9, 0.99, 1,
  ];

  /**
   * The `C` of requirement 11.6 depends only on the rects and the profile, so it
   * is written here as a multiple of the largest span either rect occupies —
   * every vertex of every frame lies inside the growing rect between them, so no
   * delta can exceed that span. A flat mesh already spends `span / density` per
   * step, which puts the honest value of `C / span` at about `1`; the factor
   * below is that with headroom for the mid-turn bulge. It is deliberately not
   * loose enough to admit a step: the smallest `sign()` flip in the bulge term
   * is `2 · maxPerp · ARC_BULGE` of unit-square width, some `0.34 · span` of
   * CSS pixels, which at the densest mesh here is over twenty times the budget.
   */
  const CONTINUITY_SPAN_FACTOR = 1.5;

  const continuityBudget = (from: Rect, to: Rect, meshProfile: MotionProfile): number => {
    const span = Math.max(from.width, from.height, to.width, to.height);
    const density = Math.min(meshProfile.meshColumns, meshProfile.meshRows);

    return (CONTINUITY_SPAN_FACTOR * span) / density;
  };

  /**
   * How much larger a crossing delta may be than the largest ordinary delta in
   * the same direction on the same frame. The observed worst case over this
   * whole sweep is about `1.10`, on the coarsest meshes where a single step
   * covers a quarter of the sheet; it falls to within `1.001` by the `32 × 24`
   * mesh. A torn mesh does not converge like that.
   */
  const SAME_SIDE_FACTOR = 1.25;

  /**
   * The fold-basis coordinates of a unit-square point, reconstructed from what
   * `foldBasis` publishes. `along`, `perp`, and `acrossFold` are module-private
   * intermediates of the per-vertex loop, so this restatement is the only way to
   * say anything about them.
   */
  const foldCoordinates = (
    basis: FoldBasis,
    u: number,
    v: number,
  ): { along: number; perp: number; acrossFold: number; alongFraction: number } => {
    const offsetX = u - basis.origin.x;
    const offsetY = v - basis.origin.y;
    const along = offsetX * basis.axis.x + offsetY * basis.axis.y;
    const perp = offsetX * basis.normal.x + offsetY * basis.normal.y;

    return {
      along,
      perp,
      acrossFold: perp / basis.maxPerp,
      alongFraction: along / basis.axisLength,
    };
  };

  /** Full three-dimensional separation: a tear in depth is as visible as one in the plane. */
  const vertexSeparation = (positions: Float32Array, first: number, second: number): number =>
    Math.hypot(
      positions[first * 3]! - positions[second * 3]!,
      positions[first * 3 + 1]! - positions[second * 3 + 1]!,
      positions[first * 3 + 2]! - positions[second * 3 + 2]!,
    );

  /**
   * Worst crossing delta and worst same-side delta among the adjacent pairs of
   * one frame that run in one direction, with the pair counts so a direction
   * that samples neither category can be recognized rather than silently
   * reported as passing.
   */
  const summarizeAdjacency = (
    positions: Float32Array,
    meshProfile: MotionProfile,
    basis: FoldBasis,
    direction: 'horizontal' | 'vertical',
  ): {
    crossingMax: number;
    crossingCount: number;
    straddleCount: number;
    sameSideMax: number;
    sameSideCount: number;
  } => {
    const { meshColumns, meshRows } = meshProfile;
    const perpAt = (column: number, row: number): number =>
      foldCoordinates(basis, column / meshColumns, row / meshRows).perp;
    let crossingMax = 0;
    let crossingCount = 0;
    let straddleCount = 0;
    let sameSideMax = 0;
    let sameSideCount = 0;

    for (let row = 0; row <= meshRows; row += 1) {
      for (let column = 0; column <= meshColumns; column += 1) {
        const nextColumn = direction === 'horizontal' ? column + 1 : column;
        const nextRow = direction === 'vertical' ? row + 1 : row;

        if (nextColumn > meshColumns || nextRow > meshRows) {
          continue;
        }

        const first = row * (meshColumns + 1) + column;
        const second = nextRow * (meshColumns + 1) + nextColumn;
        const perp = perpAt(column, row);
        const neighbourPerp = perpAt(nextColumn, nextRow);
        const delta = vertexSeparation(positions, first, second);

        if (perp * neighbourPerp < 0) {
          straddleCount += 1;
          crossingCount += 1;
          crossingMax = Math.max(crossingMax, delta);
        } else if (perp === 0 || neighbourPerp === 0) {
          crossingCount += 1;
          crossingMax = Math.max(crossingMax, delta);
        } else {
          sameSideCount += 1;
          sameSideMax = Math.max(sameSideMax, delta);
        }
      }
    }

    return { crossingMax, crossingCount, straddleCount, sameSideMax, sameSideCount };
  };

  it.each(allAnchors)('holds the sheet together across the fold axis for %s', (anchor) => {
    const basis = foldBasis(anchor);

    for (const [meshLabel, meshProfile] of continuityMeshes) {
      for (const [rectLabel, from, to] of reflectionRectPairs) {
        const budget = continuityBudget(from, to, meshProfile);

        for (const progress of continuityProgressSweep) {
          const frame = buildPaperFrame(from, to, anchor, progress, meshProfile);
          const detail = `${anchor} on ${rectLabel} with ${meshLabel} at progress ${progress}`;
          let crossingsSeen = 0;
          let comparisonsMade = 0;

          for (const direction of ['horizontal', 'vertical'] as const) {
            const summary = summarizeAdjacency(frame.positions, meshProfile, basis, direction);

            crossingsSeen += summary.crossingCount;

            // Requirement 11.6: the crossing delta is bounded by
            // `C / min(meshColumns, meshRows)`, with one `C` for the whole sweep
            // over progress, anchors, and mesh positions.
            expect(
              summary.crossingMax,
              `${detail}: worst ${direction} crossing delta within C / min(columns, rows)`,
            ).toBeLessThanOrEqual(budget);

            // A direction with no ordinary pair to compare against has nothing
            // to say — on the 2 × 2 mesh the midline family's axis occupies the
            // whole middle row or column, so every pair in one direction spans
            // it. The crossing bound above still applies there; only the
            // relative comparison is skipped.
            if (summary.crossingCount === 0 || summary.sameSideCount === 0) {
              continue;
            }

            comparisonsMade += 1;

            // The same claim stated relatively, which is the form that needs no
            // constant fixed in advance: spanning the axis costs no more than an
            // ordinary step of the same kind elsewhere on the same frame.
            expect(
              summary.crossingMax,
              `${detail}: worst ${direction} crossing delta of ${summary.crossingMax} against the same-side ${summary.sameSideMax}`,
            ).toBeLessThanOrEqual(summary.sameSideMax * SAME_SIDE_FACTOR);
          }

          // Guards against a vacuous pass: some pair has to span the axis, and
          // some direction has to be comparable, or the two assertions above
          // ran over empty sets.
          expect(crossingsSeen, `${detail}: some adjacent pair spans the fold axis`).toBeGreaterThan(
            0,
          );
          expect(comparisonsMade, `${detail}: some direction samples both categories`).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });

  /**
   * The `1 / min(meshColumns, meshRows)` shape of the bound, which is the part a
   * fixed budget cannot see. For each rect pair the worst crossing delta is
   * multiplied back by the mesh density to recover the observed `C`, and that
   * value has to stay put as the mesh refines from `2 × 2` to `32 × 24`.
   *
   * The upper end of the band is the tear test: a term that stepped at
   * `acrossFold` of `0` would keep its delta while the density grew, so the
   * recovered `C` would climb by the same factor as the density — twelvefold
   * across this sweep. The lower end says the bound is the right shape rather
   * than a wild overestimate: if the delta shrank much faster than
   * `1 / density`, `C / min(columns, rows)` would be the wrong statement of the
   * requirement.
   *
   * Requirement 15.6 rides along here: the `sin(π / 2 · acrossFold)` bulge is
   * what makes this converge, and swapping it for anything with a step at the
   * axis is what the upper end rejects.
   */
  it('recovers one continuity constant per rect pair at every mesh density', () => {
    for (const [rectLabel, from, to] of reflectionRectPairs) {
      const recovered = continuityMeshes.map(([meshLabel, meshProfile]) => {
        const density = Math.min(meshProfile.meshColumns, meshProfile.meshRows);
        let worst = 0;

        for (const anchor of allAnchors) {
          const basis = foldBasis(anchor);

          for (const progress of continuityProgressSweep) {
            const frame = buildPaperFrame(from, to, anchor, progress, meshProfile);

            for (const direction of ['horizontal', 'vertical'] as const) {
              const summary = summarizeAdjacency(frame.positions, meshProfile, basis, direction);

              worst = Math.max(worst, summary.crossingMax * density);
            }
          }
        }

        return { meshLabel, density, constant: worst };
      });
      const coarsest = recovered[0]!;

      expect(coarsest.constant, `${rectLabel}: recovered a positive constant`).toBeGreaterThan(0);

      for (const { meshLabel, density, constant } of recovered.slice(1)) {
        const detail = `${rectLabel} with ${meshLabel}: recovered ${constant.toFixed(3)} against ${coarsest.constant.toFixed(3)} from ${coarsest.meshLabel}`;

        // Observed across this sweep: the ratio sits between `0.84` and `1.02`.
        expect(constant, `${detail} (no growth with density ${density})`).toBeLessThanOrEqual(
          coarsest.constant * 1.1,
        );
        expect(constant, `${detail} (the bound is not a wild overestimate)`).toBeGreaterThanOrEqual(
          coarsest.constant * 0.75,
        );
      }
    }
  });

  /**
   * Requirement 11.8: the two normalized intermediates the per-vertex loop runs
   * on stay inside the ranges the loop's comments claim for them, for every
   * vertex written, with `1e-9` of floating-point slack. They are what make the
   * loop indifferent to the fold-axis kind — a diagonal fold and a midline fold
   * both hand it an `acrossFold` in `[−1, 1]` and an `along / axisLength` in
   * `[0, 1]` — so a fold basis that broke either range would put the profile
   * tunables and `ARC_BULGE` on a different scale for one family.
   *
   * Both quantities are functions of the vertex and the anchor alone, with no
   * progress term, so they are evaluated once per vertex; the frame is built at
   * the same mesh so the claim is about vertices the module actually writes, and
   * their finiteness is confirmed alongside.
   */
  const RANGE_SLACK = 1e-9;

  it.each(allAnchors)('keeps both normalized fold coordinates within range for %s', (anchor) => {
    const basis = foldBasis(anchor);

    for (const [meshLabel, meshProfile] of continuityMeshes) {
      const frame = buildPaperFrame(source, destination, anchor, 0.37, meshProfile);
      const vertexCount = (meshProfile.meshColumns + 1) * (meshProfile.meshRows + 1);

      expect(frame.positions, `${anchor} with ${meshLabel}: one position triple per vertex`).toHaveLength(
        vertexCount * 3,
      );

      let worstAcross = { value: 0, detail: '' };
      let lowestAlong = { value: Number.POSITIVE_INFINITY, detail: '' };
      let highestAlong = { value: Number.NEGATIVE_INFINITY, detail: '' };
      let nonFinite: string | null = null;

      for (let row = 0; row <= meshProfile.meshRows; row += 1) {
        for (let column = 0; column <= meshProfile.meshColumns; column += 1) {
          const { acrossFold, alongFraction } = foldCoordinates(
            basis,
            column / meshProfile.meshColumns,
            row / meshProfile.meshRows,
          );
          const at = `${anchor} with ${meshLabel} at vertex (${column}, ${row})`;
          const index = (row * (meshProfile.meshColumns + 1) + column) * 3;

          if (Math.abs(acrossFold) > worstAcross.value) {
            worstAcross = { value: Math.abs(acrossFold), detail: at };
          }

          if (alongFraction < lowestAlong.value) {
            lowestAlong = { value: alongFraction, detail: at };
          }

          if (alongFraction > highestAlong.value) {
            highestAlong = { value: alongFraction, detail: at };
          }

          if (
            nonFinite === null &&
            ![0, 1, 2].every((offset) => Number.isFinite(frame.positions[index + offset]))
          ) {
            nonFinite = at;
          }
        }
      }

      expect(nonFinite, `${anchor} with ${meshLabel}: every position entry is finite`).toBeNull();
      expect(
        worstAcross.value,
        `${worstAcross.detail}: acrossFold within [-1, 1]`,
      ).toBeLessThanOrEqual(1 + RANGE_SLACK);
      expect(
        lowestAlong.value,
        `${lowestAlong.detail}: along / axisLength within [0, 1]`,
      ).toBeGreaterThanOrEqual(-RANGE_SLACK);
      expect(
        highestAlong.value,
        `${highestAlong.detail}: along / axisLength within [0, 1]`,
      ).toBeLessThanOrEqual(1 + RANGE_SLACK);
      // The ranges are reached, not merely respected: the grab anchor and its
      // pivot sit at `acrossFold` of `±1` and the two fold-axis endpoints at the
      // ends of the along span, so a basis that scaled either quantity down
      // would be caught here rather than passing the bounds above trivially.
      expect(worstAcross.value, `${anchor} with ${meshLabel}: acrossFold reaches 1`).toBeCloseTo(1, 9);
      expect(lowestAlong.value, `${anchor} with ${meshLabel}: along fraction reaches 0`).toBeCloseTo(
        0,
        9,
      );
      expect(highestAlong.value, `${anchor} with ${meshLabel}: along fraction reaches 1`).toBeCloseTo(
        1,
        9,
      );
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

  it('keeps the destination hidden until the sheet has finished covering it', () => {
    // The sheet already carries the destination page on its reverse face, so
    // uncovering the live DOM mid-turn drew a flat rectangle that was not part
    // of the fold and hid the card list behind it. The page stays clipped to a
    // degenerate point until the sheet lands, where its geometry matches the
    // destination rect and the handoff to real DOM is invisible.
    for (const progress of [0, 0.25, 0.5, 0.75, 0.99]) {
      const clip = buildPaperFrame(source, destination, 'top-right', progress, profile).revealClipPath;
      const points = [...clip.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((match) => `${match[1]},${match[2]}`);

      expect(points.length).toBeGreaterThan(2);
      expect(new Set(points).size).toBe(1);
    }

    expect(buildPaperFrame(source, destination, 'top-right', 1, profile).revealClipPath).toBe(
      'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)',
    );
  });

  it('keeps the sheet fully opaque for the whole turn', () => {
    // The reverse face is a capture of the destination page, and the live
    // destination DOM sits directly beneath the sheet. Any transparency
    // therefore shows the same content twice, offset by the sheet's
    // deformation, which reads as ghosted double text. The sheet instead stays
    // opaque and hands off at progress 1, where its geometry already matches
    // the destination rect exactly.
    for (const progress of [0, 0.25, 0.5, 0.6, 0.78, 0.9, 1]) {
      expect(buildPaperFrame(source, destination, 'top-right', progress, profile).alpha).toBe(1);
    }
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

  /**
   * Corner parity with the pre-feature implementation.
   *
   * **Validates: Requirements 9.9, 9.12, 13.6**
   *
   * Widening the anchor vocabulary was supposed to leave a corner grab exactly
   * where it already was. The visual PNG baselines cannot establish that any
   * more — the demo's first tile now resolves a different anchor, so its
   * baseline legitimately changed — which makes this block the actual evidence
   * that corner geometry did not move.
   *
   * The golden values are produced by an ORACLE rather than committed as a
   * number blob: the pre-feature fold basis, the pre-feature per-vertex
   * deformation body, and the pre-feature `|u − gx| + |v − gy|` L1 reveal sweep,
   * each restated below from the implementation this feature replaced. A blob of
   * captured numbers would assert the same thing while saying nothing about why
   * those numbers are right, and could not be re-derived by a reader. The L1
   * restatement mirrors the `l1RevealPoints` helper of the reveal-sweep suite,
   * extended to the collapsed branch and to the percentage formatting so the
   * whole clip string can be compared and not merely its interior points.
   *
   * The pre-feature basis is not identical to today's for all four corners: it
   * derived both fold-axis endpoints from the grabbed corner's own uv, which
   * names them in the OPPOSITE order from today's `FOLD_AXIS` table for
   * `top-right` and `bottom-right`. That exchange is the one requirement 9.9
   * declares immaterial, so the position claim is stated in requirement 9.12's
   * terms — agreement within `1e-4` CSS pixels per component — rather than as
   * bit equality, and the difference in the two bases is asserted explicitly
   * below so this cannot quietly decay into comparing one code path with itself.
   */
  describe('corner parity with the pre-feature implementation', () => {
    /** Requirements 9.9 and 9.12 both state their budget in CSS pixels. */
    const PIXEL_TOLERANCE = 1e-4;
    /** Requirement 13.6 states the reveal budget in CSS pixels per coordinate. */
    const CLIP_TOLERANCE = 1e-6;
    /**
     * `shade` is a unitless facing ratio in `[0, 1]`, so it carries no CSS-pixel
     * budget of its own; it is compared at the tightest bound single-precision
     * storage admits at that magnitude.
     */
    const SHADE_TOLERANCE = 1e-6;

    /**
     * The three module-private constants the deformation body reads. Requirement
     * 9.11 keeps all three at their pre-feature values, so one set of literals
     * serves both the oracle and today's module.
     */
    const PERSPECTIVE_STRENGTH = 0.00042;
    const FACING_FLOOR = 0.32;
    const ARC_BULGE = 0.34;

    const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

    /**
     * The pre-feature `foldBasis`, which had no fold-axis table and derived both
     * endpoints from the grabbed corner's uv: `origin = (gx, 1 − gy)` and
     * `far = (1 − gx, gy)`. Everything downstream of the two endpoints — the
     * normal's auto-orientation toward the grabbed corner, `axisLength`, and
     * `maxPerp` — is unchanged, and is restated here in the pre-feature form.
     */
    const preFeatureFoldBasis = (corner: Corner): FoldBasis => {
      const grabbedUv = anchorUv[corner];
      const origin = { x: grabbedUv.x, y: 1 - grabbedUv.y };
      const far = { x: 1 - grabbedUv.x, y: grabbedUv.y };
      const deltaX = far.x - origin.x;
      const deltaY = far.y - origin.y;
      const axisLength = Math.hypot(deltaX, deltaY);
      const axis = { x: deltaX / axisLength, y: deltaY / axisLength };
      const toGrabbed = { x: grabbedUv.x - origin.x, y: grabbedUv.y - origin.y };
      const candidate = { x: -axis.y, y: axis.x };
      const normal =
        candidate.x * toGrabbed.x + candidate.y * toGrabbed.y >= 0
          ? candidate
          : { x: axis.y, y: -axis.x };

      return {
        origin,
        axis,
        normal,
        axisLength,
        maxPerp: normal.x * toGrabbed.x + normal.y * toGrabbed.y,
      };
    };

    /**
     * The retired L1 sweep: each rect corner measured by
     * `|u − gx| + |v − gy|` against a threshold of `progress · 2`, with the
     * crossing between an inside and an outside corner interpolated along the
     * rect edge. Defined for corner anchors only — for an edge midpoint it is the
     * very expression that left every corner outside the front and emitted a
     * polygon with no points.
     */
    const preFeatureClipViewport = (rect: Rect, corner: Corner, progress: number): Point[] => {
      const grabbedUv = anchorUv[corner];
      const threshold = progress * 2;
      const measured = corners.map((each) => ({
        point: anchorPoint(rect, each),
        distance:
          Math.abs(anchorUv[each].x - grabbedUv.x) + Math.abs(anchorUv[each].y - grabbedUv.y),
      }));
      const output: Point[] = [];

      for (let index = 0; index < measured.length; index += 1) {
        const current = measured[index]!;
        const next = measured[(index + 1) % measured.length]!;
        const currentInside = current.distance <= threshold;
        const nextInside = next.distance <= threshold;

        if (currentInside) {
          output.push(current.point);
        }

        if (currentInside !== nextInside) {
          const edgeProgress = (threshold - current.distance) / (next.distance - current.distance);

          output.push({
            x: current.point.x + (next.point.x - current.point.x) * edgeProgress,
            y: current.point.y + (next.point.y - current.point.y) * edgeProgress,
          });
        }
      }

      return output;
    };

    /**
     * The pre-feature `clipPathBetween`, formatting included, so the comparison
     * can be made against the clip string the module actually returns. The
     * pre-feature entry point rejected a non-finite progress instead of clamping
     * it — requirement 13.9 changed that deliberately — so this restatement
     * keeps only the `progress <= 0` collapse and the `Math.min(1, progress)`
     * saturation that governed the `[0, 1]` interval both versions share.
     */
    const preFeatureClipPath = (
      shape: Rect,
      reference: Rect,
      corner: Corner,
      progress: number,
    ): string => {
      const toPercent = (point: Point): string => {
        const x = ((point.x - reference.left) / reference.width) * 100;
        const y = ((point.y - reference.top) / reference.height) * 100;

        return `${x}% ${y}%`;
      };

      if (progress <= 0) {
        const collapsed = toPercent(anchorPoint(shape, corner));

        return `polygon(${collapsed}, ${collapsed}, ${collapsed})`;
      }

      return `polygon(${preFeatureClipViewport(shape, corner, Math.min(1, progress))
        .map(toPercent)
        .join(', ')})`;
    };

    interface PreFeatureFrame {
      positions: Float32Array;
      shade: Float32Array;
      lift: number;
      revealClipPath: string;
    }

    /**
     * The pre-feature `buildPaperFrame`, driven from the pre-feature basis. The
     * deformation body is unchanged by this feature — requirement 9.10 is the
     * reason it could be, since it consumes only the basis — so this is the
     * pre-feature output for a corner grab, computed at single precision exactly
     * as the module publishes it.
     */
    const preFeatureFrame = (
      from: Rect,
      to: Rect,
      corner: Corner,
      progress: number,
      meshProfile: MotionProfile,
    ): PreFeatureFrame => {
      const eased = clamp01(meshProfile.easing(clamp01(progress)));
      // Reuses the Property 3 restatement of `lerpRect(source, destination,
      // eased)`. It applies the easing without the surrounding clamp, which is a
      // no-op for every easing swept in this block.
      const base = baseRectAt(from, to, progress, meshProfile);
      const basis = preFeatureFoldBasis(corner);
      const vertexCount = (meshProfile.meshColumns + 1) * (meshProfile.meshRows + 1);
      const positions = new Float32Array(vertexCount * 3);
      const shade = new Float32Array(vertexCount);
      const turn = Math.PI * eased;
      const lift = Math.sin(turn);
      const centerX = base.left + base.width / 2;
      const centerY = base.top + base.height / 2;

      for (let row = 0; row <= meshProfile.meshRows; row += 1) {
        const v = row / meshProfile.meshRows;

        for (let column = 0; column <= meshProfile.meshColumns; column += 1) {
          const u = column / meshProfile.meshColumns;
          const index = row * (meshProfile.meshColumns + 1) + column;
          const offsetX = u - basis.origin.x;
          const offsetY = v - basis.origin.y;
          const along = offsetX * basis.axis.x + offsetY * basis.axis.y;
          const perp = offsetX * basis.normal.x + offsetY * basis.normal.y;
          const acrossFold = perp / basis.maxPerp;
          const localTurn = turn + meshProfile.foldSoftness * lift * acrossFold;
          const localCos = Math.cos(localTurn);
          const localSin = Math.sin(localTurn);
          const ridge = Math.sin(Math.PI * clamp01(along / basis.axisLength));
          const bulge =
            basis.maxPerp * ARC_BULGE * lift * ridge * Math.sin((Math.PI / 2) * acrossFold);
          const turnedPerp = perp * localCos + bulge;
          const turnedU = basis.origin.x + along * basis.axis.x + turnedPerp * basis.normal.x;
          const turnedV = basis.origin.y + along * basis.axis.y + turnedPerp * basis.normal.y;
          const depth =
            acrossFold * localSin * meshProfile.bendDepth +
            meshProfile.edgeCurvature * localSin * ridge;
          const scale = 1 + depth * PERSPECTIVE_STRENGTH;
          const flatX = base.left + turnedU * base.width;
          const flatY = base.top + turnedV * base.height;

          positions[index * 3] = centerX + (flatX - centerX) * scale;
          positions[index * 3 + 1] = centerY + (flatY - centerY) * scale;
          positions[index * 3 + 2] = depth;
          shade[index] = clamp01(FACING_FLOOR + (1 - FACING_FLOOR) * Math.abs(localCos));
        }
      }

      return {
        positions,
        shade,
        lift,
        // The pre-feature frame keyed its own reveal off eased progress in
        // exactly this binary way, and measured it on the growing base rect in
        // percentages of the destination.
        revealClipPath: preFeatureClipPath(base, to, corner, eased >= 1 ? 1 : 0),
      };
    };

    /** Both endpoints, peak curl, and a spread of points either side of it. */
    const paritySweep: readonly number[] = [
      0, 0.01, 0.05, 0.13, 0.25, 1 / 3, 0.4, 0.5, 0.6, 2 / 3, 0.75, 0.87, 0.95, 0.99, 1,
    ];

    /**
     * The suite mesh, a denser even mesh, and a non-linear easing — the last so
     * the parity claim covers frames whose base rect and turn angle disagree
     * with raw progress.
     */
    const parityProfiles: readonly (readonly [string, MotionProfile])[] = [
      ['the 2 × 2 suite mesh', profile],
      ['a 6 × 4 mesh', reflectionProfile],
      [
        'a 6 × 4 mesh under a cubic ease-out',
        { ...reflectionProfile, easing: (progress: number) => 1 - (1 - progress) ** 3 },
      ],
    ];

    /** Each rect pair contributes both of its rects to the single-rect reveal sweep. */
    const parityRects: readonly (readonly [string, Rect])[] = reflectionRectPairs.flatMap(
      ([label, from, to]) =>
        [
          [`the source of ${label}`, from],
          [`the destination of ${label}`, to],
        ] as const,
    );

    const toPixels = (rect: Rect, percentage: Point): Point => ({
      x: rect.left + (percentage.x / 100) * rect.width,
      y: rect.top + (percentage.y / 100) * rect.height,
    });

    /**
     * Guards the oracle against becoming a copy of the code under test. For two
     * of the four corners the pre-feature basis genuinely starts from the other
     * end of the same fold line, and for the other two it agrees with today's
     * table — which is why the position budget below is requirement 9.9's `1e-4`
     * CSS pixels rather than exact equality.
     */
    it('drives the oracle from the fold basis the module no longer builds', () => {
      for (const corner of ['top-right', 'bottom-right'] as const) {
        const oracle = preFeatureFoldBasis(corner);
        const current = foldBasis(corner);

        expect(oracle.origin, `${corner}: the oracle starts from the other endpoint`).not.toEqual(
          current.origin,
        );
        expect(oracle.axis.x, `${corner}: axis x reverses`).toBeCloseTo(-current.axis.x, 12);
        expect(oracle.axis.y, `${corner}: axis y reverses`).toBeCloseTo(-current.axis.y, 12);
        // The line itself, its normal, and the perpendicular reach are the same,
        // which is the whole content of requirement 9.9's immateriality claim.
        expect(oracle.normal.x, `${corner}: normal x holds`).toBeCloseTo(current.normal.x, 12);
        expect(oracle.normal.y, `${corner}: normal y holds`).toBeCloseTo(current.normal.y, 12);
        expect(oracle.maxPerp, `${corner}: maxPerp holds`).toBeCloseTo(current.maxPerp, 12);
      }

      for (const corner of ['top-left', 'bottom-left'] as const) {
        expect(preFeatureFoldBasis(corner).origin, `${corner}: endpoints already agreed`).toEqual(
          foldBasis(corner).origin,
        );
      }
    });

    /**
     * Requirement 9.12: every corner vertex lands within `1e-4` CSS pixels of
     * where the pre-feature geometry put it, at every progress across the sweep.
     *
     * Observed worst deviation over this whole sweep: `6.1e-5` CSS pixels in
     * position and `6.0e-8` in shade — one single-precision step at a magnitude
     * of `1000`, which is the storage quantization of two double-precision
     * computations that differ only in the order the fold-axis endpoints were
     * named. Nothing here is a geometric difference.
     */
    it.each(corners)('lands every vertex where the pre-feature geometry did for %s', (corner) => {
      let worstPosition = 0;
      let worstPositionDetail = '';
      let worstShade = 0;
      let worstShadeDetail = '';

      for (const [profileLabel, meshProfile] of parityProfiles) {
        for (const [rectLabel, from, to] of reflectionRectPairs) {
          for (const progress of paritySweep) {
            const frame = buildPaperFrame(from, to, corner, progress, meshProfile);
            const golden = preFeatureFrame(from, to, corner, progress, meshProfile);
            const detail = `${corner} on ${rectLabel} with ${profileLabel} at progress ${progress}`;

            expect(frame.positions, `${detail}: position count`).toHaveLength(
              golden.positions.length,
            );
            expect(frame.shade, `${detail}: shade count`).toHaveLength(golden.shade.length);
            // `lift` and `alpha` are anchor-independent and computed from eased
            // progress alone, so they are compared as exact equality.
            expect(frame.lift, `${detail}: lift`).toBe(golden.lift);
            expect(frame.alpha, `${detail}: alpha`).toBe(1);

            for (let index = 0; index < golden.positions.length; index += 1) {
              const delta = Math.abs(frame.positions[index]! - golden.positions[index]!);

              if (delta > worstPosition) {
                worstPosition = delta;
                worstPositionDetail = `${detail} at position entry ${index}`;
              }
            }

            for (let index = 0; index < golden.shade.length; index += 1) {
              const delta = Math.abs(frame.shade[index]! - golden.shade[index]!);

              if (delta > worstShade) {
                worstShade = delta;
                worstShadeDetail = `${detail} at vertex ${index}`;
              }
            }
          }
        }
      }

      expect(
        worstPosition,
        `${corner}: worst position delta of ${worstPosition} at ${worstPositionDetail}`,
      ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
      expect(
        worstShade,
        `${corner}: worst shade delta of ${worstShade} at ${worstShadeDetail}`,
      ).toBeLessThanOrEqual(SHADE_TOLERANCE);
    });

    /**
     * Requirement 13.6: the public reveal sweep returns the same number of
     * points as the retired L1 sweep, at the same coordinates within `1e-6` CSS
     * pixels, for every corner anchor across `[0, 1]` — including the collapsed
     * polygon at `progress = 0`.
     *
     * Observed worst deviation over this sweep: `1.2e-13` CSS pixels, which is
     * the double-precision difference between `(maxPerp − perp) / maxPerp` and
     * the L1 expression it is algebraically equal to.
     */
    it.each(corners)('reproduces the pre-feature reveal polygon for %s', (corner) => {
      let worst = 0;
      let worstDetail = '';

      for (const [rectLabel, rect] of parityRects) {
        for (const progress of paritySweep) {
          const actual = clipPoints(revealClipPath(rect, corner, progress));
          const golden = clipPoints(preFeatureClipPath(rect, rect, corner, progress));
          const detail = `${corner} on ${rectLabel} at progress ${progress}`;

          expect(actual, `${detail}: point count`).toHaveLength(golden.length);

          for (let index = 0; index < golden.length; index += 1) {
            const landed = toPixels(rect, actual[index]!);
            const expected = toPixels(rect, golden[index]!);
            const delta = Math.max(
              Math.abs(landed.x - expected.x),
              Math.abs(landed.y - expected.y),
            );

            if (delta > worst) {
              worst = delta;
              worstDetail = `${detail} at point ${index}`;
            }
          }
        }
      }

      expect(worst, `${corner}: worst clip delta of ${worst} at ${worstDetail}`).toBeLessThanOrEqual(
        CLIP_TOLERANCE,
      );
    });

    /**
     * The frame's own reveal clip is only ever the collapsed point or the four
     * destination corners — requirement 15.1 keeps reveal progress binary — and
     * both are exact percentages in both versions, so this one is compared as
     * string equality rather than within a budget. A drifting formatter or a
     * reveal keyed off something other than eased progress fails here.
     */
    it.each(corners)('emits the pre-feature frame reveal clip for %s', (corner) => {
      for (const [profileLabel, meshProfile] of parityProfiles) {
        for (const [rectLabel, from, to] of reflectionRectPairs) {
          for (const progress of paritySweep) {
            const frame = buildPaperFrame(from, to, corner, progress, meshProfile);
            const golden = preFeatureFrame(from, to, corner, progress, meshProfile);
            const detail = `${corner} on ${rectLabel} with ${profileLabel} at progress ${progress}`;

            expect(frame.revealClipPath, `${detail}: reveal clip`).toBe(golden.revealClipPath);
          }
        }
      }
    });
  });

  /**
   * Bulge parity across the two axis families.
   *
   * **Validates: Requirement 15.5**
   *
   * `ARC_BULGE` was tuned against a diagonal fold, and requirement 9.11 keeps it
   * at that value. This is the metamorphic check that says it needs no
   * retuning: at the eased midpoint, the peak perpendicular displacement divided
   * by `maxPerp` is the same for a midline fold as for a diagonal one, so a
   * midline fold bulges by the same fraction of its own half-width.
   *
   * Normalizing by `maxPerp` is what makes the two comparable at all — the
   * diagonal family reaches `1 / √2` of the unit square and the midline family
   * `0.5` — and it is the reason one constant serves both. The comparison is
   * made at MATCHED fold coordinates: on an `8 × 8` mesh both families put a
   * vertex on `alongFraction ∈ {0.25, 0.5}` at every multiple of `0.25` of
   * `acrossFold`, so this is a like-for-like comparison rather than a comparison
   * of whatever each family's own grid happens to sample.
   *
   * The displacement is RECOVERED from the published positions rather than
   * recomputed from the deformation formula: undo the depth-driven perspective
   * scale, map back into unit-square coordinates through the base rect, and
   * project onto the fold normal. `positions[z]` is the very depth the scale was
   * built from, so the inversion is exact up to single-precision storage.
   */
  describe('bulge parity across the two axis families', () => {
    /** Mirrors the module-private constants, unchanged by this feature per requirement 9.11. */
    const PERSPECTIVE_STRENGTH = 0.00042;
    const ARC_BULGE = 0.34;

    /**
     * Single-precision positions divided back through the base rect and
     * `maxPerp`: the recovery amplifies one float32 step at the sheet's own
     * magnitude, which lands near `1e-7` for the rects swept here. Observed
     * worst deviations are `2.5e-7` for the cross-section and `8.3e-6` for the
     * recovered bulge coefficient, whose differencing amplifies the same noise
     * by about `9`.
     */
    const DISPLACEMENT_TOLERANCE = 1e-5;
    const BULGE_TOLERANCE = 1e-4;

    /**
     * Fold coordinates are compared as exact multiples of a quarter, so the
     * membership test only has to absorb the rounding of a dot product with
     * `1 / √2`.
     */
    const COORDINATE_EPSILON = 1e-12;

    /**
     * The `8 × 8` mesh is load-bearing, not incidental: it is what puts both
     * families on the same fold coordinates. On the mid cross-section a diagonal
     * anchor samples the vertices with `u + v = 1` and a midline anchor those
     * with `u = 0.5` or `v = 0.5`, and at eight cells per side both land on
     * `acrossFold` at every multiple of `0.25`.
     */
    const bulgeMesh: MotionProfile = { ...profile, meshColumns: 8, meshRows: 8 };

    /**
     * Requirement 15.5 keys off the midpoint of EASED progress, so the cubic
     * ease-out is swept at the raw progress where its output reaches `0.5`
     * rather than at `0.5` itself.
     */
    const easedMidpoints: readonly (readonly [string, MotionProfile, number])[] = [
      ['identity easing at progress 0.5', bulgeMesh, 0.5],
      [
        'a cubic ease-out at its eased midpoint',
        { ...bulgeMesh, easing: (progress: number) => 1 - (1 - progress) ** 3 },
        1 - Math.cbrt(0.5),
      ],
    ];

    /** `[-1, 1]` at every multiple of a quarter: what an 8 × 8 mesh samples on the mid cross-section. */
    const midCrossSectionKeys: readonly number[] = [
      -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1,
    ];

    /**
     * The quarter cross-section is narrower for the diagonal family — the
     * unit square's corners cut it off at `|acrossFold| = 0.5` — so the shared
     * span is the quarters and halves. Zero is excluded because the bulge term
     * vanishes there and the recovery below divides by it.
     */
    const bulgeRecoveryKeys: readonly number[] = [-0.5, -0.25, 0.25, 0.5];

    const normalizedDisplacement = (
      positions: Float32Array,
      base: Rect,
      basis: FoldBasis,
      vertex: number,
    ): number => {
      const centerX = base.left + base.width / 2;
      const centerY = base.top + base.height / 2;
      const depth = positions[vertex * 3 + 2]!;
      const scale = 1 + depth * PERSPECTIVE_STRENGTH;
      const flatX = centerX + (positions[vertex * 3]! - centerX) / scale;
      const flatY = centerY + (positions[vertex * 3 + 1]! - centerY) / scale;
      const turnedU = (flatX - base.left) / base.width;
      const turnedV = (flatY - base.top) / base.height;

      return (
        ((turnedU - basis.origin.x) * basis.normal.x + (turnedV - basis.origin.y) * basis.normal.y) /
        basis.maxPerp
      );
    };

    /**
     * The normalized displacement of every vertex sitting on one cross-section
     * of the fold — the vertices at a given `alongFraction` — keyed by their
     * `acrossFold`. Keying by fold coordinate rather than by mesh index is what
     * lets two anchors with different vertex layouts be compared point for
     * point.
     */
    const crossSection = (
      anchor: GrabAnchor,
      from: Rect,
      to: Rect,
      progress: number,
      meshProfile: MotionProfile,
      alongTarget: number,
    ): Map<number, number> => {
      const basis = foldBasis(anchor);
      const base = baseRectAt(from, to, progress, meshProfile);
      const frame = buildPaperFrame(from, to, anchor, progress, meshProfile);
      const section = new Map<number, number>();

      for (let row = 0; row <= meshProfile.meshRows; row += 1) {
        for (let column = 0; column <= meshProfile.meshColumns; column += 1) {
          const { acrossFold, alongFraction } = foldCoordinates(
            basis,
            column / meshProfile.meshColumns,
            row / meshProfile.meshRows,
          );

          if (Math.abs(alongFraction - alongTarget) > COORDINATE_EPSILON) {
            continue;
          }

          section.set(
            Math.round(acrossFold * 1000) / 1000,
            normalizedDisplacement(
              frame.positions,
              base,
              basis,
              row * (meshProfile.meshColumns + 1) + column,
            ),
          );
        }
      }

      return section;
    };

    const peakOf = (section: Map<number, number>): number =>
      Math.max(...[...section.values()].map((value) => Math.abs(value)));

    const sortedKeys = (section: Map<number, number>): number[] =>
      [...section.keys()].sort((left, right) => left - right);

    it('bulges a midline fold by the same fraction of its half-width as a diagonal fold', () => {
      let worstPointwise = 0;
      let worstPointwiseDetail = '';
      let worstPeak = 0;
      let worstPeakDetail = '';

      for (const [rectLabel, from, to] of reflectionRectPairs) {
        for (const [easingLabel, meshProfile, progress] of easedMidpoints) {
          // `top-right` is the diagonal reference: the family `ARC_BULGE` was
          // tuned against, and the one every other anchor is compared to.
          const reference = crossSection('top-right', from, to, progress, meshProfile, 0.5);
          const referencePeak = peakOf(reference);
          const at = `${rectLabel} under ${easingLabel}`;

          expect(sortedKeys(reference), `${at}: the diagonal reference samples the quarters`).toEqual(
            [...midCrossSectionKeys],
          );
          // Non-vacuity: the cross-section is genuinely displaced at the eased
          // midpoint, so equality below is a statement about a real bulge rather
          // than about two flat sheets. Observed peak: about `0.2246` of
          // `maxPerp`, at the grab anchor and its pivot.
          expect(referencePeak, `${at}: the reference cross-section is displaced`).toBeGreaterThan(
            0.2,
          );

          for (const anchor of allAnchors) {
            const section = crossSection(anchor, from, to, progress, meshProfile, 0.5);
            const detail = `${anchor} on ${at}`;

            expect(sortedKeys(section), `${detail}: samples the same fold coordinates`).toEqual([
              ...midCrossSectionKeys,
            ]);

            for (const across of midCrossSectionKeys) {
              const delta = Math.abs(section.get(across)! - reference.get(across)!);

              if (delta > worstPointwise) {
                worstPointwise = delta;
                worstPointwiseDetail = `${detail} at acrossFold ${across}`;
              }
            }

            const peakDelta = Math.abs(peakOf(section) - referencePeak);

            if (peakDelta > worstPeak) {
              worstPeak = peakDelta;
              worstPeakDetail = detail;
            }
          }
        }
      }

      // Pointwise agreement is the stronger claim and implies the peak one; the
      // peak is asserted separately because it is the quantity requirement 15.5
      // names.
      expect(
        worstPointwise,
        `worst pointwise displacement delta of ${worstPointwise} at ${worstPointwiseDetail}`,
      ).toBeLessThanOrEqual(DISPLACEMENT_TOLERANCE);
      expect(
        worstPeak,
        `worst peak displacement delta of ${worstPeak} at ${worstPeakDetail}`,
      ).toBeLessThanOrEqual(DISPLACEMENT_TOLERANCE);
    });

    /**
     * The same claim with the fold term removed, which is what pins `ARC_BULGE`
     * itself rather than the sum it appears in. The normalized displacement is
     * `acrossFold · cos(localTurn) + ARC_BULGE · lift · sin(π · alongFraction) ·
     * sin(π/2 · acrossFold)`, and `localTurn` carries no `alongFraction` term —
     * so differencing two cross-sections at equal `acrossFold` cancels the fold
     * term exactly and leaves the bulge alone:
     *
     * `(d(0.5, c) − d(0.25, c)) / ((1 − sin(π/4)) · sin(π/2 · c)) = ARC_BULGE · lift`
     *
     * At the eased midpoint `lift` is `1`, so the quotient recovers the shipped
     * constant — for both families, from observed geometry, with no retuning.
     */
    it('recovers the shipped arc bulge from both axis families', () => {
      let worst = 0;
      let worstDetail = '';
      const ridgeAtQuarter = Math.sin(Math.PI * 0.25);

      for (const [rectLabel, from, to] of reflectionRectPairs) {
        for (const [easingLabel, meshProfile, progress] of easedMidpoints) {
          const at = `${rectLabel} under ${easingLabel}`;
          const recovered = new Map<GrabAnchor, Map<number, number>>();

          for (const anchor of allAnchors) {
            const mid = crossSection(anchor, from, to, progress, meshProfile, 0.5);
            const quarter = crossSection(anchor, from, to, progress, meshProfile, 0.25);
            const perAnchor = new Map<number, number>();

            for (const across of bulgeRecoveryKeys) {
              const midValue = mid.get(across);
              const quarterValue = quarter.get(across);
              const detail = `${anchor} on ${at} at acrossFold ${across}`;

              expect(midValue, `${detail}: mid cross-section is sampled`).toBeDefined();
              expect(quarterValue, `${detail}: quarter cross-section is sampled`).toBeDefined();

              const coefficient =
                (midValue! - quarterValue!) /
                ((1 - ridgeAtQuarter) * Math.sin((Math.PI / 2) * across));

              perAnchor.set(across, coefficient);

              const delta = Math.abs(coefficient - ARC_BULGE);

              if (delta > worst) {
                worst = delta;
                worstDetail = `${detail}: recovered ${coefficient}`;
              }
            }

            recovered.set(anchor, perAnchor);
          }

          // Requirement 15.5 states the claim as an equality BETWEEN the two
          // families, so it is also asserted directly rather than only through
          // each family's agreement with the constant.
          for (const across of bulgeRecoveryKeys) {
            const diagonal = recovered.get('top-right')!.get(across)!;

            for (const anchor of ['top-center', 'bottom-center', 'middle-left', 'middle-right'] as const) {
              const midline = recovered.get(anchor)!.get(across)!;

              expect(
                Math.abs(midline - diagonal),
                `${anchor} against top-right on ${at} at acrossFold ${across}: ${midline} against ${diagonal}`,
              ).toBeLessThanOrEqual(BULGE_TOLERANCE);
            }
          }
        }
      }

      expect(
        worst,
        `worst recovered bulge deviation of ${worst} at ${worstDetail}`,
      ).toBeLessThanOrEqual(BULGE_TOLERANCE);
    });
  });
});

/**
 * Property 1: Destination-frame reflection, in uv form.
 *
 * **Validates: Requirements 10.1, 10.2, 10.7, 10.8, 10.9**
 *
 * The sheet carries the destination page on its reverse face, so the back
 * samples the front's coordinate reflected across the fold axis. That makes the
 * uv attribute the unit-square reflection evaluated at every mesh vertex, which
 * is the uv-space statement of the same reflection **P1** states in pixel space.
 *
 * The anchor vocabulary is closed and finite, so all eight anchors are
 * enumerated rather than sampled. Mesh shapes cover an even square, an even
 * rectangle, an odd rectangle, and the smallest legal mesh: requirement 10.8
 * makes evenness irrelevant to this function, because the reflection is defined
 * at every vertex whether or not a vertex happens to land on the anchor itself.
 */
describe('back-face uvs', () => {
  const allAnchors: readonly GrabAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
  ];

  /** Mesh shapes: even square, even rectangle, odd rectangle, smallest legal mesh. */
  const meshes: readonly (readonly [number, number])[] = [
    [4, 4],
    [6, 4],
    [5, 3],
    [1, 1],
  ];

  /**
   * The closed-form reflection per anchor, written from the design's anchor
   * table rather than from anything the module reports. Requirements 10.1 and
   * 10.2 name the two midline forms; the diagonal forms are the reflections
   * about `u = v` and `u + v = 1`.
   */
  const expectedReflection: Record<GrabAnchor, (uv: Point) => Point> = {
    'top-right': (uv) => ({ x: uv.y, y: uv.x }),
    'bottom-left': (uv) => ({ x: uv.y, y: uv.x }),
    'top-left': (uv) => ({ x: 1 - uv.y, y: 1 - uv.x }),
    'bottom-right': (uv) => ({ x: 1 - uv.y, y: 1 - uv.x }),
    'top-center': (uv) => ({ x: uv.x, y: 1 - uv.y }),
    'bottom-center': (uv) => ({ x: uv.x, y: 1 - uv.y }),
    'middle-left': (uv) => ({ x: 1 - uv.x, y: uv.y }),
    'middle-right': (uv) => ({ x: 1 - uv.x, y: uv.y }),
  };

  /**
   * The two anchors sitting on the endpoints of each fold axis. For the
   * diagonal family these are the two corners flanking the grabbed diagonal;
   * for the midline family they are edge midpoints, which is why an even mesh
   * is required to address them at all.
   */
  const foldAxisEndpoints: Record<GrabAnchor, readonly [GrabAnchor, GrabAnchor]> = {
    'top-right': ['top-left', 'bottom-right'],
    'bottom-left': ['top-left', 'bottom-right'],
    'top-left': ['bottom-left', 'top-right'],
    'bottom-right': ['bottom-left', 'top-right'],
    'top-center': ['middle-left', 'middle-right'],
    'bottom-center': ['middle-left', 'middle-right'],
    'middle-left': ['top-center', 'bottom-center'],
    'middle-right': ['top-center', 'bottom-center'],
  };

  const readUv = (
    uvs: Float32Array,
    anchor: GrabAnchor,
    columns: number,
    rows: number,
  ): [number, number] => {
    const index = vertexIndex(anchor, columns, rows) * 2;
    return [uvs[index]!, uvs[index + 1]!];
  };

  it.each(allAnchors)('sizes the attribute to the mesh for %s', (anchor) => {
    for (const [columns, rows] of meshes) {
      const uvs = backFaceUvs(anchor, columns, rows);

      expect(uvs).toHaveLength((columns + 1) * (rows + 1) * 2);
      for (const value of uvs) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it.each([
    ['top-right', 'bottom-left'],
    ['bottom-left', 'top-right'],
    ['top-left', 'bottom-right'],
    ['bottom-right', 'top-left'],
    ['top-center', 'bottom-center'],
    ['bottom-center', 'top-center'],
    ['middle-left', 'middle-right'],
    ['middle-right', 'middle-left'],
  ] as const)('mirrors the %s anchor onto %s', (grabbed, mirrored) => {
    const uvs = backFaceUvs(grabbed, 4, 4);
    const [u, v] = readUv(uvs, grabbed, 4, 4);
    const expected = anchorUv[mirrored];

    expect(u).toBeCloseTo(expected.x, 6);
    expect(v).toBeCloseTo(expected.y, 6);
  });

  /**
   * Replaces the earlier "holds the fold-axis corners still" assertion, which
   * was a corner-fold-only claim: under a `top-center` fold the `top-left` uv
   * maps to `bottom-left`, not to itself. What holds still is the pair of
   * anchors on the fold axis, and for a midline fold those are edge midpoints.
   */
  it.each(allAnchors)('holds the fold-axis endpoints still for %s', (anchor) => {
    const uvs = backFaceUvs(anchor, 4, 4);

    for (const endpoint of foldAxisEndpoints[anchor]) {
      const [u, v] = readUv(uvs, endpoint, 4, 4);

      expect(u).toBeCloseTo(anchorUv[endpoint].x, 6);
      expect(v).toBeCloseTo(anchorUv[endpoint].y, 6);
    }
  });

  it.each(allAnchors)('maps every vertex through the closed form for %s', (anchor) => {
    const reflect = expectedReflection[anchor];

    for (const [columns, rows] of meshes) {
      const uvs = backFaceUvs(anchor, columns, rows);

      for (let row = 0; row <= rows; row += 1) {
        for (let column = 0; column <= columns; column += 1) {
          // Indexing row-major asserts front-face vertex order as well as the
          // reflection: a transposed or shifted layout fails here.
          const index = (row * (columns + 1) + column) * 2;
          const expected = reflect({ x: column / columns, y: row / rows });

          expect(uvs[index]!).toBeCloseTo(expected.x, 6);
          expect(uvs[index + 1]!).toBeCloseTo(expected.y, 6);
        }
      }
    }
  });

  it.each(allAnchors)('is its own inverse for %s', (anchor) => {
    // On a square mesh the reflection permutes the vertex grid for both axis
    // families, so each back-face coordinate is itself a grid vertex and the
    // attribute can be re-indexed by its own output. That makes this the
    // computation applied to its own result, not a restatement of the table.
    for (const dimension of [4, 6]) {
      const uvs = backFaceUvs(anchor, dimension, dimension);

      for (let row = 0; row <= dimension; row += 1) {
        for (let column = 0; column <= dimension; column += 1) {
          const index = (row * (dimension + 1) + column) * 2;
          const mappedColumn = uvs[index]! * dimension;
          const mappedRow = uvs[index + 1]! * dimension;

          expect(mappedColumn).toBeCloseTo(Math.round(mappedColumn), 6);
          expect(mappedRow).toBeCloseTo(Math.round(mappedRow), 6);

          const reapplied = (Math.round(mappedRow) * (dimension + 1) + Math.round(mappedColumn)) * 2;

          expect(uvs[reapplied]!).toBeCloseTo(column / dimension, 6);
          expect(uvs[reapplied + 1]!).toBeCloseTo(row / dimension, 6);
        }
      }
    }
  });

  it.each(allAnchors)(
    'stays inside the unit square for %s so the back never samples outside the page',
    (anchor) => {
      for (const [columns, rows] of meshes) {
        for (const value of backFaceUvs(anchor, columns, rows)) {
          expect(value).toBeGreaterThanOrEqual(-1e-6);
          expect(value).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    },
  );

  it.each(allAnchors)('rejects a degenerate mesh for %s by naming the dimension', (anchor) => {
    expect(() => backFaceUvs(anchor, 0, 3)).toThrow(/columns/);
    expect(() => backFaceUvs(anchor, 3, 0)).toThrow(/rows/);
    expect(() => backFaceUvs(anchor, 4.5, 4)).toThrow(/columns/);
    expect(() => backFaceUvs(anchor, 4, Number.NaN)).toThrow(/rows/);
    expect(() => backFaceUvs(anchor, 0, 3)).toThrow(/greater than or equal to 1/);
  });
});

/**
 * Property 13: Opposite is an involution and family-preserving.
 *
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**
 *
 * Enumerates all eight anchors exhaustively — the vocabulary is closed and
 * finite, so there is nothing to sample.
 */
describe('opposite anchors and fold axes', () => {
  const TOLERANCE = 1e-6;

  const cornerFamily: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const edgeMidpointFamily: readonly EdgeMidpoint[] = [
    'top-center',
    'middle-right',
    'bottom-center',
    'middle-left',
  ];
  const anchors: readonly GrabAnchor[] = [...cornerFamily, ...edgeMidpointFamily];

  /**
   * Expected unit-square coordinates, written independently of `anchorUv` from
   * requirement 1.2 so the table is checked rather than restated.
   */
  const expectedUv: Record<GrabAnchor, Point> = {
    'top-left': { x: 0, y: 0 },
    'top-center': { x: 0.5, y: 0 },
    'top-right': { x: 1, y: 0 },
    'middle-right': { x: 1, y: 0.5 },
    'bottom-right': { x: 1, y: 1 },
    'bottom-center': { x: 0.5, y: 1 },
    'bottom-left': { x: 0, y: 1 },
    'middle-left': { x: 0, y: 0.5 },
  };

  /**
   * Expected fold axis per requirements 9.2 through 9.5. Endpoints are recorded
   * as an unordered pair: which endpoint the module names `origin` is
   * immaterial to every downstream computation, so the assertions below compare
   * the pair as a set.
   */
  const expectedFoldAxis: Record<GrabAnchor, FoldAxis> = {
    'top-right': { kind: 'diagonal', origin: { x: 0, y: 0 }, far: { x: 1, y: 1 } },
    'bottom-left': { kind: 'diagonal', origin: { x: 0, y: 0 }, far: { x: 1, y: 1 } },
    'top-left': { kind: 'diagonal', origin: { x: 0, y: 1 }, far: { x: 1, y: 0 } },
    'bottom-right': { kind: 'diagonal', origin: { x: 0, y: 1 }, far: { x: 1, y: 0 } },
    'top-center': { kind: 'midline', origin: { x: 0, y: 0.5 }, far: { x: 1, y: 0.5 } },
    'bottom-center': { kind: 'midline', origin: { x: 0, y: 0.5 }, far: { x: 1, y: 0.5 } },
    'middle-left': { kind: 'midline', origin: { x: 0.5, y: 0 }, far: { x: 0.5, y: 1 } },
    'middle-right': { kind: 'midline', origin: { x: 0.5, y: 0 }, far: { x: 0.5, y: 1 } },
  };

  /**
   * The fold-axis table is module-private, so the axis is recovered from the
   * only thing the module reports about it: the fold basis. `origin` is an
   * endpoint by construction and the far endpoint is `origin + axis ·
   * axisLength`; the kind follows from `axisLength`, which is `√2` for the
   * diagonal family and `1` for the midline family (requirement 9.7).
   */
  const resolvedFoldAxis = (anchor: GrabAnchor): FoldAxis => {
    const basis = foldBasis(anchor);
    const kind: FoldAxisKind =
      Math.abs(basis.axisLength - Math.SQRT2) <= TOLERANCE ? 'diagonal' : 'midline';

    return {
      kind,
      origin: { x: basis.origin.x, y: basis.origin.y },
      far: {
        x: basis.origin.x + basis.axis.x * basis.axisLength,
        y: basis.origin.y + basis.axis.y * basis.axisLength,
      },
    };
  };

  const sameEndpoints = (left: FoldAxis, right: FoldAxis): boolean => {
    const near = (a: Point, b: Point): boolean =>
      Math.abs(a.x - b.x) <= TOLERANCE && Math.abs(a.y - b.y) <= TOLERANCE;

    return (
      (near(left.origin, right.origin) && near(left.far, right.far)) ||
      (near(left.origin, right.far) && near(left.far, right.origin))
    );
  };

  it.each(anchors)('is an involution at %s', (anchor) => {
    expect(oppositeAnchor(oppositeAnchor(anchor))).toBe(anchor);
  });

  it.each(anchors)('never leaves the anchor vocabulary from %s', (anchor) => {
    expect(anchors).toContain(oppositeAnchor(anchor));
    expect(oppositeAnchor(anchor)).not.toBe(anchor);
  });

  it.each(cornerFamily)('keeps the corner %s inside the corner family', (corner) => {
    expect(cornerFamily).toContain(oppositeAnchor(corner));
  });

  it.each(edgeMidpointFamily)('keeps the edge midpoint %s inside its own family', (midpoint) => {
    expect(edgeMidpointFamily).toContain(oppositeAnchor(midpoint));
  });

  it('splits the eight anchors into two disjoint families that cover the vocabulary', () => {
    const corners = new Set<GrabAnchor>(cornerFamily);
    const midpoints = new Set<GrabAnchor>(edgeMidpointFamily);

    expect(corners.size + midpoints.size).toBe(anchors.length);
    expect([...corners].filter((anchor) => midpoints.has(anchor))).toEqual([]);
    expect(new Set([...corners, ...midpoints]).size).toBe(anchors.length);
  });

  it.each(anchors)('reflects %s through the rectangle center', (anchor) => {
    const uv = anchorUv[anchor];
    const oppositeUv = anchorUv[oppositeAnchor(anchor)];

    expect(uv).toEqual(expectedUv[anchor]);
    expect(oppositeUv.x).toBeCloseTo(1 - uv.x, 6);
    expect(oppositeUv.y).toBeCloseTo(1 - uv.y, 6);
  });

  it.each(anchors)('resolves the fold axis recorded for %s', (anchor) => {
    const resolved = resolvedFoldAxis(anchor);
    const expected = expectedFoldAxis[anchor];

    expect(resolved.kind).toBe(expected.kind);
    expect(sameEndpoints(resolved, expected)).toBe(true);
  });

  it.each(anchors)('shares one fold axis between %s and its pivot', (anchor) => {
    const opposite = oppositeAnchor(anchor);
    const grabbedAxis = resolvedFoldAxis(anchor);
    const pivotAxis = resolvedFoldAxis(opposite);

    expect(pivotAxis.kind).toBe(grabbedAxis.kind);
    // The pair shares a single table row, so the endpoints are not merely near
    // each other, they are the same numbers.
    expect(pivotAxis.origin).toEqual(grabbedAxis.origin);
    expect(pivotAxis.far).toEqual(grabbedAxis.far);
    expect(sameEndpoints(pivotAxis, grabbedAxis)).toBe(true);
  });

  it.each(anchors)('negates the fold normal between %s and its pivot', (anchor) => {
    const grabbed = foldBasis(anchor);
    const pivot = foldBasis(oppositeAnchor(anchor));

    expect(pivot.normal.x).toBeCloseTo(-grabbed.normal.x, 6);
    expect(pivot.normal.y).toBeCloseTo(-grabbed.normal.y, 6);
    expect(Math.hypot(grabbed.normal.x, grabbed.normal.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(pivot.normal.x, pivot.normal.y)).toBeCloseTo(1, 6);
    // A shared axis with opposite normals is exactly what lets one table row
    // serve both members of the pair.
    expect(Math.abs(pivot.axisLength - grabbed.axisLength)).toBeLessThanOrEqual(TOLERANCE);
  });
});

/**
 * Fold-basis postconditions, over the closed eight-value anchor domain.
 *
 * Requirements 9.7, 9.8, 9.9, 9.13, 9.14, 9.15. The domain is finite and
 * exhaustively enumerated, so these are example tests rather than a property:
 * there is no larger input space to sample.
 */
describe('fold basis postconditions', () => {
  const TOLERANCE = 1e-6;
  /** Requirement 9.9 states its agreement bound in CSS pixels, not unit space. */
  const PIXEL_TOLERANCE = 1e-4;

  const allAnchors: readonly GrabAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
  ];

  const expectedKind: Record<GrabAnchor, FoldAxisKind> = {
    'top-left': 'diagonal',
    'top-right': 'diagonal',
    'bottom-right': 'diagonal',
    'bottom-left': 'diagonal',
    'top-center': 'midline',
    'bottom-center': 'midline',
    'middle-left': 'midline',
    'middle-right': 'midline',
  };

  /**
   * Signed distance from each anchor's fold line, written from the design's
   * line equations rather than from anything the module reports: `u = v` and
   * `u + v = 1` for the diagonal family, `v = 0.5` and `u = 0.5` for the
   * midline family.
   */
  const signedDistanceToFoldLine: Record<GrabAnchor, (point: Point) => number> = {
    'top-right': (point) => (point.x - point.y) / Math.SQRT2,
    'bottom-left': (point) => (point.x - point.y) / Math.SQRT2,
    'top-left': (point) => (point.x + point.y - 1) / Math.SQRT2,
    'bottom-right': (point) => (point.x + point.y - 1) / Math.SQRT2,
    'top-center': (point) => point.y - 0.5,
    'bottom-center': (point) => point.y - 0.5,
    'middle-left': (point) => point.x - 0.5,
    'middle-right': (point) => point.x - 0.5,
  };

  /** The closed-form reflection recorded for each anchor in the design's anchor table. */
  const expectedReflection: Record<GrabAnchor, (point: Point) => Point> = {
    'top-left': (point) => ({ x: 1 - point.y, y: 1 - point.x }),
    'bottom-right': (point) => ({ x: 1 - point.y, y: 1 - point.x }),
    'top-right': (point) => ({ x: point.y, y: point.x }),
    'bottom-left': (point) => ({ x: point.y, y: point.x }),
    'top-center': (point) => ({ x: point.x, y: 1 - point.y }),
    'bottom-center': (point) => ({ x: point.x, y: 1 - point.y }),
    'middle-left': (point) => ({ x: 1 - point.x, y: point.y }),
    'middle-right': (point) => ({ x: 1 - point.x, y: point.y }),
  };

  /** Anchors, the center, the edge quarters, and a few points on no symmetry line. */
  const samplePoints: readonly Point[] = [
    ...allAnchors.map((anchor) => anchorUv[anchor]),
    { x: 0.5, y: 0.5 },
    { x: 0.25, y: 0.75 },
    { x: 0.13, y: 0.87 },
    { x: 0.9, y: 0.1 },
    { x: 0.37, y: 0.42 },
    { x: 0.61, y: 0.08 },
  ];

  const progressSweep: readonly number[] = [0, 0.05, 0.17, 0.25, 0.4, 0.5, 0.63, 0.75, 0.9, 0.99, 1];

  const expectedAxisLength = (anchor: GrabAnchor): number =>
    expectedKind[anchor] === 'diagonal' ? Math.SQRT2 : 1;

  const expectedMaxPerp = (anchor: GrabAnchor): number =>
    expectedKind[anchor] === 'diagonal' ? 1 / Math.SQRT2 : 0.5;

  const farEndpoint = (basis: FoldBasis): Point => ({
    x: basis.origin.x + basis.axis.x * basis.axisLength,
    y: basis.origin.y + basis.axis.y * basis.axisLength,
  });

  /** The reflection requirement 9.8 names: `p ↦ p − 2 · ((p − origin) · normal) · normal`. */
  const reflectThroughFold = (basis: FoldBasis, point: Point): Point => {
    const perp =
      (point.x - basis.origin.x) * basis.normal.x + (point.y - basis.origin.y) * basis.normal.y;

    return {
      x: point.x - 2 * perp * basis.normal.x,
      y: point.y - 2 * perp * basis.normal.y,
    };
  };

  /**
   * The same fold basis with its two endpoints exchanged: `far` becomes the
   * origin and the axis reverses. The normal is re-derived by the module's own
   * rule — orient toward the grab anchor — because that is what a swapped table
   * row would produce.
   *
   * `FOLD_AXIS` is module-private and frozen, so the swap cannot be injected
   * into `geometry.ts`; it is constructed here from the basis the module
   * reports, whose `origin` is one endpoint and whose `axis · axisLength`
   * reaches the other.
   */
  const endpointSwappedBasis = (anchor: GrabAnchor): FoldBasis => {
    const canonical = foldBasis(anchor);
    const origin = farEndpoint(canonical);
    const axis = { x: -canonical.axis.x, y: -canonical.axis.y };
    const grabbedUv = anchorUv[anchor];
    const toGrabbed = { x: grabbedUv.x - origin.x, y: grabbedUv.y - origin.y };
    const candidate = { x: -axis.y, y: axis.x };
    const normal =
      candidate.x * toGrabbed.x + candidate.y * toGrabbed.y >= 0
        ? candidate
        : { x: axis.y, y: -axis.x };

    return {
      origin,
      axis,
      normal,
      axisLength: canonical.axisLength,
      maxPerp: normal.x * toGrabbed.x + normal.y * toGrabbed.y,
    };
  };

  /**
   * The deformation body of `buildPaperFrame`, parameterized on the basis so a
   * swapped basis can be driven through it. `buildPaperFrame` reads the basis
   * from the private table and cannot be handed one, so the body is restated
   * here; the first assertion of the endpoint-swap test compares this restatement
   * against the real `buildPaperFrame` output, which is what keeps the two from
   * drifting apart.
   *
   * These three constants mirror the module-private constants of the same names.
   */
  const PERSPECTIVE_STRENGTH = 0.00042;
  const ARC_BULGE = 0.34;

  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

  const positionsFromBasis = (basis: FoldBasis, progress: number): Float32Array => {
    const eased = clamp01(profile.easing(clamp01(progress)));
    const baseRect: Rect = {
      left: source.left + (destination.left - source.left) * eased,
      top: source.top + (destination.top - source.top) * eased,
      width: source.width + (destination.width - source.width) * eased,
      height: source.height + (destination.height - source.height) * eased,
    };
    const positions = new Float32Array((profile.meshColumns + 1) * (profile.meshRows + 1) * 3);
    const turn = Math.PI * eased;
    const lift = Math.sin(turn);
    const centerX = baseRect.left + baseRect.width / 2;
    const centerY = baseRect.top + baseRect.height / 2;

    for (let row = 0; row <= profile.meshRows; row += 1) {
      const v = row / profile.meshRows;

      for (let column = 0; column <= profile.meshColumns; column += 1) {
        const u = column / profile.meshColumns;
        const index = row * (profile.meshColumns + 1) + column;
        const offsetX = u - basis.origin.x;
        const offsetY = v - basis.origin.y;
        const along = offsetX * basis.axis.x + offsetY * basis.axis.y;
        const perp = offsetX * basis.normal.x + offsetY * basis.normal.y;
        const acrossFold = perp / basis.maxPerp;
        const localTurn = turn + profile.foldSoftness * lift * acrossFold;
        const localCos = Math.cos(localTurn);
        const localSin = Math.sin(localTurn);
        const ridge = Math.sin(Math.PI * clamp01(along / basis.axisLength));
        const bulge =
          basis.maxPerp * ARC_BULGE * lift * ridge * Math.sin((Math.PI / 2) * acrossFold);
        const turnedPerp = perp * localCos + bulge;
        const turnedU = basis.origin.x + along * basis.axis.x + turnedPerp * basis.normal.x;
        const turnedV = basis.origin.y + along * basis.axis.y + turnedPerp * basis.normal.y;
        const depth =
          acrossFold * localSin * profile.bendDepth + profile.edgeCurvature * localSin * ridge;
        const scale = 1 + depth * PERSPECTIVE_STRENGTH;
        const flatX = baseRect.left + turnedU * baseRect.width;
        const flatY = baseRect.top + turnedV * baseRect.height;

        positions[index * 3] = centerX + (flatX - centerX) * scale;
        positions[index * 3 + 1] = centerY + (flatY - centerY) * scale;
        positions[index * 3 + 2] = depth;
      }
    }

    return positions;
  };

  const maxComponentDelta = (left: Float32Array, right: Float32Array): number => {
    expect(right).toHaveLength(left.length);

    let worst = 0;

    for (let index = 0; index < left.length; index += 1) {
      worst = Math.max(worst, Math.abs(left[index]! - right[index]!));
    }

    return worst;
  };

  it.each(allAnchors)('returns an orthonormal axis and normal for %s', (anchor) => {
    const basis = foldBasis(anchor);

    expect(Math.abs(Math.hypot(basis.axis.x, basis.axis.y) - 1)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(Math.hypot(basis.normal.x, basis.normal.y) - 1)).toBeLessThanOrEqual(TOLERANCE);
    expect(
      Math.abs(basis.axis.x * basis.normal.x + basis.axis.y * basis.normal.y),
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  it.each(allAnchors)('places both fold-axis endpoints on the fold line for %s', (anchor) => {
    const basis = foldBasis(anchor);
    const distance = signedDistanceToFoldLine[anchor];

    expect(Math.abs(distance(basis.origin))).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(distance(farEndpoint(basis)))).toBeLessThanOrEqual(TOLERANCE);
    // The axis runs along the line, so stepping any distance along it stays on it.
    expect(
      Math.abs(distance({ x: basis.origin.x + 0.37 * basis.axis.x, y: basis.origin.y + 0.37 * basis.axis.y })),
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  it.each(allAnchors)('reports the axis length and perpendicular reach of %s', (anchor) => {
    const basis = foldBasis(anchor);

    expect(Math.abs(basis.axisLength - expectedAxisLength(anchor))).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(basis.maxPerp - expectedMaxPerp(anchor))).toBeLessThanOrEqual(TOLERANCE);
  });

  it.each(allAnchors)('orients the normal toward the grab anchor %s', (anchor) => {
    const basis = foldBasis(anchor);
    const grabbedUv = anchorUv[anchor];
    const toGrabbed = { x: grabbedUv.x - basis.origin.x, y: grabbedUv.y - basis.origin.y };
    const reach = basis.normal.x * toGrabbed.x + basis.normal.y * toGrabbed.y;

    expect(Math.abs(reach - basis.maxPerp)).toBeLessThanOrEqual(TOLERANCE);
    // A normal pointed away from the grab anchor would give a negative reach and
    // flip the sign of `acrossFold` for the whole grabbed half.
    expect(reach).toBeGreaterThan(0);
  });

  it.each(allAnchors)('induces the closed-form reflection recorded for %s', (anchor) => {
    const basis = foldBasis(anchor);
    const reflection = expectedReflection[anchor];

    for (const point of samplePoints) {
      const actual = reflectThroughFold(basis, point);
      const expected = reflection(point);

      expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it.each(allAnchors)('exchanges the grab anchor and its pivot under reflection for %s', (anchor) => {
    const basis = foldBasis(anchor);
    const reflected = reflectThroughFold(basis, anchorUv[anchor]);
    const pivotUv = anchorUv[oppositeAnchor(anchor)];

    expect(Math.abs(reflected.x - pivotUv.x)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(reflected.y - pivotUv.y)).toBeLessThanOrEqual(TOLERANCE);
  });

  /**
   * `buildPaperFrame` still takes a `Corner`; it widens to `GrabAnchor` later in
   * the plan. Until then the real deformation can only be driven for the four
   * corners, which is enough to anchor the restated body above — the body itself
   * reads nothing but the basis, so the midline family exercises it through
   * `positionsFromBasis` alone.
   */
  const asCornerOrNull = (anchor: GrabAnchor): Corner | null =>
    (corners as readonly GrabAnchor[]).includes(anchor) ? (anchor as Corner) : null;

  it.each(allAnchors)('is unchanged by exchanging the fold-axis endpoints for %s', (anchor) => {
    const canonical = foldBasis(anchor);
    const swapped = endpointSwappedBasis(anchor);
    const corner = asCornerOrNull(anchor);

    // The swap is a genuine exchange, not a no-op: the origin moves to the far
    // endpoint and the axis reverses, while the line, its normal, and the
    // perpendicular reach are untouched.
    expect(swapped.origin).not.toEqual(canonical.origin);
    expect(swapped.axis.x).toBeCloseTo(-canonical.axis.x, 12);
    expect(swapped.axis.y).toBeCloseTo(-canonical.axis.y, 12);
    expect(swapped.normal.x).toBeCloseTo(canonical.normal.x, 12);
    expect(swapped.normal.y).toBeCloseTo(canonical.normal.y, 12);
    expect(swapped.maxPerp).toBeCloseTo(canonical.maxPerp, 12);

    for (const progress of progressSweep) {
      const canonicalPositions = positionsFromBasis(canonical, progress);

      if (corner !== null) {
        // Guard: the restated deformation body reproduces the real one exactly
        // when handed the module's own basis, so the comparison below is a
        // statement about the endpoints and nothing else.
        const frame = buildPaperFrame(source, destination, corner, progress, profile);

        expect(maxComponentDelta(frame.positions, canonicalPositions)).toBe(0);
      }

      expect(
        maxComponentDelta(canonicalPositions, positionsFromBasis(swapped, progress)),
      ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    }
  });

  it.each(allAnchors)('returns component-for-component equal values on every call for %s', (anchor) => {
    const uvBefore = { ...anchorUv[anchor] };
    const first = foldBasis(anchor);
    const second = foldBasis(anchor);

    expect(second).toEqual(first);
    // Each call hands back its own object graph, so a caller scribbling on one
    // basis cannot reach the module's frozen table or another caller's copy.
    expect(second).not.toBe(first);
    expect(second.origin).not.toBe(first.origin);
    expect(second.axis).not.toBe(first.axis);
    expect(second.normal).not.toBe(first.normal);

    first.origin.x = 42;
    first.axis.x = 42;
    first.normal.y = 42;

    expect(foldBasis(anchor)).toEqual(second);
    expect(anchorUv[anchor]).toEqual(uvBefore);
  });

  it('leaves every supplied value unmutated while building frames', () => {
    const suppliedSource: Rect = { ...source };
    const suppliedDestination: Rect = { ...destination };
    const suppliedProfile: MotionProfile = { ...profile };

    for (const corner of corners) {
      for (const progress of progressSweep) {
        buildPaperFrame(suppliedSource, suppliedDestination, corner, progress, suppliedProfile);
      }
    }

    expect(suppliedSource).toEqual(source);
    expect(suppliedDestination).toEqual(destination);
    expect(suppliedProfile).toEqual(profile);
  });

  it.each(allAnchors)('constructs a fold basis without throwing for %s', (anchor) => {
    expect(() => foldBasis(anchor)).not.toThrow();
  });
});

/**
 * Property 14: Even-mesh validation fails loudly.
 *
 * **Validates: Requirements 12.1, 12.2, 12.5, 12.6, 12.7, 12.9, 12.10**
 *
 * Both halves of the constraint are enumerated rather than sampled: the odd/even
 * mesh dimensions that matter are small integers, and the anchor vocabulary is a
 * closed set of eight. `validateProfile` is module-private, so the profile half of
 * the property is exercised through `buildPaperFrame`, which is the only public
 * entry that runs it.
 */
describe('even-mesh validation', () => {
  const evenDimensions: readonly number[] = [2, 4, 6, 8];
  const oddDimensions: readonly number[] = [1, 3, 5, 7, 9];

  const cornerAnchors: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const edgeMidpoints: readonly EdgeMidpoint[] = [
    'top-center',
    'middle-right',
    'bottom-center',
    'middle-left',
  ];
  const everyAnchor: readonly GrabAnchor[] = [...cornerAnchors, ...edgeMidpoints];

  /**
   * The half-step lives on whichever axis carries the midpoint's `0.5`, so that is
   * the dimension whose odd value has to be rejected by name.
   */
  const halfStepAxis: Record<EdgeMidpoint, 'columns' | 'rows'> = {
    'top-center': 'columns',
    'bottom-center': 'columns',
    'middle-left': 'rows',
    'middle-right': 'rows',
  };

  const buildWithMesh = (meshColumns: number, meshRows: number): void => {
    buildPaperFrame(source, destination, 'top-right', 0.5, {
      ...profile,
      meshColumns,
      meshRows,
    });
  };

  const messageOf = (build: () => void): string => {
    try {
      build();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    throw new Error('Expected the supplied profile to be rejected, but it was accepted.');
  };

  it.each(oddDimensions)('rejects an odd meshColumns of %i by name', (meshColumns) => {
    const message = messageOf(() => {
      buildWithMesh(meshColumns, 4);
    });

    expect(message).toContain('profile.meshColumns');
    expect(message).not.toContain('profile.meshRows');
    expect(message).toContain('even');
  });

  it.each(oddDimensions)('rejects an odd meshRows of %i by name', (meshRows) => {
    const message = messageOf(() => {
      buildWithMesh(4, meshRows);
    });

    expect(message).toContain('profile.meshRows');
    expect(message).not.toContain('profile.meshColumns');
    expect(message).toContain('even');
  });

  it('names both mesh fields when both are odd', () => {
    for (const meshColumns of oddDimensions) {
      for (const meshRows of oddDimensions) {
        const message = messageOf(() => {
          buildWithMesh(meshColumns, meshRows);
        });

        expect(message).toContain('profile.meshColumns');
        expect(message).toContain('profile.meshRows');
      }
    }
  });

  it.each([
    ['profile.meshColumns', { meshColumns: 0 }],
    ['profile.meshColumns', { meshColumns: -2 }],
    ['profile.meshColumns', { meshColumns: 1.5 }],
    ['profile.meshRows', { meshRows: 0 }],
    ['profile.meshRows', { meshRows: -2 }],
    ['profile.meshRows', { meshRows: 2.5 }],
  ] as const)('still reports %s as a positive-integer failure, not an evenness failure', (field, overrides) => {
    const message = messageOf(() => {
      buildPaperFrame(source, destination, 'top-right', 0.5, { ...profile, ...overrides });
    });

    expect(message).toContain(field);
    expect(message).toContain('greater than or equal to 1');
    expect(message).not.toContain('even');
  });

  it.each([
    ['profile.meshColumns', { meshColumns: NaN }],
    ['profile.meshColumns', { meshColumns: Infinity }],
    ['profile.meshRows', { meshRows: -Infinity }],
    ['profile.meshRows', { meshRows: NaN }],
  ] as const)('still reports %s as a finiteness failure, not an evenness failure', (field, overrides) => {
    const message = messageOf(() => {
      buildPaperFrame(source, destination, 'top-right', 0.5, { ...profile, ...overrides });
    });

    expect(message).toContain(field);
    expect(message).toContain('finite');
    expect(message).not.toContain('even');
  });

  it('accepts the shipped even mesh dimensions for every anchor', () => {
    for (const meshColumns of evenDimensions) {
      for (const meshRows of evenDimensions) {
        expect(() => {
          buildWithMesh(meshColumns, meshRows);
        }).not.toThrow();
      }
    }
  });

  it.each(everyAnchor)('addresses an in-range integer vertex for %s at even dimensions', (anchor) => {
    for (const columns of evenDimensions) {
      for (const rows of evenDimensions) {
        const index = vertexIndex(anchor, columns, rows);
        const uv = anchorUv[anchor];

        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan((columns + 1) * (rows + 1));
        expect(index).toBe(uv.y * rows * (columns + 1) + uv.x * columns);
      }
    }
  });

  it.each(edgeMidpoints)('rejects the unrepresentable half-step for %s by anchor and dimension', (anchor) => {
    const axis = halfStepAxis[anchor];

    for (const odd of oddDimensions) {
      const columns = axis === 'columns' ? odd : 4;
      const rows = axis === 'rows' ? odd : 4;
      const message = messageOf(() => {
        vertexIndex(anchor, columns, rows);
      });

      expect(message).toContain(anchor);
      expect(message).toContain(axis);
    }
  });

  it.each(edgeMidpoints)('leaves the axis without a half-step representable for %s', (anchor) => {
    // Only the axis carrying the `0.5` is unrepresentable: the other stays exact at
    // any positive integer, so the rejection is narrow rather than blanket.
    const exactAxis = halfStepAxis[anchor] === 'columns' ? 'rows' : 'columns';

    for (const odd of oddDimensions) {
      const columns = exactAxis === 'columns' ? odd : 4;
      const rows = exactAxis === 'rows' ? odd : 4;

      expect(() => vertexIndex(anchor, columns, rows)).not.toThrow();
    }
  });

  it.each(cornerAnchors)('addresses a vertex for %s at odd dimensions too', (anchor) => {
    for (const columns of oddDimensions) {
      for (const rows of oddDimensions) {
        const index = vertexIndex(anchor, columns, rows);

        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan((columns + 1) * (rows + 1));
      }
    }
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    'rejects a columns of %s by name for every anchor',
    (columns) => {
      for (const anchor of everyAnchor) {
        const message = messageOf(() => {
          vertexIndex(anchor, columns, 4);
        });

        expect(message).toContain('columns');
        expect(message).not.toContain('rows');
      }
    },
  );

  it.each([0, -1, 2.5, NaN, Infinity, -Infinity])(
    'rejects a rows of %s by name for every anchor',
    (rows) => {
      for (const anchor of everyAnchor) {
        const message = messageOf(() => {
          vertexIndex(anchor, 4, rows);
        });

        expect(message).toContain('rows');
        expect(message).not.toContain('columns');
      }
    },
  );
});

/**
 * Property 12: Reveal sweep is total and monotone.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10**
 *
 * The anchor vocabulary is a closed set of eight, so it is enumerated rather
 * than sampled; progress is swept densely across `(0, 1]` with the interval
 * `(0, 0.25)` deliberately over-sampled for the edge-midpoint family. That
 * interval is where the retired `|u − gx| + |v − gy|` metric left every rect
 * corner outside the front for a midline anchor and emitted `polygon()` with no
 * points at all, which is not a valid CSS value — so it is exactly where a
 * regression would land.
 *
 * `frontDistance` is module-private, so the metric requirement 13.1 defines is
 * reconstructed here from the public `foldBasis`, which is the only input the
 * definition names. Every claim about the *sweep* is then made against the
 * polygon `revealClipPath` actually returns.
 */
describe('reveal sweep', () => {
  /** Requirements 13.6 and 13.12 state their bounds in CSS pixels. */
  const TOLERANCE = 1e-6;
  const POLYGON_BODY = /^polygon\((.*)\)$/;
  const WHITESPACE = /\s+/;

  const allAnchors: readonly GrabAnchor[] = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
  ];

  const edgeMidpoints: readonly EdgeMidpoint[] = [
    'top-center',
    'middle-right',
    'bottom-center',
    'middle-left',
  ];

  /** Winding order of the four true corners, which is what the polygon is built from. */
  const cornerOrder: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

  /**
   * Two non-square rects, one wide and one tall, with one placed at a negative
   * left so the percentage round trip cannot be passing by way of a zero origin.
   */
  const sweepRects: readonly Rect[] = [
    { left: 24, top: 48, width: 900, height: 620 },
    { left: -40, top: 15, width: 320, height: 1180 },
  ];

  /** Dense sweep of `(0, 1]`, with `(0, 0.25)` carrying a third of the samples. */
  const denseSweep: readonly number[] = [
    0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.24, 0.25, 0.27, 0.3,
    0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99, 1,
  ];

  /** The same sweep with the collapsed endpoint prepended, for the monotonicity chain. */
  const monotoneSweep: readonly number[] = [0, ...denseSweep];

  /**
   * The two anchors on the endpoints of each fold axis. Requirement 13.1 fixes
   * the front distance at exactly `1` there, so at `progress = 0.5` — where the
   * threshold is exactly `1` — the reveal front must pass through both.
   */
  const foldAxisEndpoints: Record<GrabAnchor, readonly [GrabAnchor, GrabAnchor]> = {
    'top-right': ['top-left', 'bottom-right'],
    'bottom-left': ['top-left', 'bottom-right'],
    'top-left': ['bottom-left', 'top-right'],
    'bottom-right': ['bottom-left', 'top-right'],
    'top-center': ['middle-left', 'middle-right'],
    'bottom-center': ['middle-left', 'middle-right'],
    'middle-left': ['top-center', 'bottom-center'],
    'middle-right': ['top-center', 'bottom-center'],
  };

  /** Points on and off every symmetry line, for the fold-parallel constancy check. */
  const samplePoints: readonly Point[] = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 0.13, y: 0.87 },
    { x: 0.9, y: 0.1 },
    { x: 0.37, y: 0.42 },
  ];

  /**
   * Reads a `clip-path` polygon back into CSS pixels against the rect its
   * percentages were expressed in. Parsing rather than string-matching is what
   * lets the assertions below talk about coordinates and areas.
   */
  const parsePoints = (clip: string, reference: Rect): Point[] => {
    const matched = POLYGON_BODY.exec(clip);

    expect(matched).not.toBeNull();

    const body = matched![1]!.trim();

    if (body === '') {
      return [];
    }

    return body.split(',').map((pair) => {
      const parts = pair.trim().split(WHITESPACE);

      expect(parts).toHaveLength(2);

      const [x, y] = parts.map((token) => {
        expect(token.endsWith('%')).toBe(true);

        const value = Number.parseFloat(token.slice(0, -1));

        expect(Number.isFinite(value)).toBe(true);

        return value;
      }) as [number, number];

      return {
        x: reference.left + (x / 100) * reference.width,
        y: reference.top + (y / 100) * reference.height,
      };
    });
  };

  const uvOf = (rect: Rect, point: Point): Point => ({
    x: (point.x - rect.left) / rect.width,
    y: (point.y - rect.top) / rect.height,
  });

  /**
   * The front distance requirement 13.1 defines: the perpendicular offset from
   * the fold-basis origin along the fold-basis normal, scaled so the grab anchor
   * sits at `0`, the fold axis at `1`, and the pivot at `2`. Written from the
   * requirement, using only what `foldBasis` publishes.
   */
  const frontDistanceAtUv = (anchor: GrabAnchor, uv: Point): number => {
    const basis = foldBasis(anchor);
    const perp = (uv.x - basis.origin.x) * basis.normal.x + (uv.y - basis.origin.y) * basis.normal.y;

    return (basis.maxPerp - perp) / basis.maxPerp;
  };

  /**
   * The retired L1 sweep, restated from the pre-feature implementation so
   * requirement 13.6 can be checked against something other than the code under
   * test. It is only defined for the four corner anchors — for an edge midpoint
   * it is the very thing that produced an empty polygon.
   */
  const l1RevealPoints = (rect: Rect, anchor: Corner, progress: number): Point[] => {
    const grabbedUv = anchorUv[anchor];
    const threshold = progress * 2;
    const measured = cornerOrder.map((corner) => ({
      point: anchorPoint(rect, corner),
      distance:
        Math.abs(anchorUv[corner].x - grabbedUv.x) + Math.abs(anchorUv[corner].y - grabbedUv.y),
    }));
    const output: Point[] = [];

    for (let index = 0; index < measured.length; index += 1) {
      const current = measured[index]!;
      const next = measured[(index + 1) % measured.length]!;
      const currentInside = current.distance <= threshold;
      const nextInside = next.distance <= threshold;

      if (currentInside) {
        output.push(current.point);
      }

      if (currentInside !== nextInside) {
        const edgeProgress = (threshold - current.distance) / (next.distance - current.distance);

        output.push({
          x: current.point.x + (next.point.x - current.point.x) * edgeProgress,
          y: current.point.y + (next.point.y - current.point.y) * edgeProgress,
        });
      }
    }

    return output;
  };

  /** Shoelace area, which tolerates the duplicated vertex a corner-hitting crossing produces. */
  const polygonArea = (points: readonly Point[]): number => {
    let doubled = 0;

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]!;
      const next = points[(index + 1) % points.length]!;

      doubled += current.x * next.y - next.x * current.y;
    }

    return Math.abs(doubled) / 2;
  };

  /** Distance from a point to the nearest of the rect's four edge lines. */
  const boundaryGap = (rect: Rect, point: Point): number =>
    Math.min(
      Math.abs(point.x - rect.left),
      Math.abs(point.x - (rect.left + rect.width)),
      Math.abs(point.y - rect.top),
      Math.abs(point.y - (rect.top + rect.height)),
    );

  const isNear = (left: Point, right: Point): boolean =>
    Math.abs(left.x - right.x) <= TOLERANCE && Math.abs(left.y - right.y) <= TOLERANCE;

  it.each(allAnchors)('measures zero, one, and two along the front for %s', (anchor) => {
    expect(frontDistanceAtUv(anchor, anchorUv[anchor])).toBeCloseTo(0, 12);
    expect(frontDistanceAtUv(anchor, anchorUv[oppositeAnchor(anchor)])).toBeCloseTo(2, 12);

    for (const endpoint of foldAxisEndpoints[anchor]) {
      expect(frontDistanceAtUv(anchor, anchorUv[endpoint])).toBeCloseTo(1, 12);
    }
  });

  it.each(allAnchors)('holds the front distance constant along the fold direction for %s', (anchor) => {
    const basis = foldBasis(anchor);

    for (const point of samplePoints) {
      const base = frontDistanceAtUv(anchor, point);

      // Only the perpendicular component may be read, so sliding any distance
      // along the axis — including off the unit square — cannot move the front.
      for (const step of [-1.3, -0.4, 0.25, 0.9]) {
        const slid = { x: point.x + step * basis.axis.x, y: point.y + step * basis.axis.y };

        expect(frontDistanceAtUv(anchor, slid)).toBeCloseTo(base, 12);
      }
    }
  });

  it.each(allAnchors)('returns between three and five finite boundary points for %s', (anchor) => {
    for (const rect of sweepRects) {
      for (const progress of denseSweep) {
        const points = parsePoints(revealClipPath(rect, anchor, progress), rect);

        expect(points.length).toBeGreaterThanOrEqual(3);
        expect(points.length).toBeLessThanOrEqual(5);

        for (const point of points) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
          // Every vertex is either a rect corner or a crossing interpolated
          // along one rect edge, so all of them sit on the rect boundary. A
          // zero interpolation denominator would land somewhere else entirely.
          expect(boundaryGap(rect, point)).toBeLessThanOrEqual(TOLERANCE);
          expect(point.x).toBeGreaterThanOrEqual(rect.left - TOLERANCE);
          expect(point.x).toBeLessThanOrEqual(rect.left + rect.width + TOLERANCE);
          expect(point.y).toBeGreaterThanOrEqual(rect.top - TOLERANCE);
          expect(point.y).toBeLessThanOrEqual(rect.top + rect.height + TOLERANCE);
        }
      }
    }
  });

  it.each(edgeMidpoints)('stays a usable polygon below quarter progress for %s', (anchor) => {
    // The interval the L1 metric could not serve: it left all four corners
    // outside the front for a midline anchor at any progress under 0.25, so the
    // whole band the sheet had already swept was emitted as no points at all.
    for (const rect of sweepRects) {
      for (const progress of [0.001, 0.01, 0.05, 0.1, 0.15, 0.2, 0.2499]) {
        const clip = revealClipPath(rect, anchor, progress);
        const points = parsePoints(clip, rect);

        expect(clip).not.toBe('polygon()');
        expect(points.length).toBeGreaterThanOrEqual(3);
        expect(points.length).toBeLessThanOrEqual(5);
        expect(polygonArea(points)).toBeGreaterThan(0);
      }
    }
  });

  it.each(allAnchors)('admits exactly the corners inside the front for %s', (anchor) => {
    for (const rect of sweepRects) {
      for (const progress of denseSweep) {
        const points = parsePoints(revealClipPath(rect, anchor, progress), rect);

        for (const corner of cornerOrder) {
          const expected = anchorPoint(rect, corner);
          const inside = frontDistanceAtUv(anchor, anchorUv[corner]) <= progress * 2;

          expect(points.some((point) => isNear(point, expected))).toBe(inside);
        }
      }
    }
  });

  it.each(allAnchors)('grows the covered region monotonically for %s', (anchor) => {
    for (const rect of sweepRects) {
      const rectArea = rect.width * rect.height;
      const areaTolerance = rectArea * TOLERANCE;

      for (let index = 1; index < monotoneSweep.length; index += 1) {
        const earlier = monotoneSweep[index - 1]!;
        const later = monotoneSweep[index]!;
        const earlierPoints = parsePoints(revealClipPath(rect, anchor, earlier), rect);
        const laterPoints = parsePoints(revealClipPath(rect, anchor, later), rect);

        expect(polygonArea(earlierPoints)).toBeLessThanOrEqual(
          polygonArea(laterPoints) + areaTolerance,
        );

        // Both regions are a rect intersected with a half-plane, so both are
        // convex. Every vertex of the earlier region satisfying the later
        // threshold therefore places the earlier region's whole hull inside the
        // later one, which is the containment requirement 13.4 asks for.
        for (const point of earlierPoints) {
          expect(frontDistanceAtUv(anchor, uvOf(rect, point))).toBeLessThanOrEqual(
            later * 2 + TOLERANCE,
          );
        }
      }
    }
  });

  it.each(allAnchors)('collapses to three coincident points at the grab anchor for %s', (anchor) => {
    for (const rect of sweepRects) {
      const points = parsePoints(revealClipPath(rect, anchor, 0), rect);
      const grabbed = anchorPoint(rect, anchor);

      expect(points).toHaveLength(3);

      for (const point of points) {
        expect(point.x).toBeCloseTo(grabbed.x, 6);
        expect(point.y).toBeCloseTo(grabbed.y, 6);
      }
    }
  });

  it.each(allAnchors)('covers the four rect corners at full progress for %s', (anchor) => {
    for (const rect of sweepRects) {
      const points = parsePoints(revealClipPath(rect, anchor, 1), rect);

      expect(points).toHaveLength(4);

      // In winding order, so a reordered or partially swept polygon fails here.
      cornerOrder.forEach((corner, index) => {
        const expected = anchorPoint(rect, corner);

        expect(points[index]!.x).toBeCloseTo(expected.x, 6);
        expect(points[index]!.y).toBeCloseTo(expected.y, 6);
      });

      expect(polygonArea(points)).toBeCloseTo(rect.width * rect.height, 6);
    }
  });

  it.each(allAnchors)('passes the front through both fold-axis endpoints at half progress for %s', (anchor) => {
    // The threshold is exactly 1 there, and requirement 13.1 pins the front
    // distance at exactly 1 on the fold axis, so both endpoints must be vertices.
    for (const rect of sweepRects) {
      const points = parsePoints(revealClipPath(rect, anchor, 0.5), rect);

      for (const endpoint of foldAxisEndpoints[anchor]) {
        const expected = anchorPoint(rect, endpoint);

        expect(points.some((point) => isNear(point, expected))).toBe(true);
      }
    }
  });

  it('sweeps a full-width band down from the top edge for top-center', () => {
    for (const rect of sweepRects) {
      for (const progress of denseSweep) {
        const points = parsePoints(revealClipPath(rect, 'top-center', progress), rect);
        const ys = points.map((point) => point.y);
        const xs = points.map((point) => point.x);

        // The band starts at the top edge and its front — parallel to the fold
        // axis — sits exactly `progress · height` below it.
        expect(Math.min(...ys)).toBeCloseTo(rect.top, 6);
        expect(Math.max(...ys)).toBeCloseTo(rect.top + progress * rect.height, 6);
        // A band, not a wedge: it spans the full width at every progress.
        expect(Math.min(...xs)).toBeCloseTo(rect.left, 6);
        expect(Math.max(...xs)).toBeCloseTo(rect.left + rect.width, 6);
      }
    }
  });

  it.each(corners)('reproduces the retired L1 sweep for the corner anchor %s', (corner) => {
    for (const rect of sweepRects) {
      for (const progress of denseSweep) {
        const actual = parsePoints(revealClipPath(rect, corner, progress), rect);
        const expected = l1RevealPoints(rect, corner, progress);

        expect(actual).toHaveLength(expected.length);

        for (let index = 0; index < expected.length; index += 1) {
          expect(actual[index]!.x).toBeCloseTo(expected[index]!.x, 6);
          expect(actual[index]!.y).toBeCloseTo(expected[index]!.y, 6);
        }
      }
    }
  });

  it.each(allAnchors)('clamps an out-of-range or non-finite progress for %s', (anchor) => {
    for (const rect of sweepRects) {
      const unrevealed = revealClipPath(rect, anchor, 0);
      const revealed = revealClipPath(rect, anchor, 1);

      // A clip is purely visual and has an answer everywhere: nothing is
      // uncovered below 0 and everything is uncovered above 1, so the progress
      // clamps rather than throwing.
      for (const progress of [-0.5, -1, -1000, Number.NEGATIVE_INFINITY, Number.NaN]) {
        expect(() => revealClipPath(rect, anchor, progress)).not.toThrow();
        expect(revealClipPath(rect, anchor, progress)).toBe(unrevealed);
      }

      for (const progress of [1.0001, 1.5, 42, Number.POSITIVE_INFINITY]) {
        expect(() => revealClipPath(rect, anchor, progress)).not.toThrow();
        expect(revealClipPath(rect, anchor, progress)).toBe(revealed);
      }

      for (const progress of [
        -0.5,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
        1.5,
        Number.POSITIVE_INFINITY,
      ]) {
        const points = parsePoints(revealClipPath(rect, anchor, progress), rect);

        expect(points.length).toBeGreaterThanOrEqual(3);
        expect(points.length).toBeLessThanOrEqual(5);
      }
    }
  });
});
