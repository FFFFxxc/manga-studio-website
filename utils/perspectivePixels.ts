import type { Homography } from '@/utils/perspective';
import { samplePremultipliedBilinear } from '@/utils/rasterSampling';

interface Rect { x: number; y: number; width: number; height: number }

/** Inverse mapping writes each destination pixel once: no mesh overlap or seams. */
export function rasterizePerspectivePixels(options: {
  source: { data: Uint8ClampedArray; width: number; height: number };
  inverse: Homography;
  bounds: Rect;
  destination: Rect;
  sourceBounds?: Rect | null;
  antialias?: boolean;
}) {
  const { source, inverse: m, bounds, destination: clip } = options;
  const texture = options.sourceBounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const output = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  const sample = new Float64Array(4);
  const maxU = clip.x + clip.width, maxV = clip.y + clip.height;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const centerX = bounds.x + x + 0.5, centerY = bounds.y + y + 0.5;
    const z = m[6] * centerX + m[7] * centerY + m[8];
    if (!Number.isFinite(z) || z <= 1e-10) continue;
    const u = (m[0] * centerX + m[1] * centerY + m[2]) / z;
    const v = (m[3] * centerX + m[4] * centerY + m[5]) / z;
    const duX = (m[0] - u * m[6]) / z, duY = (m[1] - u * m[7]) / z;
    const dvX = (m[3] - v * m[6]) / z, dvY = (m[4] - v * m[7]) / z;
    const edgeU = (Math.abs(duX) + Math.abs(duY)) * 0.5;
    const edgeV = (Math.abs(dvX) + Math.abs(dvY)) * 0.5;
    if (u < clip.x - edgeU || u > maxU + edgeU || v < clip.y - edgeV || v > maxV + edgeV) continue;
    const minifying = Math.max(
      Math.hypot(duX * texture.width * source.width, dvX * texture.height * source.height),
      Math.hypot(duY * texture.width * source.width, dvY * texture.height * source.height),
    ) > 1.5;
    const edge = u - clip.x < edgeU || maxU - u < edgeU || v - clip.y < edgeV || maxV - v < edgeV;
    const steps = options.antialias !== false && (edge || minifying) ? 2 : 1;
    let red = 0, green = 0, blue = 0, alpha = 0;
    for (let row = 0; row < steps; row++) for (let column = 0; column < steps; column++) {
      const px = bounds.x + x + (column + 0.5) / steps;
      const py = bounds.y + y + (row + 0.5) / steps;
      const denominator = m[6] * px + m[7] * py + m[8];
      if (denominator <= 1e-10) continue;
      const localU = (m[0] * px + m[1] * py + m[2]) / denominator;
      const localV = (m[3] * px + m[4] * py + m[5]) / denominator;
      if (localU < clip.x || localU > maxU || localV < clip.y || localV > maxV) continue;
      const textureU = texture.x + localU * texture.width, textureV = texture.y + localV * texture.height;
      if (textureU < 0 || textureU > 1 || textureV < 0 || textureV > 1) continue;
      samplePremultipliedBilinear(source.data, source.width, source.height, textureU * source.width - 0.5, textureV * source.height - 0.5, sample);
      red += sample[0]; green += sample[1]; blue += sample[2]; alpha += sample[3];
    }
    const index = (y * bounds.width + x) * 4;
    if (alpha <= 1e-8) continue;
    output[index] = red / alpha;
    output[index + 1] = green / alpha;
    output[index + 2] = blue / alpha;
    output[index + 3] = alpha / (steps * steps) * 255;
  }
  return output;
}
