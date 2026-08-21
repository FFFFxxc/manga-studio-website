import type { ImageDocument, SelectedLayer } from '@/types';

export function canTransformRasterLayer(
  document: ImageDocument,
  selectedLayer: SelectedLayer | null | undefined,
): boolean {
  if (!selectedLayer) return false;
  if (selectedLayer.type === 'base') {
    return document.baseLayer?.id === selectedLayer.id && document.baseLayer.locked === false;
  }
  if (selectedLayer.type === 'ai') {
    const layer = document.aiLayers.find(candidate => candidate.id === selectedLayer.id);
    return Boolean(layer && layer.locked !== true);
  }
  return false;
}
