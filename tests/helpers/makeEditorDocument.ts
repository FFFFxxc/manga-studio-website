import { createBaseLayerState } from '@/types';
import type { ImageDocument } from '@/types';

export function makeEditorDocument(overrides: Partial<ImageDocument> = {}): ImageDocument {
  const id = overrides.id ?? 'doc-text-creation';
  return {
    id,
    file: new File(['page'], 'page.png', { type: 'image/png' }),
    originalSrc: 'data:image/png;base64,eA==',
    thumbnail: '',
    width: 1000,
    height: 800,
    name: 'page.png',
    cleanup: { committed: null, strokes: [] },
    baseLayer: createBaseLayerState(id),
    masks: [],
    aiLayers: [],
    activeMaskId: null,
    selectedLayer: null,
    watermarks: [],
    texts: [],
    translationMasks: [],
    shapes: [],
    bubbles: [],
    layerOrder: [],
    past: [],
    future: [],
    hasChanges: false,
    ...overrides,
  };
}
