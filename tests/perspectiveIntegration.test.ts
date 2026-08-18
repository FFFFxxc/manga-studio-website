import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('perspective renderer integration', () => {
  it('uses named quality profiles instead of caller-specific mesh sizes', () => {
    for (const file of ['components/editor/CanvasArea.tsx', 'utils/cleanupRaster.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/drawPerspectiveImage[\s\S]{0,240}subdivisions:/);
    }
  });

  it('keeps preview and document-resolution renderer quality explicit', () => {
    const editor = readFileSync('components/editor/CanvasArea.tsx', 'utf8');
    const cleanup = readFileSync('utils/cleanupRaster.ts', 'utf8');

    expect(editor).toMatch(/quality:\s*perspectivePreviewActive\s*\?\s*'drag'\s*:\s*'preview'/);
    expect(cleanup).toMatch(/drawPerspectiveImage[\s\S]{0,240}quality:\s*'export'/);
  });

  it('keys perspective previews by rendering inputs rather than unrelated UI state', () => {
    const editor = readFileSync('components/editor/CanvasArea.tsx', 'utf8');

    expect(editor).toMatch(/const perspectivePreviewCacheKey = \[/);
    expect(editor).toMatch(/sourceIdentity/);
    expect(editor).toMatch(/sourceRevision/);
    expect(editor).toMatch(/naturalW, naturalH/);
    expect(editor).toMatch(/perspective\?\.topLeft\.x/);
    expect(editor).toMatch(/placement\.perspectiveSourceBounds/);
    expect(editor).toMatch(/previewWidth, previewHeight/);
    expect(editor).toMatch(/perspectiveQuality/);
  });
});
