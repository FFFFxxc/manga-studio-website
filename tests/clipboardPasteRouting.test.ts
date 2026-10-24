import { describe, expect, it } from 'vitest';
import {
  extractClipboardImageFiles,
  shouldKeepNativePaste,
} from '@/utils/pastedImageLayers';

describe('clipboard paste routing', () => {
  it('recognizes PNG files from clipboard providers that omit the MIME type', () => {
    const png = new File(['png'], 'overlay.PNG');
    expect(extractClipboardImageFiles({ files: [png], items: [] } as unknown as DataTransfer)).toEqual([png]);
    expect(extractClipboardImageFiles({ files: [], items: [{ kind: 'file', type: '', getAsFile: () => png }] } as unknown as DataTransfer)).toEqual([png]);
  });
  it('keeps native paste in text-editable elements', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(shouldKeepNativePaste(document.createElement(tag))).toBe(true);
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(shouldKeepNativePaste(editable)).toBe(true);
    expect(shouldKeepNativePaste(document.createElement('canvas'))).toBe(false);
  });

  it('extracts only images and deduplicates files exposed twice', () => {
    const image = new File(['png'], 'panel.png', { type: 'image/png', lastModified: 1 });
    const text = new File(['txt'], 'note.txt', { type: 'text/plain', lastModified: 2 });
    const data = {
      files: [image, text],
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => image },
        { kind: 'file', type: 'text/plain', getAsFile: () => text },
      ],
    };
    expect(extractClipboardImageFiles(data as unknown as DataTransfer)).toEqual([image]);
  });

  it('deduplicates the same clipboard image when the item copy has a new lastModified', () => {
    const fromFiles = new File(['same pixels'], 'image.png', {
      type: 'image/png',
      lastModified: 1,
    });
    const fromItems = new File(['same pixels'], 'image.png', {
      type: 'image/png',
      lastModified: Date.now(),
    });
    const data = {
      files: [fromFiles],
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => fromItems },
      ],
    };

    expect(extractClipboardImageFiles(data as unknown as DataTransfer)).toEqual([fromFiles]);
  });

  it('keeps distinct clipboard files with the same type and size', () => {
    const first = new File(['1234'], 'page-1.png', { type: 'image/png' });
    const second = new File(['5678'], 'page-2.png', { type: 'image/png' });
    const data = { files: [first, second], items: [] };

    expect(extractClipboardImageFiles(data as unknown as DataTransfer)).toEqual([first, second]);
  });
});
