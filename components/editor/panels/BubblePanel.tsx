'use client';

import { useStore } from '@/store/useStore';
import { uid } from '@/utils/imageUtils';
import type { BubbleObject, BubbleKind, BubbleTail } from '@/types';
import {
  bubbleSupportsTail,
  getBubblePath,
  getThoughtTailCircles,
} from '@/utils/bubbleGeometry';
import { DEFAULT_GLOW } from '@/utils/objectPaint';
import { PaintEditor } from './PaintEditor';

// ─────────────────────────────────────────────────────────────────────────────
// Mini SVG preview for each bubble kind
// ─────────────────────────────────────────────────────────────────────────────
const PREVIEW_W = 80;
const PREVIEW_H = 56;

interface PreviewDef {
  kind: BubbleKind;
  label: string;
  subLabel?: string;
  defaultTail?: BubbleTail | null;
  strokeDash?: string;
}

export const BUBBLE_PRESETS: PreviewDef[] = [
  {
    kind: 'speech',
    label: 'Речь',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.35, length: 0.45, width: 0.12, curve: 0.3 },
  },
  {
    kind: 'thought',
    label: 'Мысль',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.35, length: 0.5, width: 0.12, curve: 0.3 },
  },
  {
    kind: 'scream',
    label: 'Крик',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.5, length: 0.34, width: 0.1, curve: 0.2 },
  },
  {
    kind: 'whisper',
    label: 'Шёпот',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.35, length: 0.35, width: 0.08, curve: 0.2 },
    strokeDash: '4,3',
  },
  {
    kind: 'narration',
    label: 'Нарратив',
    defaultTail: null,
  },
  {
    kind: 'soft',
    label: 'Мягкий',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.35, length: 0.38, width: 0.11, curve: 0.4 },
  },
  {
    kind: 'cloud',
    label: 'Облако',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.4, length: 0.4, width: 0.12, curve: 0.25 },
  },
  {
    kind: 'comic',
    label: 'Комикс',
    defaultTail: { enabled: true, side: 'right', anchor: 0.5, length: 0.35, width: 0.1, curve: 0.2 },
  },
  {
    kind: 'electric',
    label: 'Электро',
    defaultTail: { enabled: true, side: 'bottom', anchor: 0.5, length: 0.32, width: 0.1, curve: 0.25 },
  },
  {
    kind: 'caption',
    label: 'Титр',
    defaultTail: null,
  },
];

export function createDefaultBubble(kind: BubbleKind, textColor = '#000000'): BubbleObject {
  const defaultTail = BUBBLE_PRESETS.find(preset => preset.kind === kind)?.defaultTail;
  return {
    id: uid(),
    kind,
    visible: true,
    x: 0.5,
    y: 0.5,
    width: 0.3,
    height: 0.2,
    rotation: 0,
    autoSize: true,
    tail: defaultTail !== undefined ? defaultTail : {
      enabled: true,
      side: 'bottom',
      anchor: 0.35,
      length: 0.4,
      width: 0.12,
      curve: 0.3,
    },
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 0,
    fillStyle: { type: 'solid', color: '#ffffff' },
    strokeStyle: { type: 'solid', color: '#000000' },
    glow: { ...DEFAULT_GLOW },
    text: {
      content: '',
      fontFamily: 'Russo One',
      fontSize: 14,
      fill: textColor,
      align: 'center',
      lineHeight: 1.3,
    },
  };
}

function BubblePreview({ def, active, onClick }: { def: PreviewDef; active: boolean; onClick: () => void }) {
  const W = PREVIEW_W, H = PREVIEW_H;
  const bodyW = W * 0.72, bodyH = H * 0.54;
  const cx = W / 2, cy = H * 0.42;

  const params = {
    x: 0, y: 0,
    width: bodyW, height: bodyH,
    rotation: 0,
    tail: def.defaultTail,
  };

  const d = getBubblePath(def.kind, params, { rays: 16, spikiness: 0.3, cornerRadius: 5 });
  const thoughtCircles = def.kind === 'thought'
    ? getThoughtTailCircles(def.defaultTail ?? null, bodyW, bodyH)
    : [];

  return (
    <button
      onClick={onClick}
      title={def.label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        padding: '5px 3px',
        background: active ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
        border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-default)',
        borderRadius: 6, cursor: 'pointer', transition: 'border-color 0.12s',
        minWidth: W + 8,
      }}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        <g transform={`translate(${cx} ${cy})`}>
          <path
            d={d}
            fill="#ffffff"
            stroke="#333333"
            strokeWidth={1.2}
            strokeDasharray={def.strokeDash}
          />
          {thoughtCircles.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill="#ffffff" stroke="#333333" strokeWidth={1} />
          ))}
        </g>
      </svg>
      <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontWeight: 500 }}>{def.label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tail direction presets (side + arrow label)
// ─────────────────────────────────────────────────────────────────────────────
const TAIL_PRESETS: Array<{ side: BubbleTail['side']; anchor: number; label: string }> = [
  { side: 'top',    anchor: 0.5,  label: '↑' },
  { side: 'top',    anchor: 0.25, label: '↖' },
  { side: 'top',    anchor: 0.75, label: '↗' },
  { side: 'right',  anchor: 0.5,  label: '→' },
  { side: 'bottom', anchor: 0.5,  label: '↓' },
  { side: 'bottom', anchor: 0.75, label: '↘' },
  { side: 'bottom', anchor: 0.25, label: '↙' },
  { side: 'left',   anchor: 0.5,  label: '←' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Slider row
// ─────────────────────────────────────────────────────────────────────────────
function SliderRow({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string;
  value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onWheel={e => {
          e.preventDefault();
          e.stopPropagation();
          const dir = e.deltaY < 0 ? 1 : -1;
          const mult = e.shiftKey ? 10 : 1;
          onChange(Math.max(min, Math.min(max, value + dir * step * mult)));
        }}
        onPointerDown={e => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); }}
        onDragStart={e => e.preventDefault()}
        style={{ flex: 1 }}
      />
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 28, textAlign: 'right', flexShrink: 0 }}>
        {fmt ? fmt(value) : value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────
export function BubblePanel() {
  const { activeDocIndex, documents, selectedObject, addBubble, updateBubble, pushHistory, foregroundColor } = useStore();

  const hasDoc    = activeDocIndex >= 0;
  const activeDoc = hasDoc ? documents[activeDocIndex] : null;
  const selectedBubble = selectedObject?.type === 'bubble' && activeDoc
    ? (activeDoc.bubbles ?? []).find(b => b.id === selectedObject.id) ?? null
    : null;

  function createBubble(kind: BubbleKind) {
    if (!activeDoc) return;
    addBubble(createDefaultBubble(kind, foregroundColor));
  }

  function updateTail(updates: Partial<BubbleTail>) {
    if (!selectedBubble) return;
    const prev = selectedBubble.tail ?? { enabled: true, side: 'bottom' as const, anchor: 0.35, length: 0.4, width: 0.12, curve: 0.3 };
    updateBubble(selectedBubble.id, { tail: { ...prev, ...updates } });
  }

  const tail = selectedBubble?.tail;
  const hasTail = !!tail?.enabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 12 }}>

      {/* ── Type cards ────────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, padding: '0 2px 6px' }}>Тип бабла</div>
        {[
          { label: 'Классические', items: BUBBLE_PRESETS.slice(0, 5) },
          { label: 'Декоративные', items: BUBBLE_PRESETS.slice(5) },
        ].map(group => (
          <div key={group.label} style={{ marginBottom: 7 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{group.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {group.items.map(def => (
                <BubblePreview
                  key={def.kind}
                  def={def}
                  active={selectedBubble?.kind === def.kind}
                  onClick={() => {
                    if (selectedBubble) {
                      const newTail = def.defaultTail !== undefined ? def.defaultTail : selectedBubble.tail;
                      updateBubble(selectedBubble.id, { kind: def.kind, tail: newTail });
                    } else {
                      createBubble(def.kind);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        {!selectedBubble && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, padding: '0 2px' }}>
            Нажмите на карточку, чтобы добавить бабл
          </div>
        )}
      </div>

      {selectedBubble && (
        <>
          {/* ── Text content ───────────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, padding: '2px 2px 4px' }}>Текст</div>
            <textarea
              value={selectedBubble.text.content}
              onChange={e => updateBubble(selectedBubble.id, { text: { ...selectedBubble.text, content: e.target.value } })}
              style={{
                width: '100%', height: 60, padding: 6, fontSize: 11,
                borderRadius: 4, border: '1px solid var(--border-default)',
                fontFamily: selectedBubble.text.fontFamily, resize: 'vertical',
                background: 'var(--bg-input)', color: 'var(--text-primary)',
              }}
              placeholder="Введите текст бабла"
            />
          </div>

          {/* ── Fill / stroke ───────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Заливка</span>
              <input
                type="color"
                value={selectedBubble.fill}
                onChange={e => updateBubble(selectedBubble.id, {
                  fill: e.target.value,
                  fillStyle: { type: 'solid', color: e.target.value },
                })}
                style={{ width: 28, height: 22, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Обводка</span>
              <input
                type="color"
                value={selectedBubble.stroke}
                onChange={e => updateBubble(selectedBubble.id, {
                  stroke: e.target.value,
                  strokeStyle: { type: 'solid', color: e.target.value },
                })}
                style={{ width: 28, height: 22, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <PaintEditor
              label="Стиль заливки"
              value={selectedBubble.fillStyle ?? { type: 'solid', color: selectedBubble.fill }}
              glow={selectedBubble.glow}
              onGestureStart={pushHistory}
              onChange={style => updateBubble(selectedBubble.id, {
                fillStyle: style,
                ...(style.type === 'solid' ? { fill: style.color } : {}),
              }, { history: false })}
              onGlowChange={glow => updateBubble(selectedBubble.id, { glow }, { history: false })}
            />
            <PaintEditor
              label="Стиль обводки"
              value={selectedBubble.strokeStyle ?? { type: 'solid', color: selectedBubble.stroke }}
              allowRadial={false}
              onGestureStart={pushHistory}
              onChange={style => updateBubble(selectedBubble.id, {
                strokeStyle: style,
                ...(style.type === 'solid' ? { stroke: style.color } : {}),
              }, { history: false })}
            />
          </div>

          <SliderRow
            label="Толщина обводки"
            value={selectedBubble.strokeWidth}
            min={0} max={10} step={0.5}
            onChange={v => updateBubble(selectedBubble.id, { strokeWidth: v })}
            fmt={v => v.toFixed(1)}
          />

          {/* ── Text settings ───────────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, padding: '2px 2px 4px' }}>Текст бабла</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80 }}>Цвет текста</span>
              <input
                type="color"
                value={selectedBubble.text.fill}
                onChange={e => updateBubble(selectedBubble.id, { text: { ...selectedBubble.text, fill: e.target.value } })}
                style={{ width: 28, height: 22, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </div>
            <SliderRow
              label="Размер шрифта"
              value={selectedBubble.text.fontSize}
              min={8} max={72} step={1}
              onChange={v => updateBubble(selectedBubble.id, { text: { ...selectedBubble.text, fontSize: v } })}
            />
            <SliderRow
              label="Межстрочный"
              value={selectedBubble.text.lineHeight}
              min={0.8} max={3} step={0.05}
              onChange={v => updateBubble(selectedBubble.id, { text: { ...selectedBubble.text, lineHeight: v } })}
              fmt={v => v.toFixed(2)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80 }}>Выравнивание</span>
              {(['left', 'center', 'right'] as const).map(a => (
                <button
                  key={a}
                  onClick={() => updateBubble(selectedBubble.id, { text: { ...selectedBubble.text, align: a } })}
                  style={{
                    padding: '3px 6px', fontSize: 10, borderRadius: 3,
                    border: selectedBubble.text.align === a ? '1.5px solid var(--accent)' : '1px solid var(--border-default)',
                    background: selectedBubble.text.align === a ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
                    color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                >
                  {a === 'left' ? '⬅' : a === 'center' ? '≡' : '➡'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tail settings ───────────────────────────────────────────── */}
          {bubbleSupportsTail(selectedBubble.kind) && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px 6px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>Хвост</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => updateTail({ enabled: !hasTail })}
                    style={{
                      padding: '3px 8px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                      border: '1px solid var(--border-default)',
                      background: hasTail ? 'var(--accent-dim)' : 'var(--bg-panel-raised)',
                      color: hasTail ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {hasTail ? 'Вкл' : 'Выкл'}
                  </button>
                  {hasTail && (
                    <button
                      onClick={() => updateBubble(selectedBubble.id, { tail: null })}
                      style={{
                        padding: '3px 8px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                        border: '1px solid var(--border-default)',
                        background: 'var(--bg-panel-raised)', color: 'var(--text-muted)',
                      }}
                    >
                      Убрать
                    </button>
                  )}
                </div>
              </div>

              {hasTail && tail && (
                <>
                  {/* Direction presets */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, marginBottom: 6 }}>
                    {TAIL_PRESETS.map((p, i) => (
                      <button
                        key={i}
                        title={`${p.side} ${Math.round(p.anchor * 100)}%`}
                        onClick={() => updateTail({ side: p.side, anchor: p.anchor })}
                        style={{
                          padding: '4px 0', fontSize: 13, textAlign: 'center', borderRadius: 3, cursor: 'pointer',
                          border: tail.side === p.side && Math.abs((tail.anchor ?? 0.5) - p.anchor) < 0.15
                            ? '1.5px solid var(--accent)' : '1px solid var(--border-default)',
                          background: 'var(--bg-panel-raised)', color: 'var(--text-secondary)',
                          lineHeight: 1,
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <SliderRow
                    label="Положение"
                    value={Math.round((tail.anchor ?? 0.5) * 100)}
                    min={12} max={88} step={1}
                    onChange={v => updateTail({ anchor: v / 100 })}
                    fmt={v => `${v}%`}
                  />
                  <SliderRow
                    label="Длина"
                    value={Math.round((tail.length ?? 0.4) * 100)}
                    min={8} max={80} step={1}
                    onChange={v => updateTail({ length: v / 100 })}
                    fmt={v => `${v}%`}
                  />
                  <SliderRow
                    label="Ширина"
                    value={Math.round((tail.width ?? 0.12) * 100)}
                    min={4} max={25} step={1}
                    onChange={v => updateTail({ width: v / 100 })}
                    fmt={v => `${v}%`}
                  />
                  {selectedBubble.kind !== 'thought' && selectedBubble.kind !== 'scream' && (
                    <SliderRow
                      label="Изгиб"
                      value={Math.round((tail.curve ?? 0.3) * 100)}
                      min={0} max={100} step={1}
                      onChange={v => updateTail({ curve: v / 100 })}
                      fmt={v => `${v}%`}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Fit to text ─────────────────────────────────────────────── */}
          <button
            onClick={() => {
              // Estimate auto size: fontSize * lineHeight * lineCount + padding
              const lines = (selectedBubble.text.content || '').split('\n').length;
              const estimatedH = (selectedBubble.text.fontSize / 1000) * selectedBubble.text.lineHeight * (lines + 1) + 0.06;
              const estimatedW = Math.max(selectedBubble.width, 0.2);
              updateBubble(selectedBubble.id, { width: estimatedW, height: estimatedH });
            }}
            style={{
              padding: '6px 10px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-panel-raised)', color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            Подогнать бабл под текст
          </button>
        </>
      )}
    </div>
  );
}
