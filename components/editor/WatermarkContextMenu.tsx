'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { beginEditorOperation, useEditorUiStore } from '@/store/useEditorUiStore';
import type { AiRasterLayer, ImageDocument, RasterEffectMode, WatermarkObject } from '@/types';
import { computeAlphaBBox } from '@/utils/cleanupRaster';
import { uid } from '@/utils/imageUtils';
import { resolveLayerOrder } from '@/utils/layerOrder';
import { affineBoundsToPerspective } from '@/utils/perspective';
import { renderRasterEffect } from '@/utils/rasterEffectPrimitives';
import { canvasToPersistentDataUrl, registerRuntimeRasterSource } from '@/utils/runtimeRasterSources';
import { drawWatermarkToContext } from '@/utils/watermarkRenderer';
import { ContextMenu } from './floating/ContextMenu';

export interface WatermarkContextMenuState {
  x: number;
  y: number;
  watermarkId: string;
}

export async function createWatermarkCanvas(document: ImageDocument, watermark: WatermarkObject) {
  try { await window.document.fonts.ready; } catch { /* best-effort font readiness */ }
  const canvas = window.document.createElement('canvas');
  canvas.width = document.width;
  canvas.height = document.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas недоступен.');
  await drawWatermarkToContext(context, watermark, document.width, document.height);
  return canvas;
}

function effectParameters(mode: RasterEffectMode) {
  const settings = useStore.getState().blurSettings;
  return {
    radius: mode === 'sharpen' ? settings.sharpenRadius : settings.radius,
    strength: mode === 'noise' ? 1 : mode === 'sharpen' ? settings.sharpenAmount : settings.strength,
    cellSize: settings.cellSize,
    noiseAmount: settings.noiseAmount,
    noiseMonochrome: settings.noiseMonochrome,
    seed: Date.now() >>> 0,
  };
}

function effectCanvasForWatermark(source: HTMLCanvasElement, mode: RasterEffectMode) {
  const alpha = computeAlphaBBox(source, 0);
  if (!alpha) throw new Error('Вотерка полностью прозрачная. Эффект недоступен.');
  const parameters = effectParameters(mode);
  const padding = mode === 'blur'
    ? Math.ceil(parameters.radius * 3)
    : mode === 'sharpen'
      ? Math.ceil(parameters.radius)
      : mode === 'pixelate'
        ? Math.ceil(parameters.cellSize)
        : 0;
  const x = Math.max(0, alpha.x - padding);
  const y = Math.max(0, alpha.y - padding);
  const right = Math.min(source.width, alpha.x + alpha.width + padding);
  const bottom = Math.min(source.height, alpha.y + alpha.height + padding);
  const bounds = { x, y, width: right - x, height: bottom - y };
  const patch = renderRasterEffect(source, bounds, mode, parameters);
  const output = window.document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Canvas недоступен.');
  if (mode === 'pixelate') context.imageSmoothingEnabled = false;
  context.drawImage(patch, bounds.x, bounds.y);
  return output;
}

export async function replaceWatermarkWithRaster(
  document: ImageDocument,
  watermark: WatermarkObject,
  source: HTMLCanvasElement,
  overrides: Partial<AiRasterLayer> = {},
) {
  const initialState = useStore.getState();
  const initialDocument = initialState.documents[initialState.activeDocIndex];
  if (!initialDocument || initialDocument.id !== document.id || !initialDocument.watermarks.some(item => item.id === watermark.id)) {
    throw new Error('Вотерка больше не существует.');
  }
  const src = await canvasToPersistentDataUrl(source);
  registerRuntimeRasterSource(src, source);
  const state = useStore.getState();
  const latest = state.documents[state.activeDocIndex];
  if (!latest || latest.id !== document.id || !latest.watermarks.some(item => item.id === watermark.id)) {
    throw new Error('Вотерка изменилась до завершения растеризации. Повторите действие.');
  }
  const id = `watermark-raster-${uid()}`;
  const name = watermark.type === 'text' && watermark.text
    ? `Вотерка: ${watermark.text.slice(0, 24)}`
    : 'Вотерка: изображение';
  const layer: AiRasterLayer = {
    id,
    name,
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
    ref.type === 'watermark' && ref.id === watermark.id
      ? { type: 'ai' as const, id }
      : ref
  ));

  state.pushHistory();
  state.applyDocumentTransform({
    watermarks: latest.watermarks.filter(item => item.id !== watermark.id),
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

export function WatermarkContextMenu({ menu, onClose }: { menu: WatermarkContextMenuState; onClose: () => void }) {
  const store = useStore();
  const document = store.activeDocIndex >= 0 ? store.documents[store.activeDocIndex] : null;
  const watermark = document?.watermarks.find(item => item.id === menu.watermarkId) ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    useEditorUiStore.getState().registerFloatingDismiss(onClose);
    return () => {
      if (useEditorUiStore.getState().floatingDismiss === onClose) {
        useEditorUiStore.getState().registerFloatingDismiss(null);
      }
    };
  }, [onClose]);

  if (!document || !watermark) return null;
  const watermarkRef = { type: 'watermark' as const, id: watermark.id };
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
    store.setSelectedObject({ id: watermark.id, type: 'watermark' });
    store.setActiveTool('select');
    store.pushHistory();
    beginEditorOperation('transform', 'Трансформация вотерки', {
      commit: () => useStore.getState().setSelectedObject(null),
      cancel: () => {
        const state = useStore.getState();
        state.rollbackPendingHistory();
        state.setSelectedObject(null);
      },
    });
  };

  const rasterize = async (mode?: RasterEffectMode) => {
    const canvas = await createWatermarkCanvas(document, watermark);
    // Watermarks usually occupy a tiny fraction of a manga page. Process only
    // their alpha bounds so a 4K page does not run a pixel loop over every
    // transparent pixel merely to blur or pixelate a small logo.
    const output = mode ? effectCanvasForWatermark(canvas, mode) : canvas;
    return replaceWatermarkWithRaster(document, watermark, output);
  };

  const startPerspective = async () => {
    const canvas = await createWatermarkCanvas(document, watermark);
    const alpha = computeAlphaBBox(canvas, 0);
    if (!alpha) throw new Error('Вотерка полностью прозрачная. Перспектива недоступна.');
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
    const id = await replaceWatermarkWithRaster(document, watermark, canvas, { perspective, perspectiveSourceBounds });
    beginEditorOperation('perspective', 'Перспектива вотерки', {
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
        fontSize: 12, textAlign: 'left', borderRadius: 5, border: 'none', background: 'transparent',
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
    <ContextMenu x={menu.x} y={menu.y} onClose={onClose} label="Действия с вотеркой" minWidth={280}>
      <div style={{ padding: '5px 10px 7px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Вотерка — {watermark.type === 'text' ? 'текст' : 'изображение'}
      </div>
      {button('settings', 'Настройки вотерки', () => {
        store.selectLayer(null);
        store.setSelectedObject({ id: watermark.id, type: 'watermark' });
        store.setLeftTab('watermark');
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Прозрачность</span>
        <input
          aria-label="Прозрачность вотерки"
          type="range"
          min={0}
          max={100}
          value={Math.round(watermark.opacity * 100)}
          onWheel={event => { event.preventDefault(); event.stopPropagation(); }}
          onPointerDown={() => store.pushHistory()}
          onChange={event => store.updateWatermark(watermark.id, { opacity: Number(event.target.value) / 100 })}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>{Math.round(watermark.opacity * 100)}%</span>
      </div>
      {separator('sep-transform')}
      {button('transform', 'Трансформировать', startTransform, { disabled: watermark.locked })}
      {button('perspective', 'Перспектива (в растр)', startPerspective, { disabled: watermark.locked || !watermark.visible })}
      {button('duplicate', 'Дублировать', () => {
        store.setSelectedObject({ id: watermark.id, type: 'watermark' });
        store.duplicateSelectedObject();
      })}
      {separator('sep-effects')}
      {button('blur', 'Размыть вотерку (в растр)', () => rasterize('blur'), { disabled: watermark.locked || !watermark.visible })}
      {button('pixelate', 'Пикселизировать (в растр)', () => rasterize('pixelate'), { disabled: watermark.locked || !watermark.visible })}
      {button('noise', 'Добавить шум (в растр)', () => rasterize('noise'), { disabled: watermark.locked || !watermark.visible })}
      {button('sharpen', 'Повысить резкость (в растр)', () => rasterize('sharpen'), { disabled: watermark.locked || !watermark.visible })}
      {button('rasterize', 'Растрировать без эффекта', () => rasterize(), { disabled: watermark.locked || !watermark.visible })}
      <div style={{ padding: '4px 10px 7px', fontSize: 10, lineHeight: 1.35, color: 'var(--text-muted)' }}>
        Перспектива и пиксельные эффекты превращают вотерку в растровый слой. Ctrl+Z возвращает редактируемую вотерку.
      </div>
      {separator('sep-state')}
      {button('visibility', watermark.visible ? 'Скрыть' : 'Показать', () => {
        store.pushHistory();
        store.updateWatermark(watermark.id, { visible: !watermark.visible });
      })}
      {button('lock', watermark.locked ? 'Разблокировать' : 'Заблокировать', () => {
        store.pushHistory();
        store.updateWatermark(watermark.id, { locked: !watermark.locked });
      })}
      {separator('sep-order')}
      {button('forward', 'Поднять выше', () => store.moveLayerForward(watermarkRef))}
      {button('backward', 'Опустить ниже', () => store.moveLayerBackward(watermarkRef))}
      {button('top', 'На самый верх', () => store.moveLayerToTop(watermarkRef))}
      {button('bottom', 'На самый низ', () => store.moveLayerToBottom(watermarkRef))}
      {separator('sep-delete')}
      {button('delete', 'Удалить вотерку', () => store.deleteWatermark(watermark.id), { danger: true })}
    </ContextMenu>
  );
}
