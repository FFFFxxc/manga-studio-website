import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSeededRandom,
  expandEffectBounds,
  pixelateBounds,
  renderRasterEffect,
} from '@/utils/rasterEffectPrimitives';

class PixelCanvas {
  private pixelWidth = 0;
  private pixelHeight = 0;
  pixels = new Uint8ClampedArray();
  readonly context = new PixelContext(this);

  get width() { return this.pixelWidth; }
  set width(value: number) {
    this.pixelWidth = Math.max(0, Math.floor(value));
    this.resize();
  }

  get height() { return this.pixelHeight; }
  set height(value: number) {
    this.pixelHeight = Math.max(0, Math.floor(value));
    this.resize();
  }

  getContext(type: string) {
    return type === '2d' ? this.context : null;
  }

  setPixel(x: number, y: number, rgba: ArrayLike<number>) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 4;
    this.pixels.set(rgba, offset);
  }

  getPixel(x: number, y: number) {
    const offset = (y * this.width + x) * 4;
    return Array.from(this.pixels.slice(offset, offset + 4));
  }

  private resize() {
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
  }
}

class PixelContext {
  filter = 'none';
  imageSmoothingEnabled = true;

  constructor(private readonly canvas: PixelCanvas) {}

  createImageData(width: number, height: number) {
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;
  }

  getImageData(x: number, y: number, width: number, height: number) {
    const image = this.createImageData(width, height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const target = (row * width + column) * 4;
        image.data.set(this.canvas.getPixel(x + column, y + row), target);
      }
    }
    return image;
  }

  putImageData(image: ImageData, x: number, y: number) {
    for (let row = 0; row < image.height; row += 1) {
      for (let column = 0; column < image.width; column += 1) {
        const source = (row * image.width + column) * 4;
        this.canvas.setPixel(x + column, y + row, image.data.slice(source, source + 4));
      }
    }
  }

  drawImage(sourceValue: CanvasImageSource, ...values: number[]) {
    const source = sourceValue as unknown as PixelCanvas;
    if (!(source instanceof PixelCanvas)) throw new Error('Pixel test received an unsupported image source');
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (values.length === 2) {
      [dx, dy] = values;
      [dw, dh] = [sw, sh];
    } else if (values.length === 4) {
      [dx, dy, dw, dh] = values;
    } else {
      [sx, sy, sw, sh, dx, dy, dw, dh] = values;
    }
    const blurRadius = Number.parseFloat(this.filter.match(/^blur\((\d+(?:\.\d+)?)px\)$/)?.[1] ?? '0');
    for (let y = Math.max(0, Math.floor(dy)); y < Math.min(this.canvas.height, Math.ceil(dy + dh)); y += 1) {
      for (let x = Math.max(0, Math.floor(dx)); x < Math.min(this.canvas.width, Math.ceil(dx + dw)); x += 1) {
        const sourceX = sx + (x - dx + 0.5) / dw * sw;
        const sourceY = sy + (y - dy + 0.5) / dh * sh;
        this.canvas.setPixel(x, y, samplePixel(source, sourceX, sourceY, blurRadius));
      }
    }
  }
}

function samplePixel(canvas: PixelCanvas, x: number, y: number, radius: number) {
  const centerX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x)));
  const centerY = Math.max(0, Math.min(canvas.height - 1, Math.floor(y)));
  if (radius <= 0) return canvas.getPixel(centerX, centerY);
  // Model the browser filter's Gaussian support extending well beyond the CSS radius.
  const extent = Math.max(1, Math.ceil(radius * 3));
  const totals = [0, 0, 0, 0];
  let count = 0;
  for (let offsetY = -extent; offsetY <= extent; offsetY += 1) {
    for (let offsetX = -extent; offsetX <= extent; offsetX += 1) {
      const sample = canvas.getPixel(
        Math.max(0, Math.min(canvas.width - 1, centerX + offsetX)),
        Math.max(0, Math.min(canvas.height - 1, centerY + offsetY)),
      );
      sample.forEach((value, channel) => { totals[channel] += value; });
      count += 1;
    }
  }
  return totals.map(value => Math.round(value / count));
}

function makeCanvas(width: number, height: number, pixel: (x: number, y: number) => readonly number[]) {
  const canvas = new PixelCanvas();
  canvas.width = width;
  canvas.height = height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) canvas.setPixel(x, y, pixel(x, y));
  }
  return canvas;
}

const parameters = {
  radius: 1,
  strength: 1,
  cellSize: 2,
  noiseAmount: 0.35,
  noiseMonochrome: false,
  seed: 42,
};

describe('raster effect primitives', () => {
  beforeEach(() => {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') return new PixelCanvas() as unknown as HTMLCanvasElement;
      return createElement(tagName);
    }) as typeof document.createElement);
  });

  afterEach(() => vi.restoreAllMocks());

  it('produces stable noise for the same seed', () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it('anchors pixel cells to layer coordinates', () => {
    expect(pixelateBounds({ x: 13, y: 17, width: 20, height: 20 }, 8))
      .toEqual({ x: 8, y: 16, width: 32, height: 24 });
  });

  it('expands effect bounds by the sampling radius without leaving the source', () => {
    expect(expandEffectBounds({ x: 20, y: 30, width: 10, height: 12 }, 6, 100, 100))
      .toEqual({ x: 14, y: 24, width: 22, height: 24 });
    expect(expandEffectBounds({ x: 2, y: 3, width: 8, height: 9 }, 6, 12, 14))
      .toEqual({ x: 0, y: 0, width: 12, height: 14 });
  });

  it('blurs a hard edge while preserving its source alpha', () => {
    const source = makeCanvas(8, 8, (x, y) => [x < 4 ? 0 : 255, x < 4 ? 0 : 255, x < 4 ? 0 : 255, 80 + y * 20]);
    const result = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 8 }, 'blur', parameters) as unknown as PixelCanvas;

    expect(result.getPixel(4, 4)[0] - result.getPixel(3, 4)[0]).toBeLessThan(255);
    expect(result.getPixel(3, 4)[3]).toBe(160);
    expect(result.getPixel(4, 4)[3]).toBe(160);
  });

  it('matches a full-layer blur crop when Gaussian support extends beyond the radius', () => {
    const source = makeCanvas(12, 4, x => [x * 19, x * 13, x * 7, 190]);
    const full = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 12, height: 4 }, 'blur', parameters) as unknown as PixelCanvas;
    const partial = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 4, y: 1, width: 3, height: 2 }, 'blur', parameters) as unknown as PixelCanvas;

    expect(partial.width).toBe(3);
    expect(partial.height).toBe(2);
    for (let y = 0; y < partial.height; y += 1) {
      for (let x = 0; x < partial.width; x += 1) {
        expect(partial.getPixel(x, y)).toEqual(full.getPixel(x + 4, y + 1));
      }
    }
  });

  it('pixelates to one RGBA value per anchored cell with smoothing disabled', () => {
    const source = makeCanvas(8, 8, (x, y) => [x * 27, y * 27, (x + y) * 12, 200]);
    const result = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 8 }, 'pixelate', parameters) as unknown as PixelCanvas;

    for (let cellY = 0; cellY < 8; cellY += 2) {
      for (let cellX = 0; cellX < 8; cellX += 2) {
        const expected = result.getPixel(cellX, cellY);
        expect(result.getPixel(cellX + 1, cellY)).toEqual(expected);
        expect(result.getPixel(cellX, cellY + 1)).toEqual(expected);
        expect(result.getPixel(cellX + 1, cellY + 1)).toEqual(expected);
      }
    }
    expect(result.context.imageSmoothingEnabled).toBe(false);
  });

  it('keeps partial pixelation aligned with the same layer-coordinate cells', () => {
    const source = makeCanvas(8, 4, (x, y) => [x * 29, y * 47, (x + y) * 17, 120 + x]);
    const full = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 4 }, 'pixelate', parameters) as unknown as PixelCanvas;
    const partial = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 1, y: 1, width: 5, height: 2 }, 'pixelate', parameters) as unknown as PixelCanvas;

    for (let y = 0; y < partial.height; y += 1) {
      for (let x = 0; x < partial.width; x += 1) {
        expect(partial.getPixel(x, y)).toEqual(full.getPixel(x + 1, y + 1));
      }
    }
  });

  it('keeps absolute cell boundaries at a non-divisible layer edge', () => {
    const source = makeCanvas(10, 2, x => [x * 20, x * 20, x * 20, 210]);
    const result = renderRasterEffect(
      source as unknown as HTMLCanvasElement,
      { x: 0, y: 0, width: 10, height: 2 },
      'pixelate',
      { ...parameters, cellSize: 4 },
    ) as unknown as PixelCanvas;

    expect(result.getPixel(0, 0)).toEqual(result.getPixel(3, 0));
    expect(result.getPixel(4, 0)).toEqual(result.getPixel(7, 0));
    expect(result.getPixel(8, 0)).toEqual(result.getPixel(9, 0));
    expect(result.getPixel(3, 0)).not.toEqual(result.getPixel(4, 0));
    expect(result.getPixel(7, 0)).not.toEqual(result.getPixel(8, 0));
  });

  it('renders byte-identical seeded noise without changing alpha', () => {
    const source = makeCanvas(8, 8, (x, y) => [80 + x * 3, 90 + y * 2, 120, 40 + (x + y) * 8]);
    const first = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 8 }, 'noise', parameters) as unknown as PixelCanvas;
    const second = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 8 }, 'noise', parameters) as unknown as PixelCanvas;

    expect(first.pixels).toEqual(second.pixels);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) expect(first.getPixel(x, y)[3]).toBe(source.getPixel(x, y)[3]);
    }
  });

  it('keeps seeded noise stable at absolute coordinates across different bounds', () => {
    const source = makeCanvas(8, 6, (x, y) => [100 + x, 110 + y, 120, 70 + x + y]);
    const full = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 6 }, 'noise', parameters) as unknown as PixelCanvas;
    const partial = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 2, y: 1, width: 4, height: 3 }, 'noise', parameters) as unknown as PixelCanvas;

    for (let y = 0; y < partial.height; y += 1) {
      for (let x = 0; x < partial.width; x += 1) {
        expect(partial.getPixel(x, y)).toEqual(full.getPixel(x + 2, y + 1));
      }
    }
  });

  it('uses document coordinates for noise in a downscaled preview', () => {
    const fullSource = makeCanvas(8, 8, () => [128, 128, 128, 170]);
    const previewSource = makeCanvas(4, 4, () => [128, 128, 128, 170]);
    const full = renderRasterEffect(
      fullSource as unknown as HTMLCanvasElement,
      { x: 0, y: 0, width: 8, height: 8 },
      'noise',
      { ...parameters, coordinateScale: 1 },
    ) as unknown as PixelCanvas;
    const preview = renderRasterEffect(
      previewSource as unknown as HTMLCanvasElement,
      { x: 0, y: 0, width: 4, height: 4 },
      'noise',
      { ...parameters, coordinateScale: 0.5 },
    ) as unknown as PixelCanvas;

    expect(preview.getPixel(2, 1)).toEqual(full.getPixel(4, 2));
  });

  it('sharpens an edge without changing alpha', () => {
    const source = makeCanvas(8, 8, (x, y) => [x < 4 ? 32 : 224, x < 4 ? 32 : 224, x < 4 ? 32 : 224, 60 + x * 12 + y]);
    const result = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 8 }, 'sharpen', parameters) as unknown as PixelCanvas;
    const sourceContrast = source.getPixel(4, 4)[0] - source.getPixel(3, 4)[0];
    const resultContrast = result.getPixel(4, 4)[0] - result.getPixel(3, 4)[0];

    expect(resultContrast).toBeGreaterThan(sourceContrast);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) expect(result.getPixel(x, y)[3]).toBe(source.getPixel(x, y)[3]);
    }
  });

  it('matches a full-layer sharpen crop by sampling neighboring source pixels', () => {
    const source = makeCanvas(8, 6, (x, y) => [30 + x * 17 + y * 3, 40 + x * 9 + y * 11, 50 + x * 5 + y * 13, 90 + x + y]);
    const full = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 0, y: 0, width: 8, height: 6 }, 'sharpen', parameters) as unknown as PixelCanvas;
    const partial = renderRasterEffect(source as unknown as HTMLCanvasElement, { x: 2, y: 1, width: 4, height: 3 }, 'sharpen', parameters) as unknown as PixelCanvas;

    for (let y = 0; y < partial.height; y += 1) {
      for (let x = 0; x < partial.width; x += 1) {
        expect(partial.getPixel(x, y)).toEqual(full.getPixel(x + 2, y + 1));
      }
    }
  });
});
