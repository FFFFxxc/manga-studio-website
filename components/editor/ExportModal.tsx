'use client';

import { useState, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { renderDocumentToCanvas } from '@/utils/documentComposite';

function getExportName(originalName: string, format: 'png' | 'jpg', usedNames: Set<string>): string {
  const base = originalName.replace(/\.[^.]+$/, '');
  const ext = format === 'jpg' ? 'jpg' : 'png';
  let candidate = `${base}_edit.${ext}`;
  let n = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}_edit_${n}.${ext}`;
    n++;
  }
  usedNames.add(candidate);
  return candidate;
}

export function ExportModal() {
  const { showExportModal, setShowExportModal, exportSettings, updateExportSettings, documents, activeDocIndex } = useStore();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeDoc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;

  const handleExportCurrent = useCallback(async () => {
    if (!activeDoc) return;
    setIsExporting(true);
    setError(null);
    try {
      const canvas = await renderDocumentToCanvas(activeDoc, exportSettings.format);
      const mime = exportSettings.format === 'jpg' ? 'image/jpeg' : 'image/png';
      const dataURL = canvas.toDataURL(mime, exportSettings.quality);
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = getExportName(activeDoc.name, exportSettings.format, new Set());
      a.click();
    } catch (e) {
      setError('Ошибка экспорта. Попробуйте ещё раз.');
    } finally {
      setIsExporting(false);
    }
  }, [activeDoc, exportSettings]);

  const handleExportAll = useCallback(async () => {
    if (documents.length === 0) return;
    setIsExporting(true);
    setProgress(0);
    setError(null);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const usedNames = new Set<string>();
      const mime = exportSettings.format === 'jpg' ? 'image/jpeg' : 'image/png';

      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const canvas = await renderDocumentToCanvas(doc, exportSettings.format);
        const dataURL = canvas.toDataURL(mime, exportSettings.quality);
        const base64 = dataURL.split(',')[1];
        const filename = getExportName(doc.name, exportSettings.format, usedNames);
        zip.file(filename, base64, { base64: true });
        setProgress(Math.round(((i + 1) / documents.length) * 100));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'manga-studio-export.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError('Ошибка при создании ZIP-архива.');
    } finally {
      setIsExporting(false);
    }
  }, [documents, exportSettings]);

  if (!showExportModal) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) setShowExportModal(false); }}
    >
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        padding: '24px',
        width: 360,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            Экспорт
          </h2>
          <button
            onClick={() => setShowExportModal(false)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 20, lineHeight: 1,
              display: 'flex', alignItems: 'center',
            }}
          >×</button>
        </div>

        {/* Format */}
        <div>
          <div className="section-label">Формат</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['png', 'jpg'] as const).map(f => (
              <button
                key={f}
                onClick={() => updateExportSettings({ format: f })}
                style={{
                  flex: 1, padding: '6px', borderRadius: 6,
                  border: '1px solid var(--border-default)',
                  background: exportSettings.format === f ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
                  color: exportSettings.format === f ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 13,
                }}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        {exportSettings.format === 'jpg' && (
          <div>
            <div className="section-label">
              Качество {Math.round(exportSettings.quality * 100)}%
            </div>
            <input
              type="range"
              min={50}
              max={100}
              value={Math.round(exportSettings.quality * 100)}
              onChange={e => updateExportSettings({ quality: Number(e.target.value) / 100 })}
            />
          </div>
        )}

        {/* Info */}
        <div style={{
          background: 'var(--bg-panel-raised)',
          borderRadius: 8, padding: '10px 12px',
          fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6,
        }}>
          <div>Изображений в пачке: <span style={{ color: 'var(--text-secondary)' }}>{documents.length}</span></div>
          {activeDoc && (
            <div>Текущее: <span style={{ color: 'var(--text-secondary)' }}>{activeDoc.width}×{activeDoc.height}px</span></div>
          )}
          <div style={{ marginTop: 4, fontSize: 11 }}>Экспорт в исходном разрешении</div>
        </div>

        {/* Progress */}
        {isExporting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {documents.length > 1 ? `Обработка... ${progress}%` : 'Подготовка...'}
            </div>
            <div style={{ height: 4, background: 'var(--bg-active)', borderRadius: 2 }}>
              <div
                style={{
                  width: `${documents.length > 1 ? progress : 50}%`,
                  height: '100%', background: 'var(--accent)',
                  borderRadius: 2, transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'rgba(232,94,94,0.1)',
            border: '1px solid rgba(232,94,94,0.3)',
            fontSize: 12, color: 'var(--danger)',
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleExportCurrent}
            disabled={!activeDoc || isExporting}
            style={{
              flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: !activeDoc || isExporting ? 'var(--text-muted)' : 'var(--accent)',
              cursor: !activeDoc || isExporting ? 'not-allowed' : 'pointer',
            }}
          >
            Текущее
          </button>
          <button
            onClick={handleExportAll}
            disabled={documents.length === 0 || isExporting}
            style={{
              flex: 1, padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: 'none',
              background: documents.length === 0 || isExporting ? 'var(--bg-active)' : 'var(--accent)',
              color: documents.length === 0 || isExporting ? 'var(--text-muted)' : '#fff',
              cursor: documents.length === 0 || isExporting ? 'not-allowed' : 'pointer',
            }}
          >
            ZIP все ({documents.length})
          </button>
        </div>
      </div>
    </div>
  );
}
