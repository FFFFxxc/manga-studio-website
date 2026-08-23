'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { uid } from '@/utils/imageUtils';
import type { WatermarkObject } from '@/types';
import { MANGA_FONTS } from '@/types';
import { PanelRow, PanelSlider, PanelLabel } from './PanelComponents';

export function WatermarkPanel() {
  const {
    wmSettings, updateWmSettings, addWatermark, batchApplyWatermark, activeDocIndex, documents,
    selectedObject, setSelectedObject, setActiveTool, updateWatermark, pushHistory,
  } = useStore();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const selectedLogoInputRef = useRef<HTMLInputElement>(null);
  const editedFieldRef = useRef<string | null>(null);
  const hasDoc = activeDocIndex >= 0;
  const activeDocument = hasDoc ? documents[activeDocIndex] : null;
  const selectedWatermark = selectedObject?.type === 'watermark'
    ? activeDocument?.watermarks.find(item => item.id === selectedObject.id) ?? null
    : null;

  const beginSelectedEdit = (field: string) => {
    if (editedFieldRef.current === field) return;
    editedFieldRef.current = field;
    pushHistory();
  };
  const endSelectedEdit = () => { editedFieldRef.current = null; };

  useEffect(() => {
    editedFieldRef.current = null;
  }, [selectedWatermark?.id]);

  function handleAddWatermark() {
    if (!hasDoc) return;
    const wm: WatermarkObject = {
      id: uid(),
      type: wmSettings.type,
      text: wmSettings.text,
      fontFamily: wmSettings.fontFamily,
      fontSize: wmSettings.fontSize,
      fill: wmSettings.fill,
      imageSrc: wmSettings.imageSrc ?? undefined,
      imageWidth: wmSettings.imageWidth,
      imageHeight: wmSettings.imageHeight,
      x: 0.5,
      y: 0.5,
      scaleX: 1,
      scaleY: 1,
      rotation: wmSettings.rotation,
      opacity: wmSettings.opacity,
      visible: true,
      isBatch: false,
    };
    addWatermark(wm);
    setSelectedObject({ id: wm.id, type: 'watermark' });
    setActiveTool('select');
  }

  function handleBatchApplyWatermark() {
    if (!activeDocument) return;
    batchApplyWatermark();
    setSelectedObject({ id: `wm-batch-${activeDocument.id}`, type: 'watermark' });
    setActiveTool('select');
  }

  function handleLogoLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        const ratio = img.height / img.width;
        updateWmSettings({ imageSrc: src, type: 'image', imageWidth: 0.25, imageHeight: 0.25 * ratio });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleSelectedLogoLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedWatermark || selectedWatermark.type !== 'image') return;
    const watermarkId = selectedWatermark.id;
    const reader = new FileReader();
    reader.onload = event => {
      const src = event.target?.result as string;
      const image = new window.Image();
      image.onload = () => {
        const state = useStore.getState();
        const document = state.documents[state.activeDocIndex];
        if (!document?.watermarks.some(item => item.id === watermarkId)) return;
        state.pushHistory();
        const width = selectedWatermark.imageWidth ?? 0.25;
        state.updateWatermark(watermarkId, {
          imageSrc: src,
          imageWidth: width,
          imageHeight: width * (image.height / Math.max(1, image.width)),
        });
      };
      image.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-label">Вотерка</div>

      {selectedWatermark && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 9, borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-dim)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>Выбранная вотерка</strong>
            <button
              type="button"
              onClick={() => {
                pushHistory();
                updateWatermark(selectedWatermark.id, { locked: !selectedWatermark.locked });
              }}
              style={{ border: 'none', background: 'transparent', color: selectedWatermark.locked ? 'var(--warning, #e5a50a)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
            >
              {selectedWatermark.locked ? 'Разблокировать' : 'Заблокировать'}
            </button>
          </div>

          {selectedWatermark.type === 'text' ? (
            <>
              <input
                aria-label="Текст выбранной вотерки"
                type="text"
                value={selectedWatermark.text ?? ''}
                disabled={selectedWatermark.locked}
                onChange={event => {
                  beginSelectedEdit('text');
                  updateWatermark(selectedWatermark.id, { text: event.target.value });
                }}
                onBlur={endSelectedEdit}
              />
              <select
                aria-label="Шрифт выбранной вотерки"
                value={selectedWatermark.fontFamily ?? 'Arial'}
                disabled={selectedWatermark.locked}
                onChange={event => {
                  pushHistory();
                  updateWatermark(selectedWatermark.id, { fontFamily: event.target.value });
                }}
              >
                {MANGA_FONTS.map(font => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}
              </select>
              <PanelRow label="Цвет">
                <input
                  aria-label="Цвет выбранной вотерки"
                  type="color"
                  value={(selectedWatermark.fill ?? '#ffffff').startsWith('rgba') ? '#ffffff' : (selectedWatermark.fill ?? '#ffffff')}
                  disabled={selectedWatermark.locked}
                  onPointerDown={() => beginSelectedEdit('fill')}
                  onChange={event => updateWatermark(selectedWatermark.id, { fill: event.target.value })}
                  onBlur={endSelectedEdit}
                  style={{ width: 36, height: 28 }}
                />
              </PanelRow>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={selectedWatermark.locked}
                onClick={() => selectedLogoInputRef.current?.click()}
                style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid var(--border-default)', background: 'var(--bg-panel-raised)', color: 'var(--text-secondary)', cursor: selectedWatermark.locked ? 'not-allowed' : 'pointer', fontSize: 11 }}
              >
                Заменить изображение
              </button>
              <input ref={selectedLogoInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSelectedLogoLoad} style={{ display: 'none' }} />
            </>
          )}

          {([
            {
              key: 'opacity',
              label: `Прозрачность ${Math.round(selectedWatermark.opacity * 100)}%`,
              value: Math.round(selectedWatermark.opacity * 100), min: 0, max: 100,
              apply: (value: number) => updateWatermark(selectedWatermark.id, { opacity: value / 100 }),
            },
            {
              key: 'rotation',
              label: `Поворот ${Math.round(selectedWatermark.rotation)}°`,
              value: Math.round(selectedWatermark.rotation), min: -180, max: 180,
              apply: (value: number) => updateWatermark(selectedWatermark.id, { rotation: value }),
            },
            selectedWatermark.type === 'text'
              ? {
                  key: 'size',
                  label: 'Размер текста',
                  value: Math.round((selectedWatermark.fontSize ?? 0.06) * 1000), min: 10, max: 200,
                  apply: (value: number) => updateWatermark(selectedWatermark.id, { fontSize: value / 1000 }),
                }
              : {
                  key: 'size',
                  label: 'Размер изображения',
                  value: Math.round((selectedWatermark.imageWidth ?? 0.25) * 100), min: 2, max: 100,
                  apply: (value: number) => updateWatermark(selectedWatermark.id, { imageWidth: value / 100 }),
                },
          ] as const).map(control => (
            <div key={control.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{control.label}</span>
              <input
                aria-label={control.label}
                type="range"
                min={control.min}
                max={control.max}
                value={control.value}
                disabled={selectedWatermark.locked}
                onPointerDown={event => {
                  beginSelectedEdit(control.key);
                  try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is best-effort */ }
                }}
                onPointerUp={event => {
                  try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
                  endSelectedEdit();
                }}
                onPointerCancel={endSelectedEdit}
                onKeyDown={() => beginSelectedEdit(control.key)}
                onKeyUp={endSelectedEdit}
                onChange={event => control.apply(Number(event.target.value))}
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 5 }}>
            <button
              type="button"
              disabled={selectedWatermark.locked}
              onClick={() => {
                pushHistory();
                updateWatermark(selectedWatermark.id, { x: 0.5, y: 0.5 });
              }}
              style={{ flex: 1, padding: '5px 6px', borderRadius: 5, border: '1px solid var(--border-default)', background: 'var(--bg-panel-raised)', color: 'var(--text-secondary)', cursor: selectedWatermark.locked ? 'not-allowed' : 'pointer', fontSize: 10 }}
            >
              По центру
            </button>
            <button
              type="button"
              disabled={selectedWatermark.locked}
              onClick={() => {
                pushHistory();
                updateWatermark(selectedWatermark.id, { scaleX: 1, scaleY: 1, rotation: 0 });
              }}
              style={{ flex: 1, padding: '5px 6px', borderRadius: 5, border: '1px solid var(--border-default)', background: 'var(--bg-panel-raised)', color: 'var(--text-secondary)', cursor: selectedWatermark.locked ? 'not-allowed' : 'pointer', fontSize: 10 }}
            >
              Сбросить трансформацию
            </button>
          </div>
          <span style={{ fontSize: 10, lineHeight: 1.35, color: 'var(--text-muted)' }}>
            Правый клик по вотерке открывает перспективу, размытие, пикселизацию и порядок слоя.
          </span>
        </div>
      )}

      {/* Type switcher */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['text', 'image'] as const).map(t => (
          <button
            key={t}
            onClick={() => updateWmSettings({ type: t })}
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: wmSettings.type === t ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
              color: wmSettings.type === t ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: wmSettings.type === t ? 600 : 400,
            }}
          >
            {t === 'text' ? 'Текст' : 'Лого'}
          </button>
        ))}
      </div>

      {wmSettings.type === 'text' ? (
        <>
          <PanelLabel>Текст вотерки</PanelLabel>
          <input
            type="text"
            value={wmSettings.text}
            onChange={e => updateWmSettings({ text: e.target.value })}
            placeholder="© Ваш текст"
          />
          <PanelLabel>Шрифт</PanelLabel>
          <select value={wmSettings.fontFamily} onChange={e => updateWmSettings({ fontFamily: e.target.value })}>
            {MANGA_FONTS.map(f => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>
          <PanelRow label="Цвет">
            <input
              type="color"
              value={wmSettings.fill.startsWith('rgba') ? '#ffffff' : wmSettings.fill}
              onChange={e => updateWmSettings({ fill: e.target.value })}
              style={{ width: 36, height: 28 }}
            />
          </PanelRow>
          <PanelSlider
            label="Размер"
            value={Math.round(wmSettings.fontSize * 1000)}
            min={10}
            max={200}
            onChange={v => updateWmSettings({ fontSize: v / 1000 })}
          />
        </>
      ) : (
        <>
          <button
            onClick={() => logoInputRef.current?.click()}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              border: '1px dashed var(--border-default)',
              background: 'var(--bg-panel-raised)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {wmSettings.imageSrc ? 'Заменить PNG-лого' : 'Загрузить PNG-лого'}
          </button>
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoLoad} style={{ display: 'none' }} />
          {wmSettings.imageSrc && (
            <img
              src={wmSettings.imageSrc}
              alt="Logo preview"
              style={{ maxHeight: 48, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border-subtle)' }}
            />
          )}
        </>
      )}

      <div className="divider" />

      <PanelSlider
        label={`Прозрачность ${Math.round(wmSettings.opacity * 100)}%`}
        value={Math.round(wmSettings.opacity * 100)}
        min={5}
        max={100}
        onChange={v => updateWmSettings({ opacity: v / 100 })}
      />
      <PanelSlider
        label={`Наклон ${Math.round(wmSettings.rotation)}°`}
        value={Math.round(wmSettings.rotation)}
        min={-180}
        max={180}
        onChange={v => updateWmSettings({ rotation: v })}
      />

      <div className="divider" />

      <button
        onClick={handleAddWatermark}
        disabled={!hasDoc}
        style={{
          padding: '7px 10px',
          borderRadius: 6,
          border: '1px solid var(--accent)',
          background: 'transparent',
          color: hasDoc ? 'var(--accent)' : 'var(--text-muted)',
          cursor: hasDoc ? 'pointer' : 'not-allowed',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        + Добавить на текущее
      </button>

      <div className="section-label" style={{ marginTop: 4 }}>Пакетное применение</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(['fixed', 'random', 'scattered'] as const).map(m => (
          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
            <input
              type="radio"
              name="batchMode"
              checked={wmSettings.batchMode === m}
              onChange={() => updateWmSettings({ batchMode: m })}
              style={{ accentColor: 'var(--accent)' }}
            />
            {m === 'fixed' ? 'Одинаковое место' : m === 'random' ? 'Случайное место' : 'С разбросом'}
          </label>
        ))}
      </div>

      {wmSettings.batchMode === 'scattered' && (
        <>
          <PanelSlider
            label={`Разброс ${wmSettings.scatterOffsetPct}%`}
            value={wmSettings.scatterOffsetPct}
            min={0}
            max={40}
            onChange={v => updateWmSettings({ scatterOffsetPct: v })}
          />
          <PanelSlider
            label={`Наклон ±${wmSettings.scatterTiltDeg}°`}
            value={wmSettings.scatterTiltDeg}
            min={0}
            max={90}
            onChange={v => updateWmSettings({ scatterTiltDeg: v })}
          />
        </>
      )}

      <button
        onClick={handleBatchApplyWatermark}
        disabled={documents.length === 0}
        style={{
          padding: '7px 10px',
          borderRadius: 6,
          border: 'none',
          background: documents.length > 0 ? 'var(--accent)' : 'var(--bg-active)',
          color: documents.length > 0 ? '#fff' : 'var(--text-muted)',
          cursor: documents.length > 0 ? 'pointer' : 'not-allowed',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Применить ко всем ({documents.length})
      </button>
    </div>
  );
}
