'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { pasteExternalImagesAsLayers } from '@/utils/pastedImageLayers';
import { toast } from '@/hooks/use-toast';

export function ImageLayerImportButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const [loading, setLoading] = useState(false);
  const hasDocument = useStore(state => state.activeDocIndex >= 0 && Boolean(state.documents[state.activeDocIndex]));
  const targetDocument = useRef<string | null>(null);
  const importFiles = async (files: File[]) => {
    const documentId = targetDocument.current;
    if (!files.length || !documentId || importing.current) return;
    importing.current = true;
    setLoading(true);
    const errors: string[] = [];
    try {
      const ids = await pasteExternalImagesAsLayers(files, documentId, { onError: error => errors.push(error) });
      toast({ title: ids.length === 1 ? 'Изображение добавлено слоем' : `Добавлено слоёв: ${ids.length}`, description: 'Перетаскивайте рамку за углы, чтобы изменить размер. Ctrl+Z — отменить вставку.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось добавить изображение.';
      if (!errors.length || !errors.join('\n').includes(message)) errors.push(message);
    } finally {
      if (errors.length) toast({ title: 'Некоторые файлы не удалось вставить', description: errors.join('\n'), variant: 'destructive' });
      importing.current = false;
      setLoading(false);
    }
  };

  return <>
    <button type="button" className="ui-button ui-button-secondary layer-import-button" disabled={!hasDocument || loading}
      style={fullWidth ? { width: '100%' } : undefined}
      aria-label="Добавить изображение слоем" title="PNG, JPG или WebP отдельным слоем. Также можно перетащить файл или нажать Ctrl+V."
      onClick={() => {
        const state = useStore.getState();
        targetDocument.current = state.documents[state.activeDocIndex]?.id ?? null;
        input.current?.click();
      }}>
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
      <span>{loading ? 'Добавляем…' : 'Изображение слоем'}</span>
    </button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple hidden
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        void importFiles(files);
      }} />
  </>;
}
