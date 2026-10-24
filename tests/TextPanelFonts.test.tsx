import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextPanel } from '@/components/editor/panels/TextPanel';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';

const fontMocks = vi.hoisted(() => ({ save: vi.fn(), has: vi.fn(), remove: vi.fn() }));
vi.mock('@/utils/fonts', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/fonts')>(),
  saveCustomFont: fontMocks.save,
  hasCustomFont: fontMocks.has,
  deleteCustomFont: fontMocks.remove,
}));

function fontFile(name: string) {
  const file = new File(['font'], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer });
  return file;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  fontMocks.save.mockReset().mockResolvedValue(undefined);
  fontMocks.has.mockReset().mockResolvedValue(false);
  fontMocks.remove.mockReset().mockResolvedValue(undefined);
  useStore.setState({ documents: [makeEditorDocument()], activeDocIndex: 0, selectedObject: null, customFonts: [] });
});

describe('TextPanel font imports', () => {
  it('saves valid files from one selection and reports invalid files without stopping the batch', async () => {
    render(<TextPanel />);
    const input = screen.getByLabelText('Добавить файлы шрифтов');
    expect(input.hasAttribute('multiple')).toBe(true);
    fireEvent.change(input, { target: { files: [fontFile('First.ttf'), fontFile('bad.png'), fontFile('Second.woff2')] } });
    await waitFor(() => expect(useStore.getState().customFonts).toEqual(['First', 'Second']));
    expect(fontMocks.save).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/bad.png: Принимаются/)).toBeTruthy();
    expect(screen.getByText(/Сохранено шрифтов: 2/)).toBeTruthy();
  });

  it('does not claim persistence or add a font to the list if saving fails', async () => {
    fontMocks.save.mockRejectedValueOnce(new Error('Недостаточно места в браузере.'));
    render(<TextPanel />);
    fireEvent.change(screen.getByLabelText('Добавить файлы шрифтов'), { target: { files: [fontFile('Manga.otf')] } });
    await waitFor(() => expect(screen.getByText(/Manga.otf: Недостаточно места/)).toBeTruthy());
    expect(useStore.getState().customFonts).toEqual([]);
    expect(screen.getByText('Новые шрифты не добавлены.')).toBeTruthy();
  });

  it('does not silently overwrite an existing saved font', async () => {
    fontMocks.has.mockResolvedValueOnce(true);
    render(<TextPanel />);
    fireEvent.change(screen.getByLabelText('Добавить файлы шрифтов'), { target: { files: [fontFile('Existing.ttf')] } });
    await waitFor(() => expect(screen.getByText(/Шрифт с таким именем уже есть/)).toBeTruthy());
    expect(fontMocks.save).not.toHaveBeenCalled();
  });
});
