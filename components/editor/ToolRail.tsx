'use client';

import { Blend, Brush, Crop, Eraser, Hand, Lasso, MousePointer2, Pipette, ScanLine, SquareDashed, Stamp, Type, WandSparkles, Paintbrush, Waypoints } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import type { ActiveTool, LeftTab } from '@/types';

const tools: Array<{ tool: ActiveTool; label: string; hotkey?: string; icon: typeof Brush; tab?: LeftTab; hint?: string }> = [
  { tool: 'select', label: 'Выделение', hotkey: 'V', icon: MousePointer2 },
  { tool: 'pan', label: 'Рука', hotkey: 'H / Space', icon: Hand },
  { tool: 'brush', label: 'Кисть', hotkey: 'B', icon: Brush, tab: 'cleanup' },
  { tool: 'maskBrush', label: 'Маска', hotkey: 'K', icon: Paintbrush, tab: 'cleanup' },
  { tool: 'eraser', label: 'Ластик', hotkey: 'E', icon: Eraser, tab: 'cleanup' },
  { tool: 'lasso', label: 'Лассо', hotkey: 'L', icon: Lasso, tab: 'cleanup', hint: 'Свободное выделение' },
  { tool: 'polyLasso', label: 'Прямолинейное лассо', hotkey: 'P', icon: Waypoints, tab: 'cleanup', hint: 'Выделение прямыми отрезками: кликайте по точкам, Enter или двойной клик — замкнуть' },
  { tool: 'rectSelect', label: 'Прямоугольное выделение', hotkey: 'M', icon: SquareDashed, tab: 'cleanup', hint: 'Прямоугольная область' },
  { tool: 'wand', label: 'Волшебная палочка', hotkey: 'W', icon: WandSparkles, tab: 'cleanup', hint: 'Выделение связанной области похожего цвета' },
  { tool: 'text', label: 'Текст', hotkey: 'T', icon: Type, tab: 'text' },
  { tool: 'crop', label: 'Кадрирование / Размер', hotkey: 'C', icon: Crop, tab: 'transform' },
  { tool: 'blur', label: 'Blur / Pixelate / Noise', icon: ScanLine },
  { tool: 'eyedropper', label: 'Пипетка', hotkey: 'I', icon: Pipette },
  { tool: 'cloneStamp', label: 'Штамп', hotkey: 'S', icon: Stamp },
  { tool: 'smudge', label: 'Палец', hotkey: 'R', icon: Blend },
  { tool: 'sharpen', label: 'Резкость', hotkey: 'R', icon: ScanLine },
];

export function ToolRail() {
  const { activeTool, setActiveTool, setLeftTab, documents } = useStore();
  const openToolOptions = useEditorUiStore(state => state.openToolOptions);
  const cancelActiveOperation = useEditorUiStore(state => state.cancelActiveOperation);
  const closeToolOptions = useEditorUiStore(state => state.closeToolOptions);
  const disabled = documents.length === 0;
  return (
    <nav className="tool-rail" aria-label="Инструменты холста">
      {tools.map(({ tool, label, hotkey, icon: Icon, tab, hint }) => (
        <button
          key={tool}
          className="tool-rail-button"
          aria-label={hotkey ? `${label}, клавиша ${hotkey}` : label}
          aria-pressed={activeTool === tool}
          title={`${label}${hotkey ? ` (${hotkey})` : ''}${hint ? ` — ${hint}` : ''}`}
          disabled={disabled}
          onClick={() => {
            cancelActiveOperation();
            closeToolOptions();
            setActiveTool(tool);
            if (tab) setLeftTab(tab);
          }}
          onContextMenu={event => {
            event.preventDefault();
            cancelActiveOperation();
            setActiveTool(tool);
            openToolOptions({ x: event.clientX, y: event.clientY, target: { type: 'tool', tool } });
          }}
        >
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}
