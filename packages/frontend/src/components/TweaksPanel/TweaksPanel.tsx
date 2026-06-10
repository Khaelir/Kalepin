import React, { useEffect, useRef } from 'react';

type TweakAccent = 'orange' | 'blue' | 'green' | 'purple' | 'rose';
type TweakDensity = 'compact' | 'comfortable' | 'spacious';
type TweakEditorFont = 'serif' | 'sans';

export interface TweakState {
  theme: 'light' | 'dark';
  accent: TweakAccent;
  density: TweakDensity;
  editorFont: TweakEditorFont;
  sidebar: boolean;
  rail: boolean;
  minimap: boolean;
}

interface Props {
  state: TweakState;
  setState: (next: TweakState) => void;
  onClose: () => void;
  /** Element whose click should NOT dismiss the panel (e.g. the opener button). */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const ACCENT_SWATCHES: { key: TweakAccent; color: string }[] = [
  { key: 'blue',   color: '#5b8def' },
  { key: 'orange', color: '#f77500' },
  { key: 'green',  color: '#10b981' },
  { key: 'purple', color: '#8b5cf6' },
  { key: 'rose',   color: '#e94560' },
];

const THEMES: { key: 'light' | 'dark'; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark',  label: 'Dark' },
];

const DENSITIES: { key: TweakDensity; label: string }[] = [
  { key: 'compact',     label: 'Compact' },
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'spacious',    label: 'Spacious' },
];

const FONTS: { key: TweakEditorFont; label: string }[] = [
  { key: 'sans',  label: 'Lato' },
  { key: 'serif', label: 'Serif' },
];

export function TweaksPanel({ state, setState, onClose, anchorRef }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleMouse);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouse);
    };
  }, [onClose, anchorRef]);

  return (
    <div ref={panelRef} className="kp-tweaks" role="dialog" aria-label="Tweaks">
      <div className="kp-tweaks-head">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--kalepin-primary)' }}>
          <circle cx="5" cy="4" r="1.5" />
          <path d="M2 4h1.5M6.5 4H14" />
          <circle cx="11" cy="8" r="1.5" />
          <path d="M2 8h7.5M12.5 8H14" />
          <circle cx="5" cy="12" r="1.5" />
          <path d="M2 12h1.5M6.5 12H14" />
        </svg>
        <span className="kp-tweaks-title">Tweaks</span>
        <button
          type="button"
          className="kp-tweaks-close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="kp-tweaks-row">
        <div className="kp-tweaks-row-label">Theme</div>
        <div className="kp-tweaks-seg" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={state.theme === t.key}
              className={state.theme === t.key ? 'is-active' : ''}
              onClick={() => setState({ ...state, theme: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kp-tweaks-row">
        <div className="kp-tweaks-row-label">Accent</div>
        <div className="kp-tweaks-swatches" role="radiogroup" aria-label="Accent">
          {ACCENT_SWATCHES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={state.accent === s.key}
              aria-label={s.key}
              className={`kp-tweaks-swatch${state.accent === s.key ? ' is-active' : ''}`}
              style={{ background: s.color }}
              onClick={() => setState({ ...state, accent: s.key })}
            />
          ))}
        </div>
      </div>

      <div className="kp-tweaks-row">
        <div className="kp-tweaks-row-label">Density</div>
        <div className="kp-tweaks-seg" role="radiogroup" aria-label="Density">
          {DENSITIES.map((d) => (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={state.density === d.key}
              className={state.density === d.key ? 'is-active' : ''}
              onClick={() => setState({ ...state, density: d.key })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kp-tweaks-row">
        <div className="kp-tweaks-row-label">Editor font</div>
        <div className="kp-tweaks-seg" role="radiogroup" aria-label="Editor font">
          {FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={state.editorFont === f.key}
              className={state.editorFont === f.key ? 'is-active' : ''}
              onClick={() => setState({ ...state, editorFont: f.key })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
