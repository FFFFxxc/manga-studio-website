'use client';

import { useStore } from '@/store/useStore';
import { useEffect } from 'react';
import { Brush, Type, MessageCircle, Shapes, Stamp, Crop, Sticker } from 'lucide-react';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import type { LeftTab } from '@/types';
import { WatermarkPanel } from './panels/WatermarkPanel';
import { CleanupPanel } from './panels/CleanupPanel';
import { TextPanel } from './panels/TextPanel';
import { InsertPanel } from './panels/InsertPanel';
import { TransformPanel } from './panels/TransformPanel';
import { BubblePanel } from './panels/BubblePanel';
import { StickerPanel } from './panels/StickerPanel';

const TABS: Array<{ key: LeftTab; label: string; hotkey: string; icon: typeof Brush; hint: string }> = [
  { key: 'cleanup', label: 'Очистка', hotkey: '2', icon: Brush, hint: 'Уберите исходный текст и исправьте фон.' },
  { key: 'text', label: 'Текст', hotkey: '3', icon: Type, hint: 'Добавьте перевод или измените выбранную надпись.' },
  { key: 'bubble', label: 'Баблы', hotkey: '6', icon: MessageCircle, hint: 'Добавьте реплику и настройте её форму.' },
  { key: 'insert', label: 'Фигуры', hotkey: '4', icon: Shapes, hint: 'Добавьте фигуру или стрелку. Изображения вставляются кнопкой в верхней панели.' },
  { key: 'stickers', label: 'Стикеры', hotkey: '7', icon: Sticker, hint: 'Готовый пак и ваши PNG, сохранённые в браузере.' },
  { key: 'watermark', label: 'Водяной знак', hotkey: '1', icon: Stamp, hint: 'Поставьте подпись или логотип на страницы.' },
  { key: 'transform', label: 'Размер и обрезка', hotkey: '5', icon: Crop, hint: 'Измените размер или обрежьте страницу.' },
];

export function LeftPanel() {
  const { leftTab, setLeftTab, documents, selectedObject } = useStore();
  const hasDocuments = documents.length > 0;
  const currentTab = TABS.find(tab => tab.key === leftTab)!;

  // Object selection opens its properties, including selection from the layer list.
  useEffect(() => {
    if (!selectedObject) return;
    const tab: LeftTab | undefined = ({ text: 'text', bubble: 'bubble', shape: 'insert', watermark: 'watermark', translationMask: 'text' } as const)[selectedObject.type];
    if (tab) setLeftTab(tab);
  }, [selectedObject?.id, selectedObject?.type, setLeftTab]);

  return (
    <aside
      className="editor-sidebar"
      id="editor-properties"
      aria-label="Инструменты редактора"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-default)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Tab bar */}
      <div role="tablist" aria-label="Панели редактирования" className="editor-navigation">
        {TABS.map(({ icon: Icon, ...tab }) => (
          <button
            key={tab.key}
            role="tab"
            className="editor-navigation-button"
            id={`tab-${tab.key}`}
            aria-selected={leftTab === tab.key}
            aria-controls={`panel-${tab.key}`}
            onClick={() => {
              const ui = useEditorUiStore.getState();
              ui.cancelActiveOperation();
              ui.closeToolOptions();
              setLeftTab(tab.key);
              const state = useStore.getState();
              state.setActiveTool(tab.key === 'text' ? 'text' : tab.key === 'cleanup' ? (state.cleanupSettings.mode === 'inpaint' ? 'maskBrush' : 'brush') : 'select');
            }}
            title={`${tab.label} (${tab.hotkey})`}
          >
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div id={`panel-${leftTab}`} role="tabpanel" aria-labelledby={`tab-${leftTab}`} className="editor-scroll editor-properties" style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
        {!hasDocuments && leftTab !== 'stickers' ? (
          <div className="editor-empty">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><rect x="5" y="7" width="26" height="22" rx="4" stroke="currentColor" strokeWidth="1.5"/><path d="M10 23l5-5 4 4 3-3 5 5M23 13h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <strong>Здесь будут настройки</strong>
            <span style={{ fontSize: 12, lineHeight: 1.6 }}>Добавьте страницу на холст, затем выберите нужный инструмент.</span>
          </div>
        ) : (
          <>
            <div className="editor-panel-heading"><h2>{currentTab.label}</h2><p>{currentTab.hint}</p></div>
            {leftTab === 'watermark' && <WatermarkPanel />}
            {leftTab === 'cleanup' && <CleanupPanel />}
            {leftTab === 'text' && <TextPanel />}
            {leftTab === 'bubble' && <BubblePanel />}
            {leftTab === 'insert' && <InsertPanel />}
            {leftTab === 'transform' && <TransformPanel />}
            {leftTab === 'stickers' && <StickerPanel />}
          </>
        )}
      </div>
    </aside>
  );
}
