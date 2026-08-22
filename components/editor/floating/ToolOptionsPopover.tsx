'use client';

import { useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useEditorUiStore, beginEditorOperation } from '@/store/useEditorUiStore';
import { FloatingPanel } from './FloatingPanel';
import { DEFAULT_ANIME_FONT, MANGA_FONTS, type ActiveTool, type TextObject, type TranslationMaskObject } from '@/types';
import { hasCustomFont, saveCustomFont } from '@/utils/fonts';
import { cropDocument, resizeCanvasDocument, resizeDocument } from '@/utils/imageUtils';

const TOOL_LABELS: Partial<Record<ActiveTool, string>> = {
  text: 'Текст',
  brush: 'Кисть',
  maskBrush: 'Маска',
  eraser: 'Ластик',
  crop: 'Кадрирование / Размер',
  blur: 'Размытие / Пикселизация',
  eyedropper: 'Пипетка',
  select: 'Объект',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'var(--bg-panel)',
  color: 'var(--text-primary)',
  padding: '5px 7px',
  fontSize: 12,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function RangeField({ label, value, min, max, step, onPointerDown, onChange, format }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onPointerDown?: () => void;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <Field label={label}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px', alignItems: 'center', gap: 6 }}>
        <input type="range" value={value} min={min} max={max} step={step} onPointerDown={onPointerDown} onChange={event => onChange(Number(event.target.value))} />
        <span style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>{format ? format(value) : value}</span>
      </div>
    </Field>
  );
}

function TextOptions({ objectId }: { objectId?: string }) {
  const store = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const activeDoc = store.activeDocIndex >= 0 ? store.documents[store.activeDocIndex] : null;
  const object = objectId ? activeDoc?.texts.find(text => text.id === objectId) ?? null : null;
  const settings = useMemo(() => ({
    ...store.textSettings,
    ...(object ? {
      fontFamily: object.fontFamily,
      fontSize: object.fontSize,
      fill: object.fill,
      stroke: object.stroke,
      strokeWidth: object.strokeWidth,
      shadowColor: object.shadowColor,
      shadowBlur: object.shadowBlur,
      shadowOffsetX: object.shadowOffsetX ?? 0,
      shadowOffsetY: object.shadowOffsetY ?? 0,
      lineHeight: object.lineHeight,
      align: object.align,
      bold: object.bold ?? false,
      italic: object.italic ?? false,
      vertical: object.vertical ?? false,
    } : {}),
  }), [object, store.textSettings]);

  const apply = (updates: Partial<TextObject>, history = true) => {
    store.updateTextSettings(updates);
    if (object) store.updateText(object.id, updates, { history });
  };
  const beginContinuous = () => { if (object) store.pushHistory(); };
  const fonts = [...MANGA_FONTS, ...store.customFonts.filter(name => !MANGA_FONTS.includes(name))];

  const uploadFont = async (file: File | undefined) => {
    if (!file) return;
    const fontName = file.name.replace(/\.[^.]+$/, '').trim();
    if (!fontName) return;
    if ((store.customFonts.includes(fontName) || await hasCustomFont(fontName)) && !window.confirm(`Шрифт «${fontName}» уже существует. Заменить?`)) return;
    await saveCustomFont(fontName, await file.arrayBuffer());
    store.addCustomFont(fontName);
    store.bumpFontsVersion();
    apply({ fontFamily: fontName });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Шрифт">
        <select value={settings.fontFamily || DEFAULT_ANIME_FONT} onChange={event => apply({ fontFamily: event.target.value })} style={fieldStyle}>
          {fonts.map(font => <option key={font} value={font}>{font}</option>)}
        </select>
      </Field>
      <button type="button" className="ui-button" onClick={() => fileRef.current?.click()} style={{ fontSize: 11, padding: '5px 8px' }}>Загрузить .ttf / .otf / .woff2</button>
      <input ref={fileRef} hidden type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={event => { void uploadFont(event.target.files?.[0]); event.target.value = ''; }} />
      <RangeField label="Размер" value={settings.fontSize} min={0.008} max={0.2} step={0.002} onPointerDown={beginContinuous} onChange={value => apply({ fontSize: value }, false)} format={value => `${Math.round(value * 1000) / 10}%`} />
      <RangeField label="Межстрочный" value={settings.lineHeight} min={0.7} max={2.5} step={0.05} onPointerDown={beginContinuous} onChange={value => apply({ lineHeight: value }, false)} format={value => value.toFixed(2)} />
      <Field label="Цвет текста"><input aria-label="Цвет текста" type="color" value={settings.fill} onChange={event => apply({ fill: event.target.value })} style={{ ...fieldStyle, height: 30, padding: 2 }} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px', gap: 6 }}>
        <Field label="Обводка"><input aria-label="Цвет обводки" type="color" value={settings.stroke || '#000000'} onChange={event => apply({ stroke: event.target.value })} style={{ ...fieldStyle, height: 30, padding: 2 }} /></Field>
        <input aria-label="Толщина обводки" type="number" min={0} max={40} value={settings.strokeWidth} onChange={event => apply({ strokeWidth: Number(event.target.value) })} style={fieldStyle} />
      </div>
      <Field label="Цвет тени"><input aria-label="Цвет тени" type="color" value={settings.shadowColor === 'transparent' ? '#000000' : settings.shadowColor} onChange={event => apply({ shadowColor: event.target.value })} style={{ ...fieldStyle, height: 30, padding: 2 }} /></Field>
      <RangeField label="Размытие тени" value={settings.shadowBlur} min={0} max={80} step={1} onPointerDown={beginContinuous} onChange={value => apply({ shadowBlur: value }, false)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Field label="Тень X"><input type="number" value={settings.shadowOffsetX} onChange={event => apply({ shadowOffsetX: Number(event.target.value) })} style={fieldStyle} /></Field>
        <Field label="Тень Y"><input type="number" value={settings.shadowOffsetY} onChange={event => apply({ shadowOffsetY: Number(event.target.value) })} style={fieldStyle} /></Field>
      </div>
      <Field label="Выравнивание">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {(['left', 'center', 'right'] as const).map(value => <button key={value} type="button" className="ui-button" aria-pressed={settings.align === value} onClick={() => apply({ align: value })}>{value === 'left' ? '←' : value === 'center' ? '↔' : '→'}</button>)}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
        {[
          ['Жирный', 'bold', settings.bold],
          ['Курсив', 'italic', settings.italic],
          ['Вертик.', 'vertical', settings.vertical],
        ].map(([label, key, enabled]) => (
          <button key={String(key)} type="button" className="ui-button" aria-pressed={Boolean(enabled)} onClick={() => apply({ [String(key)]: !enabled } as Partial<TextObject>)} style={{ background: enabled ? 'var(--accent-dim)' : undefined }}>{String(label)}</button>
        ))}
      </div>
    </div>
  );
}

function BrushOptions({ tool }: { tool: 'brush' | 'maskBrush' | 'eraser' }) {
  const settings = useStore(state => state.cleanupSettings);
  const update = useStore(state => state.updateCleanupSettings);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <RangeField label="Размер" value={settings.brushSize} min={0.003} max={0.2} step={0.002} onChange={brushSize => update({ brushSize })} format={value => `${Math.round(value * 1000) / 10}%`} />
      <RangeField label="Жёсткость" value={settings.brushHardness} min={0} max={1} step={0.05} onChange={brushHardness => update({ brushHardness })} format={value => `${Math.round(value * 100)}%`} />
      <RangeField label="Непрозрачность" value={settings.brushOpacity} min={0.05} max={1} step={0.05} onChange={brushOpacity => update({ brushOpacity })} format={value => `${Math.round(value * 100)}%`} />
      {tool === 'brush' && <Field label="Цвет"><input type="color" value={settings.brushColor} onChange={event => useStore.getState().setForegroundColor(event.target.value)} style={{ ...fieldStyle, height: 30, padding: 2 }} /></Field>}
    </div>
  );
}

function CropOptions() {
  const store = useStore();
  const activeDoc = store.activeDocIndex >= 0 ? store.documents[store.activeDocIndex] : null;
  const selected = activeDoc?.selectedLayer;
  const placement = selected?.type === 'base' ? activeDoc?.baseLayer : selected?.type === 'ai' ? activeDoc?.aiLayers.find(layer => layer.id === selected.id) : null;
  const naturalLayerWidth = activeDoc ? Math.round((placement?.crop?.width ?? 1) * activeDoc.width * Math.abs(placement?.scaleX ?? 1)) : 1;
  const naturalLayerHeight = activeDoc ? Math.round((placement?.crop?.height ?? 1) * activeDoc.height * Math.abs(placement?.scaleY ?? 1)) : 1;
  const settings = store.cropSettings;
  const initialWidth = settings.scope === 'image-size' ? naturalLayerWidth : activeDoc?.width ?? 1;
  const initialHeight = settings.scope === 'image-size' ? naturalLayerHeight : activeDoc?.height ?? 1;
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);

  const changeScope = (scope: typeof settings.scope) => {
    store.updateCropSettings({ scope });
    if (scope === 'image-size') {
      setWidth(naturalLayerWidth);
      setHeight(naturalLayerHeight);
    } else if (activeDoc) {
      setWidth(activeDoc.width);
      setHeight(activeDoc.height);
    }
  };

  const aspectWidth = settings.scope === 'image-size' ? naturalLayerWidth : activeDoc?.width ?? 1;
  const aspectHeight = settings.scope === 'image-size' ? naturalLayerHeight : activeDoc?.height ?? 1;

  const startCrop = () => {
    if (!activeDoc) return;
    const selected = activeDoc.selectedLayer;
    const layerScope = settings.scope === 'layer' && (selected?.type === 'base' || selected?.type === 'ai');
    if (layerScope && selected) store.setLayerCropTarget({ id: selected.id, type: selected.type as 'base' | 'ai' });
    else store.setLayerCropTarget(null);
    const ratio = settings.ratio === '1:1' ? 1 : settings.ratio === '2:3' ? 2 / 3 : settings.ratio === 'a4' ? 210 / 297 : null;
    const widthNorm = settings.ratio === 'original-width' ? 1 : 0.8;
    const heightNorm = ratio ? Math.min(0.9, widthNorm * activeDoc.width / activeDoc.height / ratio) : 0.8;
    const adjustedWidth = ratio && heightNorm >= 0.9 ? Math.min(0.9, heightNorm * activeDoc.height / activeDoc.width * ratio) : widthNorm;
    store.setCropRect({ x: (1 - adjustedWidth) / 2, y: (1 - heightNorm) / 2, width: adjustedWidth, height: heightNorm });
    store.setActiveTool('crop');
    beginEditorOperation('crop', layerScope ? 'Кадрирование слоя' : 'Кадрирование страницы', {
      commit: async () => {
        const latest = useStore.getState();
        const doc = latest.documents[latest.activeDocIndex];
        if (!doc || !latest.cropRect) return;
        if (latest.layerCropTarget) latest.applyLayerCrop();
        else {
          const updates = await cropDocument(doc, latest.cropRect);
          latest.applyDocumentTransform(updates);
          latest.setActiveTool('select');
        }
      },
      cancel: () => {
        const latest = useStore.getState();
        if (latest.layerCropTarget) latest.cancelLayerCrop();
        else {
          latest.setCropRect(null);
          latest.setActiveTool('select');
        }
      },
    });
    useEditorUiStore.getState().closeToolOptions();
  };

  const applyResize = async () => {
    if (!activeDoc || width < 1 || height < 1) return;
    if (settings.scope === 'image-size' && placement && selected && (selected.type === 'base' || selected.type === 'ai')) {
      const scaleX = width / Math.max(1, (placement.crop?.width ?? 1) * activeDoc.width);
      const scaleY = height / Math.max(1, (placement.crop?.height ?? 1) * activeDoc.height);
      if (selected.type === 'base') store.updateBaseLayer({ scaleX, scaleY });
      else store.updateAiLayer(selected.id, { scaleX, scaleY });
      useEditorUiStore.getState().closeToolOptions();
      return;
    }
    const updates = settings.scope === 'canvas-size'
      ? await resizeCanvasDocument(activeDoc, Math.min(8000, width), Math.min(8000, height))
      : await resizeDocument(activeDoc, Math.min(8000, width), Math.min(8000, height));
    store.applyDocumentTransform(updates);
    useEditorUiStore.getState().closeToolOptions();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Область">
        <select value={settings.scope} onChange={event => changeScope(event.target.value as typeof settings.scope)} style={fieldStyle}>
          <option value="page">Кадрировать страницу</option>
          <option value="layer">Кадрировать слой</option>
          <option value="canvas-size">Изменить размер холста</option>
          <option value="image-size">Изменить размер изображения</option>
        </select>
      </Field>
      <Field label="Пропорции">
        <select value={settings.ratio} onChange={event => store.updateCropSettings({ ratio: event.target.value as typeof settings.ratio })} style={fieldStyle}>
          <option value="free">Свободно</option><option value="1:1">1:1</option><option value="2:3">2:3</option><option value="a4">A4</option><option value="original-width">Ширина оригинала</option>
        </select>
      </Field>
      {(settings.scope === 'canvas-size' || settings.scope === 'image-size') && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Field label="Ширина"><input type="number" min={1} max={8000} value={width} onChange={event => { const next = Number(event.target.value); setWidth(next); if (settings.lockAspect) setHeight(Math.max(1, Math.round(next * aspectHeight / Math.max(1, aspectWidth)))); }} style={fieldStyle} /></Field>
            <Field label="Высота"><input type="number" min={1} max={8000} value={height} onChange={event => { const next = Number(event.target.value); setHeight(next); if (settings.lockAspect) setWidth(Math.max(1, Math.round(next * aspectWidth / Math.max(1, aspectHeight)))); }} style={fieldStyle} /></Field>
          </div>
          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11 }}><input type="checkbox" checked={settings.lockAspect} onChange={event => store.updateCropSettings({ lockAspect: event.target.checked })} />Фиксировать пропорции</label>
          <button type="button" className="ui-button ui-button-primary" onClick={() => { void applyResize(); }}>Применить размер</button>
        </>
      )}
      {(settings.scope === 'page' || settings.scope === 'layer') && <button type="button" className="ui-button ui-button-primary" onClick={startCrop}>Начать кадрирование</button>}
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Enter — применить, Esc — отменить.</span>
    </div>
  );
}

function BlurOptions() {
  const settings = useStore(state => state.blurSettings);
  const update = useStore(state => state.updateBlurSettings);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Режим"><select value={settings.mode} onChange={event => update({ mode: event.target.value as typeof settings.mode })} style={fieldStyle}><option value="blur">Размытие</option><option value="pixelate">Пикселизация</option><option value="noise">Шум</option><option value="sharpen">Резкость</option></select></Field>
      <Field label="Способ"><select value={settings.gesture} onChange={event => update({ gesture: event.target.value as typeof settings.gesture })} style={fieldStyle}><option value="brush">Кисть</option><option value="area">Область</option></select></Field>
      <Field label="Применить"><select value={settings.applyTo} onChange={event => update({ applyTo: event.target.value as typeof settings.applyTo })} style={fieldStyle}><option value="layer">К слою</option><option value="selection">К выделению</option></select></Field>
      <RangeField label="Размер кисти" value={settings.brushSize} min={0.003} max={0.35} step={0.005} onChange={brushSize => update({ brushSize })} format={value => `${Math.round(value * 1000) / 10}%`} />
      <RangeField label="Жёсткость края" value={settings.hardness} min={0} max={1} step={0.05} onChange={hardness => update({ hardness })} format={value => `${Math.round(value * 100)}%`} />
      {settings.mode === 'blur' && <>
        <RangeField label="Радиус размытия" value={settings.radius} min={0.5} max={64} step={0.5} onChange={radius => update({ radius })} format={value => `${value}px`} />
        <RangeField label="Сила" value={settings.strength} min={0.05} max={1} step={0.05} onChange={strength => update({ strength })} format={value => `${Math.round(value * 100)}%`} />
      </>}
      {settings.mode === 'pixelate' && <>
        <RangeField label="Размер ячейки" value={settings.cellSize} min={2} max={128} step={1} onChange={cellSize => update({ cellSize })} format={value => `${value}px`} />
        <RangeField label="Смешивание" value={settings.strength} min={0.05} max={1} step={0.05} onChange={strength => update({ strength })} format={value => `${Math.round(value * 100)}%`} />
      </>}
      {settings.mode === 'noise' && <>
        <RangeField label="Количество шума" value={settings.noiseAmount} min={0.01} max={1} step={0.01} onChange={noiseAmount => update({ noiseAmount })} format={value => `${Math.round(value * 100)}%`} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}><input type="checkbox" checked={settings.noiseMonochrome} onChange={event => update({ noiseMonochrome: event.target.checked })} />Монохромный шум</label>
      </>}
      {settings.mode === 'sharpen' && <>
        <RangeField label="Радиус резкости" value={settings.sharpenRadius} min={1} max={8} step={1} onChange={sharpenRadius => update({ sharpenRadius })} format={value => `${value}px`} />
        <RangeField label="Количество" value={settings.sharpenAmount} min={0.05} max={1} step={0.05} onChange={sharpenAmount => update({ sharpenAmount })} format={value => `${Math.round(value * 100)}%`} />
      </>}
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Рисуйте по активному растровому слою. Отпускание кнопки применяет один шаг Undo. [ / ] — размер, Shift+[ / ] — жёсткость.</span>
    </div>
  );
}

function EyedropperOptions() {
  const settings = useStore(state => state.eyedropperSettings);
  const foregroundColor = useStore(state => state.foregroundColor);
  const update = useStore(state => state.updateEyedropperSettings);
  const setForegroundColor = useStore(state => state.setForegroundColor);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Образец">
        <select value={settings.sample} onChange={event => update({ sample: event.target.value as typeof settings.sample })} style={fieldStyle}>
          <option value="all">Все слои</option>
          <option value="current">Текущий растровый слой</option>
        </select>
      </Field>
      <Field label="Цвет"><input aria-label="Основной цвет" type="color" value={foregroundColor} onChange={event => setForegroundColor(event.target.value)} style={{ ...fieldStyle, height: 30, padding: 2 }} /></Field>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>После клика редактор вернётся к кисти. Alt/Option временно берёт цвет, не переключая инструмент.</span>
    </div>
  );
}

function TranslationMaskOptions({ objectId }: { objectId: string }) {
  const store = useStore();
  const document = store.documents[store.activeDocIndex];
  const mask = document?.translationMasks?.find(item => item.id === objectId);
  if (!document || !mask) return <div style={{ fontSize: 11 }}>Маска больше не существует.</div>;
  const update = (updates: Partial<TranslationMaskObject>, history = true) => {
    store.updateTranslationMaskSettings({
      ...(updates.shape ? { shape: updates.shape } : {}),
      ...(updates.fill ? { fill: updates.fill } : {}),
      ...(updates.opacity !== undefined ? { opacity: updates.opacity } : {}),
      ...(updates.feather !== undefined ? { feather: updates.feather } : {}),
      ...(updates.padding !== undefined ? { padding: updates.padding } : {}),
    });
    store.updateTranslationMask(mask.id, updates, { history });
  };
  const fitMaskToSource = () => {
    const source = mask.sourceBounds;
    if (!source) return;
    const padding = mask.padding;
    update({
      x: Math.max(0, source.x - padding),
      y: Math.max(0, source.y - padding),
      width: Math.min(1 - Math.max(0, source.x - padding), source.width + padding * 2),
      height: Math.min(1 - Math.max(0, source.y - padding), source.height + padding * 2),
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
  };
  const fitTextToMask = async () => {
    const text = document.texts.find(item => item.id === mask.textId || (mask.groupId && item.groupId === mask.groupId));
    if (!text) return;
    const { fitTextToBox, ensureFontLoaded } = await import('@/utils/textFit');
    await ensureFontLoaded(text.fontFamily);
    const inset = Math.min(mask.width, mask.height) * 0.08;
    const fitted = fitTextToBox(text.text, {
      boxWidthPx: Math.max(1, (mask.width - inset * 2) * document.width),
      boxHeightPx: Math.max(1, (mask.height - inset * 2) * document.height),
      fontFamily: text.fontFamily,
      lineHeight: text.lineHeight,
      maxFontSizePx: Math.max(12, text.fontSize * document.height),
      minFontSizePx: Math.max(7, document.height * 0.008),
      maxWidthScale: 1,
      maxHeightScale: 1,
    });
    store.updateText(text.id, {
      text: fitted.text,
      fontSize: fitted.fontSizePx / document.height,
      width: Math.max(0.01, mask.width - inset * 2),
      x: mask.x + inset,
      y: mask.y + Math.max(0, (mask.height - fitted.lines.length * fitted.fontSizePx * text.lineHeight / document.height) / 2),
      rotation: mask.rotation,
    }, { history: true });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Форма"><select value={mask.shape} onChange={event => update({ shape: event.target.value as TranslationMaskObject['shape'] })} style={fieldStyle}><option value="rect">Прямоугольник</option><option value="rounded-rect">Скруглённая</option><option value="ellipse">Эллипс</option><option value="polygon">Полигон</option></select></Field>
      <Field label="Цвет"><input type="color" value={mask.fill} onChange={event => update({ fill: event.target.value })} style={{ ...fieldStyle, height: 30, padding: 2 }} /></Field>
      <RangeField label="Непрозрачность" value={mask.opacity} min={0} max={1} step={0.05} onPointerDown={store.pushHistory} onChange={opacity => update({ opacity }, false)} format={value => `${Math.round(value * 100)}%`} />
      <RangeField label="Растушёвка" value={mask.feather} min={0} max={50} step={1} onPointerDown={store.pushHistory} onChange={feather => update({ feather }, false)} format={value => `${value}px`} />
      <RangeField label="Padding" value={mask.padding} min={0} max={0.2} step={0.005} onPointerDown={store.pushHistory} onChange={padding => update({ padding }, false)} format={value => `${Math.round(value * 100)}%`} />
      <button type="button" className="ui-button" onClick={fitMaskToSource}>Подогнать маску под исходный текст</button>
      <button type="button" className="ui-button" onClick={() => { void fitTextToMask(); }}>Подогнать текст под маску</button>
      <button type="button" className="ui-button" onClick={() => store.updateAllTranslationMaskPadding(mask.padding)}>Применить padding ко всем маскам страницы</button>
    </div>
  );
}

export function ToolOptionsPopoverHost() {
  const request = useEditorUiStore(state => state.toolOptions);
  const close = useEditorUiStore(state => state.closeToolOptions);
  if (!request) return null;
  const { tool } = request.target;
  const objectId = request.target.type === 'object' && request.target.object.type === 'text' ? request.target.object.id : undefined;
  const maskId = request.target.type === 'object' && request.target.object.type === 'translationMask' ? request.target.object.id : undefined;
  const effectiveTool = objectId ? 'text' : tool;
  return (
    <FloatingPanel x={request.x} y={request.y} onClose={() => close()} ariaLabel={`Быстрые настройки: ${TOOL_LABELS[effectiveTool] ?? 'Инструмент'}`} minWidth={310} maxWidth={390}>
      <div style={{ fontWeight: 700, fontSize: 12, margin: '1px 2px 9px' }}>{maskId ? 'Маска перевода' : TOOL_LABELS[effectiveTool] ?? 'Быстрые настройки'}</div>
      {effectiveTool === 'text' && <TextOptions objectId={objectId} />}
      {(effectiveTool === 'brush' || effectiveTool === 'maskBrush' || effectiveTool === 'eraser') && <BrushOptions tool={effectiveTool} />}
      {effectiveTool === 'crop' && <CropOptions />}
      {effectiveTool === 'blur' && <BlurOptions />}
      {effectiveTool === 'eyedropper' && <EyedropperOptions />}
      {maskId && <TranslationMaskOptions objectId={maskId} />}
      {!maskId && !['text', 'brush', 'maskBrush', 'eraser', 'crop', 'blur', 'eyedropper'].includes(effectiveTool) && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Для этого объекта доступны трансформация и действия в контекстном меню слоя.</div>}
    </FloatingPanel>
  );
}
