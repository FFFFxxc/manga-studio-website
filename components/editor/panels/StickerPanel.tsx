'use client';
import { useEffect, useRef, useState } from 'react';
import { BUILTIN_STICKERS, deleteSavedSticker, listSavedStickers, saveSticker, type SavedSticker } from '@/utils/stickerLibrary';
import { pasteExternalImagesAsLayers } from '@/utils/pastedImageLayers';
import { useStore } from '@/store/useStore';
import { toast } from '@/hooks/use-toast';

type StickerView = { id: string; name: string; src: string; saved?: SavedSticker };
const PAGE_SIZE = 24;
export function StickerPanel() {
  const [custom, setCustom] = useState<StickerView[]>([]);
  const [tab, setTab] = useState<'pack' | 'custom'>('pack');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const urls = useRef<string[]>([]);
  const docId = useStore(state => state.documents[state.activeDocIndex]?.id);

  async function refresh() {
    const saved = await listSavedStickers();
    if (!mounted.current) return;
    const next = saved.sort((a, b) => b.createdAt - a.createdAt).map(item => ({ id: item.id, name: item.name, saved: item, src: URL.createObjectURL(item.blob) }));
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = next.map(item => item.src);
    setCustom(next);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; };
  }, []);

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true); setError(''); setStatus('');
    let count = 0; const errors: string[] = [];
    try {
      for (const file of files) {
        try { await saveSticker(file); count++; } catch (e) { errors.push(e instanceof Error ? e.message : `Не удалось сохранить ${file.name}`); }
      }
      await refresh(); setTab('custom'); setPage(0);
      setStatus(`Сохранено PNG: ${count}. Одинаковые файлы не дублируются.`);
    } catch (e) { errors.push(e instanceof Error ? e.message : 'Не удалось открыть библиотеку.'); }
    finally { setError(errors.join('\n')); setBusy(false); }
  }
  async function insert(sticker: StickerView) {
    if (!docId || busy) return;
    const target = docId;
    setBusy(true); setError('');
    try {
      let blob: Blob;
      if (sticker.saved) blob = sticker.saved.blob;
      else {
        const response = await fetch(sticker.src);
        if (!response.ok) throw Error('Не удалось загрузить стикер.');
        blob = await response.blob();
      }
      await pasteExternalImagesAsLayers([new File([blob], `${sticker.name}.png`, { type: 'image/png' })], target);
      toast({ title: 'Стикер добавлен слоем', description: 'Перемещайте и масштабируйте рамкой. Ctrl+Z — отменить.' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось вставить стикер.'); }
    finally { setBusy(false); }
  }
  async function remove(sticker: StickerView) {
    setBusy(true); setError('');
    try { await deleteSavedSticker(sticker.id); await refresh(); setStatus('Удалено из библиотеки. Слои на страницах сохранены.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось удалить стикер.'); }
    finally { setBusy(false); }
  }
  const all: StickerView[] = tab === 'pack' ? BUILTIN_STICKERS : custom;
  const filtered = all.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  return <div className="sticker-library">
    <button className="ui-button ui-button-secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Обработка…' : '+ Загрузить свои PNG'}</button>
    <input ref={input} type="file" multiple accept="image/png,.png" hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files); }} />
    <p className="library-hint">Свои стикеры сохраняются в этом браузере. Клик по стикеру добавляет отдельный слой.</p>
    <div className="library-tabs" role="tablist" aria-label="Наборы стикеров">
      <button role="tab" aria-selected={tab === 'pack'} onClick={() => { setTab('pack'); setPage(0); }}>Memoji · 127</button>
      <button role="tab" aria-selected={tab === 'custom'} onClick={() => { setTab('custom'); setPage(0); }}>Мои · {custom.length}</button>
    </div>
    <input className="library-search" aria-label="Поиск стикеров" placeholder="Поиск по названию" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
    {!docId && <p className="library-hint">Откройте страницу, чтобы вставить стикер. Загружать свои PNG можно уже сейчас.</p>}
    {error && <p role="alert" className="library-error">{error}</p>}
    {status && <p role="status" className="library-hint">{status}</p>}
    {filtered.length === 0 && <p className="library-hint">{tab === 'custom' && !query ? 'Здесь появятся ваши PNG. Загрузите один или несколько файлов.' : 'Ничего не найдено.'}</p>}
    <div className="sticker-grid">{filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(sticker => <div key={sticker.id} className="sticker-tile">
      <button type="button" disabled={!docId || busy} title={sticker.name} aria-label={`Вставить стикер: ${sticker.name}`} onClick={() => void insert(sticker)}>
        <img src={sticker.src} loading="lazy" alt={sticker.name} /><span>{sticker.name}</span>
      </button>
      {sticker.saved && <button type="button" className="sticker-delete" disabled={busy} aria-label={`Удалить из библиотеки: ${sticker.name}`} title="Удалить из библиотеки" onClick={() => void remove(sticker)}>×</button>}
    </div>)}</div>
    {pages > 1 && <div className="library-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>→</button></div>}
  </div>;
}
