'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { resizeDocument, cropDocument } from '@/utils/imageUtils';
import { PanelLabel, PanelSection, PanelButton } from './PanelComponents';
import { affineToPerspective } from '@/utils/perspective';
import { canTransformRasterLayer } from '@/utils/layerGuards';

export function TransformPanel() {
  const {
    documents, activeDocIndex,
    activeTool, setActiveTool,
    cropRect, setCropRect,
    applyDocumentTransform,
    layerCropTarget, applyLayerCrop, cancelLayerCrop,
    updateBasePerspective, updateAiLayerPerspective, pushHistory,
  } = useStore();

  const activeDoc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;

  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lockAspect, setLockAspect] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync inputs with the active document
  useEffect(() => {
    if (activeDoc) {
      setWidth(activeDoc.width);
      setHeight(activeDoc.height);
    }
  }, [activeDoc?.id, activeDoc?.width, activeDoc?.height]);

  if (!activeDoc) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
        Загрузите изображение
      </div>
    );
  }

  const aspect = activeDoc.width / activeDoc.height;

  function handleWidthChange(v: number) {
    setWidth(v);
    if (lockAspect && v > 0) setHeight(Math.round(v / aspect));
  }

  function handleHeightChange(v: number) {
    setHeight(v);
    if (lockAspect && v > 0) setWidth(Math.round(v * aspect));
  }

  function applyPercent(pct: number) {
    if (!activeDoc) return;
    setWidth(Math.max(1, Math.round(activeDoc.width * pct)));
    setHeight(Math.max(1, Math.round(activeDoc.height * pct)));
  }

  async function handleResize() {
    if (!activeDoc || width < 1 || height < 1) return;
    if (width === activeDoc.width && height === activeDoc.height) return;
    if (width > 8000 || height > 8000) {
      setError('Максимум 8000px по стороне.');
      return;
    }
    setIsWorking(true);
    setError(null);
    try {
      const updates = await resizeDocument(activeDoc, width, height);
      applyDocumentTransform(updates);
    } catch {
      setError('Не удалось изменить размер.');
    } finally {
      setIsWorking(false);
    }
  }

  function startCrop() {
    setCropRect({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    setActiveTool('crop');
  }

  function cancelCrop() {
    if (layerCropTarget) { cancelLayerCrop(); return; }
    setCropRect(null);
    setActiveTool('select');
  }

  async function handleApplyCrop() {
    if (!activeDoc || !cropRect) return;
    // Layer crop is non-destructive and handled entirely by the store.
    if (layerCropTarget) { applyLayerCrop(); return; }
    setIsWorking(true);
    setError(null);
    try {
      const updates = await cropDocument(activeDoc, cropRect);
      applyDocumentTransform(updates);
      setActiveTool('select');
    } catch {
      setError('Не удалось обрезать изображение.');
    } finally {
      setIsWorking(false);
    }
  }

  const isCropping = activeTool === 'crop' && cropRect;
  const selectedLayer = activeDoc.selectedLayer;
  const selectedRaster = selectedLayer?.type === 'base'
    ? activeDoc.baseLayer
    : selectedLayer?.type === 'ai'
      ? activeDoc.aiLayers.find(layer => layer.id === selectedLayer.id) ?? null
      : null;
  const perspectiveEnabled = Boolean(selectedRaster?.perspective);
  const canTransformPerspective = canTransformRasterLayer(activeDoc, selectedLayer);

  function enablePerspective() {
    if (!selectedLayer || !selectedRaster) return;
    if (!canTransformPerspective) {
      setError('Слой заблокирован — сначала снимите замок.');
      return;
    }
    const quad = affineToPerspective(activeDoc!.width, activeDoc!.height, selectedRaster);
    pushHistory();
    if (selectedLayer.type === 'base') {
      updateBasePerspective(quad, { history: false });
    } else if (selectedLayer.type === 'ai') {
      updateAiLayerPerspective(selectedLayer.id, quad, { history: false });
    }
    setActiveTool('select');
  }

  function resetPerspective() {
    if (!selectedLayer || !selectedRaster) return;
    if (!canTransformPerspective) {
      setError('Слой заблокирован — сначала снимите замок.');
      return;
    }
    pushHistory();
    if (selectedLayer.type === 'base') {
      updateBasePerspective(null, { history: false });
    }
    if (selectedLayer.type === 'ai') {
      updateAiLayerPerspective(selectedLayer.id, null, { history: false });
    }
    setActiveTool('select');
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-panel-raised)',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontSize: 12,
    padding: '5px 8px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-label">Размер и обрезка</div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Текущий размер: {activeDoc.width}×{activeDoc.height}px
      </div>

      <PanelSection title="Деформация слоя">
        {selectedRaster ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {selectedLayer?.type === 'base'
                ? 'Оригинал'
                : activeDoc.aiLayers.find(layer => layer.id === selectedLayer?.id)?.name ?? 'Растровый слой'}. В режиме перспективы потяните любой из четырёх углов на холсте.
            </div>
            {!canTransformPerspective && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Слой заблокирован — сначала снимите замок.
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <PanelButton variant={perspectiveEnabled ? 'secondary' : 'primary'} fullWidth onClick={resetPerspective} disabled={!perspectiveEnabled || !canTransformPerspective}>
                Обычная
              </PanelButton>
              <PanelButton variant={perspectiveEnabled ? 'primary' : 'secondary'} fullWidth onClick={enablePerspective} disabled={perspectiveEnabled || !canTransformPerspective}>
                Перспектива
              </PanelButton>
            </div>
            {perspectiveEnabled && (
              <PanelButton variant="secondary" fullWidth onClick={resetPerspective} disabled={!canTransformPerspective}>
                Сбросить перспективу
              </PanelButton>
            )}
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Выберите базовое изображение или растровый слой в панели «Слои».
          </div>
        )}
      </PanelSection>

      <div className="divider" />

      {/* Resize */}
      <PanelSection title="Изменить размер">
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <PanelLabel>Ширина</PanelLabel>
            <input
              type="number"
              min={1}
              max={8000}
              value={width || ''}
              onChange={e => handleWidthChange(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <button
            onClick={() => setLockAspect(!lockAspect)}
            title={lockAspect ? 'Пропорции связаны' : 'Пропорции свободны'}
            style={{
              padding: '5px 7px', fontSize: 13, borderRadius: 6, marginBottom: 1,
              border: '1px solid var(--border-default)',
              background: lockAspect ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
              color: lockAspect ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            {lockAspect ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 8h6M6.5 5H5a3 3 0 000 6h1.5M9.5 5H11a3 3 0 010 6H9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 5H5a3 3 0 000 6h1.5M9.5 5H11a3 3 0 010 6H9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            )}
          </button>
          <div style={{ flex: 1 }}>
            <PanelLabel>Высота</PanelLabel>
            <input
              type="number"
              min={1}
              max={8000}
              value={height || ''}
              onChange={e => handleHeightChange(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {[0.25, 0.5, 0.75, 2].map(pct => (
            <button
              key={pct}
              onClick={() => applyPercent(pct)}
              style={{
                flex: 1, padding: '4px', fontSize: 11, borderRadius: 5,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-panel-raised)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              {pct * 100}%
            </button>
          ))}
        </div>

        <PanelButton
          variant="primary"
          fullWidth
          onClick={handleResize}
          disabled={isWorking || (width === activeDoc.width && height === activeDoc.height)}
        >
          {isWorking ? 'Обработка…' : 'Применить размер'}
        </PanelButton>
      </PanelSection>

      <div className="divider" />

      {/* Crop */}
      <PanelSection title="Обрезка">
        {!isCropping ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Нажмите «Начать обрезку» и выделите область рамкой на холсте.
            </div>
            <PanelButton variant="secondary" fullWidth onClick={startCrop}>
              Начать обрезку
            </PanelButton>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, color: 'var(--accent)', lineHeight: 1.5 }}>
              Перетаскивайте рамку на холсте. Новый размер: {Math.round(cropRect.width * activeDoc.width)}×{Math.round(cropRect.height * activeDoc.height)}px
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <PanelButton variant="primary" fullWidth onClick={handleApplyCrop} disabled={isWorking}>
                {isWorking ? 'Обработка…' : 'Обрезать'}
              </PanelButton>
              <PanelButton variant="secondary" fullWidth onClick={cancelCrop} disabled={isWorking}>
                Отмена
              </PanelButton>
            </div>
          </>
        )}
      </PanelSection>

      {error && (
        <div style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Изменение размера и обрезка очищают историю отмены для этого изображения.
      </div>
    </div>
  );
}
