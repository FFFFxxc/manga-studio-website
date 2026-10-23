'use client';

import { Blend, Brush, Crop, Eraser, Hand, Lasso, MousePointer2, Pipette, ScanLine, SquareDashed, Stamp, Type, WandSparkles, Paintbrush, Waypoints, MoreHorizontal } from 'lucide-react';
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
  { tool: 'blur', label: 'Размытие и эффекты', icon: ScanLine, tab: 'cleanup' },
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
  const primaryTools: ActiveTool[] = ['select', 'pan', 'brush', 'eraser', 'text', 'eyedropper'];
  const renderTool = ({ tool, label, hotkey, icon: Icon, tab, hint }: typeof tools[number]) => (
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
        useEditorUiStore.getState().setShapePointEditingId(null);
        if (tool === 'brush') useStore.getState().updateCleanupSettings({ mode: 'brush' });
        if (tool === 'maskBrush') useStore.getState().updateCleanupSettings({ mode: 'inpaint' });
        setActiveTool(tool);
        if (tab) setLeftTab(tab);
      }}
      onContextMenu={event => {
        event.preventDefault();
        cancelActiveOperation();
        setActiveTool(tool);
        if (tab) setLeftTab(tab);
        openToolOptions({ x: event.clientX, y: event.clientY, target: { type: 'tool', tool } });
      }}
    >
      <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
      <span>{tool === 'eyedropper' ? 'Цвет' : label}</span>
    </button>
  );
  return (
    <nav className="tool-rail" aria-label="Инструменты холста">
      {tools.filter(item => primaryTools.includes(item.tool)).map(renderTool)}
      <details className="tool-rail-more" key={primaryTools.includes(activeTool) ? 'primary' : activeTool} open={!primaryTools.includes(activeTool)}>
        <summary className="tool-rail-button" title="Дополнительные инструменты"><MoreHorizontal size={19} aria-hidden="true" /><span>Ещё</span></summary>
        {tools.filter(item => !primaryTools.includes(item.tool)).map(renderTool)}
      </details>
    </nav>
  );
}
