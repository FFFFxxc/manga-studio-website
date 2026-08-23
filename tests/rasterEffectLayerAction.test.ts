import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { useStore } from '@/store/useStore';
import { applyRasterEffectToLayer } from '@/utils/rasterEffects';

const effectMocks = vi.hoisted(() => ({
  createRasterEffectSession: vi.fn(),
  commit: vi.fn(),
}));

vi.mock('@/utils/rasterEffectSession', () => ({
  createRasterEffectSession: effectMocks.createRasterEffectSession,
}));

describe('raster layer context-menu effects', () => {
  beforeEach(() => {
    effectMocks.commit.mockReset().mockResolvedValue('pasted-layer');
    effectMocks.createRasterEffectSession.mockReset().mockResolvedValue({
      append: vi.fn(),
      renderPreview: vi.fn(),
      commit: effectMocks.commit,
      cancel: vi.fn(),
    });
    const document = makeEditorDocument({ id: 'context-effect' });
    document.aiLayers = [{
      id: 'pasted-layer',
      name: 'Вставленный фрагмент',
      src: 'data:image/png;base64,pasted',
      visible: true,
      opacity: 1,
      locked: false,
      operation: 'drawing',
      eraseElements: [],
      x: 0.15,
      y: 0.1,
      scaleX: 0.8,
      scaleY: 0.8,
      rotation: 0,
    }];
    useStore.setState({
      documents: [document],
      activeDocIndex: 0,
      blurSettings: {
        ...useStore.getState().blurSettings,
        mode: 'blur',
        gesture: 'brush',
        applyTo: 'selection',
        cellSize: 36,
      },
    });
  });

  it('selects the pasted layer and applies pixelation to its complete local bitmap', async () => {
    await applyRasterEffectToLayer({ type: 'ai', id: 'pasted-layer' }, 'pixelate');

    expect(useStore.getState().documents[0].selectedLayer).toEqual({ type: 'ai', id: 'pasted-layer' });
    expect(useStore.getState().blurSettings.mode).toBe('pixelate');
    expect(effectMocks.createRasterEffectSession).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'context-effect',
      layer: { type: 'ai', id: 'pasted-layer' },
      settings: expect.objectContaining({
        mode: 'pixelate',
        gesture: 'area',
        applyTo: 'layer',
        cellSize: 36,
      }),
    }));
    expect(effectMocks.commit).toHaveBeenCalledTimes(1);
  });
});
