import { useStore } from '@/store/useStore';
import { createRasterEffectSession } from '@/utils/rasterEffectSession';

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
