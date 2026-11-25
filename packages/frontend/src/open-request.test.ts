import { describe, it, expect, vi } from 'vitest';
import { OpenRequests } from './open-request';

describe('OpenRequests', () => {
  it('a new open supersedes the one in flight', () => {
    const opens = new OpenRequests();
    const a = opens.begin();
    expect(a.isCurrent()).toBe(true);
    const b = opens.begin();
    expect(a.isCurrent()).toBe(false);
    expect(b.isCurrent()).toBe(true);
  });

  it('tears down the superseded open (listeners, timers) exactly once', () => {
    const opens = new OpenRequests();
    const a = opens.begin();
    const offOpened = vi.fn();
    const clearTimer = vi.fn();
    a.onCancel(offOpened);
    a.onCancel(clearTimer);
    opens.begin();
    opens.begin();
    expect(offOpened).toHaveBeenCalledTimes(1);
    expect(clearTimer).toHaveBeenCalledTimes(1);
  });

  it('does not tear down the open that is still current', () => {
    const opens = new OpenRequests();
    opens.begin();
    const b = opens.begin();
    const off = vi.fn();
    b.onCancel(off);
    expect(off).not.toHaveBeenCalled();
    expect(b.isCurrent()).toBe(true);
  });

  it('cancel() ends the open without starting another', () => {
    const opens = new OpenRequests();
    const a = opens.begin();
    const off = vi.fn();
    a.onCancel(off);
    opens.cancel();
    expect(a.isCurrent()).toBe(false);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('teardown registered after the open was superseded runs immediately', () => {
    const opens = new OpenRequests();
    const a = opens.begin();
    opens.begin();
    const off = vi.fn();
    a.onCancel(off);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('drops a late response for the note the user left (click A, then B)', async () => {
    // Mirrors openFile: each continuation checks its own request before
    // touching shared state.
    const opens = new OpenRequests();
    let shown: string | null = null;
    const open = (path: string, response: Promise<string>) => {
      const req = opens.begin();
      return response.then((content) => {
        if (req.isCurrent()) shown = content;
      });
    };
    let resolveA!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });
    const doneA = open('a.md', slowA);
    await open('b.md', Promise.resolve('B text'));
    resolveA('A text');
    await doneA;
    expect(shown).toBe('B text');
  });
});
