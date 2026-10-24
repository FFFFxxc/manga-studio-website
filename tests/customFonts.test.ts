import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise transaction failure and reload behavior without depending on DOM
// canvas font rendering. A real FontFace is checked separately in browser QA.
const saved = new Map<string, { name: string; data: ArrayBuffer }>();
let failWrites = false;
const faces = { add: vi.fn(), delete: vi.fn() };
const close = vi.fn();
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

function request(result: unknown) {
  const req = { result, onsuccess: null as (() => void) | null };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

beforeEach(() => {
  vi.resetModules(); saved.clear(); failWrites = false; vi.clearAllMocks();
  Object.defineProperty(document, 'fonts', { configurable: true, value: faces });
  vi.stubGlobal('FontFace', class {
    constructor(public family: string, public data: ArrayBuffer) {}
    load() { return new Uint8Array(this.data)[0] === 0 ? Promise.reject(new Error('Corrupt font')) : Promise.resolve(this); }
  });
  vi.stubGlobal('indexedDB', {
    open() {
      return request({
        close,
        transaction() {
          const tx = {
            error: failWrites ? new Error('Storage quota exceeded') : null,
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            objectStore: () => ({
              put: (font: { name: string; data: ArrayBuffer }) => {
                if (!failWrites) saved.set(font.name, font);
                queueMicrotask(() => failWrites ? tx.onerror?.() : tx.oncomplete?.());
              },
              delete: (name: string) => {
                if (!failWrites) saved.delete(name);
                queueMicrotask(() => failWrites ? tx.onabort?.() : tx.oncomplete?.());
              },
              getAll: () => request([...saved.values()]),
              getKey: (name: string) => request(saved.has(name) ? name : undefined),
            }),
          };
          return tx;
        },
      });
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
});

describe('custom font library', () => {
  const data = () => new Uint8Array([1, 2, 3]).buffer;
  it('persists font bytes and restores them in a new runtime', async () => {
    let fonts = await import('@/utils/fonts');
    await fonts.saveCustomFont('Comic Cyrillic', data());
    expect(await fonts.hasCustomFont('Comic Cyrillic')).toBe(true);
    vi.resetModules(); faces.add.mockClear();
    fonts = await import('@/utils/fonts');
    expect(await fonts.loadSavedCustomFonts()).toEqual(['Comic Cyrillic']);
    expect(faces.add.mock.calls[0][0].family).toBe('Comic Cyrillic');
    expect(new Uint8Array(faces.add.mock.calls[0][0].data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps the previous face and stored bytes when replacement is corrupt or cannot be saved', async () => {
    const fonts = await import('@/utils/fonts');
    await fonts.saveCustomFont('My font', data());
    const previous = saved.get('My font');
    await expect(fonts.saveCustomFont('My font', new Uint8Array([0]).buffer)).rejects.toThrow('Corrupt');
    failWrites = true;
    await expect(fonts.saveCustomFont('My font', data())).rejects.toThrow('quota');
    expect(faces.delete).not.toHaveBeenCalled();
    expect(faces.add).toHaveBeenCalledTimes(1);
    expect(saved.get('My font')).toBe(previous);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('reports failed deletion and removes the runtime face only after storage succeeds', async () => {
    const fonts = await import('@/utils/fonts');
    await fonts.saveCustomFont('My font', data());
    failWrites = true;
    await expect(fonts.deleteCustomFont('My font')).rejects.toThrow('quota');
    expect(faces.delete).not.toHaveBeenCalled();
    expect(saved.has('My font')).toBe(true);
    failWrites = false;
    await fonts.deleteCustomFont('My font');
    expect(saved.has('My font')).toBe(false);
    expect(faces.delete).toHaveBeenCalledTimes(1);
  });

  it('isolates a corrupt saved font while restoring valid fonts', async () => {
    saved.set('broken', { name: 'broken', data: new Uint8Array([0]).buffer });
    saved.set('valid', { name: 'valid', data: data() });
    const fonts = await import('@/utils/fonts');
    expect(await fonts.loadSavedCustomFonts()).toEqual(['valid']);
  });

  it('validates supported extensions, empty files and size before loading', async () => {
    const { validateCustomFontFile: validate } = await import('@/utils/fonts');
    for (const extension of ['ttf', 'otf', 'woff', 'WOFF2']) expect(validate(new File(['font'], `Manga.${extension}`))).toBeNull();
    expect(validate(new File(['x'], 'font.png'))).toMatch(/TTF/);
    expect(validate(new File([], 'font.ttf'))).toMatch(/пустой/);
    const oversized = new File(['x'], 'font.ttf');
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 });
    expect(validate(oversized)).toMatch(/20 МБ/);
  });
});
