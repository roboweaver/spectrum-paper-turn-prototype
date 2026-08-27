import { describe, expect, it } from 'vitest';
import { buildMeshIndices, buildUvs } from '../../src/transition/paper-turn-renderer';

describe('paper mesh buffers', () => {
  it('creates two triangles per cell for a 20x14 mesh', () => {
    const indices = buildMeshIndices(20, 14);

    expect(indices).toHaveLength(20 * 14 * 6);
    expect(Math.max(...indices)).toBe((20 + 1) * (14 + 1) - 1);
  });

  it('creates normalized UVs for every vertex', () => {
    expect(Array.from(buildUvs(2, 1))).toEqual([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1]);
  });

  it.each([
    ['columns', 0, 1],
    ['columns', 1.5, 1],
    ['rows', 1, 0],
    ['rows', 1, 1.5],
  ] as const)('rejects invalid %s dimensions', (_field, columns, rows) => {
    expect(() => buildMeshIndices(columns, rows)).toThrow(/greater than or equal to 1|finite number/);
    expect(() => buildUvs(columns, rows)).toThrow(/greater than or equal to 1|finite number/);
  });
});
