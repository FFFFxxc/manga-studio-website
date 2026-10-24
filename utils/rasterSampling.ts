/** Bilinear interpolation in premultiplied alpha, with pixel-center coordinates. */
export function samplePremultipliedBilinear(
  pixels: Uint8ClampedArray, width: number, height: number,
  x: number, y: number, result: Float64Array,
) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(x), top = Math.floor(y);
  const right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1);
  const fx = x - left, fy = y - top;
  const a = (top * width + left) * 4, b = (top * width + right) * 4;
  const c = (bottom * width + left) * 4, d = (bottom * width + right) * 4;
  const wa = (1 - fx) * (1 - fy) * pixels[a + 3] / 255;
  const wb = fx * (1 - fy) * pixels[b + 3] / 255;
  const wc = (1 - fx) * fy * pixels[c + 3] / 255;
  const wd = fx * fy * pixels[d + 3] / 255;
  for (let channel = 0; channel < 3; channel++) {
    result[channel] = pixels[a + channel] * wa + pixels[b + channel] * wb + pixels[c + channel] * wc + pixels[d + channel] * wd;
  }
  result[3] = wa + wb + wc + wd;
}

/** Smudging interpolates coverage; source-over would thicken transparent pixels. */
export function mixPremultipliedPixel(pixels: Uint8ClampedArray, index: number, sample: Float64Array, amount: number) {
  const alpha = pixels[index + 3] / 255;
  const nextAlpha = alpha * (1 - amount) + sample[3] * amount;
  for (let channel = 0; channel < 3; channel++) {
    pixels[index + channel] = nextAlpha > 1e-8
      ? (pixels[index + channel] * alpha * (1 - amount) + sample[channel] * amount) / nextAlpha
      : 0;
  }
  pixels[index + 3] = nextAlpha * 255;
}
