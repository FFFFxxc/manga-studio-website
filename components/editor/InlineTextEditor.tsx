'use client';

import { useEffect, useRef } from 'react';
import type { TextObject, ViewportState } from '@/types';
import { getInlineTextEditorBox } from '@/utils/inlineTextEditorGeometry';

interface Props {
  textObj: TextObject;
  docWidth: number;   // px (docWidth * previewScale)
  docHeight: number;  // px (docHeight * previewScale)
  viewport: ViewportState;
  isNew: boolean;     // if true, select all on mount
  onCommit: (text: string) => void;
  onCancel: () => void;
  onOverflowChange?: (isOverflowing: boolean) => void;
}

/**
 * Floating textarea that appears over the Konva canvas at the text object's
 * position. WYSIWYG: mirrors font, size, color, stroke, shadow, rotation and
 * scale of the Konva Text node, so editing looks exactly like the final
 * render. The Konva node itself is hidden while editing (no ghost copy), and
 * the textarea is fully transparent — only a thin frame marks the edit area.
 */
export function InlineTextEditor({
  textObj,
  docWidth,
  docHeight,
  viewport,
  isNew,
  onCommit,
  onCancel,
  onOverflowChange,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const finishedRef = useRef(false);

  // Compute screen-space position matching the Konva Text node
  const screenX = textObj.x * docWidth * viewport.scale + viewport.x;
  const screenY = textObj.y * docHeight * viewport.scale + viewport.y;
  const scaledFontSize = textObj.fontSize * docHeight * viewport.scale;
  const scaledWidth = textObj.width * docWidth * viewport.scale;
  const isParagraph = textObj.textMode === 'paragraph';
  const scaledHeight = (textObj.height ?? 0) * docHeight * viewport.scale;
  const editorBox = getInlineTextEditorBox(scaledWidth, scaledHeight, isParagraph);
  const scaledStroke = textObj.stroke && textObj.strokeWidth > 0
    ? textObj.strokeWidth * viewport.scale
    : 0;
  const scaledShadow = textObj.shadowBlur > 0
    ? textObj.shadowBlur * viewport.scale
    : 0;

  function measureOverflow() {
    const el = ref.current;
    if (!el) return;
    const overflowing = el.scrollHeight > el.clientHeight;
    el.dataset.overflowing = String(overflowing);
    onOverflowChange?.(overflowing);
  }

  // Point text grows with content; paragraph text keeps its drawn rectangle.
  function fitEditor() {
    const el = ref.current;
    if (!el) return;
    if (isParagraph) {
      el.style.height = `${editorBox.height}px`;
      measureOverflow();
      return;
    }
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
    measureOverflow();
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitEditor();
    el.focus();
    if (isNew) {
      el.select();
    } else {
      // Place cursor at end
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // Re-fit when the rendered text metrics or paragraph bounds change.
  useEffect(() => {
    fitEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaledFontSize, scaledWidth, scaledHeight, isParagraph]);

  useEffect(() => {
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) fitEditor();
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaledFontSize, scaledWidth, scaledHeight, isParagraph]);

  function commit() {
    if (finishedRef.current || !ref.current) return;
    finishedRef.current = true;
    onCommit(ref.current.value);
  }

  function cancel() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  }

  return (
    <textarea
      ref={ref}
      defaultValue={textObj.text}
      data-text-mode={isParagraph ? 'paragraph' : 'point'}
      onInput={fitEditor}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
          return;
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width: editorBox.width,
        height: editorBox.height,
        minHeight: isParagraph ? undefined : scaledFontSize * textObj.lineHeight,
        fontSize: scaledFontSize,
        fontFamily: textObj.fontFamily,
        color: textObj.fill,
        lineHeight: textObj.lineHeight,
        textAlign: textObj.align as React.CSSProperties['textAlign'],
        // Transparent editor — the text is the only thing you see,
        // exactly where it will be rendered. A thin frame marks the bounds.
        background: 'transparent',
        border: 'none',
        outline: '1px solid var(--accent)',
        outlineOffset: 3,
        borderRadius: 2,
        padding: 0,
        margin: 0,
        resize: 'none',
        overflow: 'hidden',
        display: 'block',
        zIndex: 50,
        boxSizing: 'border-box',
        pointerEvents: 'all',
        caretColor: textObj.fill,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        // Mirror Konva node visuals so editing is true WYSIWYG
        WebkitTextStroke: scaledStroke > 0 ? `${scaledStroke}px ${textObj.stroke}` : undefined,
        textShadow: scaledShadow > 0 ? `0 0 ${scaledShadow}px ${textObj.shadowColor}` : undefined,
        transform: `rotate(${textObj.rotation}deg) scale(${textObj.scaleX}, ${textObj.scaleY})`,
        transformOrigin: 'left top',
      }}
    />
  );
}
