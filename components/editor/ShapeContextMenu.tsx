'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { beginEditorOperation, useEditorUiStore } from '@/store/useEditorUiStore';
import type { AiRasterLayer, ImageDocument, RasterEffectMode, ShapeObject } from '@/types';
import { computeAlphaBBox } from '@/utils/cleanupRaster';
import { drawShapeToContext } from '@/utils/drawVectorObject';
import { uid } from '@/utils/imageUtils';
import { resolveLayerOrder } from '@/utils/layerOrder';
import { affineBoundsToPerspective } from '@/utils/perspective';
import { renderRasterEffect } from '@/utils/rasterEffectPrimitives';
import { canvasToPersistentDataUrl, registerRuntimeRasterSource } from '@/utils/runtimeRasterSources';
import { ContextMenu } from './floating/ContextMenu';

export interface ShapeContextMenuState {
  x: number;
  y: number;
  shapeId: string;
}

function createShapeCanvas(document: ImageDocument, shape: ShapeObject) {
  const canvas = window.document.createElement('canvas');
  canvas.width = document.width;
  canvas.height = document.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas недоступен.');
  drawShapeToContext(context, shape, document.width, document.height);
  return canvas;
}

function effectParameters(mode: RasterEffectMode) {
  const settings = useStore.getState().blurSettings;
  return {
    radius: mode === 'sharpen' ? settings.sharpenRadius : settings.radius,
    strength: mode === 'noise'
      ? 1
      : mode === 'sharpen'
        ? settings.sharpenAmount
        : settings.strength,
    cellSize: settings.cellSize,
    noiseAmount: settings.noiseAmount,
    noiseMonochrome: settings.noiseMonochrome,
    seed: Date.now() >>> 0,
  };
}

export async function replaceShapeWithRaster(
  document: ImageDocument,
  shape: ShapeObject,
  source: HTMLCanvasElement,
  overrides: Partial<AiRasterLayer> = {},
) {
  const initialState = useStore.getState();
  const initialDocument = initialState.documents[initialState.activeDocIndex];
  if (!initialDocument || initialDocument.id !== document.id || !(initialDocument.shapes ?? []).some(item => item.id === shape.id)) {
    throw new Error('Фигура больше не существует.');
  }
  // PNG encoding can be expensive on a large manga page. Yield it through
  // toBlob and retain the live canvas in the runtime cache for instant preview.
  const src = await canvasToPersistentDataUrl(source);
  registerRuntimeRasterSource(src, source);
  const state = useStore.getState();
  const latest = state.documents[state.activeDocIndex];
  if (!latest || latest.id !== document.id || !(latest.shapes ?? []).some(item => item.id === shape.id)) {
    throw new Error('Фигура изменилась до завершения растеризации. Повторите действие.');
  }
  const id = `shape-raster-${uid()}`;
  const layer: AiRasterLayer = {
    id,
    name: `Фигура: ${shape.kind}`,
    src,
    visible: true,
    opacity: 1,
    operation: 'effect',
    locked: false,
    eraseElements: [],
    crop: null,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    perspective: null,
    perspectiveSourceBounds: null,
    ...overrides,
  };
  const layerOrder = resolveLayerOrder(latest).map(ref => (
    ref.type === 'shape' && ref.id === shape.id
      ? { type: 'ai' as const, id }
      : ref
  ));

  state.pushHistory();
  state.applyDocumentTransform({
    shapes: (latest.shapes ?? []).filter(item => item.id !== shape.id),
    aiLayers: [...latest.aiLayers, layer],
    layerOrder,
    selectedLayer: { id, type: 'ai' },
    hasChanges: true,
  });
  state.selectLayer({ id, type: 'ai' });
  state.setSelectedObject(null);
  state.setActiveTool('select');
  return id;
}

export function ShapeContextMenu({ menu, onClose }: { menu: ShapeContextMenuState; onClose: () => void }) {
  const store = useStore();
  const document = store.activeDocIndex >= 0 ? store.documents[store.activeDocIndex] : null;
  const shape = document?.shapes?.find(item => item.id === menu.shapeId) ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    useEditorUiStore.getState().registerFloatingDismiss(onClose);
    return () => {
      if (useEditorUiStore.getState().floatingDismiss === onClose) {
        useEditorUiStore.getState().registerFloatingDismiss(null);
      }
    };
  }, [onClose]);

  if (!document || !shape) return null;

  const shapeRef = { type: 'shape' as const, id: shape.id };
  const run = async (key: string, action: () => Promise<unknown> | void, keepOpen = false) => {
    setBusy(key);
    try {
      await action();
      if (!keepOpen) onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
    } finally {
      setBusy(null);
    }
  };

  const startTransform = () => {
    store.selectLayer(null);
    store.setSelectedObject({ id: shape.id, type: 'shape' });
    store.setActiveTool('select');
    store.pushHistory();
    beginEditorOperation('transform', 'Трансформация фигуры', {
      commit: () => useStore.getState().setSelectedObject(null),
      cancel: () => {
        const state = useStore.getState();
        state.rollbackPendingHistory();
        state.setSelectedObject(null);
      },
    });
  };

  const rasterize = async (mode?: RasterEffectMode) => {
    const canvas = createShapeCanvas(document, shape);
    const output = mode
      ? renderRasterEffect(
          canvas,
          { x: 0, y: 0, width: canvas.width, height: canvas.height },
          mode,
          effectParameters(mode),
        )
      : canvas;
    return replaceShapeWithRaster(document, shape, output);
  };

  const startPerspective = async () => {
    const canvas = createShapeCanvas(document, shape);
    const alpha = computeAlphaBBox(canvas, 0);
    if (!alpha) throw new Error('Фигура полностью прозрачная. Перспектива недоступна.');
    const perspectiveSourceBounds = {
      x: alpha.x / document.width,
      y: alpha.y / document.height,
      width: alpha.width / document.width,
      height: alpha.height / document.height,
    };
    const perspective = affineBoundsToPerspective(
      document.width,
      document.height,
      alpha,
      { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    );
    const id = await replaceShapeWithRaster(document, shape, canvas, { perspective, perspectiveSourceBounds });
    beginEditorOperation('perspective', 'Перспектива фигуры', {
      commit: () => {
        const state = useStore.getState();
        state.updateAiLayer(id, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, { history: false });
        state.selectLayer(null);
      },
      cancel: () => {
        const state = useStore.getState();
        state.rollbackPendingHistory();
        state.selectLayer(null);
      },
    });
  };

  const button = (
    key: string,
    label: string,
    action: () => Promise<unknown> | void,
    options: { disabled?: boolean; danger?: boolean } = {},
  ) => (
    <button
      key={key}
      role="menuitem"
      type="button"
      disabled={options.disabled || busy !== null}
      onClick={() => { void run(key, action); }}
      style={{
        display: 'flex', alignItems: 'center', width: '100%', padding: '6px 10px',
        fontSize: 12, textAlign: 'left', borderRadius: 5, border: 'none',
        background: 'transparent',
        color: options.disabled ? 'var(--text-muted)' : options.danger ? 'var(--danger)' : 'var(--text-primary)',
        cursor: options.disabled || busy !== null ? 'not-allowed' : 'pointer',
        opacity: busy && busy !== key ? 0.6 : 1,
      }}
      onMouseEnter={event => { if (!options.disabled && !busy) event.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))'; }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
    >
      {busy === key ? 'Выполняется…' : label}
    </button>
  );
  const separator = (key: string) => <div key={key} role="separator" style={{ height: 1, background: 'var(--border-default)', margin: '4px 6px' }} />;

  return (
    <ContextMenu x={menu.x} y={menu.y} onClose={onClose} label="Действия с фигурой" minWidth={270}>
      <div style={{ padding: '5px 10px 7px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Фигура — {shape.kind}
      </div>
      {button('settings', 'Настройки фигуры', () => {
        store.selectLayer(null);
        store.setSelectedObject({ id: shape.id, type: 'shape' });
        store.setLeftTab('insert');
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Прозрачность</span>
        <input
          aria-label="Прозрачность фигуры"
          type="range"
          min={0}
          max={100}
          value={Math.round(shape.opacity * 100)}
          onWheel={event => { event.preventDefault(); event.stopPropagation(); }}
          onPointerDown={() => store.pushHistory()}
          onChange={event => store.updateShape(shape.id, { opacity: Number(event.target.value) / 100 }, { history: false })}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>{Math.round(shape.opacity * 100)}%</span>
      </div>
      {separator('sep-transform')}
      {button('transform', 'Трансформировать', startTransform, { disabled: shape.locked })}
      {button('perspective', 'Перспектива (в растр)', startPerspective, { disabled: shape.locked || !shape.visible })}
      {button('duplicate', 'Дублировать', () => {
        store.setSelectedObject({ id: shape.id, type: 'shape' });
        store.duplicateSelectedObject();
      })}
      {separator('sep-effects')}
      {button('blur', 'Размыть фигуру (в растр)', () => rasterize('blur'), { disabled: shape.locked || !shape.visible })}
      {button('pixelate', 'Пикселизировать (в растр)', () => rasterize('pixelate'), { disabled: shape.locked || !shape.visible })}
      {button('noise', 'Добавить шум (в растр)', () => rasterize('noise'), { disabled: shape.locked || !shape.visible })}
      {button('sharpen', 'Повысить резкость (в растр)', () => rasterize('sharpen'), { disabled: shape.locked || !shape.visible })}
      {button('rasterize', 'Растрировать без эффекта', () => rasterize(), { disabled: shape.locked || !shape.visible })}
      <div style={{ padding: '4px 10px 7px', fontSize: 10, lineHeight: 1.35, color: 'var(--text-muted)' }}>
        Перспектива и пиксельные эффекты превращают фигуру в растровый слой. Ctrl+Z возвращает редактируемую фигуру.
      </div>
      {separator('sep-state')}
      {button('visibility', shape.visible ? 'Скрыть' : 'Показать', () => store.updateShape(shape.id, { visible: !shape.visible }, { history: true }))}
      {button('lock', shape.locked ? 'Разблокировать' : 'Заблокировать', () => store.updateShape(shape.id, { locked: !shape.locked }, { history: true }))}
      {separator('sep-order')}
      {button('forward', 'Поднять выше', () => store.moveLayerForward(shapeRef))}
      {button('backward', 'Опустить ниже', () => store.moveLayerBackward(shapeRef))}
      {button('top', 'На самый верх', () => store.moveLayerToTop(shapeRef))}
      {button('bottom', 'На самый низ', () => store.moveLayerToBottom(shapeRef))}
      {separator('sep-delete')}
      {button('delete', 'Удалить фигуру', () => store.deleteShape(shape.id), { danger: true })}
    </ContextMenu>
  );
}
