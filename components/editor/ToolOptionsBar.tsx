'use client';

import { useRef, useState } from 'react';
import { Copy, Layers, Trash2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { aiCleanupMaskedArea, deleteMaskedPixels, fillMaskedArea, hasActiveSelection, inpaintMaskedArea } from '@/utils/layerActions';
import { EditorSlider } from './EditorSlider';
import type { SelectionMode } from '@/types';

const toolTitles: Record<string, string> = {
  eraser: 'Ластик', maskBrush: 'Маска', brush: 'Кисть', select: 'Выделение объектов',
  pan: 'Рука', text: 'Текст', watermark: 'Вотерка', wand: 'Волшебная палочка',
  lasso: 'Лассо', polyLasso: 'Прямолинейное лассо', rectSelect: 'Прямоугольное выделение', crop: 'Кадрирование',
};

const selectionModes: Array<{ mode: SelectionMode; label: string; hint: string }> = [
  { mode: 'replace', label: 'Новое', hint: 'Каждое выделение заменяет предыдущее' },
  { mode: 'add', label: '+', hint: 'Добавить к выделению (Shift)' },
  { mode: 'subtract', label: '−', hint: 'Вычесть из выделения (Alt)' },
];

export function ToolOptionsBar() {
  const state = useStore();
  const { activeTool, cleanupSettings, updateCleanupSettings, selectedObject, documents, activeDocIndex } = state;
  const doc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;
  const isMarking = activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser';
  const isSelecting = activeTool === 'lasso' || activeTool === 'polyLasso' || activeTool === 'rectSelect' || activeTool === 'wand';
  const [running, setRunning] = useState<string | null>(null);
  const [fillColor, setFillColor] = useState('#ffffff');
  const abortRef = useRef<AbortController | null>(null);

  if (!doc) return null;
  const selectionActive = hasActiveSelection(doc);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setRunning(key);
    try {
      await action();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="tool-options" aria-label="Параметры активного инструмента" style={{ pointerEvents: 'auto', zIndex: 40 }} onMouseDown={event => event.stopPropagation()}>
      <strong>{toolTitles[activeTool] ?? 'Инструмент'}</strong>
      {isMarking && <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Размер
          <EditorSlider label="Размер кисти" min={3} max={200} step={1}
            value={Math.round(cleanupSettings.brushSize * 1000)}
            onChange={v => updateCleanupSettings({ brushSize: v / 1000 })}
            style={{ width: 120 }}
          />
          <input className="tool-number" aria-label="Размер инструмента" type="number" min="3" max="200"
            value={Math.round(cleanupSettings.brushSize * 1000)}
            onChange={e => updateCleanupSettings({ brushSize: Math.max(3, Math.min(200, Number(e.target.value))) / 1000 })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Жёсткость
          <EditorSlider label="Жёсткость кисти" min={0} max={100} step={1}
            value={Math.round(cleanupSettings.brushHardness * 100)}
            onChange={v => updateCleanupSettings({ brushHardness: v / 100 })}
            style={{ width: 90 }}
          />
          <input
            className="tool-number"
            aria-label="Жёсткость инструмента"
            type="number"
            min="0"
            max="100"
            value={Math.round(cleanupSettings.brushHardness * 100)}
            onChange={event => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                updateCleanupSettings({ brushHardness: Math.max(0, Math.min(100, value)) / 100 });
              }
            }}
          />
          <span>%</span>
        </label>
        {activeTool === 'brush' && <input aria-label="Цвет кисти" title="Цвет кисти" type="color" value={cleanupSettings.brushColor} onChange={event => updateCleanupSettings({ brushColor: event.target.value })} onMouseDown={event => event.stopPropagation()} style={{ width: 30, height: 26, cursor: 'pointer', pointerEvents: 'auto' }} />}
      </>}
      {activeTool === 'pan' && <span>Перетаскивайте холст. Удерживайте Space для временного режима.</span>}

      {isSelecting && <>
        {/* Selection mode: replace / add / subtract */}
        <div role="group" aria-label="Режим выделения" style={{ display: 'flex', gap: 2 }}>
          {selectionModes.map(({ mode, label, hint }) => (
            <button
              key={mode}
              type="button"
              title={hint}
              aria-pressed={cleanupSettings.selectionMode === mode}
              onClick={() => updateCleanupSettings({ selectionMode: mode })}
              style={{
                minWidth: 30,
                background: cleanupSettings.selectionMode === mode ? 'var(--accent)' : undefined,
                color: cleanupSettings.selectionMode === mode ? 'var(--bg-base)' : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTool === 'polyLasso' && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title="Backspace убирает последнюю точку, Esc отменяет выделение">
            Клики — точки · Enter/двойной клик — замкнуть
          </span>
        )}

        {activeTool === 'wand' && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Порог
            <EditorSlider label="Порог волшебной палочки" min={1} max={100} step={1}
              value={cleanupSettings.magicThreshold}
              onChange={v => updateCleanupSettings({ magicThreshold: v })}
              style={{ width: 90 }}
            />
            <span>{cleanupSettings.magicThreshold}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Только связанная область вокруг точки клика">
            <input type="checkbox" checked={cleanupSettings.wandContiguous} onChange={e => updateCleanupSettings({ wandContiguous: e.target.checked })} />
            Смежные
          </label>
        </>}

        {/* Actions on the selection */}
        <button disabled={!selectionActive || running !== null} title="Сделать выделенную область прозрачной (локально)" onClick={() => runAction('delete', deleteMaskedPixels)}>
          {running === 'delete' ? 'Удаляю…' : 'Удалить пиксели'}
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <button disabled={!selectionActive || running !== null} title="Залить выделение цветом (новый слой)" onClick={() => runAction('fill', () => fillMaskedArea(fillColor))}>
            {running === 'fill' ? 'Заливаю…' : 'Залить'}
          </button>
          <input aria-label="Цвет заливки" type="color" value={fillColor} onChange={e => setFillColor(e.target.value)} style={{ width: 26, height: 24, cursor: 'pointer' }} />
        </span>
        <button disabled={!selectionActive || running !== null} title="Локальное замывание без AI (быстро)" onClick={() => runAction('inpaint', inpaintMaskedArea)}>
          {running === 'inpaint' ? 'Замываю…' : 'Замыть'}
        </button>
        <button
          disabled={!selectionActive || running !== null}
          title="AI удаляет объект в выделении и дорисовывает фон (Clipdrop)"
          onClick={() => {
            abortRef.current = new AbortController();
            void runAction('ai', () => aiCleanupMaskedArea(abortRef.current?.signal));
          }}
        >
          {running === 'ai' ? 'AI работает…' : 'AI-удаление объекта'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Не сбрасывать выделение после действия">
          <input type="checkbox" checked={cleanupSettings.keepSelectionAfterAction} onChange={e => updateCleanupSettings({ keepSelectionAfterAction: e.target.checked })} />
          Сохранять
        </label>
        <button disabled={!selectionActive} onClick={state.clearActiveMask}>Сбросить</button>
      </>}

      {activeTool === 'text' && <>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          Потяните рамку · Enter — новая строка · Ctrl/⌘+Enter — готово · Esc — отмена
        </span>
        <button onClick={() => state.setLeftTab('text')}>Открыть настройки</button>
      </>}
      {activeTool === 'select' && (selectedObject ? <>
        <span>{selectedObject.type === 'text' ? 'Текст' : selectedObject.type === 'shape' ? 'Фигура' : 'Вотерка'}</span>
        <button onClick={state.duplicateSelectedObject}><Copy size={14} /> Дублировать</button>
        <button onClick={() => state.moveSelectedObject('forward')}><Layers size={14} /> Вперёд</button>
        <button className="danger" onClick={state.deleteSelectedObject}><Trash2 size={14} /> Удалить</button>
      </> : <span>Нажмите на объект, чтобы выбрать его</span>)}
    </div>
  );
}
