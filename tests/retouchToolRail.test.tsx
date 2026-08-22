import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRail } from '@/components/editor/ToolRail';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';

describe('retouch tool rail', () => {
  beforeEach(() => {
    useStore.setState({
      documents: [makeEditorDocument()],
      activeDocIndex: 0,
      activeTool: 'select',
    });
  });

  afterEach(() => cleanup());

  it.each(['Пипетка', 'Штамп', 'Палец', 'Резкость'])('exposes %s as an accessible tool', label => {
    render(<ToolRail />);
    expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
  });
});
