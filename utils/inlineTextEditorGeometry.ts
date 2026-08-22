export const MIN_INLINE_TEXT_EDITOR_WIDTH = 80;
export const MIN_PARAGRAPH_TEXT_EDITOR_HEIGHT = 1;

export function getInlineTextEditorBox(scaledWidth: number, scaledHeight: number, isParagraph: boolean) {
  return {
    width: Math.max(MIN_INLINE_TEXT_EDITOR_WIDTH, scaledWidth),
    height: isParagraph ? Math.max(MIN_PARAGRAPH_TEXT_EDITOR_HEIGHT, scaledHeight) : undefined,
  };
}
