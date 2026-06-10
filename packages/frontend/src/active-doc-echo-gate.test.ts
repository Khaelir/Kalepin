import { describe, it, expect } from 'vitest';
import { decideActiveDocEcho } from './active-doc-echo-gate';

const NOW = 1_700_000_000_000;

describe('decideActiveDocEcho', () => {
  it('OT save (active doc + recent op/ack): suppress toast and refresh', () => {
    // Saved 500ms ago, well within the 2s echo window.
    const decision = decideActiveDocEcho({
      isActive: true,
      lastOTRevisionAt: NOW - 500,
      now: NOW,
    });
    expect(decision).toEqual({ showToast: false, refreshContent: false });
  });

  it('External editor on active doc (no recent OT): toast + refresh', () => {
    const decision = decideActiveDocEcho({
      isActive: true,
      lastOTRevisionAt: NOW - 10_000,
      now: NOW,
    });
    expect(decision).toEqual({ showToast: true, refreshContent: true });
  });

  it('No OT activity ever (lastOTRevisionAt = 0) on active doc: toast + refresh', () => {
    const decision = decideActiveDocEcho({
      isActive: true,
      lastOTRevisionAt: 0,
      now: NOW,
    });
    expect(decision).toEqual({ showToast: true, refreshContent: true });
  });

  it('Echo window boundary: 1999ms back still suppresses', () => {
    const decision = decideActiveDocEcho({
      isActive: true,
      lastOTRevisionAt: NOW - 1999,
      now: NOW,
    });
    expect(decision.showToast).toBe(false);
    expect(decision.refreshContent).toBe(false);
  });

  it('Echo window boundary: exactly 2000ms back is treated as stale', () => {
    const decision = decideActiveDocEcho({
      isActive: true,
      lastOTRevisionAt: NOW - 2000,
      now: NOW,
    });
    expect(decision.showToast).toBe(true);
    expect(decision.refreshContent).toBe(true);
  });

  it('Non-active path: always toast, never refresh', () => {
    const recent = decideActiveDocEcho({
      isActive: false,
      lastOTRevisionAt: NOW - 500,
      now: NOW,
    });
    expect(recent).toEqual({ showToast: true, refreshContent: false });

    const stale = decideActiveDocEcho({
      isActive: false,
      lastOTRevisionAt: 0,
      now: NOW,
    });
    expect(stale).toEqual({ showToast: true, refreshContent: false });
  });
});
