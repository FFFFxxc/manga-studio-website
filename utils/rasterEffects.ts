import { useStore } from '@/store/useStore';
import { createRasterEffectSession } from '@/utils/rasterEffectSession';
import type { LayerReference, RasterEffectMode } from '@/types';

type RasterLayerReference = Extract<LayerReference, { type: 'base' | 'ai' }>;

/** Apply the chosen filter to one complete raster layer from its context menu. */
export async function applyRasterEffectToLayer(layer: RasterLayerReference, mode: RasterEffectMode) {
  const state = useStore.getState();
  const document = state.documents[state.activeDocIndex];
  if (!document) throw new Error('Нет активной страницы.');
  if (layer.type === 'base') {
    if (layer.id !== document.baseLayer.id) throw new Error('Слой не найден.');
  } else if (!document.aiLayers.some(item => item.id === layer.id)) {
    throw new Error('Слой не найден.');
  }

  state.selectLayer(layer);
  state.updateBlurSettings({ mode });
  const session = await createRasterEffectSession({
    documentId: document.id,
    layer: layer.type === 'base' ? { type: 'base' } : { type: 'ai', id: layer.id },
    settings: {
      ...state.blurSettings,
      mode,
      gesture: 'area',
      applyTo: 'layer',
    },
    previewScale: 1,
  });
  return session.commit();
}

/** Compatibility wrapper kept until CanvasArea moves to the stroke-session API. */
export async function applyRasterEffectPreview(points?: number[]) {
  const state = useStore.getState();
  const document = state.documents[state.activeDocIndex];
  if (!document) throw new Error('Нет активной страницы.');
  const selected = document.selectedLayer;
  if (selected?.type === 'mask') throw new Error('Выберите растровый слой.');
  const layer = selected?.type === 'ai'
    ? { type: 'ai' as const, id: selected.id }
    : { type: 'base' as const };
  const settings = points?.length
    ? { ...state.blurSettings }
    : { ...state.blurSettings, gesture: 'area' as const };
  const session = await createRasterEffectSession({
    documentId: document.id,
    layer,
    settings,
    previewScale: 1,
  });
  if (points?.length) session.append(points);
  return session.commit();
}
