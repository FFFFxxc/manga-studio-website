'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { deleteMaskedPixels, hasActiveSelection, removeBackgroundFromLayer } from '@/utils/layerActions';
import { localRectToDocRect } from '@/utils/coordinates';
import type { LayerReference } from '@/types';
import { ContextMenu } from './floating/ContextMenu';
import { beginEditorOperation, useEditorUiStore } from '@/store/useEditorUiStore';
import { buildBaseCanvas, buildRasterLayerCanvas, computeAlphaBBox, drawPlacedLayer } from '@/utils/cleanupRaster';
import { affineBoundsToPerspective } from '@/utils/perspective';
import { applyRasterEffectToLayer } from '@/utils/rasterEffects';

export interface ContextMenuState {
  x: number;
  y: number;
  target: { id: string; type: 'base' | 'ai' };
}

export function LayerContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const {
    documents, activeDocIndex,
    duplicateAiLayer, duplicateBaseLayer, deleteAiLayer, updateAiLayer, updateBaseLayer, clearEraseElements,
    selectLayer, setRightTab, resetBaseLayerSettings,
    moveLayerForward, moveLayerBackward, moveLayerToTop, moveLayerToBottom,
    setLayerCropTarget, setCropRect, setActiveTool, pushHistory, applyDocumentTransform,
  } = useStore();
  const doc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    useEditorUiStore.getState().registerFloatingDismiss(onClose);
    return () => {
      if (useEditorUiStore.getState().floatingDismiss === onClose) {
        useEditorUiStore.getState().registerFloatingDismiss(null);
      }
    };
  }, [onClose]);

  if (!doc) return null;

  const isBase = menu.target.type === 'base';
  const aiLayer = isBase ? null : doc.aiLayers.find(layer => layer.id === menu.target.id);
  if (!isBase && !aiLayer) return null;

  const layerRef: LayerReference = isBase ? { type: 'base', id: menu.target.id } : { type: 'ai', id: menu.target.id };
  const visible = isBase ? doc.baseLayer?.visible !== false : aiLayer!.visible;
  const locked = isBase ? doc.baseLayer?.locked !== false : aiLayer!.locked === true;
  const opacity = isBase ? (doc.baseLayer?.opacity ?? 1) : aiLayer!.opacity;
  const crop = isBase ? doc.baseLayer?.crop : aiLayer!.crop;
  const eraseCount = isBase ? (doc.baseLayer?.eraseElements.length ?? 0) : (aiLayer!.eraseElements?.length ?? 0);
  const selectionActive = hasActiveSelection(doc);
  const placement = isBase ? doc.baseLayer : aiLayer!;

  const startTransform = () => {
    selectLayer({ id: menu.target.id, type: menu.target.type });
    setActiveTool('select');
    pushHistory();
    beginEditorOperation('transform', 'Трансформация слоя', {
      commit: () => useStore.getState().selectLayer(null),
      cancel: () => {
        const state = useStore.getState();
        state.rollbackPendingHistory();
        state.selectLayer(null);
      },
    });
  };

  const startPerspective = async () => {
    const canvas = isBase
      ? await buildBaseCanvas(doc)
      : await buildRasterLayerCanvas(aiLayer!, doc.width, doc.height);
    const alpha = computeAlphaBBox(canvas, 0);
    if (!alpha) throw new Error('Слой полностью прозрачный. Перспектива недоступна.');
    const cropBounds = placement.crop ? {
      x: placement.crop.x * doc.width,
      y: placement.crop.y * doc.height,
      width: placement.crop.width * doc.width,
      height: placement.crop.height * doc.height,
    } : null;
    const x1 = Math.max(alpha.x, cropBounds?.x ?? 0);
    const y1 = Math.max(alpha.y, cropBounds?.y ?? 0);
    const x2 = Math.min(alpha.x + alpha.width, cropBounds ? cropBounds.x + cropBounds.width : doc.width);
    const y2 = Math.min(alpha.y + alpha.height, cropBounds ? cropBounds.y + cropBounds.height : doc.height);
    if (x2 <= x1 || y2 <= y1) throw new Error('В видимой области слоя нет непрозрачных пикселей.');
    const sourceBounds = { x: x1 / doc.width, y: y1 / doc.height, width: (x2 - x1) / doc.width, height: (y2 - y1) / doc.height };
    const perspective = placement.perspective ?? affineBoundsToPerspective(doc.width, doc.height, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, placement);
    pushHistory();
    if (isBase) useStore.getState().updateBaseLayer({ perspective, perspectiveSourceBounds: sourceBounds }, { history: false });
    else useStore.getState().updateAiLayer(menu.target.id, { perspective, perspectiveSourceBounds: sourceBounds }, { history: false });
    selectLayer({ id: menu.target.id, type: menu.target.type });
    setActiveTool('select');
    beginEditorOperation('perspective', 'Изменение перспективы', {
      commit: () => {
        const state = useStore.getState();
        const identity = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        if (isBase) state.updateBaseLayer(identity, { history: false });
        else state.updateAiLayer(menu.target.id, identity, { history: false });
        state.selectLayer(null);
      },
      cancel: () => {
        const state = useStore.getState();
        state.rollbackPendingHistory();
        state.selectLayer(null);
      },
    });
  };

  const rasterize = async () => {
    const source = isBase ? await buildBaseCanvas(doc) : await buildRasterLayerCanvas(aiLayer!, doc.width, doc.height);
    const canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas недоступен.');
    drawPlacedLayer(context, source, placement, doc.width, doc.height);
    const src = canvas.toDataURL('image/png');
    const reset = { src, opacity: 1, crop: null, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, perspective: null, perspectiveSourceBounds: null };
    if (isBase) {
      const state = useStore.getState();
      const id = `ai-rasterized-${Date.now()}`;
      state.addAiLayer(doc.id, { id, name: `Растрированный ${doc.name}`, src, visible: true, opacity: 1, operation: 'duplicate', locked: false, eraseElements: [], crop: null, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
      state.updateBaseLayer({ visible: false }, { history: false });
    } else {
      useStore.getState().updateAiLayer(menu.target.id, reset);
    }
  };

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

  type MenuItem =
    | { kind: 'item'; key: string; label: string; disabled?: boolean; danger?: boolean; onClick: () => void }
    | { kind: 'separator'; key: string }
    | { kind: 'opacity'; key: string };

  const items: MenuItem[] = [
    {
      kind: 'item',
      key: 'settings',
      label: 'Настройки изображения',
      onClick: () => run('settings', () => { selectLayer({ id: menu.target.id, type: menu.target.type }); setRightTab('layers'); }),
    },
    { kind: 'opacity', key: 'opacity' },
    { kind: 'separator', key: 'sep-1' },
    {
      kind: 'item', key: 'perspective', label: 'Изменить перспективу', disabled: locked,
      onClick: () => run('perspective', startPerspective),
    },
    {
      kind: 'item', key: 'transform', label: 'Трансформировать', disabled: locked,
      onClick: () => run('transform', startTransform),
    },
    {
      kind: 'item',
      key: 'duplicate',
      label: 'Дублировать',
      onClick: () => run('duplicate', () => { if (isBase) duplicateBaseLayer(); else duplicateAiLayer(menu.target.id); }),
    },
    { kind: 'separator', key: 'sep-effects' },
    {
      kind: 'item', key: 'effect-blur', label: 'Размыть весь слой', disabled: locked || !visible,
      onClick: () => run('effect-blur', () => applyRasterEffectToLayer(layerRef, 'blur')),
    },
    {
      kind: 'item', key: 'effect-pixelate', label: 'Пикселизировать весь слой', disabled: locked || !visible,
      onClick: () => run('effect-pixelate', () => applyRasterEffectToLayer(layerRef, 'pixelate')),
    },
    {
      kind: 'item', key: 'effect-noise', label: 'Добавить шум на слой', disabled: locked || !visible,
      onClick: () => run('effect-noise', () => applyRasterEffectToLayer(layerRef, 'noise')),
    },
    {
      kind: 'item', key: 'effect-sharpen', label: 'Повысить резкость слоя', disabled: locked || !visible,
      onClick: () => run('effect-sharpen', () => applyRasterEffectToLayer(layerRef, 'sharpen')),
    },
    { kind: 'separator', key: 'sep-after-effects' },
    {
      kind: 'item',
      key: 'remove-bg',
      label: 'Удалить фон (Clipdrop)',
      onClick: () => run('remove-bg', () => removeBackgroundFromLayer(menu.target)),
    },
    {
      kind: 'item',
      key: 'delete-pixels',
      label: 'Удалить пиксели по выделению',
      disabled: !selectionActive || locked,
      onClick: () => run('delete-pixels', () => deleteMaskedPixels(menu.target)),
    },
    ...(!isBase ? [{
      kind: 'item' as const,
      key: 'clear-erase',
      label: `Восстановить стёртое${eraseCount ? ` (${eraseCount})` : ''}`,
      disabled: eraseCount === 0 || locked,
      onClick: () => run('clear-erase', () => clearEraseElements({ id: menu.target.id, type: 'ai' })),
    }] : []),
    ...(isBase && eraseCount > 0 ? [{
      kind: 'item' as const,
      key: 'clear-erase',
      label: `Восстановить стёртое (${eraseCount})`,
      disabled: locked,
      onClick: () => run('clear-erase', () => clearEraseElements({ type: 'base' })),
    }] : []),
    {
      kind: 'item',
      key: 'crop',
      label: crop ? 'Кадрировать слой (изменить)' : 'Кадрировать слой',
      disabled: locked,
      onClick: () => run('crop', () => {
        selectLayer({ id: menu.target.id, type: menu.target.type });
        setLayerCropTarget(layerRef);
        // The crop frame lives in document space, but the layer may be moved,
        // scaled or rotated — open the frame where the layer's visible content
        // actually is on screen, not at its untransformed position.
        const placement = isBase ? doc.baseLayer : aiLayer!;
        const initial = crop ?? { x: 0, y: 0, width: 1, height: 1 };
        setCropRect(placement && !placement.perspective
          ? localRectToDocRect(initial, placement, doc.width, doc.height)
          : initial);
        setActiveTool('crop');
        beginEditorOperation('crop', 'Кадрирование слоя', {
          commit: () => useStore.getState().applyLayerCrop(),
          cancel: () => useStore.getState().cancelLayerCrop(),
        });
      }),
    },
    {
      kind: 'item', key: 'rename', label: 'Переименовать слой',
      onClick: () => run('rename', () => {
        const name = window.prompt('Новое имя слоя', isBase ? doc.name : aiLayer!.name)?.trim();
        if (!name) return;
        if (isBase) applyDocumentTransform({ name });
        else updateAiLayer(menu.target.id, { name });
      }),
    },
    { kind: 'item', key: 'rasterize', label: 'Растрировать', disabled: locked, onClick: () => run('rasterize', rasterize) },
    {
      kind: 'item', key: 'reset-transform', label: 'Сбросить трансформации', disabled: locked,
      onClick: () => run('reset-transform', () => {
        const reset = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, perspective: null, perspectiveSourceBounds: null };
        if (isBase) updateBaseLayer(reset);
        else updateAiLayer(menu.target.id, reset);
      }),
    },
    { kind: 'separator', key: 'sep-2' },
    {
      kind: 'item',
      key: 'visibility',
      label: visible ? 'Скрыть' : 'Показать',
      onClick: () => run('visibility', () => {
        if (isBase) updateBaseLayer({ visible: !visible });
        else updateAiLayer(menu.target.id, { visible: !visible });
      }),
    },
    {
      kind: 'item',
      key: 'lock',
      label: locked ? 'Разблокировать' : 'Заблокировать',
      onClick: () => run('lock', () => {
        if (isBase) updateBaseLayer({ locked: !locked });
        else updateAiLayer(menu.target.id, { locked: !locked });
      }),
    },
    { kind: 'separator', key: 'sep-3' },
    { kind: 'item', key: 'forward', label: 'Поднять выше', onClick: () => run('forward', () => moveLayerForward(layerRef)) },
    { kind: 'item', key: 'backward', label: 'Опустить ниже', onClick: () => run('backward', () => moveLayerBackward(layerRef)) },
    { kind: 'item', key: 'to-top', label: 'На самый верх', onClick: () => run('to-top', () => moveLayerToTop(layerRef)) },
    { kind: 'item', key: 'to-bottom', label: 'На самый низ', onClick: () => run('to-bottom', () => moveLayerToBottom(layerRef)) },
    { kind: 'separator', key: 'sep-4' },
  ];

  if (isBase) {
    items.push({
      kind: 'item',
      key: 'reset',
      label: 'Сбросить настройки',
      disabled: locked,
      onClick: () => run('reset', () => resetBaseLayerSettings()),
    });
  } else {
    items.push({
      kind: 'item',
      key: 'delete',
      label: 'Удалить слой',
      danger: true,
      onClick: () => run('delete', () => deleteAiLayer(menu.target.id)),
    });
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      label={isBase ? 'Действия с исходником' : 'Действия со слоем'}
    >
      <div style={{ padding: '5px 10px 7px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {isBase ? `Оригинал — ${doc.name}` : aiLayer!.name}
      </div>
      {items.map(item => {
        if (item.kind === 'separator') {
          return <div key={item.key} role="separator" style={{ height: 1, background: 'var(--border-default)', margin: '4px 6px' }} />;
        }
        if (item.kind === 'opacity') {
          return (
            <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Прозрачность</span>
              <input
                aria-label="Прозрачность слоя"
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                onWheel={event => { event.preventDefault(); event.stopPropagation(); }}
                onPointerDown={() => pushHistory()}
                onChange={e => {
                  const value = Number(e.target.value) / 100;
                  if (isBase) updateBaseLayer({ opacity: value }, { history: false });
                  else updateAiLayer(menu.target.id, { opacity: value }, { history: false });
                }}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>{Math.round(opacity * 100)}%</span>
            </div>
          );
        }
        return (
          <button
            key={item.key}
            role="menuitem"
            type="button"
            disabled={item.disabled || busy !== null}
            onClick={item.onClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              textAlign: 'left',
              borderRadius: 5,
              border: 'none',
              background: 'transparent',
              color: item.disabled ? 'var(--text-muted)' : item.danger ? 'var(--danger)' : 'var(--text-primary)',
              cursor: item.disabled || busy !== null ? 'not-allowed' : 'pointer',
              opacity: busy && busy !== item.key ? 0.6 : 1,
            }}
            onMouseEnter={e => { if (!item.disabled && !busy) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.06))'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            {busy === item.key ? 'Выполняется…' : item.label}
          </button>
        );
      })}
    </ContextMenu>
  );
}
