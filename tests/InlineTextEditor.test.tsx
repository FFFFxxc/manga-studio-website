import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextObject } from '@/types';
import { InlineTextEditor } from '@/components/editor/InlineTextEditor';

const textObj: TextObject = {
  id: 'text-1',
  text: '',
  fontFamily: 'Arial',
  fontSize: 0.05,
  fill: '#111111',
  stroke: '',
  strokeWidth: 0,
  shadowColor: 'transparent',
  shadowBlur: 0,
  lineHeight: 1.2,
  align: 'left',
  width: 0.4,
  x: 0.2,
  y: 0.2,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  visible: true,
};

function renderEditor(overrides: Partial<React.ComponentProps<typeof InlineTextEditor>> = {}) {
  return render(
    <InlineTextEditor
      textObj={textObj}
      docWidth={1000}
      docHeight={800}
      viewport={{ x: 0, y: 0, scale: 1 }}
      isNew={false}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
}

describe('InlineTextEditor keyboard semantics', () => {
  afterEach(cleanup);

  // Mutation caught: restoring the old plain-Enter commit branch prevents
  // paragraph users from entering a second line and publishes too early.
  it('inserts a newline with Enter and commits with Meta+Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    renderEditor({ onCommit });

    const editor = screen.getByRole('textbox');
    await user.type(editor, 'Первая{enter}Вторая');

    expect((editor as HTMLTextAreaElement).value).toBe('Первая\nВторая');
    expect(onCommit).not.toHaveBeenCalled();

    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('Первая\nВторая');
  });

  // Mutation caught: calling onCancel before a later blur without marking the
  // editor finished lets blur publish text after Photoshop-style cancellation.
  it('cancels once on Escape and ignores the following blur', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    renderEditor({ onCancel, onCommit });

    const editor = screen.getByRole('textbox');
    await user.keyboard('{Escape}');
    fireEvent.blur(editor);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Mutation caught: auto-growing paragraph text ignores the box height and
  // gives CanvasArea no signal that the visible paragraph has clipped lines.
  it('keeps a paragraph height fixed and reports clipped input', () => {
    renderEditor({
      textObj: { ...textObj, textMode: 'paragraph', height: 0.25 },
    });

    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 240 },
    });
    fireEvent.input(editor);

    expect(editor.dataset.textMode).toBe('paragraph');
    expect(editor.style.height).toBe('200px');
    expect(editor.dataset.overflowing).toBe('true');
    expect(editor.style.overflow).toBe('hidden');
    expect(editor.style.resize).toBe('none');
  });
});
