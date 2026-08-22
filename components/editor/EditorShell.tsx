'use client';

import { useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useStore } from '@/store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_ANIME_FONT, MANGA_FONTS, type ActiveTool } from '@/types';
import { LeftPanel } from './LeftPanel';
import { ToolRail } from './ToolRail';
import { RightPanel } from './RightPanel';
import { ExportModal } from './ExportModal';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/use-toast';
import { resolveDeleteTarget, resolveEditableTargetShortcut, resolveEditorShortcut } from '@/utils/editorShortcuts';
import { revokeUnusedDocumentObjectUrls } from '@/utils/objectUrls';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import { ToolOptionsPopoverHost } from './floating/ToolOptionsPopover';

// Konva's Stage relies on browser APIs and react-reconciler internals that
// break during SSR ("getOwner is not a function"), so load it client-only.
const CanvasArea = dynamic(
  () => import('./CanvasArea').then(m => m.CanvasArea),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-app)',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        Загрузка редактора…
      </div>
    ),
  },
);

export function EditorShell() {
  const { undo, redo, setActiveTool, setLeftTab, selectedObject, deleteWatermark, deleteText, deleteTranslationMask, deleteShape, deleteBubble, deleteAiLayer, deleteMask, documents, activeDocIndex, fontsReady, setShowExportModal, activeTool } = useStore(useShallow(state => ({
    undo: state.undo,
    redo: state.redo,
    setActiveTool: state.setActiveTool,
    setLeftTab: state.setLeftTab,
    selectedObject: state.selectedObject,
    deleteWatermark: state.deleteWatermark,
    deleteText: state.deleteText,
    deleteTranslationMask: state.deleteTranslationMask,
    deleteShape: state.deleteShape,
    deleteBubble: state.deleteBubble,
    deleteAiLayer: state.deleteAiLayer,
    deleteMask: state.deleteMask,
    documents: state.documents,
    activeDocIndex: state.activeDocIndex,
    fontsReady: state.fontsReady,
    setShowExportModal: state.setShowExportModal,
    activeTool: state.activeTool,
  })));
  const prevToolRef = useRef<ActiveTool | null>(null);
  const lastRetouchToolRef = useRef<'smudge' | 'sharpen'>('smudge');

  useEffect(() => {
    if (activeTool === 'smudge' || activeTool === 'sharpen') lastRetouchToolRef.current = activeTool;
  }, [activeTool]);

  // Register hasChanges for beforeunload
  useEffect(() => {
    (window as any).__mangaStudioHasChanges = () =>
      documents.some(d => d.hasChanges);
    return () => { delete (window as any).__mangaStudioHasChanges; };
  }, [documents]);

  useEffect(() => {
    const releaseOnPageHide = (event: PageTransitionEvent) => {
      // Keep URLs alive for the browser back-forward cache; otherwise the
      // whole editor is leaving and its blob-backed pages can be released.
      if (!event.persisted) revokeUnusedDocumentObjectUrls(useStore.getState().documents, []);
    };
    window.addEventListener('pagehide', releaseOnPageHide);
    return () => window.removeEventListener('pagehide', releaseOnPageHide);
  }, []);

  // Register ALL fonts (built-in + saved custom from IndexedDB) BEFORE the
  // canvas first renders — otherwise Konva would paint text with a fallback
  // font. fontsReady gates <CanvasArea/>; a 6s guard keeps the editor usable
  // even if font loading stalls (fonts then arrive in the background and the
  // canvas repaints via fontsVersion).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        preloadGoogleFonts,
        loadSavedCustomFonts,
        loadStoredDefaultTranslationFont,
      } = await import('@/utils/fonts');
      const {
        setCustomFonts, bumpFontsVersion, setFontsReady,
        setTranslationFontFamily, replaceMissingFonts,
      } = useStore.getState();

      const finalize = (customNames: string[]) => {
        if (cancelled) return;
        setCustomFonts(customNames);
        const available = [...MANGA_FONTS, ...customNames];

        // Восстанавливаем «Шрифт перевода по умолчанию» из localStorage.
        // Если выбранный шрифт удалён из IndexedDB — возвращаемся к встроенному.
        const stored = loadStoredDefaultTranslationFont();
        const effective = stored && available.includes(stored) ? stored : DEFAULT_ANIME_FONT;
        setTranslationFontFamily(effective);
        if (stored && !available.includes(stored)) {
          toast({
            title: 'Шрифт по умолчанию недоступен',
            description: `«${stored}» не найден среди сохранённых шрифтов. Используется встроенный «${DEFAULT_ANIME_FONT}».`,
          });
        }

        // Если открытые документы ссылаются на отсутствующие шрифты —
        // подставляем дефолтный, чтобы не ломать рендер.
        const missing = replaceMissingFonts(available);
        if (missing.length > 0) {
          toast({
            title: 'Шрифты не найдены',
            description: `Не найдены: ${missing.join(', ')}. Текст показан шрифтом по умолчанию «${effective}».`,
          });
        }
        bumpFontsVersion();
      };

      const loadPromise = (async () => {
        const [, customNames] = await Promise.all([
          preloadGoogleFonts(),
          loadSavedCustomFonts(),
        ]);
        return customNames;
      })();
      const guard = new Promise<null>(resolve => { window.setTimeout(() => resolve(null), 6000); });
      const result = await Promise.race([loadPromise, guard]);
      if (cancelled) return;
      if (result !== null) {
        finalize(result);
      } else {
        loadPromise.then(finalize).catch(() => {});
      }
      setFontsReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const ui = useEditorUiStore.getState();
        if (ui.dismissFloating()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (ui.closeToolOptions()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (ui.cancelActiveOperation()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        const state = useStore.getState();
        window.dispatchEvent(new Event('manga-editor-cancel-transient'));
        if (state.inlineEditingTextId) {
          state.setInlineEditingTextId(null);
          e.preventDefault();
          return;
        }
        const doc = state.documents[state.activeDocIndex];
        const activeMask = doc?.masks.find(mask => mask.id === doc.activeMaskId);
        if (activeMask && ((activeMask.elements?.length ?? 0) > 0 || activeMask.strokes.length > 0)) {
          state.clearActiveMask();
          e.preventDefault();
          return;
        }
        state.setSelectedObject(null);
        state.selectLayer(null);
        state.setActiveTool('select');
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && useEditorUiStore.getState().commitActiveOperation()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
      const shortcut = resolveEditorShortcut(e, activeTool, lastRetouchToolRef.current);
      // Export remains global even while a form control is focused. Native
      // text undo/redo and editing shortcuts stay owned by the control.
      if (editable && resolveEditableTargetShortcut(e)?.type === 'export') {
        e.preventDefault();
        setShowExportModal(true);
        return;
      }
      if (editable)
        return;

      const mod = e.ctrlKey || e.metaKey;

      // Space — toggle pan tool, restore on keyup (check NO modifiers)
      if (e.code === 'Space' && !mod) {
        e.preventDefault();
        if (e.repeat) return;
        if (activeTool !== 'pan') {
          prevToolRef.current = activeTool;
          setActiveTool('pan');
        }
        return;
      }

      if (shortcut) {
        e.preventDefault();
        if (shortcut.type === 'undo') undo();
        else if (shortcut.type === 'redo') redo();
        else if (shortcut.type === 'export') setShowExportModal(true);
        else if (shortcut.type === 'tab') setLeftTab(shortcut.tab);
        else if (shortcut.type === 'brush-adjust') {
          const state = useStore.getState();
          if (activeTool === 'blur') {
            if (shortcut.property === 'size') {
              state.updateBlurSettings({
                brushSize: Math.max(0.003, Math.min(0.35, state.blurSettings.brushSize + shortcut.delta * 0.005)),
              });
            } else {
              state.updateBlurSettings({
                hardness: Math.max(0, Math.min(1, state.blurSettings.hardness + shortcut.delta * 0.05)),
              });
            }
          } else if (activeTool === 'cloneStamp') {
            if (shortcut.property === 'size') {
              state.updateCloneStampSettings({
                size: Math.max(0.003, Math.min(0.35, state.cloneStampSettings.size + shortcut.delta * 0.005)),
              });
            } else {
              state.updateCloneStampSettings({
                hardness: Math.max(0, Math.min(1, state.cloneStampSettings.hardness + shortcut.delta * 0.05)),
              });
            }
          } else if (activeTool === 'smudge') {
            if (shortcut.property === 'size') state.updateSmudgeSettings({ size: Math.max(0.003, Math.min(0.35, state.smudgeSettings.size + shortcut.delta * 0.005)) });
            else state.updateSmudgeSettings({ hardness: Math.max(0, Math.min(1, state.smudgeSettings.hardness + shortcut.delta * 0.05)) });
          } else if (activeTool === 'sharpen') {
            if (shortcut.property === 'size') state.updateBlurSettings({ brushSize: Math.max(0.003, Math.min(0.35, state.blurSettings.brushSize + shortcut.delta * 0.005)) });
            else state.updateBlurSettings({ hardness: Math.max(0, Math.min(1, state.blurSettings.hardness + shortcut.delta * 0.05)) });
          } else if (activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser') {
            if (shortcut.property === 'size') {
              state.updateCleanupSettings({
                brushSize: Math.max(0.003, Math.min(0.2, state.cleanupSettings.brushSize + shortcut.delta * 0.005)),
              });
            } else {
              state.updateCleanupSettings({
                brushHardness: Math.max(0, Math.min(1, state.cleanupSettings.brushHardness + shortcut.delta * 0.05)),
              });
            }
          }
        }
        else {
          useEditorUiStore.getState().cancelActiveOperation();
          useEditorUiStore.getState().closeToolOptions();
          setActiveTool(shortcut.tool);
          if (shortcut.tab) setLeftTab(shortcut.tab);
        }
        return;
      }

      if (mod) return; // Don't steal other Ctrl/Cmd shortcuts from the browser

      // Delete/Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedLayer = activeDocIndex >= 0 ? documents[activeDocIndex]?.selectedLayer ?? null : null;
        const deleteTarget = resolveDeleteTarget(activeTool, selectedObject, selectedLayer);
        if (deleteTarget === 'contour') return;
        if (!deleteTarget) return;
        e.preventDefault();
        if (deleteTarget.type === 'watermark') deleteWatermark(deleteTarget.id);
        else if (deleteTarget.type === 'shape') deleteShape(deleteTarget.id);
        else if (deleteTarget.type === 'bubble') deleteBubble(deleteTarget.id);
        else if (deleteTarget.type === 'text') deleteText(deleteTarget.id);
        else if (deleteTarget.type === 'translationMask') deleteTranslationMask(deleteTarget.id);
        else if (deleteTarget.type === 'ai') deleteAiLayer(deleteTarget.id);
        else deleteMask(deleteTarget.id);
      }
    },
    [
      undo,
      redo,
      setActiveTool,
      setLeftTab,
      setShowExportModal,
      selectedObject,
      deleteWatermark,
      deleteText,
      deleteTranslationMask,
      deleteShape,
      deleteBubble,
      deleteAiLayer,
      deleteMask,
      documents,
      activeDocIndex,
      activeTool,
    ],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const previous = prevToolRef.current;
      prevToolRef.current = null;
      if (previous) setActiveTool(previous);
    },
    [setActiveTool],
  );

  const handleBlur = useCallback(() => {
    // If user alt-tab or lose focus while holding Space, restore the previous tool
    const previous = prevToolRef.current;
    prevToolRef.current = null;
    if (previous) setActiveTool(previous);
  }, [setActiveTool]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleKeyDown, handleKeyUp, handleBlur]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-app)',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <TopBar />
      {/* Main area */}
      <div className="editor-main">
        <LeftPanel />
        <ToolRail />
        {fontsReady ? (
          <CanvasArea />
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-app)',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            Загружаем шрифты…
          </div>
        )}
        <RightPanel />
      </div>
      <ExportModal />
      <Toaster />
      <ToolOptionsPopoverHost />
    </div>
  );
}

function TopBar() {
  const { documents, activeDocIndex, setShowExportModal, undo, redo } = useStore(useShallow(state => ({
    documents: state.documents,
    activeDocIndex: state.activeDocIndex,
    setShowExportModal: state.setShowExportModal,
    undo: state.undo,
    redo: state.redo,
  })));
  const activeDoc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;

  return (
    <header style={{ height: 52, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, flexShrink: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 190 }}>
        <svg width="24" height="24" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <rect width="22" height="22" rx="5" fill="var(--accent-dim)" />
          <rect x="3" y="3" width="7" height="10" rx="1.5" fill="var(--accent)" />
          <rect x="12" y="3" width="7" height="6" rx="1.5" fill="var(--accent)" opacity="0.7" />
          <rect x="12" y="11" width="7" height="8" rx="1.5" fill="var(--accent)" opacity="0.5" />
          <rect x="3" y="15" width="7" height="4" rx="1.5" fill="var(--accent)" opacity="0.5" />
        </svg>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>Манга-студия</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
            {activeDoc ? `${activeDoc.name} · ${activeDocIndex + 1}/${documents.length}` : 'Новый проект'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, paddingLeft: 8, borderLeft: '1px solid var(--border-subtle)' }}>
        <button className="ui-icon-button" onClick={undo} disabled={!activeDoc?.past.length} aria-label="Отменить действие" title="Отменить (Ctrl+Z)">↶</button>
        <button className="ui-icon-button" onClick={redo} disabled={!activeDoc?.future.length} aria-label="Повторить действие" title="Повторить (Ctrl+Shift+Z)">↷</button>
      </div>

      {activeDoc?.hasChanges && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ color: 'var(--accent)' }}>●</span> Есть изменения</span>}
      <div style={{ flex: 1 }} />
      <button className="ui-button ui-button-primary" onClick={() => setShowExportModal(true)} disabled={!activeDoc} aria-label="Открыть экспорт">
        Экспортировать
        <span aria-hidden="true">→</span>
      </button>
    </header>
  );
}
