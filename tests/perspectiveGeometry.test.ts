import { describe, expect, it } from 'vitest';
import {
  getPerspectiveSubdivisionCount,
  isValidPerspectiveQuad,
  perspectiveHomography,
  projectHomography,
} from '@/utils/perspective';

const rectangle = {
  topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
};

describe('perspective geometry quality', () => {
  // Mutation caught: accepting a non-self-intersecting inward corner because
  // only signed area and opposite-edge intersections were checked.
  it('rejects a concave quad whose edges do not self-intersect', () => {
    expect(isValidPerspectiveQuad({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 0.2, y: 0.2 },
      bottomLeft: { x: 0, y: 1 },
    })).toBe(false);
  });

  it('rejects a short edge even when the polygon area is large enough', () => {
    expect(isValidPerspectiveQuad({
      ...rectangle,
      topRight: { x: 0.001, y: 0 },
    }, { minArea: 0.0004, minEdge: 0.005 })).toBe(false);
  });

  it('uses more fallback segments for export and stronger distortion', () => {
    const skewed = { ...rectangle, topRight: { x: 0.64, y: 0.18 } };
    expect(getPerspectiveSubdivisionCount(skewed, 3000, 2000, 'export'))
      .toBeGreaterThan(getPerspectiveSubdivisionCount(rectangle, 800, 600, 'drag'));
  });

  it('maps every source corner to the requested quad corner', () => {
    const quad = { ...rectangle, topLeft: { x: 0.1, y: 0.15 }, bottomRight: { x: 0.9, y: 0.8 } };
    const matrix = perspectiveHomography(quad, 1000, 800)!;
    const topLeft = projectHomography(matrix, { x: 0, y: 0 });
    const topRight = projectHomography(matrix, { x: 1, y: 0 });
    const bottomRight = projectHomography(matrix, { x: 1, y: 1 });
    const bottomLeft = projectHomography(matrix, { x: 0, y: 1 });
    expect(topLeft.x).toBeCloseTo(100);
    expect(topLeft.y).toBeCloseTo(120);
    expect(topRight.x).toBeCloseTo(1000);
    expect(topRight.y).toBeCloseTo(0);
    expect(bottomRight.x).toBeCloseTo(900);
    expect(bottomRight.y).toBeCloseTo(640);
    expect(bottomLeft.x).toBeCloseTo(0);
    expect(bottomLeft.y).toBeCloseTo(800);
  });
});
