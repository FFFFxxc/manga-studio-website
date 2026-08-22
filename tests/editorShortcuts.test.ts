import { describe, expect, it } from 'vitest';
import { resolveDeleteTarget, resolveEditableTargetShortcut, resolveEditorShortcut } from '@/utils/editorShortcuts';

describe('editor keyboard ownership', () => {
  it('keeps polygon-lasso Delete/Backspace in CanvasArea', () => {
    expect(resolveDeleteTarget('polyLasso', { id: 'text', type: 'text' }, null)).toBe('contour');
  });

  it('deletes selected AI layers and masks when no object is selected', () => {
    expect(resolveDeleteTarget('select', null, { id: 'ai', type: 'ai' })).toEqual({ id: 'ai', type: 'ai' });
    expect(resolveDeleteTarget('maskBrush', null, { id: 'mask', type: 'mask' })).toEqual({ id: 'mask', type: 'mask' });
  });

  it('supports standard export and redo shortcuts', () => {
    expect(resolveEditorShortcut({ code: 'KeyS', key: 's', ctrlKey: true })).toEqual({ type: 'export' });
    expect(resolveEditorShortcut({ code: 'KeyZ', key: 'z', ctrlKey: true, shiftKey: true })).toEqual({ type: 'redo' });
    expect(resolveEditorShortcut({ code: 'KeyZ', key: 'z', ctrlKey: true, altKey: true })).toEqual({ type: 'redo' });
  });

  it('keeps export global in form controls without stealing native text undo', () => {
    expect(resolveEditableTargetShortcut({ code: 'KeyS', key: 's', ctrlKey: true })).toEqual({ type: 'export' });
    expect(resolveEditableTargetShortcut({ code: 'KeyZ', key: 'z', ctrlKey: true })).toBeNull();
  });

  it('keeps one hotkey per selection tool and uses R for blur', () => {
    expect(resolveEditorShortcut({ code: 'KeyM', key: 'm' })).toEqual({ type: 'tool', tool: 'rectSelect', tab: 'cleanup' });
    expect(resolveEditorShortcut({ code: 'KeyW', key: 'w' })).toEqual({ type: 'tool', tool: 'wand', tab: 'cleanup' });
    expect(resolveEditorShortcut({ code: 'KeyR', key: 'r' })).toEqual({ type: 'tool', tool: 'blur' });
    expect(resolveEditorShortcut({ code: 'KeyG', key: 'g' })).toBeNull();
  });

  it('opens the bubble tab with the displayed numeric shortcut', () => {
    expect(resolveEditorShortcut({ code: 'Digit6', key: '6' })).toEqual({ type: 'tab', tab: 'bubble' });
  });

  it('adjusts size and hardness only for paint and raster-effect tools', () => {
    expect(resolveEditorShortcut({ code: 'BracketRight', key: ']' }, 'brush'))
      .toEqual({ type: 'brush-adjust', property: 'size', delta: 1 });
    expect(resolveEditorShortcut({ code: 'BracketLeft', key: '[', shiftKey: true }, 'blur'))
      .toEqual({ type: 'brush-adjust', property: 'hardness', delta: -1 });
    expect(resolveEditorShortcut({ code: 'BracketRight', key: ']' }, 'text')).toBeNull();
    expect(resolveEditableTargetShortcut({ code: 'BracketRight', key: ']' })).toBeNull();
  });
});
