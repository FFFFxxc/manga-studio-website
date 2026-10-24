import { DEFAULT_ANIME_FONT, DEFAULT_TRANSLATION_FONT_STORAGE_KEY, MANGA_FONTS } from '../types';

/**
 * Fonts linked from Google Fonts (and the self-hosted default font) only
 * download when the browser sees DOM text using them. Konva draws on
 * <canvas>, which never triggers that download — so we explicitly
 * force-load every manga font via the CSS Font Loading API.
 *
 * The sample includes latin, latin-ext and cyrillic characters so every
 * unicode-range subset a canvas may need is actually fetched.
 */
export async function preloadGoogleFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const sample = 'АБВЁЙЩабвёйщ ĄĆŽąćž abcABC 123';
  const loads = MANGA_FONTS
    .filter(f => !['Arial', 'Times New Roman', 'Georgia'].includes(f))
    .map(f =>
      document.fonts.load(`16px "${f}"`, sample).catch(() => [])
    );
  await Promise.allSettled(loads);
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
}

/* ---------- Custom font persistence (IndexedDB) ---------- */

const DB_NAME = 'manga-studio-fonts';
const STORE = 'fonts';

interface StoredFont {
  name: string;
  data: ArrayBuffer;
}

/**
 * FontFace instances we registered at runtime, keyed by family name.
 * Needed so re-uploading a font with the same name replaces the previous
 * face (instead of piling duplicates into document.fonts) and so deleting
 * a font also unregisters it from the current session.
 */
const registeredFaces = new Map<string, FontFace>();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Хранилище шрифтов занято другой вкладкой. Закройте её и повторите загрузку.'));
  });
}

/** Register a font with the browser so both DOM and canvas can use it */
async function registerFont(name: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(name, data);
  const loaded = await face.load();
  activateFont(name, loaded);
}

function activateFont(name: string, loaded: FontFace): void {
  unregisterFont(name);
  (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
  registeredFaces.set(name, loaded);
}

/** Remove a runtime-registered FontFace from document.fonts (if any). */
function unregisterFont(name: string): void {
  const face = registeredFaces.get(name);
  if (!face) return;
  try {
    (document.fonts as unknown as { delete: (f: FontFace) => boolean }).delete(face);
  } catch {
    // ignore — worst case the old face lives until reload
  }
  registeredFaces.delete(name);
}

/** Check whether a custom font with this family name is already stored. */
export async function hasCustomFont(name: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const db = await openDB();
    const found = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getKey(name);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return found;
  } catch {
    return false;
  }
}

/**
 * Save an uploaded custom font to IndexedDB and register it immediately.
 * Saving under an existing name overwrites the stored file (the caller is
 * responsible for asking the user to confirm the overwrite).
 */
export async function saveCustomFont(name: string, data: ArrayBuffer): Promise<void> {
  // Validate the new face before replacing either the persisted file or the
  // current face. A failed upload must leave the existing font usable.
  const loaded = await new FontFace(name, data).load();
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ name, data } satisfies StoredFont);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Не удалось сохранить шрифт в браузере.'));
    });
  } finally { db.close(); }
  activateFont(name, loaded);
}

/** Load all previously saved custom fonts; returns their names */
export async function loadSavedCustomFonts(): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openDB();
    const fonts = await new Promise<StoredFont[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredFont[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const names: string[] = [];
    for (const f of fonts) {
      try {
        await registerFont(f.name, f.data);
        names.push(f.name);
      } catch {
        // skip corrupted font
      }
    }
    return names;
  } catch {
    return [];
  }
}

/** Delete a saved custom font (from IndexedDB AND the current session). */
export async function deleteCustomFont(name: string): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Не удалось удалить шрифт из браузера.'));
    });
  } finally { db.close(); }
  unregisterFont(name);
}

export function validateCustomFontFile(file: File): string | null {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) return 'Принимаются TTF, OTF, WOFF и WOFF2.';
  if (!file.size) return 'Файл шрифта пустой.';
  if (file.size > 20 * 1024 * 1024) return 'Размер шрифта превышает 20 МБ.';
  if (!file.name.replace(/\.[^.]+$/, '').trim()) return 'Не удалось определить имя шрифта.';
  return null;
}

/* ---------- Default translation font (localStorage) ---------- */

/**
 * Read the saved «Шрифт перевода по умолчанию». Returns null when the user
 * never picked one (callers fall back to DEFAULT_ANIME_FONT).
 */
export function loadStoredDefaultTranslationFont(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DEFAULT_TRANSLATION_FONT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist the default translation font so it survives reloads. */
export function storeDefaultTranslationFont(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (name === DEFAULT_ANIME_FONT) {
      // Built-in default needs no record; keeps storage clean.
      window.localStorage.removeItem(DEFAULT_TRANSLATION_FONT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(DEFAULT_TRANSLATION_FONT_STORAGE_KEY, name);
    }
  } catch {
    // localStorage unavailable (private mode etc.) — selection just won't persist
  }
}
