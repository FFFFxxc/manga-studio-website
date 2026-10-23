import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeftPanel } from '@/components/editor/LeftPanel';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { useStore } from '@/store/useStore';

describe('editor navigation', () => {
  beforeEach(() => {
    useStore.setState({ documents: [makeEditorDocument()], activeDocIndex: 0, leftTab: 'cleanup', activeTool: 'brush', selectedObject: null });
  });
  afterEach(cleanup);

  it('opens shapes directly and exits the painting tool', () => {
    render(<LeftPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'Фигуры' }));
    expect(useStore.getState().leftTab).toBe('insert');
    expect(useStore.getState().activeTool).toBe('select');
    expect(screen.getByRole('button', { name: 'Добавить: Прямоугольник' })).toBeTruthy();
  });

  it('opens the matching properties when the selected object changes', () => {
    render(<LeftPanel />);
    act(() => useStore.getState().setSelectedObject({ id: 'shape', type: 'shape' }));
    expect(useStore.getState().leftTab).toBe('insert');
    act(() => useStore.getState().setSelectedObject({ id: 'bubble', type: 'bubble' }));
    expect(useStore.getState().leftTab).toBe('bubble');
  });
});
