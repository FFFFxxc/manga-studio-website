import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/useStore';

describe('raster effect settings', () => {
  beforeEach(() => {
    useStore.setState({
      blurSettings: {
        mode: 'blur',
        gesture: 'brush',
        applyTo: 'layer',
        brushSize: 0.08,
        hardness: 0.75,
        radius: 18,
        strength: 0.5,
        cellSize: 24,
        noiseAmount: 0.18,
        noiseMonochrome: true,
        sharpenRadius: 1,
        sharpenAmount: 0.5,
      },
    });
  });

  it('keeps independent blur radius, pixel cell size and sharpen amount', () => {
    useStore.getState().updateBlurSettings({ mode: 'blur', radius: 14 });
    useStore.getState().updateBlurSettings({ mode: 'pixelate', cellSize: 32 });
    useStore.getState().updateBlurSettings({ mode: 'sharpen', sharpenAmount: 0.8 });

    expect(useStore.getState().blurSettings).toMatchObject({
      mode: 'sharpen',
      radius: 14,
      cellSize: 32,
      sharpenAmount: 0.8,
    });
  });

  it('keeps monochrome noise as an explicit independent option', () => {
    useStore.getState().updateBlurSettings({ mode: 'noise', noiseAmount: 0.35, noiseMonochrome: false });

    expect(useStore.getState().blurSettings).toMatchObject({
      mode: 'noise',
      noiseAmount: 0.35,
      noiseMonochrome: false,
      strength: 0.5,
    });
  });
});
