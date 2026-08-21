import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/perspective', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/perspective')>();
  return { ...actual, drawPerspectiveImage: vi.fn() };
});

import { drawPlacedLayer } from '@/utils/cleanupRaster';
import { drawPerspectiveImage } from '@/utils/perspective';

const quad = {
  topLeft: { x: 0.08, y: 0.14 },
  topRight: { x: 0.9, y: 0.04 },
  bottomRight: { x: 0.82, y: 0.92 },
  bottomLeft: { x: 0.18, y: 0.78 },
};

describe('perspective renderer integration', () => {
  beforeEach(() => vi.mocked(drawPerspectiveImage).mockClear());

  // Mutations caught: bypassing the shared renderer in document composition,
  // dropping crop/source bounds/opacity, or submitting preview/drag quality to
  // an export and AI-source path.
  it('sends complete raster placement through export-quality composition', () => {
    const source = { width: 320, height: 240 } as HTMLCanvasElement;
    const context = {} as CanvasRenderingContext2D;
    const crop = { x: 0.1875, y: 0.25, width: 0.25, height: 0.1875 };
    const sourceBounds = { x: 0.125, y: 0.125, width: 0.5, height: 0.5 };

    drawPlacedLayer(context, source, {
      perspective: quad,
      crop,
      perspectiveSourceBounds: sourceBounds,
      opacity: 0.45,
    }, 640, 480);

    expect(drawPerspectiveImage).toHaveBeenCalledOnce();
    expect(drawPerspectiveImage).toHaveBeenCalledWith(context, source, quad, 640, 480, {
      crop,
      sourceBounds,
      opacity: 0.45,
      quality: 'export',
    });
  });
});
