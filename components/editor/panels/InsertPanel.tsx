'use client';

import { useEffect } from 'react';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import { useStore } from '@/store/useStore';
import type { ShapeKind, ShapeSettings } from '@/types';
import { PanelRow, PanelSlider, PanelLabel, PanelSection } from './PanelComponents';
import { PaintEditor } from './PaintEditor';
import {
  POINTER_PRESETS,
  createShapeFromSettings,
} from '@/utils/shapePresets';

const SHAPES: { kind: ShapeKind; label: string; icon: React.ReactNode }[] = [
  {
    kind: 'rect', label: 'Прямоугольник',
    icon: <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2.5" y="4.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>,
  },
  {
    kind: 'ellipse', label: 'Эллипс',
    icon: <svg width="18" height="18" viewBox="0 0 18 18"><ellipse cx="9" cy="9" rx="6.5" ry="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>,
  },
  {
    kind: 'line', label: 'Линия',
    icon: <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 15L15 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  },
  {
    kind: 'arrow', label: 'Стрелка',
    icon: <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 15L14 4M14 4H8M14 4v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>,
  },
  {
    kind: 'star', label: 'Звезда',
    icon: <svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 2l2 4.5 4.8.4-3.6 3.2 1.1 4.7L9 12.3l-4.3 2.5 1.1-4.7L2.2 6.9 7 6.5 9 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" /></svg>,
  },
];

export function InsertPanel() {
  const {
    activeDocIndex, documents,
    addShape, updateShape,
    shapeSettings, updateShapeSettings,
    selectedObject, pushHistory,
  } = useStore();
  const pointEditingId = useEditorUiStore(state => state.shapePointEditingId);
  const setPointEditingId = useEditorUiStore(state => state.setShapePointEditingId);

  const hasDoc = activeDocIndex >= 0;
  const activeDoc = hasDoc ? documents[activeDocIndex] : null;
  const selectedShape = selectedObject?.type === 'shape' && activeDoc
    ? (activeDoc.shapes ?? []).find(shape => shape.id === selectedObject.id) ?? null
    : null;
  useEffect(() => () => setPointEditingId(null), [selectedShape?.id, setPointEditingId]);
  const editingPoints = Boolean(selectedShape && pointEditingId === selectedShape.id);
  const currentSettings: ShapeSettings = selectedShape ? {
    fill: selectedShape.fill,
    stroke: selectedShape.stroke,
    strokeWidth: selectedShape.strokeWidth,
    opacity: selectedShape.opacity,
    cornerRadius: selectedShape.cornerRadius,
    fillStyle: selectedShape.fillStyle ?? { type: 'solid', color: selectedShape.fill || '#ffffff' },
    strokeStyle: selectedShape.strokeStyle ?? { type: 'solid', color: selectedShape.stroke || '#000000' },
    glow: selectedShape.glow ?? shapeSettings.glow,
    lineStyle: selectedShape.lineStyle ?? 'solid',
    curve: selectedShape.curve ?? 0.35,
  } : shapeSettings;

  function updateCurrentSettings(updates: Partial<ShapeSettings>, options?: { history?: boolean }) {
    if (selectedShape) updateShape(selectedShape.id, updates, { history: options?.history ?? true });
    else updateShapeSettings(updates);
  }

  function handleAddShape(kind: ShapeKind) {
    if (!activeDoc) return;
    addShape(createShapeFromSettings(kind, shapeSettings));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Shapes */}
      <PanelSection>
        <div className="shape-picker" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {SHAPES.filter(s => s.kind !== 'arrow').map(s => (
            <button
              key={s.kind}
              onClick={() => handleAddShape(s.kind)}
              disabled={!hasDoc}
              title={s.label}
              aria-label={`Добавить: ${s.label}`}
              style={{
                minHeight: 62,
                display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', justifyContent: 'center',
                borderRadius: 6,
                border: '1px solid transparent',
                background: 'transparent',
                color: hasDoc ? 'var(--text-secondary)' : 'var(--text-muted)',
                cursor: hasDoc ? 'pointer' : 'not-allowed',
              }}
              onMouseEnter={e => { if (hasDoc) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; } }}
              onMouseLeave={e => { e.currentTarget.style.color = hasDoc ? 'var(--text-secondary)' : 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
            >
              {s.icon}
              <span style={{ fontSize: 11 }}>{s.label}</span>
            </button>
          ))}
        </div>

        <details className="editor-disclosure">
        <summary>Стрелки и указатели</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {POINTER_PRESETS.map(preset => {
            const symbol: Record<string, string> = {
              arrow: '→',
              'double-arrow': '↔',
              'curved-arrow': '↷',
              'elbow-arrow': '↱',
              'block-arrow': '➜',
              chevron: '❯',
              pointer: '▶',
            };
            return (
              <button
                key={preset.kind}
                type="button"
                onClick={() => handleAddShape(preset.kind)}
                disabled={!hasDoc}
                title={preset.label}
                style={{
                  minHeight: 42,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, borderRadius: 6, border: '1px solid var(--border-default)',
                  background: 'var(--bg-panel-raised)',
                  color: hasDoc ? 'var(--text-secondary)' : 'var(--text-muted)',
                  cursor: hasDoc ? 'pointer' : 'not-allowed',
                }}
              >
                <span style={{ fontSize: 19, lineHeight: 1 }}>{symbol[preset.kind]}</span>
                <span style={{ fontSize: 8 }}>{preset.label}</span>
              </button>
            );
          })}
        </div>
        </details>

        <div className="editor-section-heading">{selectedShape ? 'Свойства фигуры' : 'Оформление новых фигур'}</div>
        {selectedShape && <>
          <button className={`ui-button ${editingPoints ? 'ui-button-primary' : 'ui-button-secondary'}`}
            disabled={selectedShape.locked} aria-pressed={editingPoints}
            onClick={() => {
              useStore.getState().setActiveTool('select');
              setPointEditingId(editingPoints ? null : selectedShape.id);
            }}>
            {editingPoints ? 'Готово · Enter' : 'Редактировать точки'}
          </button>
          {editingPoints && <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Перетаскивайте синие узлы контура. Жёлтые узлы меняют изгиб. Enter или Esc — закончить, Ctrl+Z — отменить перемещение.
          </p>}
          {selectedShape.paths && <button className="ui-button" disabled={selectedShape.locked}
            onClick={() => updateShape(selectedShape.id, { paths: undefined }, { history: true })}>Сбросить контур</button>}
        </>}

        <PanelRow label="Заливка">
          <input
            type="color"
            aria-label="Цвет заливки фигуры"
            value={currentSettings.fill || '#ffffff'}
            onChange={e => updateCurrentSettings({
              fill: e.target.value,
              fillStyle: { type: 'solid', color: e.target.value },
            })}
            style={{ width: 36, height: 28 }}
          />
          <button
            onClick={() => updateCurrentSettings({
              fill: currentSettings.fill ? '' : '#ffffff',
              fillStyle: { type: 'solid', color: currentSettings.fill ? 'transparent' : '#ffffff' },
            })}
            title={currentSettings.fill ? 'Убрать заливку' : 'Включить заливку'}
            style={{
              padding: '3px 6px', fontSize: 10, borderRadius: 4,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-panel-raised)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            {currentSettings.fill ? 'выкл' : 'вкл'}
          </button>
        </PanelRow>

        <PanelRow label="Обводка">
          <input
            type="color"
            aria-label="Цвет обводки фигуры"
            value={currentSettings.stroke || '#000000'}
            onChange={e => updateCurrentSettings({
              stroke: e.target.value,
              strokeStyle: { type: 'solid', color: e.target.value },
            })}
            style={{ width: 36, height: 28 }}
          />
          <input
            type="number"
            aria-label="Толщина обводки фигуры"
            value={currentSettings.strokeWidth}
            min={0}
            max={60}
            onChange={e => updateCurrentSettings({ strokeWidth: Number(e.target.value) })}
            style={{ width: 44 }}
          />
        </PanelRow>

        <PanelSlider
          label={`Непрозрачность ${Math.round(currentSettings.opacity * 100)}%`}
          value={Math.round(currentSettings.opacity * 100)}
          min={5}
          max={100}
          onChange={v => updateCurrentSettings({ opacity: v / 100 })}
        />

        {!selectedShape?.paths && <PanelSlider
          label={`Скругление углов ${currentSettings.cornerRadius}px`}
          value={currentSettings.cornerRadius}
          min={0}
          max={120}
          onChange={v => updateCurrentSettings({ cornerRadius: v })}
        />}

        <details className="editor-disclosure">
        <summary>Эффекты заливки</summary>
        <PaintEditor
          label="Стиль заливки"
          value={currentSettings.fillStyle}
          glow={currentSettings.glow}
          onGestureStart={selectedShape ? pushHistory : undefined}
          onChange={paint => updateCurrentSettings({
            fillStyle: paint,
            ...(paint.type === 'solid' ? { fill: paint.color === 'transparent' ? '' : paint.color } : {}),
          }, { history: false })}
          onGlowChange={glow => updateCurrentSettings({ glow }, { history: false })}
        />

        </details>

        <div>
          <PanelLabel>Линия</PanelLabel>
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              ['solid', 'Сплошная'],
              ['dashed', 'Пунктир'],
              ['dotted', 'Точки'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => updateCurrentSettings({ lineStyle: value })}
                style={{
                  flex: 1, padding: '4px 3px', fontSize: 9, borderRadius: 4,
                  border: currentSettings.lineStyle === value ? '1.5px solid var(--accent)' : '1px solid var(--border-default)',
                  background: currentSettings.lineStyle === value ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {selectedShape
            ? 'Настройки применяются к выбранной фигуре.'
            : 'Настройки применяются к новым фигурам.'}
          {' '}Фигуру можно двигать, свободно растягивать и вращать; Delete — удалить.
        </div>
      </PanelSection>
    </div>
  );
}
