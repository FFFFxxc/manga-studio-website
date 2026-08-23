import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canvasToPersistentDataUrl,
  clearRuntimeRasterSources,
  getRuntimeRasterSource,
  registerRuntimeRasterSource,
} from '@/utils/runtimeRasterSources';

function source(width: number, height: number) {
  return { width, height } as unknown as CanvasImageSource;
}

describe('runtime raster sources', () => {
  beforeEach(() => clearRuntimeRasterSources());

  it('returns the committed canvas without constructing another image', () => {
    const canvas = source(120, 80);
    registerRuntimeRasterSource('data:image/png;base64,current', canvas);
    expect(getRuntimeRasterSource('data:image/png;base64,current')).toBe(canvas);
  });

  it('keeps the newest large canvas and evicts older pixel buffers', () => {
    const first = source(4096, 4096);
    const second = source(4096, 4096);
    registerRuntimeRasterSource('first', first);
    registerRuntimeRasterSource('second', second);
    expect(getRuntimeRasterSource('first')).toBeNull();
    expect(getRuntimeRasterSource('second')).toBe(second);
  });

  it('uses asynchronous toBlob encoding when the browser provides it', async () => {
    const toDataURL = vi.fn(() => 'sync');
    const canvas = {
      width: 16,
      height: 16,
      toDataURL,
      toBlob(callback: BlobCallback) {
        callback(new Blob(['png-bytes'], { type: 'image/png' }));
      },
    } as unknown as CanvasImageSource;

    const result = await canvasToPersistentDataUrl(canvas);
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(toDataURL).not.toHaveBeenCalled();
  });
});
