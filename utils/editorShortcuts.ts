import type { ActiveTool, LeftTab, SelectedLayer, SelectedObject } from '@/types';

interface KeyboardLike {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type EditorShortcut =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'export' }
  | { type: 'tool'; tool: ActiveTool; tab?: LeftTab }
  | { type: 'tab'; tab: LeftTab }
  | { type: 'brush-adjust'; property: 'size' | 'hardness'; delta: -1 | 1 };

export function resolveEditorShortcut(event: KeyboardLike, activeTool?: ActiveTool): EditorShortcut | null {
  const mod = Boolean(event.ctrlKey || event.metaKey);
  if (mod) {
    if (event.code === 'KeyZ') return { type: event.shiftKey || event.altKey ? 'redo' : 'undo' };
    if (event.code === 'KeyY') return { type: 'redo' };
    if (event.code === 'KeyE' || event.code === 'KeyS') return { type: 'export' };
    return null;
  }

  const paintTools: ActiveTool[] = ['brush', 'maskBrush', 'eraser', 'blur'];
  if (activeTool && paintTools.includes(activeTool)
    && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
    return {
      type: 'brush-adjust',
      property: event.shiftKey ? 'hardness' : 'size',
      delta: event.code === 'BracketRight' ? 1 : -1,
    };
  }

  const tools: Partial<Record<string, { tool: ActiveTool; tab?: LeftTab }>> = {
    KeyV: { tool: 'select' },
    KeyH: { tool: 'pan' },
    KeyB: { tool: 'brush', tab: 'cleanup' },
    KeyE: { tool: 'eraser', tab: 'cleanup' },
    KeyL: { tool: 'lasso', tab: 'cleanup' },
    KeyP: { tool: 'polyLasso', tab: 'cleanup' },
    KeyM: { tool: 'rectSelect', tab: 'cleanup' },
    KeyW: { tool: 'wand', tab: 'cleanup' },
    KeyK: { tool: 'maskBrush', tab: 'cleanup' },
    KeyT: { tool: 'text', tab: 'text' },
    KeyC: { tool: 'crop', tab: 'transform' },
    KeyR: { tool: 'blur' },
  };
  const tool = tools[event.code];
  if (tool) return { type: 'tool', ...tool };

  const tabs: Partial<Record<string, LeftTab>> = {
    Digit1: 'watermark',
    Digit2: 'cleanup',
    Digit3: 'text',
    Digit4: 'insert',
    Digit5: 'transform',
    Digit6: 'bubble',
  };
  const tab = tabs[event.code] ?? tabs[`Digit${event.key}`];
  return tab ? { type: 'tab', tab } : null;
}

/** Form controls keep native editing keys; export is the one app-global shortcut. */
export function resolveEditableTargetShortcut(event: KeyboardLike): EditorShortcut | null {
  const shortcut = resolveEditorShortcut(event);
  return shortcut?.type === 'export' ? shortcut : null;
}

export type DeleteTarget = SelectedObject | { id: string; type: 'ai' | 'mask' } | 'contour';

export function resolveDeleteTarget(
  activeTool: ActiveTool,
  selectedObject: SelectedObject | null,
  selectedLayer: SelectedLayer | null,
): DeleteTarget | null {
  if (activeTool === 'polyLasso') return 'contour';
  if (selectedObject) return selectedObject;
  if (selectedLayer?.type === 'ai' || selectedLayer?.type === 'mask') {
    return { id: selectedLayer.id, type: selectedLayer.type };
  }
  return null;
}
