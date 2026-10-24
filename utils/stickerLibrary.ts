export interface SavedSticker { id: string; name: string; blob: Blob; width: number; height: number; createdAt: number }
export const BUILTIN_STICKERS = Array.from({ length: 127 }, (_, index) => {
  const number = String(index + 1).padStart(3, '0');
  return { id: `favmemojis-${number}`, name: `Memoji ${number}`, src: `/stickers/favmemojis/${number}.png` };
});

const DATABASE = 'manga-studio-stickers';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(Error('Хранилище браузера недоступно. Разрешите сохранение данных сайта.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('stickers', { keyPath: 'id' });
    request.onerror = () => reject(request.error ?? Error('Не удалось открыть библиотеку стикеров.'));
    request.onblocked = () => reject(Error('Закройте другие вкладки редактора и повторите загрузку.'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('stickers', mode);
    const request = action(tx.objectStore('stickers'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? Error('Не удалось сохранить библиотеку. Проверьте свободное место в браузере.')); };
  });
}
export const listSavedStickers = () => transaction<SavedSticker[]>('readonly', store => store.getAll());
export const deleteSavedSticker = (id: string) => transaction('readwrite', store => store.delete(id));

export async function saveSticker(file: File): Promise<SavedSticker> {
  if (!/\.png$/i.test(file.name) && file.type !== 'image/png') throw Error(`«${file.name}»: выберите PNG.`);
  if (file.size > 15 * 1024 * 1024) throw Error(`«${file.name}»: PNG должен быть меньше 15 МБ.`);
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  if (signature.join() !== '137,80,78,71,13,10,26,10') throw Error(`«${file.name}»: файл не является PNG.`);
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width, height = bitmap.height; bitmap.close();
  if (width > 8192 || height > 8192 || width * height > 32_000_000) throw Error(`«${file.name}»: слишком большое изображение. Уменьшите его до 8192 px и 32 мегапикселей.`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const sticker: SavedSticker = { id, name: file.name.replace(/\.png$/i, ''), blob, width, height, createdAt: Date.now() };
  await transaction('readwrite', store => store.put(sticker));
  return sticker;
}
