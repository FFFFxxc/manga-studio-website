type RuntimeRasterSource = CanvasImageSource;

interface RuntimeRasterEntry {
  source: RuntimeRasterSource;
  bytes: number;
}

// Keep only a small, pixel-budgeted set of the most recent committed raster
// canvases. These are a render cache, never document state: persisted/history
// values remain ordinary data URLs and still work after a reload.
const MAX_RUNTIME_ENTRIES = 4;
const MAX_RUNTIME_BYTES = 96 * 1024 * 1024;
const runtimeSources = new Map<string, RuntimeRasterEntry>();
let runtimeBytes = 0;

function estimatedBytes(source: RuntimeRasterSource) {
  const sized = source as { width?: number; height?: number };
  const width = Number(sized.width) || 0;
  const height = Number(sized.height) || 0;
  return Math.max(0, width * height * 4);
}

function trimRuntimeSources() {
  // Always retain the newest canvas even when one very large document exceeds
  // the soft pixel budget; dropping it would immediately force a PNG decode.
  while (runtimeSources.size > 1 && (
    runtimeSources.size > MAX_RUNTIME_ENTRIES
    || runtimeBytes > MAX_RUNTIME_BYTES
  )) {
    const oldestKey = runtimeSources.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = runtimeSources.get(oldestKey);
    runtimeSources.delete(oldestKey);
    runtimeBytes -= oldest?.bytes ?? 0;
  }
}

export function registerRuntimeRasterSource(src: string, source: RuntimeRasterSource) {
  if (!src || !source) return;
  const previous = runtimeSources.get(src);
  if (previous) runtimeBytes -= previous.bytes;
  runtimeSources.delete(src);
  const entry = { source, bytes: estimatedBytes(source) };
  runtimeSources.set(src, entry);
  runtimeBytes += entry.bytes;
  trimRuntimeSources();
}

export function getRuntimeRasterSource(src: string | null | undefined): CanvasImageSource | null {
  if (!src) return null;
  const entry = runtimeSources.get(src);
  if (!entry) return null;
  // Refresh insertion order so actively used sources survive the LRU trim.
  runtimeSources.delete(src);
  runtimeSources.set(src, entry);
  return entry.source;
}

export function clearRuntimeRasterSources() {
  runtimeSources.clear();
  runtimeBytes = 0;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось сохранить результат эффекта.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Persist a canvas without synchronous PNG encoding on the pointer-up path.
 * Browser canvases use toBlob; lightweight test/offscreen shims may fall back
 * to their existing encoders.
 */
export async function canvasToPersistentDataUrl(source: CanvasImageSource): Promise<string> {
  const canvas = source as HTMLCanvasElement;
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => {
        if (result) resolve(result);
        else reject(new Error('Не удалось сохранить результат эффекта.'));
      }, 'image/png');
    });
    return blobToDataUrl(blob);
  }
  if (typeof canvas.toDataURL === 'function') return canvas.toDataURL('image/png');
  const offscreen = source as OffscreenCanvas;
  if (typeof offscreen.convertToBlob === 'function') {
    return blobToDataUrl(await offscreen.convertToBlob({ type: 'image/png' }));
  }
  throw new Error('Не удалось сохранить результат эффекта.');
}
