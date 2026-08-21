import { drawPlacedLayer } from '@/utils/cleanupRaster';
import { drawPerspectiveImage, perspectiveHomography, projectHomography } from '@/utils/perspective';

const WIDTH = 240;
const HEIGHT = 180;
const quad = {
  topLeft: { x: 0.08, y: 0.14 },
  topRight: { x: 0.9, y: 0.04 },
  bottomRight: { x: 0.82, y: 0.92 },
  bottomLeft: { x: 0.18, y: 0.78 },
};

function makeHighContrastSource() {
  const source = document.createElement('canvas');
  source.width = source.height = 160;
  const context = source.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      context.fillStyle = (x + y) % 2 ? '#ffffff' : '#050505';
      context.fillRect(x * 20, y * 20, 20, 20);
    }
  }
  context.strokeStyle = '#ff00ff';
  context.lineWidth = 12;
  context.beginPath();
  context.moveTo(16, 144);
  context.lineTo(144, 16);
  context.stroke();
  return source;
}

function makeAsymmetricSource() {
  const source = document.createElement('canvas');
  source.width = source.height = 160;
  const context = source.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.fillStyle = '#ff0000'; context.fillRect(0, 0, 80, 80);
  context.fillStyle = '#00ff00'; context.fillRect(80, 0, 80, 80);
  context.fillStyle = '#0000ff'; context.fillRect(80, 80, 80, 80);
  context.fillStyle = '#ffff00'; context.fillRect(0, 80, 80, 80);
  return source;
}

function pixelAt(context: CanvasRenderingContext2D, x: number, y: number) {
  return Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data);
}

function channelDelta(left: number[], right: number[]) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function assertPixel(name: string, actual: number[], expected: number[], tolerance = 10) {
  const delta = channelDelta(actual, expected);
  if (delta > tolerance) {
    throw new Error(`${name}: expected ${expected.join(',')}, received ${actual.join(',')} (delta ${delta})`);
  }
}

function runCombinedCropSourceBoundsSmoke() {
  const source = makeAsymmetricSource();
  const preview = document.createElement('canvas');
  const exported = document.createElement('canvas');
  preview.width = exported.width = WIDTH;
  preview.height = exported.height = HEIGHT;
  const previewContext = preview.getContext('2d');
  const exportContext = exported.getContext('2d');
  if (!previewContext || !exportContext) throw new Error('Canvas 2D is unavailable');

  const sourceBounds = { x: .125, y: .125, width: .75, height: .75 };
  const crop = { x: .25, y: .3125, width: .375, height: .3125 };
  drawPerspectiveImage(previewContext, source, quad, WIDTH, HEIGHT, {
    sourceBounds,
    crop,
    opacity: .5,
    quality: 'preview',
  });
  drawPlacedLayer(exportContext, source, {
    perspective: quad,
    perspectiveSourceBounds: sourceBounds,
    crop,
    opacity: .5,
  }, WIDTH, HEIGHT);

  const homography = perspectiveHomography(quad, WIDTH, HEIGHT);
  if (!homography) throw new Error('Combined crop/source-bounds setup is invalid');
  const samples = [
    { name: 'red', destinationUv: { x: .25, y: 1 / 3 }, expected: [255, 0, 0, 128] },
    { name: 'green', destinationUv: { x: 7 / 12, y: 1 / 3 }, expected: [0, 255, 0, 128] },
    { name: 'yellow', destinationUv: { x: .25, y: 7 / 12 }, expected: [255, 255, 0, 128] },
    { name: 'blue', destinationUv: { x: 7 / 12, y: 7 / 12 }, expected: [0, 0, 255, 128] },
    { name: 'outside intersection', destinationUv: { x: .1, y: .1 }, expected: [0, 0, 0, 0] },
  ].map(sample => {
    const point = projectHomography(homography, sample.destinationUv);
    const previewPixel = pixelAt(previewContext, point.x, point.y);
    const exportPixel = pixelAt(exportContext, point.x, point.y);
    assertPixel(`combined preview ${sample.name}`, previewPixel, sample.expected);
    assertPixel(`combined export ${sample.name}`, exportPixel, sample.expected);
    const delta = channelDelta(previewPixel, exportPixel);
    if (delta > 8) {
      throw new Error(`combined preview/export ${sample.name} diverged by ${delta}`);
    }
    return { ...sample, point, preview: previewPixel, exported: exportPixel, delta };
  });

  return {
    sourceBounds,
    crop,
    opacity: .5,
    maxDelta: Math.max(...samples.map(sample => sample.delta)),
    samples,
  };
}

export function runPerspectivePreviewExportBrowserSmoke() {
  const source = makeHighContrastSource();
  const preview = document.createElement('canvas');
  const exported = document.createElement('canvas');
  preview.width = exported.width = WIDTH;
  preview.height = exported.height = HEIGHT;
  const previewContext = preview.getContext('2d');
  const exportContext = exported.getContext('2d');
  if (!previewContext || !exportContext) throw new Error('Canvas 2D is unavailable');

  drawPerspectiveImage(previewContext, source, quad, WIDTH, HEIGHT, { quality: 'preview' });
  drawPlacedLayer(exportContext, source, { perspective: quad, opacity: 1 }, WIDTH, HEIGHT);

  const homography = perspectiveHomography(quad, WIDTH, HEIGHT);
  if (!homography) throw new Error('Perspective comparison setup is invalid');
  const samples = [0.2, 0.35, 0.5, 0.65, 0.8].map(value => {
    const point = projectHomography(homography, { x: value, y: 1 - value });
    const previewPixel = pixelAt(previewContext, point.x, point.y);
    const exportPixel = pixelAt(exportContext, point.x, point.y);
    const delta = channelDelta(previewPixel, exportPixel);
    if (previewPixel[0] < 210 || previewPixel[2] < 210 || previewPixel[1] > 45 || previewPixel[3] < 245) {
      throw new Error(`preview diagonal sample ${value} is not magenta: ${previewPixel.join(',')}`);
    }
    if (delta > 8) {
      throw new Error(`preview/export diagonal sample ${value} diverged by ${delta}: ${previewPixel.join(',')} vs ${exportPixel.join(',')}`);
    }
    return { value, point, preview: previewPixel, exported: exportPixel, delta };
  });

  const combinedCrop = runCombinedCropSourceBoundsSmoke();
  return {
    maxDelta: Math.max(Math.max(...samples.map(sample => sample.delta)), combinedCrop.maxDelta),
    samples,
    combinedCrop,
    preview: preview.toDataURL('image/png'),
    exported: exported.toDataURL('image/png'),
  };
}
