import type { RasterEffectMode, RasterEffectParameters } from '@/types';

export interface RasterEffectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(0, Math.floor(width));
  canvas.height = Math.max(0, Math.floor(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement, willReadFrequently = false) {
  const context = canvas.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!context) throw new Error('Canvas 2D is unavailable');
  return context;
}

function normalizeBounds(bounds: RasterEffectBounds, sourceWidth: number, sourceHeight: number): RasterEffectBounds {
  const width = Math.max(0, finiteOr(sourceWidth, 0));
  const height = Math.max(0, finiteOr(sourceHeight, 0));
  const rawX = finiteOr(bounds.x, 0);
  const rawY = finiteOr(bounds.y, 0);
  const rawWidth = Math.max(0, finiteOr(bounds.width, 0));
  const rawHeight = Math.max(0, finiteOr(bounds.height, 0));
  const x = Math.floor(clamp(rawX, 0, width));
  const y = Math.floor(clamp(rawY, 0, height));
  const right = Math.ceil(clamp(rawX + rawWidth, x, width));
  const bottom = Math.ceil(clamp(rawY + rawHeight, y, height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function readPixels(canvas: HTMLCanvasElement) {
  return context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height);
}

function writeMixedPixels(
  output: HTMLCanvasElement,
  source: ImageData,
  effected: ImageData,
  strength: number,
) {
  const amount = clamp(finiteOr(strength, 1), 0, 1);
  const context = context2d(output, true);
  const result = context.createImageData(output.width, output.height);
  for (let index = 0; index < result.data.length; index += 4) {
    result.data[index] = source.data[index] + (effected.data[index] - source.data[index]) * amount;
    result.data[index + 1] = source.data[index + 1] + (effected.data[index + 1] - source.data[index + 1]) * amount;
    result.data[index + 2] = source.data[index + 2] + (effected.data[index + 2] - source.data[index + 2]) * amount;
    result.data[index + 3] = source.data[index + 3];
  }
  context.putImageData(result, 0, 0);
}

function renderBlur(source: HTMLCanvasElement, bounds: RasterEffectBounds, radius: number) {
  const expandedBounds = expandEffectBounds(bounds, radius, source.width, source.height);
  const expandedSource = createCanvas(expandedBounds.width, expandedBounds.height);
  context2d(expandedSource).drawImage(
    source,
    expandedBounds.x,
    expandedBounds.y,
    expandedBounds.width,
    expandedBounds.height,
    0,
    0,
    expandedSource.width,
    expandedSource.height,
  );
  const expandedEffect = createCanvas(expandedBounds.width, expandedBounds.height);
  const context = context2d(expandedEffect);
  context.filter = `blur(${Math.max(0, finiteOr(radius, 0))}px)`;
  context.drawImage(expandedSource, 0, 0);
  const output = createCanvas(bounds.width, bounds.height);
  context2d(output).drawImage(
    expandedEffect,
    bounds.x - expandedBounds.x,
    bounds.y - expandedBounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    output.width,
    output.height,
  );
  return output;
}

function renderPixelate(
  source: HTMLCanvasElement,
  sourceBounds: RasterEffectBounds,
  bounds: RasterEffectBounds,
  cellSize: number,
) {
  const cell = Math.max(1, Math.round(finiteOr(cellSize, 1)));
  const alignedBounds = pixelateBounds(bounds, cell, source.width, source.height);
  const alignedSource = createCanvas(alignedBounds.width, alignedBounds.height);
  context2d(alignedSource).drawImage(
    source,
    alignedBounds.x,
    alignedBounds.y,
    alignedBounds.width,
    alignedBounds.height,
    0,
    0,
    alignedBounds.width,
    alignedBounds.height,
  );

  const reduced = createCanvas(
    Math.max(1, Math.ceil(alignedBounds.width / cell)),
    Math.max(1, Math.ceil(alignedBounds.height / cell)),
  );
  const reducedContext = context2d(reduced);
  reducedContext.imageSmoothingEnabled = false;
  reducedContext.drawImage(alignedSource, 0, 0, alignedSource.width, alignedSource.height, 0, 0, reduced.width, reduced.height);

  const alignedEffect = createCanvas(alignedBounds.width, alignedBounds.height);
  const alignedContext = context2d(alignedEffect);
  alignedContext.imageSmoothingEnabled = false;
  alignedContext.drawImage(reduced, 0, 0, reduced.width, reduced.height, 0, 0, alignedEffect.width, alignedEffect.height);

  const output = createCanvas(sourceBounds.width, sourceBounds.height);
  const outputContext = context2d(output);
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(
    alignedEffect,
    sourceBounds.x - alignedBounds.x,
    sourceBounds.y - alignedBounds.y,
    sourceBounds.width,
    sourceBounds.height,
    0,
    0,
    output.width,
    output.height,
  );
  return output;
}

function renderNoise(source: HTMLCanvasElement, parameters: RasterEffectParameters) {
  const output = createCanvas(source.width, source.height);
  const context = context2d(output, true);
  const pixels = readPixels(source);
  const result = context.createImageData(source.width, source.height);
  result.data.set(pixels.data);
  const random = createSeededRandom(finiteOr(parameters.seed, 0));
  const amount = clamp(finiteOr(parameters.noiseAmount, 0), 0, 1) * 255;
  for (let index = 0; index < result.data.length; index += 4) {
    if (parameters.noiseMonochrome) {
      const noise = (random() * 2 - 1) * amount;
      result.data[index] += noise;
      result.data[index + 1] += noise;
      result.data[index + 2] += noise;
    } else {
      result.data[index] += (random() * 2 - 1) * amount;
      result.data[index + 1] += (random() * 2 - 1) * amount;
      result.data[index + 2] += (random() * 2 - 1) * amount;
    }
  }
  context.putImageData(result, 0, 0);
  return output;
}

function renderSharpen(source: HTMLCanvasElement) {
  const output = createCanvas(source.width, source.height);
  const context = context2d(output, true);
  const pixels = readPixels(source);
  const result = context.createImageData(source.width, source.height);
  const sample = (x: number, y: number, channel: number) => {
    const column = clamp(x, 0, source.width - 1);
    const row = clamp(y, 0, source.height - 1);
    return pixels.data[(row * source.width + column) * 4 + channel];
  };
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        result.data[index + channel] = sample(x, y, channel) * 5
          - sample(x - 1, y, channel)
          - sample(x + 1, y, channel)
          - sample(x, y - 1, channel)
          - sample(x, y + 1, channel);
      }
      result.data[index + 3] = pixels.data[index + 3];
    }
  }
  context.putImageData(result, 0, 0);
  return output;
}

export function createSeededRandom(seed: number) {
  let value = finiteOr(seed, 0) >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export function pixelateBounds(
  bounds: RasterEffectBounds,
  cellSize: number,
  sourceWidth = Number.POSITIVE_INFINITY,
  sourceHeight = Number.POSITIVE_INFINITY,
): RasterEffectBounds {
  const cell = Math.max(1, Math.round(finiteOr(cellSize, 1)));
  const x = Math.max(0, Math.floor(finiteOr(bounds.x, 0) / cell) * cell);
  const y = Math.max(0, Math.floor(finiteOr(bounds.y, 0) / cell) * cell);
  const rawRight = Math.ceil((finiteOr(bounds.x, 0) + Math.max(0, finiteOr(bounds.width, 0))) / cell) * cell;
  const rawBottom = Math.ceil((finiteOr(bounds.y, 0) + Math.max(0, finiteOr(bounds.height, 0))) / cell) * cell;
  const right = Math.min(rawRight, Math.max(0, sourceWidth));
  const bottom = Math.min(rawBottom, Math.max(0, sourceHeight));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function expandEffectBounds(
  bounds: RasterEffectBounds,
  radius: number,
  sourceWidth: number,
  sourceHeight: number,
): RasterEffectBounds {
  const expansion = Math.max(0, Math.ceil(finiteOr(radius, 0)));
  const x = Math.max(0, Math.floor(finiteOr(bounds.x, 0) - expansion));
  const y = Math.max(0, Math.floor(finiteOr(bounds.y, 0) - expansion));
  const right = Math.min(
    Math.max(0, finiteOr(sourceWidth, 0)),
    Math.ceil(finiteOr(bounds.x, 0) + Math.max(0, finiteOr(bounds.width, 0)) + expansion),
  );
  const bottom = Math.min(
    Math.max(0, finiteOr(sourceHeight, 0)),
    Math.ceil(finiteOr(bounds.y, 0) + Math.max(0, finiteOr(bounds.height, 0)) + expansion),
  );
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function renderRasterEffect(
  source: HTMLCanvasElement,
  bounds: RasterEffectBounds,
  mode: RasterEffectMode,
  parameters: RasterEffectParameters,
): HTMLCanvasElement {
  const sourceBounds = normalizeBounds(bounds, source.width, source.height);
  const sourcePatch = createCanvas(sourceBounds.width, sourceBounds.height);
  const sourceContext = context2d(sourcePatch, true);
  if (sourcePatch.width === 0 || sourcePatch.height === 0) return sourcePatch;
  sourceContext.drawImage(
    source,
    sourceBounds.x,
    sourceBounds.y,
    sourceBounds.width,
    sourceBounds.height,
    0,
    0,
    sourcePatch.width,
    sourcePatch.height,
  );

  let effected: HTMLCanvasElement;
  if (mode === 'blur') effected = renderBlur(source, sourceBounds, parameters.radius);
  else if (mode === 'pixelate') effected = renderPixelate(source, sourceBounds, sourceBounds, parameters.cellSize);
  else if (mode === 'noise') effected = renderNoise(sourcePatch, parameters);
  else effected = renderSharpen(sourcePatch);

  const output = createCanvas(sourcePatch.width, sourcePatch.height);
  if (mode === 'pixelate') context2d(output).imageSmoothingEnabled = false;
  writeMixedPixels(output, readPixels(sourcePatch), readPixels(effected), parameters.strength);
  return output;
}
