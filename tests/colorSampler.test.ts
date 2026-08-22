import { beforeEach, describe, expect, it } from 'vitest';
import { sampleCanvasColor } from '@/utils/colorSampler';
import { useStore } from '@/store/useStore';

describe('color sampler', () => {
  beforeEach(() => {
    useStore.setState({
      foregroundColor: '#000000',
      cleanupSettings: { ...useStore.getState().cleanupSettings, brushColor: '#ffffff' },
      textSettings: { ...useStore.getState().textSettings, fill: '#000000' },
    });
  });

  it('samples an opaque pixel as hex and RGBA', () => {
    const context = { getImageData: () => ({ data: new Uint8ClampedArray([17, 34, 51, 255]) }) };
    const canvas = { width: 20, height: 20, getContext: () => context } as unknown as HTMLCanvasElement;
    expect(sampleCanvasColor(canvas, { x: 4, y: 7 })).toEqual({
      hex: '#112233',
      rgba: [17, 34, 51, 255],
    });
  });

  it('returns null for a fully transparent pixel', () => {
    const context = { getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }) };
    const canvas = { width: 1, height: 1, getContext: () => context } as unknown as HTMLCanvasElement;
    expect(sampleCanvasColor(canvas, { x: 0, y: 0 })).toBeNull();
  });

  it('updates only color defaults without adding document history', () => {
    useStore.getState().setForegroundColor('#Aa44CC');
    const state = useStore.getState();
    expect(state.foregroundColor).toBe('#aa44cc');
    expect(state.cleanupSettings.brushColor).toBe('#aa44cc');
    expect(state.textSettings.fill).toBe('#aa44cc');
    expect(state.documents).toHaveLength(0);
  });
});
