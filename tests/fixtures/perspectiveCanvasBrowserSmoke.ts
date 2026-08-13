import { perspectiveHomography, projectHomography } from '@/utils/perspective';
import { drawPerspectiveCanvas } from '@/utils/perspectiveCanvas';

const samples = [
  { name: 'top-left red', uv: { x: .25, y: .25 }, expected: [255, 0, 0, 64] },
  { name: 'top-right green', uv: { x: .75, y: .25 }, expected: [0, 255, 0, 64] },
  { name: 'bottom-right blue', uv: { x: .75, y: .75 }, expected: [0, 0, 255, 64] },
  { name: 'bottom-left yellow', uv: { x: .25, y: .75 }, expected: [255, 255, 0, 64] },
];

function assertNear(name: string, actual: Uint8ClampedArray, expected: number[]) {
  for (let channel = 0; channel < expected.length; channel++) {
    if (Math.abs(actual[channel] - expected[channel]) > 10) {
      throw new Error(`${name}: expected ${expected.join(',')}, received ${Array.from(actual).join(',')}`);
    }
  }
}

/**
 * Optional real-browser smoke fixture. Vitest/jsdom has no Canvas rasterizer.
 * The half-transparent asymmetric source is drawn at half layer opacity, so
 * every covered pixel must remain near alpha 64; source-over mesh accumulation
 * would create visible alpha peaks near 96 along internal triangle overlaps.
 */
export function runPerspectiveCanvasBrowserSmoke() {
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 64;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Canvas 2D is unavailable');
  sourceContext.fillStyle = 'rgba(255,0,0,.5)'; sourceContext.fillRect(0, 0, 32, 32);
  sourceContext.fillStyle = 'rgba(0,255,0,.5)'; sourceContext.fillRect(32, 0, 32, 32);
  sourceContext.fillStyle = 'rgba(0,0,255,.5)'; sourceContext.fillRect(32, 32, 32, 32);
  sourceContext.fillStyle = 'rgba(255,255,0,.5)'; sourceContext.fillRect(0, 32, 32, 32);

  const output = document.createElement('canvas');
  output.width = 180;
  output.height = 140;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Canvas 2D is unavailable');
  const quad = {
    topLeft: { x: .1, y: .12 }, topRight: { x: .82, y: .2 },
    bottomRight: { x: .9, y: .88 }, bottomLeft: { x: .16, y: .74 },
  };
  drawPerspectiveCanvas(outputContext, source, quad, output.width, output.height, {
    opacity: .5,
    subdivisions: 4,
    seamOverlapPx: .75,
  });

  const homography = perspectiveHomography(quad, output.width, output.height);
  if (!homography) throw new Error('Perspective Canvas smoke setup failed');
  const results = samples.map(sample => {
    const point = projectHomography(homography, sample.uv);
    const pixel = outputContext.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data;
    assertNear(sample.name, pixel, sample.expected);
    return { name: sample.name, rgba: Array.from(pixel) };
  });

  const pixels = outputContext.getImageData(0, 0, output.width, output.height).data;
  let maxAlpha = 0;
  for (let index = 3; index < pixels.length; index += 4) maxAlpha = Math.max(maxAlpha, pixels[index]);
  if (maxAlpha > 74) throw new Error(`Perspective Canvas overlap accumulated alpha ${maxAlpha}`);
  return { maxAlpha, samples: results };
}
