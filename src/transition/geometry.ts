import type { Corner, MotionProfile, PaperFrame, Point, Rect } from './types';

export const cornerUv: Record<Corner, Point> = {
  'top-left': { x: 0, y: 0 },
  'top-right': { x: 1, y: 0 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-left': { x: 0, y: 1 },
};

const orderedCornerKeys: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

export function oppositeCorner(corner: Corner): Corner {
  const opposites: Record<Corner, Corner> = {
    'top-left': 'bottom-right',
    'top-right': 'bottom-left',
    'bottom-right': 'top-left',
    'bottom-left': 'top-right',
  };

  return opposites[corner];
}

export function cornerPoint(rect: Rect, corner: Corner): Point {
  const uv = cornerUv[corner];

  return {
    x: rect.left + uv.x * rect.width,
    y: rect.top + uv.y * rect.height,
  };
}

export function vertexIndex(corner: Corner, columns: number, rows: number): number {
  const uv = cornerUv[corner];
  return uv.y * rows * (columns + 1) + uv.x * columns;
}

function clampUnitInterval(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}

function validateFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: expected a finite number.`);
  }
}

function validatePositiveNumber(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (value <= 0) {
    throw new Error(`Invalid ${field}: expected a number greater than 0.`);
  }
}

function validatePositiveInteger(value: number, field: string): void {
  validateFiniteNumber(value, field);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${field}: expected an integer greater than or equal to 1.`);
  }
}

function validateRect(rect: Rect, field: string): void {
  validateFiniteNumber(rect.left, `${field}.left`);
  validateFiniteNumber(rect.top, `${field}.top`);
  validatePositiveNumber(rect.width, `${field}.width`);
  validatePositiveNumber(rect.height, `${field}.height`);
}

function validateProfile(profile: MotionProfile): void {
  validatePositiveInteger(profile.meshColumns, 'profile.meshColumns');
  validatePositiveInteger(profile.meshRows, 'profile.meshRows');
  validatePositiveNumber(profile.foldSoftness, 'profile.foldSoftness');
  validateFiniteNumber(profile.bendDepth, 'profile.bendDepth');
  validateFiniteNumber(profile.edgeCurvature, 'profile.edgeCurvature');
}

function easedProgress(progress: number, profile: MotionProfile): number {
  validateFiniteNumber(progress, 'progress');

  const eased = profile.easing(clampUnitInterval(progress));

  if (!Number.isFinite(eased)) {
    throw new Error('Invalid profile.easing: expected a finite number.');
  }

  return clampUnitInterval(eased);
}

function mix(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

function bilinear(corners: readonly [Point, Point, Point, Point], u: number, v: number): Point {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  return {
    x: mix(mix(topLeft.x, topRight.x, u), mix(bottomLeft.x, bottomRight.x, u), v),
    y: mix(mix(topLeft.y, topRight.y, u), mix(bottomLeft.y, bottomRight.y, u), v),
  };
}

function orderedCorners(rect: Rect): [Point, Point, Point, Point] {
  return orderedCornerKeys.map((corner) => cornerPoint(rect, corner)) as [Point, Point, Point, Point];
}

function endCorners(source: Rect, destination: Rect, grabbed: Corner): [Point, Point, Point, Point] {
  const result = orderedCorners(destination);
  const grabbedIndex = orderedCornerKeys.indexOf(grabbed);
  const opposite = oppositeCorner(grabbed);
  const oppositeIndex = orderedCornerKeys.indexOf(opposite);

  result[grabbedIndex] = cornerPoint(destination, opposite);
  result[oppositeIndex] = cornerPoint(source, grabbed);

  return result;
}

function canonicalDistance(u: number, v: number, grabbed: Corner): number {
  const grabbedUv = cornerUv[grabbed];
  return Math.abs(u - grabbedUv.x) + Math.abs(v - grabbedUv.y);
}

function clipViewport(rect: Rect, grabbed: Corner, progress: number): Point[] {
  const grabbedUv = cornerUv[grabbed];
  const threshold = progress * 2;
  const normalized = orderedCorners(rect).map((point) => {
    const u = (point.x - rect.left) / rect.width;
    const v = (point.y - rect.top) / rect.height;

    return {
      point,
      distance: Math.abs(u - grabbedUv.x) + Math.abs(v - grabbedUv.y),
    };
  });
  const output: Point[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    const currentInside = current.distance <= threshold;
    const nextInside = next.distance <= threshold;

    if (currentInside) {
      output.push(current.point);
    }

    if (currentInside !== nextInside) {
      const edgeProgress = (threshold - current.distance) / (next.distance - current.distance);
      output.push({
        x: mix(current.point.x, next.point.x, edgeProgress),
        y: mix(current.point.y, next.point.y, edgeProgress),
      });
    }
  }

  return output;
}

function percent(value: number): string {
  return `${value}%`;
}

export function revealClipPath(rect: Rect, grabbed: Corner, progress: number): string {
  validateRect(rect, 'rect');
  validateFiniteNumber(progress, 'progress');

  if (progress <= 0) {
    const point = cornerPoint(rect, grabbed);
    const x = ((point.x - rect.left) / rect.width) * 100;
    const y = ((point.y - rect.top) / rect.height) * 100;

    return `polygon(${percent(x)} ${percent(y)}, ${percent(x)} ${percent(y)}, ${percent(x)} ${percent(y)})`;
  }

  if (progress >= 1) {
    return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  }

  return `polygon(${clipViewport(rect, grabbed, progress)
    .map((point) => {
      const x = ((point.x - rect.left) / rect.width) * 100;
      const y = ((point.y - rect.top) / rect.height) * 100;
      return `${percent(x)} ${percent(y)}`;
    })
    .join(', ')})`;
}

export function buildPaperFrame(
  source: Rect,
  destination: Rect,
  grabbed: Corner,
  progress: number,
  profile: MotionProfile,
): PaperFrame {
  validateRect(source, 'source');
  validateRect(destination, 'destination');
  validateProfile(profile);

  const eased = easedProgress(progress, profile);
  const start = orderedCorners(source);
  const end = endCorners(source, destination, grabbed);
  const vertexCount = (profile.meshColumns + 1) * (profile.meshRows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const shade = new Float32Array(vertexCount);
  const curl = eased <= 0 || eased >= 1 ? 0 : Math.sin(Math.PI * eased);

  for (let row = 0; row <= profile.meshRows; row += 1) {
    const v = row / profile.meshRows;

    for (let column = 0; column <= profile.meshColumns; column += 1) {
      const u = column / profile.meshColumns;
      const index = row * (profile.meshColumns + 1) + column;
      const from = bilinear(start, u, v);
      const to = bilinear(end, u, v);
      const distance = canonicalDistance(u, v, grabbed);
      const foldDistance = Math.abs(distance - eased * 2);
      const foldInfluence = Math.exp(-(foldDistance * foldDistance) / profile.foldSoftness);
      const edgeWave = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const edgeDistance = Math.min(u, 1 - u, v, 1 - v);
      const edgeInfluence = 1 - Math.min(1, edgeDistance * 4);
      const edgeBend = Math.sin(Math.PI * (u + v)) * edgeInfluence * profile.edgeCurvature * curl;
      const grabbedUv = cornerUv[grabbed];

      positions[index * 3] =
        mix(from.x, to.x, eased) + edgeBend * (grabbedUv.x === 0 ? 0.45 : -0.45);
      positions[index * 3 + 1] =
        mix(from.y, to.y, eased) +
        edgeWave * profile.edgeCurvature * curl +
        edgeBend * (grabbedUv.y === 0 ? 1 : -1);
      positions[index * 3 + 2] =
        curl * (profile.bendDepth * foldInfluence + profile.edgeCurvature * edgeWave);
      shade[index] = Math.min(1, 0.35 + foldInfluence * 0.65);
    }
  }

  return {
    positions,
    shade,
    revealClipPath: revealClipPath(destination, grabbed, eased),
  };
}
