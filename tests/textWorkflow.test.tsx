import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolOptionsBar } from '@/components/editor/ToolOptionsBar';
import { TextPanel } from '@/components/editor/panels/TextPanel';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { useStore } from '@/store/useStore';

const TEXT_WORKFLOW_HINT = 'Потяните рамку · Enter — новая строка · Ctrl/⌘+Enter — готово · Esc — отмена';

describe('paragraph text workflow guidance', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      documents: [makeEditorDocument()],
      activeDocIndex: 0,
      activeTool: 'text',
      selectedObject: null,
      inlineEditingTextId: null,
    });
  });

  afterEach(cleanup);

  it('shows the complete keyboard and drag guidance while Text is active', () => {
    render(<ToolOptionsBar />);
    expect(screen.getByText(TEXT_WORKFLOW_HINT)).toBeTruthy();
  });

  it('guides panel users to draw a frame without promising click-time creation', () => {
    render(<TextPanel />);
    expect(screen.getByText(TEXT_WORKFLOW_HINT)).toBeTruthy();
    expect(screen.getByPlaceholderText('Текст можно ввести после создания рамки')).toBeTruthy();
  });
});
