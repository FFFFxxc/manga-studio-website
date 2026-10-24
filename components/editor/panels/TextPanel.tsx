'use client';

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/useStore';
import { uid } from '@/utils/imageUtils';
import { saveCustomFont, hasCustomFont, deleteCustomFont, validateCustomFontFile } from '@/utils/fonts';
import { translateText, type TranslateLang } from '@/utils/translate';
import type { PaintStyle, TextObject, TranslationMaskObject } from '@/types';
import { DEFAULT_ANIME_FONT, MANGA_FONTS, TEXT_PRESETS } from '@/types';
import { PanelRow, PanelSlider, PanelLabel, PanelSection } from './PanelComponents';
import { clampOcrBox } from '@/utils/coordinates';
import { TEXT_PRESET_LABELS } from '@/lib/strings.ru';
import { toast } from '@/hooks/use-toast';
import { PaintEditor } from './PaintEditor';
import { clonePaintStyle } from '@/utils/objectPaint';

function DeferredColorInput({ label, value, onCommit }: {
  label: string;
  value: string;
  onCommit: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  const [draft, setDraft] = useState(value);

  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handleChange = () => commitRef.current(input.value);
    input.addEventListener('change', handleChange);
    return () => input.removeEventListener('change', handleChange);
  }, []);

  return (
    <input
      ref={inputRef}
      aria-label={label}
      type="color"
      value={draft}
      onInput={event => setDraft(event.currentTarget.value)}
      onBlur={() => onCommit(draft)}
      style={{ width: 36, height: 28 }}
    />
  );
}

export function TextPanel() {
  const {
    textSettings, updateTextSettings, recentColors, rememberTextColor, addText, activeDocIndex, documents,
    selectedObject, updateText, customFonts, addCustomFont, removeCustomFont, bumpFontsVersion,
    addTranslationGroup, restorePageSourceText, setActiveTool, translationFontFamily, translationMaskSettings, updateAllTranslationMaskPadding, pushHistory,
  } = useStore(useShallow(state => ({
    textSettings: state.textSettings,
    updateTextSettings: state.updateTextSettings,
    recentColors: state.recentColors,
    rememberTextColor: state.rememberTextColor,
    addText: state.addText,
    activeDocIndex: state.activeDocIndex,
    documents: state.documents,
    selectedObject: state.selectedObject,
    updateText: state.updateText,
    customFonts: state.customFonts,
    addCustomFont: state.addCustomFont,
    removeCustomFont: state.removeCustomFont,
    bumpFontsVersion: state.bumpFontsVersion,
    addTranslationGroup: state.addTranslationGroup,
    restorePageSourceText: state.restorePageSourceText,
    setActiveTool: state.setActiveTool,
    translationFontFamily: state.translationFontFamily,
    translationMaskSettings: state.translationMaskSettings,
    updateAllTranslationMaskPadding: state.updateAllTranslationMaskPadding,
    pushHistory: state.pushHistory,
  })));
  const customFontRef = useRef<HTMLInputElement>(null);
  const fontImporting = useRef(false);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [fontStatus, setFontStatus] = useState('');
  const [fontErrors, setFontErrors] = useState<string[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [langFrom, setLangFrom] = useState<TranslateLang>('en');
  const [langTo, setLangTo] = useState<TranslateLang>('ru');
  const [pageStatus, setPageStatus] = useState<string | null>(null);
  const [pageProgress, setPageProgress] = useState(0);
  const [translatedBlocks, setTranslatedBlocks] = useState<number | null>(null);
  const [isPageTranslating, setIsPageTranslating] = useState(false);

  const hasDoc = activeDocIndex >= 0;
  const activeDoc = hasDoc ? documents[activeDocIndex] : null;
  const selectedText = selectedObject?.type === 'text' && activeDoc
    ? activeDoc.texts.find(t => t.id === selectedObject.id)
    : null;
  const canRestoreSourceText = activeDoc?.texts.some(text => text.translationBatchId && text.sourceText && text.isTranslated) ?? false;

  function handleRestoreSourceText() {
    restorePageSourceText();
    setTranslatedBlocks(0);
    setPageProgress(0);
    setPageStatus('Перевод отменён · показан исходный текст так, как его распознала AI-модель.');
  }

  function handleActivateTextTool() {
    setActiveTool('text');
  }

  function applyPreset(key: string) {
    const preset = TEXT_PRESETS[key];
    updateTextSettings({
      ...preset,
      ...(preset.fill ? { fillStyle: { type: 'solid', color: preset.fill } as PaintStyle } : {}),
      ...(preset.stroke !== undefined ? {
        strokeStyle: { type: 'solid', color: preset.stroke || 'transparent' } as PaintStyle,
      } : {}),
    });
  }

  async function handleCustomFont(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || fontImporting.current) return;
    fontImporting.current = true;
    setLoadingFonts(true);
    setFontErrors([]);
    setFontStatus('Проверяем и сохраняем шрифты…');
    const errors: string[] = [];
    let added = 0;
    try {
      for (const file of files) {
        try {
          const validation = validateCustomFontFile(file);
          if (validation) throw new Error(validation);
          const fontName = file.name.replace(/\.[^.]+$/, '').trim();
          if (MANGA_FONTS.includes(fontName) || useStore.getState().customFonts.includes(fontName) || await hasCustomFont(fontName)) {
            throw new Error('Шрифт с таким именем уже есть. Переименуйте файл, чтобы добавить другую версию.');
          }
          await saveCustomFont(fontName, await file.arrayBuffer());
          addCustomFont(fontName);
          bumpFontsVersion();
          if (!useStore.getState().selectedObject) updateTextSettings({ fontFamily: fontName });
          added++;
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Не удалось прочитать шрифт. Проверьте файл и доступ к хранилищу браузера.'}`);
        }
      }
    } finally {
      setFontErrors(errors);
      setFontStatus(added ? `Сохранено шрифтов: ${added}. Доступны после перезагрузки.` : 'Новые шрифты не добавлены.');
      setLoadingFonts(false);
      fontImporting.current = false;
    }
  }

  async function handleDeleteCustomFont(name: string) {
    if (!window.confirm(`Удалить шрифт «${name}»? Он исчезнет из списка и из сохранённых шрифтов.`)) return;
    // Удаляем из IndexedDB и дерегистрируем из текущей сессии
    try {
      await deleteCustomFont(name);
    } catch {
      setFontErrors([`Не удалось удалить «${name}» из хранилища браузера. Повторите попытку.`]);
      return;
    }
    removeCustomFont(name);

    const state = useStore.getState();
    // Если удалили дефолтный шрифт перевода — возвращаем встроенный
    if (state.translationFontFamily === name) {
      state.setTranslationFontFamily(DEFAULT_ANIME_FONT);
    } else if (state.textSettings.fontFamily === name) {
      state.updateTextSettings({ fontFamily: state.translationFontFamily });
    }
    // Тексты в открытых документах не должны ссылаться на удалённый шрифт
    const available = [...MANGA_FONTS, ...useStore.getState().customFonts];
    const missing = useStore.getState().replaceMissingFonts(available);
    if (missing.length > 0) {
      toast({
        title: 'Шрифт удалён',
        description: `Тексты, использовавшие «${name}», переключены на шрифт по умолчанию.`,
      });
    }
    bumpFontsVersion();
  }

  async function handleTranslate() {
    if (!selectedText || !selectedText.text.trim()) return;
    setIsTranslating(true);
    setTranslateError(null);
    try {
      const translated = await translateText(selectedText.text, langFrom, langTo);
      updateText(selectedText.id, { text: translated });
    } catch {
      setTranslateError('Не удалось перевести. Попробуйте позже.');
    } finally {
      setIsTranslating(false);
    }
  }

  /**
   * Page auto-translate via AI vision model:
   * 1. Send full page to /api/translate/page
   * 2. Замываем ТОЛЬКО буквы оригинала (с небольшим запасом)
   * 3. Перевод вписываем в бабл, а не в узкий бокс букв
   */
  async function handlePageTranslate() {
    if (!activeDoc || isPageTranslating) return;
    setIsPageTranslating(true);
    setTranslatedBlocks(null);
    setPageProgress(20);
    setPageStatus('AI распознаёт и переводит страницу…');
    try {
      const { translatePageWithAi } = await import('@/utils/pageTranslate');
      const src = activeDoc.cleanup.committed ?? activeDoc.originalSrc;
      const blocks = await translatePageWithAi(src, langFrom, langTo);
      if (blocks.length === 0) {
        setPageProgress(0);
        setTranslatedBlocks(0);
        setPageStatus('Текст не найден. Проверьте исходный язык или попробуйте более чёткое изображение.');
        return;
      }

      setPageProgress(60);
      setPageStatus(`Размещаем перевод · блоков: ${blocks.length}`);

      const { fitTextToBox, ensureFontLoaded } = await import('@/utils/textFit');
      const fontFamily = useStore.getState().translationFontFamily;
      await ensureFontLoaded(fontFamily);

      const W = activeDoc.width;
      const H = activeDoc.height;
      const translationBatchId = uid();
      const LINE_HEIGHT = 1.15;
      const INSET = 0.08; // поля внутри бабла, чтобы текст не липнул к контуру

      let placed = 0;

      blocks.forEach((block) => {
        const textBox = clampOcrBox(block);
        if (!textBox) return;

        // 1) Замывка строго по буквам оригинала + небольшой запас на хвосты глифов
        const wipe =
          clampOcrBox({
            x: textBox.x - textBox.width * 0.04,
            y: textBox.y - textBox.height * 0.1,
            width: textBox.width * 1.08,
            height: textBox.height * 1.2,
          }) ?? textBox;
        // 2) Область под перевод — весь бабл. Если модель его не дала,
        // расширяем бокс букв: русский длиннее английского примерно на 30%.
        const area =
          (block.bubble ? clampOcrBox(block.bubble) : null) ??
          clampOcrBox({
            x: textBox.x - textBox.width * 0.15,
            y: textBox.y - textBox.height * 0.12,
            width: textBox.width * 1.3,
            height: textBox.height * 1.24,
          }) ??
          textBox;

        const innerWidth = Math.max(0.03, area.width * (1 - INSET * 2));
        const innerHeight = Math.max(0.02, area.height * (1 - INSET * 2));

        const fitted = fitTextToBox(block.translation, {
          boxWidthPx: innerWidth * W,
          boxHeightPx: innerHeight * H,
          fontFamily,
          lineHeight: LINE_HEIGHT,
          maxFontSizePx: Math.max(14, Math.min(innerHeight * H, H * 0.055)),
          // Ниже 11px на странице читать невозможно — лучше слегка вылезти за бабл
          minFontSizePx: Math.max(11, Math.round(H * 0.012)),
          maxWidthScale: block.bubble ? 1.15 : 1.45,
          maxHeightScale: 1.2,
        });
        if (fitted.lines.length === 0) return;

        const widthNorm = Math.min(1, innerWidth * fitted.widthScale);
        const textHeight = (fitted.lines.length * fitted.fontSizePx * LINE_HEIGHT) / H;
        const centerX = area.x + area.width / 2;
        const centerY = area.y + area.height / 2;

        const textId = `translation-text-${uid()}`;
        const maskId = `translation-mask-${uid()}`;
        const groupId = `translation-group-${uid()}`;
        const padding = translationMaskSettings.padding;
        const maskX = Math.max(0, wipe.x - padding);
        const maskY = Math.max(0, wipe.y - padding);
        const mask: TranslationMaskObject = {
          id: maskId,
          name: `Маска: ${block.original.slice(0, 32)}`,
          x: maskX,
          y: maskY,
          width: Math.min(1 - maskX, wipe.width + padding * 2),
          height: Math.min(1 - maskY, wipe.height + padding * 2),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          shape: translationMaskSettings.shape,
          fill: block.background || translationMaskSettings.fill,
          opacity: translationMaskSettings.opacity,
          feather: translationMaskSettings.feather,
          padding,
          visible: true,
          groupId,
          textId,
          sourceBounds: textBox,
        };
        const text: TextObject = {
          id: textId,
          text: fitted.text,
          fontFamily,
          fontSize: fitted.fontSizePx / H,
          fill: textSettings.fill,
          stroke: '',
          strokeWidth: 0,
          fillStyle: clonePaintStyle(textSettings.fillStyle),
          strokeStyle: { type: 'solid', color: 'transparent' },
          shadowColor: '#000000',
          shadowBlur: 0,
          lineHeight: LINE_HEIGHT,
          align: 'center',
          width: widthNorm,
          x: Math.max(0, Math.min(1 - widthNorm, centerX - widthNorm / 2)),
          y: Math.max(0, Math.min(1 - textHeight, centerY - textHeight / 2)),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          visible: true,
          sourceText: block.original,
          translationBatchId,
          groupId,
          isTranslated: true,
        };
        addTranslationGroup(mask, text);
        placed += 1;
      });

      setPageProgress(100);
      setTranslatedBlocks(placed);
      setPageStatus(`Готово · переведено блоков: ${placed}`);
    } catch {
      setPageProgress(0);
      setTranslatedBlocks(null);
      setPageStatus('Не удалось обработать страницу. Проверьте соединение и повторите попытку.');
    } finally {
      setIsPageTranslating(false);
    }
  }

  const userFonts = customFonts.filter(f => !MANGA_FONTS.includes(f));

  const settings = selectedText ? {
    fontFamily: selectedText.fontFamily,
    fontSize: selectedText.fontSize,
    fill: selectedText.fill,
    stroke: selectedText.stroke,
    strokeWidth: selectedText.strokeWidth,
    fillStyle: selectedText.fillStyle ?? { type: 'solid' as const, color: selectedText.fill || '#000000' },
    strokeStyle: selectedText.strokeStyle ?? { type: 'solid' as const, color: selectedText.stroke || 'transparent' },
    shadowColor: selectedText.shadowColor,
    shadowBlur: selectedText.shadowBlur,
    lineHeight: selectedText.lineHeight,
    align: selectedText.align,
    width: selectedText.width,
  } : textSettings;

  const paintFallbackColor = (paint: PaintStyle, fallback: string) => paint.type === 'solid'
    ? paint.color
    : paint.stops[0]?.color ?? fallback;

  function beginTextPaintGesture() {
    if (selectedText) pushHistory();
  }

  function update(updates: Partial<typeof textSettings>, options?: { history?: boolean }) {
    const persistentColors = (['fill', 'stroke', 'shadowColor'] as const)
      .filter(key => typeof updates[key] === 'string');
    if (persistentColors.length > 0) {
      const settingsUpdate: Partial<typeof textSettings> = {};
      for (const key of persistentColors) {
        const color = updates[key] as string;
        settingsUpdate[key] = color;
        rememberTextColor(color);
      }
      updateTextSettings(settingsUpdate);
    }
    if (updates.fillStyle || updates.strokeStyle) {
      updateTextSettings({
        ...(updates.fillStyle ? { fillStyle: clonePaintStyle(updates.fillStyle) } : {}),
        ...(updates.strokeStyle ? { strokeStyle: clonePaintStyle(updates.strokeStyle) } : {}),
      });
    }
    if (selectedText) {
      const changed = Object.entries(updates).some(([key, value]) => selectedText[key as keyof TextObject] !== value);
      if (changed) updateText(selectedText.id, updates, options);
    } else {
      updateTextSettings(updates);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!selectedText && (<>
      {/* Draft text — shown even without a selected object */}
      <div>
        <PanelLabel>Текст для вставки</PanelLabel>
        <textarea
          value={textSettings.draftText}
          onChange={e => updateTextSettings({ draftText: e.target.value })}
          placeholder="Текст можно ввести после создания рамки"
          rows={3}
          onWheel={e => e.stopPropagation()}
          style={{
            width: '100%',
            resize: 'vertical',
            background: 'var(--bg-panel-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '6px 8px',
            fontFamily: 'inherit',
            lineHeight: 1.4,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ marginTop: 5, color: 'var(--text-muted)', fontSize: 10, lineHeight: 1.45 }}>
          Потяните рамку · Enter — новая строка · Ctrl/⌘+Enter — готово · Esc — отмена
        </div>
      </div>

      <button
        onClick={handleActivateTextTool}
        disabled={!hasDoc}
        style={{
          padding: '7px 10px', borderRadius: 6, fontWeight: 600, fontSize: 13,
          border: 'none',
          background: hasDoc ? 'var(--accent)' : 'var(--bg-active)',
          color: hasDoc ? '#fff' : 'var(--text-muted)',
          cursor: hasDoc ? 'pointer' : 'not-allowed',
        }}
      >
        Разместить текст (T)
      </button>
      </>)}
      {selectedText && <button className="ui-button ui-button-secondary" onClick={() => {
        useStore.getState().setSelectedObject(null);
        handleActivateTextTool();
      }}>+ Новый текст</button>}

      {/* Page auto-translate (OCR + translate + overlay) */}
      <details className="editor-disclosure" open={isPageTranslating || undefined}>
      <summary>Автоперевод страницы</summary>
      <div className="editor-card editor-card-accent" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1.5, color: 'var(--text-secondary)' }}>Распознает реплики, скроет оригинал и добавит редактируемый перевод.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label className="sr-only" htmlFor="translate-from">Исходный язык</label>
          <select
            id="translate-from"
            value={langFrom}
            onChange={e => setLangFrom(e.target.value as TranslateLang)}
            style={{ flex: 1, fontSize: 11 }}
          >
            <option value="en">EN</option>
            <option value="ru">RU</option>
            <option value="ja">JA</option>
            <option value="ko">KO</option>
            <option value="zh">ZH</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>→</span>
          <label className="sr-only" htmlFor="translate-to">Язык перевода</label>
          <select
            id="translate-to"
            value={langTo}
            onChange={e => setLangTo(e.target.value as TranslateLang)}
            style={{ flex: 1, fontSize: 11 }}
          >
            <option value="ru">RU</option>
            <option value="en">EN</option>
            <option value="ja">JA</option>
            <option value="ko">KO</option>
            <option value="zh">ZH</option>
          </select>
        </div>
        <button className="ui-button ui-button-primary" onClick={handlePageTranslate} disabled={!hasDoc || isPageTranslating} style={{ width: '100%' }}>
          {isPageTranslating ? 'Обрабатываем страницу…' : translatedBlocks !== null ? 'Повторить автоперевод' : 'Распознать и перевести'}
        </button>
        {canRestoreSourceText && !isPageTranslating && (
          <button className="ui-button ui-button-secondary" onClick={handleRestoreSourceText} style={{ width: '100%' }}>
            Отменить перевод и показать оригинал
          </button>
        )}
        {isPageTranslating && <div className="editor-progress" role="progressbar" aria-label="Прогресс автоперевода" aria-valuenow={pageProgress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pageProgress}%` }} /></div>}
        {pageStatus && (
          <div className="editor-status" role={isPageTranslating ? 'status' : translatedBlocks === null ? 'alert' : 'status'} data-tone={translatedBlocks && translatedBlocks > 0 ? 'success' : undefined}>
            <span aria-hidden="true">{translatedBlocks && translatedBlocks > 0 ? '✓' : isPageTranslating ? '○' : 'i'}</span>
            <span>{pageStatus}</span>
          </div>
        )}
      </div>
      </details>

      {(activeDoc?.translationMasks?.length ?? 0) > 0 && (
        <details className="editor-card">
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 650 }}>Все маски страницы ({activeDoc!.translationMasks!.length})</summary>
          <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
            <label style={{ display: 'grid', gridTemplateColumns: '1fr 42px', gap: 7, alignItems: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>
              <input
                aria-label="Padding всех масок"
                type="range"
                min={0}
                max={0.2}
                step={0.005}
                value={translationMaskSettings.padding}
                onPointerDown={pushHistory}
                onChange={event => {
                  const padding = Number(event.target.value);
                  useStore.getState().updateTranslationMaskSettings({ padding });
                  updateAllTranslationMaskPadding(padding, { history: false });
                }}
              />
              <span>{Math.round(translationMaskSettings.padding * 100)}%</span>
            </label>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Слайдер массово подгоняет все маски от исходных OCR-границ.</span>
          </div>
        </details>
      )}

      <div className="divider" />

      {/* Presets */}
      <details className="editor-disclosure"><summary>Готовые стили текста</summary>
      <PanelSection>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {Object.keys(TEXT_PRESETS).map(key => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              style={{
                padding: '5px 6px',
                fontSize: 11,
                borderRadius: 6,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-panel-raised)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {TEXT_PRESET_LABELS[key] ?? key}
            </button>
          ))}
        </div>
      </PanelSection>
      </details>

      <div className="divider" />

      {selectedText && (
        <>
          <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: -4 }}>
            Редактирование выбранного
          </div>
          <div>
            <PanelLabel>Содержимое</PanelLabel>
            <textarea
              value={selectedText.text}
              onChange={e => updateText(selectedText.id, { text: e.target.value })}
              rows={3}
              style={{
                width: '100%',
                resize: 'vertical',
                background: 'var(--bg-panel-raised)',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                fontSize: 12,
                padding: '6px 8px',
                fontFamily: 'inherit',
                lineHeight: 1.4,
              }}
            />
          </div>

          {/* Auto-translate */}
          <div>
            <PanelLabel>Автоперевод</PanelLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <select
                value={langFrom}
                onChange={e => setLangFrom(e.target.value as TranslateLang)}
                style={{ flex: 1, fontSize: 11 }}
              >
                <option value="en">EN</option>
                <option value="ru">RU</option>
                <option value="ja">JA</option>
                <option value="ko">KO</option>
                <option value="zh">ZH</option>
              </select>
              <button
                onClick={() => { const f = langFrom; setLangFrom(langTo); setLangTo(f); }}
                title="Поменять направление"
                style={{
                  padding: '4px 6px', fontSize: 12, borderRadius: 5,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-panel-raised)',
                  color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
                }}
              >
                ⇄
              </button>
              <select
                value={langTo}
                onChange={e => setLangTo(e.target.value as TranslateLang)}
                style={{ flex: 1, fontSize: 11 }}
              >
                <option value="ru">RU</option>
                <option value="en">EN</option>
                <option value="ja">JA</option>
                <option value="ko">KO</option>
                <option value="zh">ZH</option>
              </select>
            </div>
            <button
              onClick={handleTranslate}
              disabled={isTranslating || !selectedText.text.trim()}
              style={{
                marginTop: 4, width: '100%', padding: '6px 8px', fontSize: 12,
                borderRadius: 6, border: '1px solid var(--accent)',
                background: 'transparent',
                color: isTranslating ? 'var(--text-muted)' : 'var(--accent)',
                cursor: isTranslating ? 'wait' : 'pointer', fontWeight: 600,
              }}
            >
              {isTranslating ? 'Переводим…' : `Перевести ${langFrom.toUpperCase()} → ${langTo.toUpperCase()}`}
            </button>
            {translateError && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--danger)' }}>
                {translateError}
              </div>
            )}
          </div>
        </>
      )}

      {/* Font */}
      <div>
        <PanelLabel>Шрифт</PanelLabel>
        <select value={settings.fontFamily} onChange={e => update({ fontFamily: e.target.value })}>
          <optgroup label="Встроенные">
            {MANGA_FONTS.map(f => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}{f === DEFAULT_ANIME_FONT ? ' (встроенный)' : ''}{f === translationFontFamily ? ' — по умолчанию' : ''}
              </option>
            ))}
          </optgroup>
          {userFonts.length > 0 && (
            <optgroup label="Мои шрифты">
              {userFonts.map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}{f === translationFontFamily ? ' — по умолчанию' : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <details className="editor-disclosure"><summary>Мои шрифты</summary>
      <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-muted)', margin: '8px 0' }}>Загрузите TTF, OTF, WOFF или WOFF2. Шрифты сохраняются в этом браузере и доступны после перезагрузки. Можно выбрать несколько файлов, до 20 МБ каждый.</p>
      <button
        type="button"
        disabled={loadingFonts}
        onClick={() => customFontRef.current?.click()}
        style={{
          padding: '5px 8px', fontSize: 11, borderRadius: 6,
          border: '1px dashed var(--border-default)',
          background: 'var(--bg-panel-raised)',
          color: 'var(--text-muted)', cursor: 'pointer',
        }}
      >
        {loadingFonts ? 'Сохраняем шрифты…' : 'Добавить свои шрифты'}
      </button>
      <input ref={customFontRef} aria-label="Добавить файлы шрифтов" type="file" accept=".ttf,.otf,.woff,.woff2" multiple onChange={handleCustomFont} style={{ display: 'none' }} />
      {fontStatus && <p role="status" style={{ fontSize: 11, lineHeight: 1.5 }}>{fontStatus}</p>}
      {fontErrors.length > 0 && <ul role="alert" style={{ paddingLeft: 16, fontSize: 11, lineHeight: 1.5, color: 'var(--danger)' }}>{fontErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>}

      {/* Мои шрифты: сохранены в браузере (IndexedDB), переживают перезагрузку */}
      {customFonts.length > 0 && (
        <div>
          <PanelLabel>Мои шрифты</PanelLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {customFonts.map(f => (
              <div
                key={f}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 4px 4px 8px', borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel-raised)',
                }}
              >
                <span
                  style={{
                    flex: 1, fontSize: 12, color: 'var(--text-primary)',
                    fontFamily: `"${f}"`,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {f}
                </span>
                {f === translationFontFamily && (
                  <span style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }}>по умолчанию</span>
                )}
                <button
                  onClick={() => handleDeleteCustomFont(f)}
                  title={`Удалить шрифт «${f}»`}
                  aria-label={`Удалить шрифт «${f}»`}
                  style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: 5,
                    border: 'none', background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      </details>

      {/* Text paint uses the same editor as shapes, including linear/radial gradients. */}
      <PaintEditor
        label="Заливка текста"
        solidColorAriaLabel="Цвет текста"
        value={settings.fillStyle}
        onGestureStart={beginTextPaintGesture}
        onChange={paint => update({
          fillStyle: paint,
          fill: paintFallbackColor(paint, settings.fill),
        }, { history: false })}
      />
      {recentColors.length > 0 && (
        <div aria-label="Недавние цвета" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: -4 }}>
          {recentColors.map(color => (
            <button
              key={color}
              type="button"
              aria-label={`Применить цвет ${color}`}
              title={color}
              onClick={() => update({
                fill: color,
                fillStyle: { type: 'solid', color },
              }, { history: true })}
              style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid var(--border-default)', background: color, cursor: 'pointer' }}
            />
          ))}
        </div>
      )}
      <PanelRow label="Толщина обводки">
        <input
          aria-label="Толщина обводки"
          type="number"
          value={settings.strokeWidth}
          min={0}
          max={20}
          onChange={e => update({ strokeWidth: Number(e.target.value) })}
          style={{ width: 44 }}
        />
      </PanelRow>
      <PanelRow label="Цвет обводки">
        <DeferredColorInput
          label="Цвет обводки"
          value={/^#[0-9a-f]{6}$/i.test(settings.stroke) ? settings.stroke : '#000000'}
          onCommit={color => update({ stroke: color, strokeStyle: { type: 'solid', color } }, { history: true })}
        />
      </PanelRow>
      <details className="editor-disclosure"><summary>Тень</summary>
      <PanelRow label="Тень">
        <DeferredColorInput
          label="Цвет тени"
          value={settings.shadowColor === 'transparent' ? '#000000' : settings.shadowColor}
          onCommit={color => update({ shadowColor: color }, { history: true })}
        />
      </PanelRow>

      <PanelSlider
        label={`Свечение тени ${settings.shadowBlur}px`}
        value={settings.shadowBlur}
        min={0}
        max={40}
        onChange={v => update({ shadowBlur: v })}
      />

      </details>

      <PanelSlider
        label={`Размер`}
        value={Math.round(settings.fontSize * 1000)}
        min={10}
        max={250}
        onChange={v => update({ fontSize: v / 1000 })}
      />
      <PanelSlider
        label={`Межстрочный ${settings.lineHeight.toFixed(1)}`}
        value={Math.round(settings.lineHeight * 10)}
        min={8}
        max={30}
        onChange={v => update({ lineHeight: v / 10 })}
      />

      {/* Alignment */}
      <div>
        <PanelLabel>Выравнивание</PanelLabel>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['left', 'center', 'right'] as const).map(a => (
            <button
              key={a}
              onClick={() => update({ align: a })}
              title={a === 'left' ? 'Влево' : a === 'center' ? 'По центру' : 'Вправо'}
              style={{
                flex: 1, padding: '5px', borderRadius: 6,
                border: '1px solid var(--border-default)',
                background: settings.align === a ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
                color: settings.align === a ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 14,
              }}
            >
              {a === 'left' ? '⬅' : a === 'center' ? '⬌' : '➡'}
            </button>
          ))}
        </div>
      </div>

      <div className="divider" />


    </div>
  );
}
