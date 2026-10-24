'use client';

import { useRef, useState } from 'react';
import { Copy, Layers, Trash2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { aiCleanupMaskedArea, deleteMaskedPixels, fillMaskedArea, hasActiveSelection, inpaintMaskedArea } from '@/utils/layerActions';
import { EditorSlider } from './EditorSlider';
import type { SelectionMode } from '@/types';
import { BRUSH_PRESETS } from '@/utils/brushPresets';

const toolTitles: Record<string, string> = {
  eraser: 'Ластик', maskBrush: 'Маска', brush: 'Кисть', select: 'Выделение объектов',
  pan: 'Рука', text: 'Текст', watermark: 'Вотерка', wand: 'Волшебная палочка',
  lasso: 'Лассо', polyLasso: 'Прямолинейное лассо', rectSelect: 'Прямоугольное выделение', crop: 'Кадрирование',
  blur: 'Растровый эффект',
  eyedropper: 'Пипетка', cloneStamp: 'Штамп', smudge: 'Палец', sharpen: 'Резкость',
};

const selectionModes: Array<{ mode: SelectionMode; label: string; hint: string }> = [
  { mode: 'replace', label: 'Новое', hint: 'Каждое выделение заменяет предыдущее' },
  { mode: 'add', label: '+', hint: 'Добавить к выделению (Shift)' },
  { mode: 'subtract', label: '−', hint: 'Вычесть из выделения (Alt)' },
];

export function ToolOptionsBar() {
  const state = useStore();
  const { activeTool, cleanupSettings, updateCleanupSettings, blurSettings, updateBlurSettings, eyedropperSettings, updateEyedropperSettings, foregroundColor, setForegroundColor, cloneStampSettings, updateCloneStampSettings, smudgeSettings, updateSmudgeSettings, selectedObject, documents, activeDocIndex } = state;
  const doc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;
  const isMarking = activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser';
  const isEffect = activeTool === 'blur';
  const isSelecting = activeTool === 'lasso' || activeTool === 'polyLasso' || activeTool === 'rectSelect' || activeTool === 'wand';
  const [running, setRunning] = useState<string | null>(null);
  const [fillColor, setFillColor] = useState('#ffffff');
  const abortRef = useRef<AbortController | null>(null);

  if (!doc) return null;
  const selectionActive = hasActiveSelection(doc);
  const sizeUnits = activeTool === 'eraser' ? doc.height : 1000;
  const minSize = activeTool === 'eraser' ? 1 : 3;
  const maxSize = activeTool === 'eraser' ? Math.max(1, Math.round(doc.height * 0.2)) : 200;

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
    <div className="tool-options" aria-label="Параметры активного инструмента" style={{ pointerEvents: 'auto', zIndex: 40, flexWrap: activeTool === 'eraser' || activeTool === 'brush' ? 'wrap' : undefined }} onMouseDown={event => event.stopPropagation()}>
      <strong>{toolTitles[activeTool] ?? 'Инструмент'}</strong>
      {activeTool === 'brush' && <select aria-label="Форма кисти" style={{ width: 110, flexShrink: 0 }} value={cleanupSettings.brushPreset ?? 'round'}
        onChange={event => updateCleanupSettings({ brushPreset: event.target.value as NonNullable<typeof cleanupSettings.brushPreset> })}>
        {BRUSH_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>}
      {isMarking && <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Размер
          <EditorSlider label="Размер кисти" min={minSize} max={maxSize} step={1}
            value={Math.max(minSize, Math.round(cleanupSettings.brushSize * sizeUnits))}
            onChange={v => updateCleanupSettings({ brushSize: v / sizeUnits })}
            style={{ width: 120 }}
          />
          <input className="tool-number" aria-label="Размер инструмента" type="number" min={minSize} max={maxSize}
            value={Math.max(minSize, Math.round(cleanupSettings.brushSize * sizeUnits))}
            onChange={e => updateCleanupSettings({ brushSize: Math.max(minSize, Math.min(maxSize, Number(e.target.value))) / sizeUnits })}
          />
          {activeTool === 'eraser' && <span>px</span>}
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
        {activeTool === 'brush' && <input aria-label="Цвет кисти" title="Основной цвет" type="color" value={cleanupSettings.brushColor} onChange={event => setForegroundColor(event.target.value)} onMouseDown={event => event.stopPropagation()} style={{ width: 30, height: 26, cursor: 'pointer', pointerEvents: 'auto' }} />}
        {activeTool === 'eraser' && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="100% полностью стирает центр кисти; меньше — стирает частично">
            Непрозрачность
            <EditorSlider label="Непрозрачность ластика" min={1} max={100} step={1}
              value={Math.round(cleanupSettings.brushOpacity * 100)}
              onChange={value => updateCleanupSettings({ brushOpacity: value / 100 })} style={{ width: 70 }} />
            <span>{Math.round(cleanupSettings.brushOpacity * 100)}%</span>
          </label>
          <span title="Низкая жёсткость — мягкий край, 100% — чёткий круг">Стирает выбранный слой · [ ] — размер</span>
        </>}
      </>}
      {isEffect && <>
        <select aria-label="Растровый эффект" value={blurSettings.mode} onChange={event => updateBlurSettings({ mode: event.target.value as typeof blurSettings.mode })}>
          <option value="blur">Размытие</option>
          <option value="pixelate">Пикселизация</option>
          <option value="noise">Шум</option>
          <option value="sharpen">Резкость</option>
        </select>
        <select aria-label="Способ эффекта" value={blurSettings.gesture} onChange={event => updateBlurSettings({ gesture: event.target.value as typeof blurSettings.gesture })}>
          <option value="brush">Кисть</option>
          <option value="area">Вся область</option>
        </select>
        <select aria-label="Цель эффекта" value={blurSettings.applyTo} onChange={event => updateBlurSettings({ applyTo: event.target.value as typeof blurSettings.applyTo })}>
          <option value="layer">Активный слой</option>
          <option value="selection">Выделение</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="[ / ] меняют размер кисти">
          Кисть
          <EditorSlider label="Размер кисти эффекта" min={3} max={350} step={5} value={Math.round(blurSettings.brushSize * 1000)} onChange={value => updateBlurSettings({ brushSize: value / 1000 })} style={{ width: 88 }} />
          <span>{Math.round(blurSettings.brushSize * 1000)}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Shift+[ / ] меняют жёсткость">
          Край
          <EditorSlider label="Жёсткость кисти эффекта" min={0} max={100} step={5} value={Math.round(blurSettings.hardness * 100)} onChange={value => updateBlurSettings({ hardness: value / 100 })} style={{ width: 76 }} />
          <span>{Math.round(blurSettings.hardness * 100)}%</span>
        </label>
        {blurSettings.mode === 'blur' && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Радиус <input className="tool-number" aria-label="Радиус размытия" type="number" min="0.5" max="64" step="0.5" value={blurSettings.radius} onChange={event => updateBlurSettings({ radius: Math.max(0.5, Math.min(64, Number(event.target.value))) })} /> px</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Сила <EditorSlider label="Сила размытия" min={5} max={100} step={5} value={Math.round(blurSettings.strength * 100)} onChange={value => updateBlurSettings({ strength: value / 100 })} style={{ width: 76 }} /> <span>{Math.round(blurSettings.strength * 100)}%</span></label>
        </>}
        {blurSettings.mode === 'pixelate' && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Ячейка <input className="tool-number" aria-label="Размер ячейки пикселизации" type="number" min="2" max="128" step="1" value={blurSettings.cellSize} onChange={event => updateBlurSettings({ cellSize: Math.max(2, Math.min(128, Number(event.target.value))) })} /> px</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Mix <EditorSlider label="Смешивание пикселизации" min={5} max={100} step={5} value={Math.round(blurSettings.strength * 100)} onChange={value => updateBlurSettings({ strength: value / 100 })} style={{ width: 76 }} /> <span>{Math.round(blurSettings.strength * 100)}%</span></label>
        </>}
        {blurSettings.mode === 'noise' && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Шум <EditorSlider label="Количество шума" min={1} max={100} step={1} value={Math.round(blurSettings.noiseAmount * 100)} onChange={value => updateBlurSettings({ noiseAmount: value / 100 })} style={{ width: 76 }} /> <span>{Math.round(blurSettings.noiseAmount * 100)}%</span></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={blurSettings.noiseMonochrome} onChange={event => updateBlurSettings({ noiseMonochrome: event.target.checked })} />Моно</label>
        </>}
        {blurSettings.mode === 'sharpen' && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Радиус <input className="tool-number" aria-label="Радиус резкости" type="number" min="1" max="8" step="1" value={blurSettings.sharpenRadius} onChange={event => updateBlurSettings({ sharpenRadius: Math.max(1, Math.min(8, Number(event.target.value))) })} /> px</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Сила <EditorSlider label="Количество резкости" min={5} max={100} step={5} value={Math.round(blurSettings.sharpenAmount * 100)} onChange={value => updateBlurSettings({ sharpenAmount: value / 100 })} style={{ width: 76 }} /> <span>{Math.round(blurSettings.sharpenAmount * 100)}%</span></label>
        </>}
      </>}
      {activeTool === 'eyedropper' && <>
        <select aria-label="Образец пипетки" value={eyedropperSettings.sample} onChange={event => updateEyedropperSettings({ sample: event.target.value as typeof eyedropperSettings.sample })}>
          <option value="all">Все слои</option>
          <option value="current">Текущий слой</option>
        </select>
        <input aria-label="Основной цвет" type="color" value={foregroundColor} onChange={event => setForegroundColor(event.target.value)} style={{ width: 30, height: 26, cursor: 'pointer' }} />
        <span>Кликните по холсту · Alt/Option временно включает пипетку для кисти</span>
      </>}
      {activeTool === 'cloneStamp' && <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Размер <EditorSlider label="Размер штампа" min={3} max={300} step={2} value={Math.round(cloneStampSettings.size * 1000)} onChange={value => updateCloneStampSettings({ size: value / 1000 })} style={{ width: 80 }} /><span>{Math.round(cloneStampSettings.size * 1000)}</span></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Край <EditorSlider label="Жёсткость штампа" min={0} max={100} step={5} value={Math.round(cloneStampSettings.hardness * 100)} onChange={value => updateCloneStampSettings({ hardness: value / 100 })} style={{ width: 70 }} /><span>{Math.round(cloneStampSettings.hardness * 100)}%</span></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Непрозр. <EditorSlider label="Непрозрачность штампа" min={5} max={100} step={5} value={Math.round(cloneStampSettings.opacity * 100)} onChange={value => updateCloneStampSettings({ opacity: value / 100 })} style={{ width: 65 }} /></label>
        <select aria-label="Образец штампа" value={cloneStampSettings.sample} onChange={event => updateCloneStampSettings({ sample: event.target.value as typeof cloneStampSettings.sample })}><option value="current">Текущий слой</option><option value="all">Все слои</option></select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={cloneStampSettings.aligned} onChange={event => updateCloneStampSettings({ aligned: event.target.checked })} />Выровненный</label>
        <span>Alt/Option + клик — выбрать источник · S</span>
      </>}
      {activeTool === 'smudge' && <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Размер <EditorSlider label="Размер пальца" min={3} max={300} step={2} value={Math.round(smudgeSettings.size * 1000)} onChange={value => updateSmudgeSettings({ size: value / 1000 })} style={{ width: 80 }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Край <EditorSlider label="Жёсткость пальца" min={0} max={100} step={5} value={Math.round(smudgeSettings.hardness * 100)} onChange={value => updateSmudgeSettings({ hardness: value / 100 })} style={{ width: 70 }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Сила <EditorSlider label="Сила пальца" min={5} max={100} step={5} value={Math.round(smudgeSettings.strength * 100)} onChange={value => updateSmudgeSettings({ strength: value / 100 })} style={{ width: 70 }} /><span>{Math.round(smudgeSettings.strength * 100)}%</span></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={smudgeSettings.sampleAllLayers} onChange={event => updateSmudgeSettings({ sampleAllLayers: event.target.checked })} />Все слои</label>
        <span>Тянет пиксели по движению · R</span>
      </>}
      {activeTool === 'sharpen' && <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Размер <EditorSlider label="Размер кисти резкости" min={3} max={300} step={2} value={Math.round(blurSettings.brushSize * 1000)} onChange={value => updateBlurSettings({ brushSize: value / 1000 })} style={{ width: 80 }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Край <EditorSlider label="Жёсткость кисти резкости" min={0} max={100} step={5} value={Math.round(blurSettings.hardness * 100)} onChange={value => updateBlurSettings({ hardness: value / 100 })} style={{ width: 70 }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Радиус <input className="tool-number" aria-label="Радиус кисти резкости" type="number" min="1" max="8" value={blurSettings.sharpenRadius} onChange={event => updateBlurSettings({ sharpenRadius: Math.max(1, Math.min(8, Number(event.target.value))) })} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Сила <EditorSlider label="Сила кисти резкости" min={5} max={100} step={5} value={Math.round(blurSettings.sharpenAmount * 100)} onChange={value => updateBlurSettings({ sharpenAmount: value / 100 })} style={{ width: 70 }} /></label>
        <span>Повышает локальную резкость · R</span>
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
        <span>{{ text: 'Текст', shape: 'Фигура', bubble: 'Бабл', translationMask: 'Маска перевода', watermark: 'Водяной знак' }[selectedObject.type]}</span>
        <button onClick={state.duplicateSelectedObject}><Copy size={14} /> Дублировать</button>
        <button onClick={() => state.moveSelectedObject('forward')}><Layers size={14} /> Вперёд</button>
        <button className="danger" onClick={state.deleteSelectedObject}><Trash2 size={14} /> Удалить</button>
      </> : <span>Нажмите на объект, чтобы выбрать его</span>)}
    </div>
  );
}
