import { perspectiveHomography, projectHomography } from '@/utils/perspective';
import {
  renderPerspectiveWebgl,
  resetPerspectiveWebglRenderer,
} from '@/utils/perspectiveWebgl';

interface ExpectedSample {
  name: string;
  sourceUv: { x: number; y: number };
  expected: [number, number, number, number];
  compositeExpected?: [number, number, number, number];
}

const samples: ExpectedSample[] = [
  { name: 'top-left red', sourceUv: { x: .25, y: .25 }, expected: [255, 0, 0, 255] },
  { name: 'top-right green', sourceUv: { x: .75, y: .25 }, expected: [0, 255, 0, 255] },
  { name: 'bottom-right blue', sourceUv: { x: .75, y: .75 }, expected: [0, 0, 255, 255] },
  { name: 'bottom-left yellow', sourceUv: { x: .25, y: .75 }, expected: [255, 255, 0, 255] },
  {
    name: 'top red semitransparent edge',
    sourceUv: { x: .25, y: .0625 },
    expected: [128, 0, 0, 128],
    compositeExpected: [255, 127, 127, 255],
  },
  {
    name: 'right blue semitransparent edge',
    sourceUv: { x: .9375, y: .75 },
    expected: [0, 0, 128, 128],
    compositeExpected: [127, 127, 255, 255],
  },
];

function assertColor(name: string, actual: ArrayLike<number>, expected: ExpectedSample['expected']) {
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
  sourceContext.clearRect(0, 0, 32, 8);
  sourceContext.fillStyle = 'rgba(255,0,0,.5)'; sourceContext.fillRect(0, 0, 32, 8);
  sourceContext.clearRect(32, 0, 32, 8);
  sourceContext.fillStyle = 'rgba(0,255,0,.5)'; sourceContext.fillRect(32, 0, 32, 8);
  sourceContext.clearRect(56, 32, 8, 32);
  sourceContext.fillStyle = 'rgba(0,0,255,.5)'; sourceContext.fillRect(56, 32, 8, 32);

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

    const rawResults = samples.map(sample => {
      const documentPoint = projectHomography(homography, sample.sourceUv);
      const localX = Math.max(0, Math.min(result.canvas.width - 1, Math.round(documentPoint.x - result.bounds.x)));
      const canvasY = Math.max(0, Math.min(result.canvas.height - 1, Math.round(documentPoint.y - result.bounds.y)));
      const localY = Math.max(0, Math.min(
        result.canvas.height - 1,
        result.canvas.height - 1 - canvasY,
      ));
      const pixel = new Uint8Array(4);
      gl.readPixels(localX, localY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
        throw new Error(`${sample.name}: WebGL readback failed`);
      }
      assertColor(sample.name, pixel, sample.expected);
      return { sample, localX, canvasY, pixel: Array.from(pixel) };
    });

    // Read the WebGL framebuffer first: drawing a non-preserved WebGL canvas
    // into 2D may present/clear its drawing buffer before readPixels.
    const composite = document.createElement('canvas');
    composite.width = result.canvas.width;
    composite.height = result.canvas.height;
    const compositeContext = composite.getContext('2d');
    if (!compositeContext) throw new Error('Canvas 2D compositing is unavailable');
    compositeContext.fillStyle = '#ffffff';
    compositeContext.fillRect(0, 0, composite.width, composite.height);
    compositeContext.drawImage(result.canvas, 0, 0);

    return rawResults.map(({ sample, localX, canvasY, pixel }) => {
      const compositePixel = compositeContext.getImageData(localX, canvasY, 1, 1).data;
      if (sample.compositeExpected) {
        assertColor(`${sample.name} composite`, compositePixel, sample.compositeExpected);
      }
      return {
        name: sample.name,
        rgba: pixel,
        compositeRgba: Array.from(compositePixel),
      };
    });
  } finally {
    resetPerspectiveWebglRenderer();
  }
}
