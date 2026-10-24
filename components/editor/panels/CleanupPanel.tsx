'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { PanelSlider, PanelRow } from './PanelComponents';
import { aiCleanupMaskedArea, inpaintMaskedArea, removeBackgroundFromLayer } from '@/utils/layerActions';
import { DEFAULT_REDRAW_PROMPT, redrawSfx, translateBubble, translateRegionWithAi } from '@/utils/translateActions';
import { getImageUsage } from '@/lib/routerai/client';
import type { TextObject } from '@/types';
import { DEFAULT_ANIME_FONT } from '@/types';
import { BrushLibrary } from '../BrushLibrary';

const primaryButtonStyle = {
  padding: '7px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  border: 'none', background: 'var(--accent)', color: 'var(--accent-foreground)', cursor: 'pointer',
} as const;

const secondaryButtonStyle = {
  padding: '6px', borderRadius: 6, fontSize: 11,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel-raised)',
  color: 'var(--text-secondary)', cursor: 'pointer',
} as const;

export function CleanupPanel() {
  const {
    cleanupSettings, updateCleanupSettings,
    setActiveTool, activeTool,
    activeDocIndex, documents,
    createMask, clearActiveMask, setInpaintRunning,
    isInpaintRunning, inpaintProgress,
    addText, setSelectedObject,
    customFonts, translationFontFamily, setTranslationFontFamily,
  } = useStore();
  const [aiOperation, setAiOperation] = useState<'cleanup' | 'background' | null>(null);
  const [translationOperation, setTranslationOperation] = useState<'bubble' | 'ai' | 'redraw' | null>(null);
  const [aiError, setAiError] = useState('');
  const [brushHex, setBrushHex] = useState(cleanupSettings.brushColor.toUpperCase());
  const [targetLang, setTargetLang] = useState('ru');
  const [translationOriginal, setTranslationOriginal] = useState('');
  const [translationText, setTranslationText] = useState('');
  const [translationDraft, setTranslationDraft] = useState<TextObject | null>(null);
  const [redrawPrompt, setRedrawPrompt] = useState(DEFAULT_REDRAW_PROMPT);
  const [aiFallbackVisible, setAiFallbackVisible] = useState(false);
  const [aiRetryAction, setAiRetryAction] = useState<'translate' | 'redraw' | null>(null);
  const [imageQualityWarning, setImageQualityWarning] = useState(false);
  const [imageUsage, setImageUsage] = useState(getImageUsage());
  const abortRef = useRef<AbortController | null>(null);

  const activeDoc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;
  const activeMask = activeDoc?.masks.find(mask => mask.id === activeDoc.activeMaskId) ?? null;
  const hasMask = Boolean(activeMask && ((activeMask.elements?.length ?? 0) > 0 || activeMask.strokes.some(stroke => stroke.mode !== 'erase')));
  // safetyHint is true when the server reported a content-policy refusal (HTTP 451).
  // The server message always contains "отклонила фрагмент" for these cases.
  const safetyHint = /отклонил|safety|unsafe|policy|refus/i.test(aiError);

  useEffect(() => setBrushHex(cleanupSettings.brushColor.toUpperCase()), [cleanupSettings.brushColor]);

  function commitBrushHex() {
    const normalized = brushHex.trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(normalized)) {
      updateCleanupSettings({ brushColor: normalized.toLowerCase() });
      setBrushHex(normalized);
    } else {
      setBrushHex(cleanupSettings.brushColor.toUpperCase());
    }
  }

  async function handleClipdrop(operation: 'cleanup' | 'background') {
    if (!activeDoc || aiOperation || translationOperation) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAiError('');
    setAiOperation(operation);
    try {
      if (operation === 'cleanup') {
        await aiCleanupMaskedArea(controller.signal);
      } else {
        await removeBackgroundFromLayer({ id: activeDoc.baseLayer?.id ?? `base-${activeDoc.id}`, type: 'base' }, controller.signal);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setAiError(error instanceof Error ? error.message : 'Не удалось обработать изображение.');
      }
    } finally {
      abortRef.current = null;
      setAiOperation(null);
    }
  }

  async function handleTranslateBubble() {
    if (!activeDoc || !hasMask || aiOperation || translationOperation) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAiError('');
    setAiFallbackVisible(false);
    setTranslationOperation('bubble');
    setTranslationOriginal('');
    setTranslationText('');
    setTranslationDraft(null);
    try {
      const result = await translateBubble(targetLang, cleanupSettings.translationCleanupMethod, controller.signal);
      setTranslationOriginal(result.original);
      setTranslationText(result.translation);
      setTranslationDraft(result.draft);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setAiError(error instanceof Error ? error.message : 'Не удалось перевести фрагмент.');
      }
    } finally {
      abortRef.current = null;
      setTranslationOperation(null);
    }
  }

  async function handleTranslateAi() {
    if (!activeDoc || !hasMask || aiOperation || translationOperation) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAiError('');
    setAiFallbackVisible(false);
    setAiRetryAction(null);
    setTranslationOperation('ai');
    try {
      const result = await translateRegionWithAi(targetLang, controller.signal, Math.floor(Math.random() * 2_000_000_000));
      setImageQualityWarning(result.downscaleRatio > 2);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : 'Не удалось выполнить AI-перевод.';
        setAiError(message);
        if (/отклони|safety|unsafe|policy|refus|не могу|cannot assist/i.test(message)) setAiFallbackVisible(true);
        else setAiRetryAction('translate');
      }
    } finally {
      abortRef.current = null;
      setTranslationOperation(null);
      setImageUsage(getImageUsage());
    }
  }

  async function handleRedrawSfx() {
    if (!activeDoc || !hasMask || aiOperation || translationOperation) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAiError('');
    setAiRetryAction(null);
    setTranslationOperation('redraw');
    try {
      const result = await redrawSfx(controller.signal, redrawPrompt, Math.floor(Math.random() * 2_000_000_000));
      setImageQualityWarning(result.downscaleRatio > 2);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : 'Не удалось перерисовать фрагмент.';
        setAiError(message);
        if (/отклони|safety|unsafe|policy|refus|не могу|cannot assist/i.test(message)) setAiFallbackVisible(true);
        else setAiRetryAction('redraw');
      }
    } finally {
      abortRef.current = null;
      setTranslationOperation(null);
      setImageUsage(getImageUsage());
    }
  }

  function handleInsertTranslation() {
    if (!translationDraft || !translationText.trim()) return;
    const text = { ...translationDraft, text: translationText.trim() };
    addText(text);
    setSelectedObject({ id: text.id, type: 'text' });
    setActiveTool('text');
    setTranslationDraft(null);
  }

  async function handleInpaint() {
    if (!activeDoc || isInpaintRunning) return;
    try {
      await inpaintMaskedArea();
    } catch {
      alert('Ошибка при замывании. Попробуйте ещё раз.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {activeTool === 'brush' && <BrushLibrary />}
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {([
          { key: 'brush', label: 'Кисть' },
          { key: 'inpaint', label: 'Замывание' },
        ] as const).map(m => (
          <button
            key={m.key}
            onClick={() => {
              updateCleanupSettings({ mode: m.key });
              setActiveTool(m.key === 'brush' ? 'brush' : 'maskBrush');
            }}
            style={{
              flex: 1,
              padding: '5px 6px',
              fontSize: 11,
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: cleanupSettings.mode === m.key ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
              color: cleanupSettings.mode === m.key ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {cleanupSettings.mode === 'brush' && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Рисуйте белой кистью по тексту в баблах. Инструмент Кисть (B).
          </div>
          <PanelRow label="Цвет кисти">
            <input
              type="color"
              aria-label="Палитра кисти"
              value={cleanupSettings.brushColor}
              onChange={e => updateCleanupSettings({ brushColor: e.target.value })}
              style={{ width: 36, height: 28 }}
            />
            <input
              type="text"
              aria-label="HEX цвет кисти"
              value={brushHex}
              maxLength={7}
              spellCheck={false}
              onChange={event => setBrushHex(event.target.value)}
              onBlur={commitBrushHex}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              style={{ width: 76, height: 28, padding: '2px 6px', fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', borderRadius: 5, border: '1px solid var(--border-default)', background: 'var(--bg-panel-raised)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={() => updateCleanupSettings({ brushColor: '#ffffff' })}
              style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-panel-raised)',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Белый
            </button>
          </PanelRow>
          <PanelSlider
            label={`Размер кисти ([ ])`}
            value={Math.round(cleanupSettings.brushSize * 1000)}
            min={3}
            max={200}
            onChange={v => updateCleanupSettings({ brushSize: v / 1000 })}
          />
          <PanelSlider
            label={`Жёсткость ${Math.round(cleanupSettings.brushHardness * 100)}%`}
            value={Math.round(cleanupSettings.brushHardness * 100)}
            min={0}
            max={100}
            onChange={v => updateCleanupSettings({ brushHardness: v / 100 })}
          />
        </>
      )}

      {cleanupSettings.mode === 'inpaint' && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Нарисуйте маску кистью (B), затем нажмите «Замыть». Хорошо работает на ровных фонах.
          </div>
          <PanelSlider
            label={`Радиус ${cleanupSettings.inpaintRadius}px`}
            value={cleanupSettings.inpaintRadius}
            min={1}
            max={20}
            onChange={v => updateCleanupSettings({ inpaintRadius: v })}
          />
          <PanelSlider
            label={`Размер маски`}
            value={Math.round(cleanupSettings.brushSize * 1000)}
            min={3}
            max={200}
            onChange={v => updateCleanupSettings({ brushSize: v / 1000 })}
          />

          {isInpaintRunning ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Замывание... {inpaintProgress}%
              </div>
              <div style={{ height: 4, background: 'var(--bg-active)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${inpaintProgress}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    borderRadius: 2,
                    transition: 'width 0.2s',
                  }}
                />
              </div>
              <button
                onClick={() => setInpaintRunning(false, 0)}
                style={{
                  padding: '5px', borderRadius: 6, fontSize: 11,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-panel-raised)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              onClick={handleInpaint}
              disabled={!activeDoc || !hasMask}
              style={{
                padding: '7px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: 'none',
                background: activeDoc && hasMask ? 'var(--accent)' : 'var(--bg-active)',
                color: activeDoc && hasMask ? '#fff' : 'var(--text-muted)',
                cursor: activeDoc && hasMask ? 'pointer' : 'not-allowed',
              }}
            >
              Замыть
            </button>
          )}
        </>
      )}

      <details className="editor-disclosure" open={Boolean(translationOperation) || Boolean(translationDraft) || undefined}>
      <summary>Перевести выделенный фрагмент</summary>
      <div className="editor-disclosure-content">
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Выделите бабл маской, чтобы отправить только его фрагмент в RouterAI.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <label style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)' }}>
          Язык
          <select
            aria-label="Язык перевода бабла"
            value={targetLang}
            onChange={event => setTargetLang(event.target.value)}
            style={{ width: '100%', marginTop: 3, fontSize: 11 }}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="zh">中文</option>
          </select>
        </label>
        <label style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)' }}>
          Очистка
          <select
            aria-label="Способ очистки перед переводом"
            value={cleanupSettings.translationCleanupMethod}
            onChange={event => updateCleanupSettings({ translationCleanupMethod: event.target.value as 'local' | 'clipdrop' })}
            style={{ width: '100%', marginTop: 3, fontSize: 11 }}
          >
            <option value="local">Локально</option>
            <option value="clipdrop">Clipdrop</option>
          </select>
        </label>
      </div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>
        Шрифт перевода по умолчанию
        <select
          aria-label="Шрифт перевода по умолчанию"
          value={translationFontFamily}
          onChange={event => setTranslationFontFamily(event.target.value)}
          style={{ width: '100%', marginTop: 3, fontSize: 11 }}
        >
          <option value={DEFAULT_ANIME_FONT} style={{ fontFamily: DEFAULT_ANIME_FONT }}>
            {DEFAULT_ANIME_FONT} (встроенный)
          </option>
          {customFonts.length > 0 && (
            <optgroup label="Мои шрифты">
              {customFonts.filter(f => f !== DEFAULT_ANIME_FONT).map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Применяется к новому тексту, «Вставить текст» и блокам автоперевода. Выбор сохраняется после перезагрузки.
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
        <input
          type="checkbox"
          checked={cleanupSettings.disableImageTranslationModel}
          onChange={event => updateCleanupSettings({ disableImageTranslationModel: event.target.checked })}
        />
        Не использовать image-модель
      </label>
      <button
        type="button"
        onClick={handleTranslateBubble}
        disabled={!activeDoc || !hasMask || Boolean(aiOperation) || Boolean(translationOperation)}
        style={{
          ...primaryButtonStyle,
          opacity: activeDoc && hasMask && !aiOperation && !translationOperation ? 1 : 0.55,
          cursor: activeDoc && hasMask && !aiOperation && !translationOperation ? 'pointer' : 'not-allowed',
        }}
      >
        {translationOperation === 'bubble' ? 'Переводим…' : 'Перевести бабл'}
      </button>
      {!cleanupSettings.disableImageTranslationModel && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Image-вызовы за сессию: {imageUsage.calls} · примерно ${imageUsage.estimatedCostUsd.toFixed(2)}
        </div>
      )}
      {!cleanupSettings.disableImageTranslationModel && (
        <>
          <button
            type="button"
            title="Модель перерисует текст сама. Результат нельзя редактировать как текст"
            onClick={handleTranslateAi}
            disabled={!activeDoc || !hasMask || Boolean(aiOperation) || Boolean(translationOperation)}
            style={{
              ...secondaryButtonStyle,
              opacity: activeDoc && hasMask && !aiOperation && !translationOperation ? 1 : 0.55,
              cursor: activeDoc && hasMask && !aiOperation && !translationOperation ? 'pointer' : 'not-allowed',
            }}
          >
            {translationOperation === 'ai' ? 'Переводим…' : 'Перевод AI (в стиле оригинала)'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Для AI-перевода выделяйте бабл целиком вместе с текстом. Если выделена только часть текста, результат может обрезаться.
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-secondary)' }}>
            Инструкция для AI
            <textarea
              aria-label="Инструкция для AI"
              value={redrawPrompt}
              onChange={event => setRedrawPrompt(event.target.value)}
              rows={5}
              style={{
                width: '100%', resize: 'vertical', boxSizing: 'border-box',
                background: 'var(--bg-panel-raised)', border: '1px solid var(--border-default)',
                borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, padding: '6px 8px', lineHeight: 1.35,
              }}
            />
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Для текста в баблах используйте «Перевести бабл» — он заливает область цветом фона. «Перерисовать» предназначен для надписей поверх арта.
          </div>
          <button
            type="button"
            onClick={handleRedrawSfx}
            disabled={!activeDoc || !hasMask || Boolean(aiOperation) || Boolean(translationOperation)}
            style={{
              ...secondaryButtonStyle,
              opacity: activeDoc && hasMask && !aiOperation && !translationOperation ? 1 : 0.55,
              cursor: activeDoc && hasMask && !aiOperation && !translationOperation ? 'pointer' : 'not-allowed',
            }}
          >
            {translationOperation === 'redraw' ? 'Перерисовываем…' : 'Перерисовать участок (AI)'}
          </button>
        </>
      )}
      {(translationOriginal || translationText) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {translationOriginal && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Оригинал:</strong> {translationOriginal}
            </div>
          )}
          <textarea
            aria-label="Перевод бабла"
            value={translationText}
            onChange={event => setTranslationText(event.target.value)}
            rows={3}
            style={{
              width: '100%', resize: 'vertical', boxSizing: 'border-box',
              background: 'var(--bg-panel-raised)', border: '1px solid var(--border-default)',
              borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '6px 8px',
              lineHeight: 1.4,
            }}
          />
          <button
            type="button"
            onClick={handleInsertTranslation}
            disabled={!translationDraft || !translationText.trim()}
            style={{ ...primaryButtonStyle, opacity: translationDraft && translationText.trim() ? 1 : 0.55 }}
          >
            Вставить текст
          </button>
        </div>
      )}

      </div>
      </details>
      <details className="editor-disclosure" open={Boolean(aiOperation) || activeTool === 'maskBrush' || undefined}>
      <summary>Маски и удаление объектов</summary>
      <div className="editor-disclosure-content">
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        {activeMask ? `Активна: ${activeMask.name} · ${activeMask.strokes.length} штр.` : 'Создайте маску и закрасьте объект оранжевой кистью.'}
      </div>
      <button
        type="button"
        onClick={() => { createMask(); setActiveTool('maskBrush'); }}
        disabled={!activeDoc || Boolean(aiOperation) || Boolean(translationOperation)}
        style={secondaryButtonStyle}
      >
        Новая маска
      </button>
      <button
        type="button"
        aria-label="Включить кисть маски"
        onClick={() => { updateCleanupSettings({ mode: 'inpaint' }); setActiveTool('maskBrush'); }}
        disabled={!activeDoc || Boolean(aiOperation) || Boolean(translationOperation)}
        style={secondaryButtonStyle}
      >
        Кисть маски
      </button>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => handleClipdrop('cleanup')}
          disabled={!activeDoc || !hasMask || Boolean(aiOperation) || Boolean(translationOperation)}
          aria-busy={aiOperation === 'cleanup'}
          style={{ ...primaryButtonStyle, flex: 1 }}
        >
          {aiOperation === 'cleanup' ? 'Удаляем…' : 'AI-удаление объекта'}
        </button>
        <button
          type="button"
          onClick={() => { if (window.confirm('Очистить все штрихи активной маски?')) clearActiveMask(); }}
          disabled={!hasMask || Boolean(aiOperation) || Boolean(translationOperation)}
          style={secondaryButtonStyle}
        >
          Очистить маску
        </button>
      </div>
      <button
        type="button"
        onClick={() => handleClipdrop('background')}
        disabled={!activeDoc || Boolean(aiOperation) || Boolean(translationOperation)}
        aria-busy={aiOperation === 'background'}
        style={primaryButtonStyle}
      >
        {aiOperation === 'background' ? 'Удаляем фон…' : 'Удалить фон'}
      </button>
      </div>
      </details>
      {(aiOperation || translationOperation) && (
        <button type="button" onClick={() => abortRef.current?.abort()} style={secondaryButtonStyle}>
          Отменить запрос
        </button>
      )}
      {aiError && (
        <div role="alert" style={{ color: 'var(--destructive)', fontSize: 11, lineHeight: 1.4 }}>
          <div>{aiError}</div>
          {safetyHint && <div style={{ marginTop: 4 }}>Image-модель отклонила фрагмент. Перевести через OCR + шрифт?</div>}
          {aiFallbackVisible && (
            <button type="button" onClick={handleTranslateBubble} disabled={Boolean(translationOperation)} style={{ ...secondaryButtonStyle, marginTop: 6 }}>
              Перевести бабл (OCR + заливка)
            </button>
          )}
          {aiRetryAction && !aiFallbackVisible && (
            <button
              type="button"
              onClick={() => { if (aiRetryAction === 'translate') void handleTranslateAi(); else void handleRedrawSfx(); }}
              disabled={Boolean(translationOperation)}
              style={{ ...secondaryButtonStyle, marginTop: 6 }}
            >
              Повторить
            </button>
          )}
        </div>
      )}
      {imageQualityWarning && (
        <div role="status" style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 }}>
          Выделение слишком большое, качество перерисовки может пострадать.
        </div>
      )}

      <div className="divider" />

      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Ctrl+Z — отмена, Ctrl+Shift+Z — повтор
      </div>
    </div>
  );
}
