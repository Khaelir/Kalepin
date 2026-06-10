import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TourStep } from '../tours/types';

interface CoachMarkProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
  onDone: () => void;
  isLast: boolean;
  /** Extra buttons to render (e.g., [Keep it] / [Delete it] on final step) */
  extraButtons?: React.ReactNode;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const TOOLTIP_GAP = 12;
const TOOLTIP_WIDTH = 320;

function getTargetRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function bestPosition(
  preferred: 'top' | 'bottom' | 'left' | 'right',
  target: Rect,
  tooltipHeight: number,
): 'top' | 'bottom' | 'left' | 'right' {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const space = {
    top: target.top - PADDING,
    bottom: vh - (target.top + target.height + PADDING),
    left: target.left - PADDING,
    right: vw - (target.left + target.width + PADDING),
  };

  const needed = {
    top: tooltipHeight + TOOLTIP_GAP,
    bottom: tooltipHeight + TOOLTIP_GAP,
    left: TOOLTIP_WIDTH + TOOLTIP_GAP,
    right: TOOLTIP_WIDTH + TOOLTIP_GAP,
  };

  if (space[preferred] >= needed[preferred]) return preferred;

  // Try opposite
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
  const opp = opposite[preferred];
  if (space[opp] >= needed[opp]) return opp;

  // Pick whichever has most space
  const best = (Object.entries(space) as [typeof preferred, number][]).sort((a, b) => b[1] - a[1])[0][0];
  return best;
}

function tooltipStyle(
  pos: 'top' | 'bottom' | 'left' | 'right',
  target: Rect,
): React.CSSProperties {
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;

  switch (pos) {
    case 'bottom':
      return {
        top: target.top + target.height + PADDING + TOOLTIP_GAP,
        left: Math.max(16, Math.min(cx - TOOLTIP_WIDTH / 2, window.innerWidth - TOOLTIP_WIDTH - 16)),
        width: TOOLTIP_WIDTH,
      };
    case 'top':
      return {
        bottom: window.innerHeight - target.top + PADDING + TOOLTIP_GAP,
        left: Math.max(16, Math.min(cx - TOOLTIP_WIDTH / 2, window.innerWidth - TOOLTIP_WIDTH - 16)),
        width: TOOLTIP_WIDTH,
      };
    case 'right':
      return {
        top: Math.max(16, cy - 60),
        left: target.left + target.width + PADDING + TOOLTIP_GAP,
        width: TOOLTIP_WIDTH,
      };
    case 'left':
      return {
        top: Math.max(16, cy - 60),
        right: window.innerWidth - target.left + PADDING + TOOLTIP_GAP,
        width: TOOLTIP_WIDTH,
      };
  }
}

export function CoachMark({ step, stepIndex, totalSteps, onNext, onSkip, onDone, isLast, extraButtons }: CoachMarkProps) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(200);

  const measure = useCallback(() => {
    if (step.target) {
      setTargetRect(getTargetRect(step.target));
    } else {
      setTargetRect(null);
    }
  }, [step.target]);

  useEffect(() => {
    measure();
    // Small delay to handle elements appearing after mount
    const timer = setTimeout(measure, 100);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  });

  const isCentered = !step.target || !targetRect;
  const pos = !isCentered ? bestPosition(step.position || 'bottom', targetRect!, tooltipHeight) : 'bottom';

  // For active steps, allow clicks through the spotlight area to reach the target element
  const allowClickThrough = step.type === 'active';

  return (
    <>
      {/* Dim overlay — blocks clicks everywhere except the spotlight hole */}
      {step.noDim ? (
        // No dim: just the spotlight ring, no overlay
        !isCentered && targetRect && (
          <div
            className="coach-mark-spotlight"
            style={{
              top: targetRect.top - PADDING,
              left: targetRect.left - PADDING,
              width: targetRect.width + PADDING * 2,
              height: targetRect.height + PADDING * 2,
              pointerEvents: 'none',
            }}
          />
        )
      ) : !isCentered && targetRect ? (
        <>
          {/* Four overlay rectangles around the spotlight cutout */}
          <div className="coach-mark-overlay-piece" style={{ top: 0, left: 0, right: 0, height: Math.max(0, targetRect.top - PADDING) }} />
          <div className="coach-mark-overlay-piece" style={{ top: Math.max(0, targetRect.top - PADDING), left: 0, width: Math.max(0, targetRect.left - PADDING), height: targetRect.height + PADDING * 2 }} />
          <div className="coach-mark-overlay-piece" style={{ top: Math.max(0, targetRect.top - PADDING), left: targetRect.left + targetRect.width + PADDING, right: 0, height: targetRect.height + PADDING * 2 }} />
          <div className="coach-mark-overlay-piece" style={{ top: targetRect.top + targetRect.height + PADDING, left: 0, right: 0, bottom: 0 }} />
          {/* Spotlight ring — visual highlight, clicks pass through to target */}
          <div
            className="coach-mark-spotlight"
            style={{
              top: targetRect.top - PADDING,
              left: targetRect.left - PADDING,
              width: targetRect.width + PADDING * 2,
              height: targetRect.height + PADDING * 2,
              pointerEvents: allowClickThrough ? 'none' : 'auto',
            }}
          />
        </>
      ) : (
        <div className="coach-mark-overlay-piece" style={{ top: 0, left: 0, right: 0, bottom: 0 }} />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`coach-mark-tooltip ${isCentered ? 'centered' : ''}`}
        style={isCentered ? undefined : tooltipStyle(pos, targetRect!)}
      >
        <h3 className="coach-mark-title">{step.title}</h3>
        <p className="coach-mark-body">{step.body}</p>
        {step.illustration && (
          <div className="coach-mark-illustration">{step.illustration}</div>
        )}

        {/* Progress dots */}
        <div className="coach-mark-dots">
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              className={`coach-mark-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="coach-mark-actions">
          {extraButtons}
          <button className="coach-mark-btn skip" onClick={onSkip}>Skip</button>
          {step.type === 'active' ? (
            <span className="coach-mark-hint">Waiting for your action...</span>
          ) : isLast ? (
            <button className="coach-mark-btn done" onClick={onDone}>Done</button>
          ) : (
            <button className="coach-mark-btn next" onClick={onNext}>Next</button>
          )}
        </div>
      </div>
    </>
  );
}
