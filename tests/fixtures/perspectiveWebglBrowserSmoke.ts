import { perspectiveHomography, projectHomography } from '@/utils/perspective';
import {
  renderPerspectiveWebgl,
  resetPerspectiveWebglRenderer,
} from '@/utils/perspectiveWebgl';

interface ExpectedSample {
  name: string;
  sourceUv: { x: number; y: number };
  expected: [number, number, number, number];
}

const samples: ExpectedSample[] = [
  { name: 'top-left red', sourceUv: { x: .25, y: .25 }, expected: [255, 0, 0, 255] },
  { name: 'top-right green', sourceUv: { x: .75, y: .25 }, expected: [0, 255, 0, 255] },
  { name: 'bottom-right blue', sourceUv: { x: .75, y: .75 }, expected: [0, 0, 255, 255] },
  { name: 'bottom-left yellow', sourceUv: { x: .25, y: .75 }, expected: [255, 255, 0, 255] },
];

function assertColor(name: string, actual: Uint8Array, expected: ExpectedSample['expected']) {
  for (let channel = 0; channel < expected.length; channel++) {
    if (Math.abs(actual[channel] - expected[channel]) > 8) {
      throw new Error(`${name}: expected ${expected.join(',')}, received ${Array.from(actual).join(',')}`);
    }
  }
}

/**
 * Optional real-browser smoke fixture. Run this function from a browser-bundled
 * harness; Vitest/jsdom has no WebGL implementation. It exercises the production
 * renderer with asymmetric geometry and validates actual framebuffer pixels.
 */
export function runPerspectiveWebglBrowserSmoke() {
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 64;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Canvas 2D is unavailable');
  sourceContext.fillStyle = '#ff0000'; sourceContext.fillRect(0, 0, 32, 32);
  sourceContext.fillStyle = '#00ff00'; sourceContext.fillRect(32, 0, 32, 32);
  sourceContext.fillStyle = '#0000ff'; sourceContext.fillRect(32, 32, 32, 32);
  sourceContext.fillStyle = '#ffff00'; sourceContext.fillRect(0, 32, 32, 32);

  const quad = {
    topLeft: { x: .1, y: .1 }, topRight: { x: .76, y: .22 },
    bottomRight: { x: .91, y: .88 }, bottomLeft: { x: .18, y: .7 },
  };
  const outputWidth = 160;
  const outputHeight = 120;

  resetPerspectiveWebglRenderer();
  try {
    const result = renderPerspectiveWebgl(source, quad, outputWidth, outputHeight);
    if (!result) throw new Error('Perspective WebGL renderer was unavailable');
    const gl = result.canvas.getContext('webgl');
    const homography = perspectiveHomography(quad, outputWidth, outputHeight);
    if (!gl || !homography) throw new Error('Perspective WebGL smoke setup failed');
    gl.finish();

    return samples.map(sample => {
      const documentPoint = projectHomography(homography, sample.sourceUv);
      const localX = Math.max(0, Math.min(result.canvas.width - 1, Math.round(documentPoint.x - result.bounds.x)));
      const localY = Math.max(0, Math.min(
        result.canvas.height - 1,
        result.canvas.height - 1 - Math.round(documentPoint.y - result.bounds.y),
      ));
      const pixel = new Uint8Array(4);
      gl.readPixels(localX, localY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
        throw new Error(`${sample.name}: WebGL readback failed`);
      }
      assertColor(sample.name, pixel, sample.expected);
      return { name: sample.name, rgba: Array.from(pixel) };
    });
  } finally {
    resetPerspectiveWebglRenderer();
  }
}
