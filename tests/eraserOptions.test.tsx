import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolOptionsBar } from '@/components/editor/ToolOptionsBar';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';

afterEach(cleanup);
describe('eraser controls', () => {
  it('shows the real pixel diameter and changes the brush diameter in document units', () => {
    const doc = makeEditorDocument({ width: 1200, height: 2000 });
    useStore.setState({ documents: [doc], activeDocIndex: 0, activeTool: 'eraser', cleanupSettings: { ...useStore.getState().cleanupSettings, brushSize: 0.05, brushOpacity: 0.7 } });
    render(<ToolOptionsBar />);
    const diameter = screen.getByRole('spinbutton', { name: 'Размер инструмента' }) as HTMLInputElement;
    expect(diameter.value).toBe('100');
    fireEvent.change(diameter, { target: { value: '160' } });
    expect(useStore.getState().cleanupSettings.brushSize).toBe(0.08);
    const opacity = screen.getByRole('slider', { name: 'Непрозрачность ластика' }) as HTMLInputElement;
    expect(opacity.value).toBe('70');
    fireEvent.change(opacity, { target: { value: '40' } });
    expect(useStore.getState().cleanupSettings.brushOpacity).toBe(0.4);
    expect(screen.getByText(/Стирает выбранный слой/)).toBeTruthy();
  });
});
