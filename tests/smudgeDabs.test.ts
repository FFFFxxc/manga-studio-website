import { describe, expect, it } from 'vitest';
import { createSmudgeDabSampler } from '@/utils/smudgeDabs';
import { mixPremultipliedPixel, samplePremultipliedBilinear } from '@/utils/rasterSampling';
import { createRasterPointMapper, mapDocumentPointToRasterPoint, mapRasterPointToDocumentPoint } from '@/utils/cloneStamp';

describe('smudge stroke sampling', () => {
  const path = [4, 4, 18, 4, 18, 17, 4, 17, 4, 4];
  it('keeps the same dabs when a curved stroke is delivered in different batches', () => {
    const batched = createSmudgeDabSampler(2.5);
    const expected = [...batched.append(path), ...batched.finish()];
    const streamed = createSmudgeDabSampler(2.5);
    const actual = [];
    for (let index = 0; index < path.length; index += 2) actual.push(...streamed.append(path.slice(index, index + 2)));
    actual.push(...streamed.finish());
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(20);
    expect(actual.some(dab => dab.to.x < dab.from.x)).toBe(true);
    expect(actual.some(dab => dab.to.y < dab.from.y)).toBe(true);
  });

  it('does not move pixels for a stationary click and flushes a short final segment once', () => {
    const sampler = createSmudgeDabSampler(4);
    expect(sampler.append([2, 2, 2, 2])).toEqual([]);
    expect(sampler.finish()).toEqual([]);
    expect(sampler.append([3, 2])).toEqual([]);
    expect(sampler.finish()).toEqual([{ from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, distance: 1 }]);
    expect(sampler.finish()).toEqual([]);
  });

  it('interpolates fractional samples without pulling hidden RGB out of transparent pixels', () => {
    const sample = new Float64Array(4);
    samplePremultipliedBilinear(new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 128]), 2, 1, 0.5, 0, sample);
    const destination = new Uint8ClampedArray([0, 0, 0, 0]);
    mixPremultipliedPixel(destination, 0, sample, 1);
    expect([...destination]).toEqual([0, 0, 255, 64]);
  });

  it('preserves translucent coverage instead of accumulating opacity', () => {
    const destination = new Uint8ClampedArray([0, 0, 255, 128]);
    const sample = new Float64Array([128, 0, 0, 128 / 255]);
    for (let i = 0; i < 20; i++) mixPremultipliedPixel(destination, 0, sample, 0.5);
    expect(destination[3]).toBe(128);
  });

  it('uses the same cached transform on rotated and perspective layers', () => {
    for (const placement of [
      { x: 0.2, y: 0.1, scaleX: 0.8, scaleY: 0.6, rotation: 25 },
      { perspective: { topLeft: { x: 0.1, y: 0.1 }, topRight: { x: 0.9, y: 0.2 }, bottomRight: { x: 0.8, y: 0.9 }, bottomLeft: { x: 0.2, y: 0.8 } }, perspectiveSourceBounds: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 } },
    ]) {
      const mapper = createRasterPointMapper(placement, 800, 1000);
      const point = { x: 0.4, y: 0.3 };
      expect(mapper.toRaster(point)).toEqual(mapDocumentPointToRasterPoint(point, placement, 800, 1000));
      expect(mapper.toDocument(point)).toEqual(mapRasterPointToDocumentPoint(point, placement, 800, 1000));
    }
  });
});
