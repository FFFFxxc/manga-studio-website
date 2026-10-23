'use client';

import { create } from 'zustand';
import type { ActiveTool, LayerReference, SelectedObject } from '@/types';

export type EditorOperationKind =
  | 'crop'
  | 'transform'
  | 'perspective'
  | 'selection'
  | 'text-edit'
  | 'blur';

export interface ActiveEditorOperation {
  id: string;
  kind: EditorOperationKind;
  label: string;
  commit: () => void | Promise<void>;
  cancel: () => void | Promise<void>;
}

export type ToolOptionsTarget =
  | { type: 'tool'; tool: ActiveTool }
  | { type: 'object'; object: SelectedObject; tool: ActiveTool }
  | { type: 'layer'; layer: Extract<LayerReference, { type: 'base' | 'ai' }>; tool: ActiveTool };

export interface ToolOptionsRequest {
  x: number;
  y: number;
  target: ToolOptionsTarget;
}

interface EditorUiState {
  shapePointEditingId: string | null;
  setShapePointEditingId: (id: string | null) => void;
  activeOperation: ActiveEditorOperation | null;
  /** Selected raster layer whose perspective corner is actively being dragged. */
  perspectiveDragLayerKey: string | null;
  toolOptions: ToolOptionsRequest | null;
  floatingDismiss: (() => void) | null;
  beginOperation: (operation: ActiveEditorOperation) => void;
  setPerspectiveDragLayerKey: (layerKey: string | null) => void;
  commitActiveOperation: () => boolean;
  cancelActiveOperation: () => boolean;
  openToolOptions: (request: ToolOptionsRequest) => void;
  closeToolOptions: () => boolean;
  registerFloatingDismiss: (dismiss: (() => void) | null) => void;
  dismissFloating: () => boolean;
  clearTransientUi: () => void;
}

export const useEditorUiStore = create<EditorUiState>((set, get) => ({
  shapePointEditingId: null,
  setShapePointEditingId: shapePointEditingId => set({ shapePointEditingId }),
  activeOperation: null,
  perspectiveDragLayerKey: null,
  toolOptions: null,
  floatingDismiss: null,

  beginOperation: operation => {
    const current = get().activeOperation;
    if (current && current.id !== operation.id) void current.cancel();
    set({ activeOperation: operation, perspectiveDragLayerKey: null });
  },

  setPerspectiveDragLayerKey: perspectiveDragLayerKey => set({ perspectiveDragLayerKey }),

  commitActiveOperation: () => {
    const operation = get().activeOperation;
    if (!operation) return false;
    set({ activeOperation: null, perspectiveDragLayerKey: null });
    void operation.commit();
    return true;
  },

  cancelActiveOperation: () => {
    const operation = get().activeOperation;
    if (!operation) return false;
    set({ activeOperation: null, perspectiveDragLayerKey: null });
    void operation.cancel();
    return true;
  },

  openToolOptions: request => set({ toolOptions: request }),
  closeToolOptions: () => {
    if (!get().toolOptions) return false;
    set({ toolOptions: null });
    return true;
  },
  registerFloatingDismiss: floatingDismiss => set({ floatingDismiss }),
  dismissFloating: () => {
    const dismiss = get().floatingDismiss;
    if (!dismiss) return false;
    set({ floatingDismiss: null });
    dismiss();
    return true;
  },
  clearTransientUi: () => set({ toolOptions: null, floatingDismiss: null, perspectiveDragLayerKey: null, shapePointEditingId: null }),
}));

export function beginEditorOperation(
  kind: EditorOperationKind,
  label: string,
  handlers: Pick<ActiveEditorOperation, 'commit' | 'cancel'>,
) {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  useEditorUiStore.getState().beginOperation({ id, kind, label, ...handlers });
  return id;
}
