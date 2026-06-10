import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildDocUrlByHandle,
  buildDocUrlByPath,
  buildShareLinkUrl,
  parseDocUrl,
  DOC_HANDLE_RE,
} from './urls';

describe('DOC_HANDLE_RE', () => {
  it('matches 16-char base32 (A-Z2-7)', () => {
    expect(DOC_HANDLE_RE.test('ABCDEFGHIJKLMNOP')).toBe(true);
    expect(DOC_HANDLE_RE.test('A2B3C4D5E6F7G2H3')).toBe(true);
  });
  it('rejects too-short or too-long ids', () => {
    expect(DOC_HANDLE_RE.test('ABCDEFGHIJKLMNO')).toBe(false); // 15
    expect(DOC_HANDLE_RE.test('ABCDEFGHIJKLMNOPQ')).toBe(false); // 17
  });
  it('rejects lowercase, digits 0/1, slashes, dots', () => {
    expect(DOC_HANDLE_RE.test('abcdefghijklmnop')).toBe(false);
    expect(DOC_HANDLE_RE.test('A0B0C0D0E0F0G0H0')).toBe(false);
    expect(DOC_HANDLE_RE.test('A1B1C1D1E1F1G1H1')).toBe(false);
    expect(DOC_HANDLE_RE.test('AB/DEFGHIJKLMNOP')).toBe(false);
    expect(DOC_HANDLE_RE.test('AB.DEFGHIJKLMNOP')).toBe(false);
  });
});

describe('buildDocUrlByHandle', () => {
  it('produces a /doc/<id> URL', () => {
    expect(buildDocUrlByHandle('ABCDEFGHIJKLMNOP'))
      .toBe('/doc/ABCDEFGHIJKLMNOP');
  });
  it('appends ?thread when given', () => {
    expect(buildDocUrlByHandle('ABCDEFGHIJKLMNOP', undefined, 'T1'))
      .toBe('/doc/ABCDEFGHIJKLMNOP?thread=T1');
  });
  it('appends #heading when given', () => {
    expect(buildDocUrlByHandle('ABCDEFGHIJKLMNOP', 'section-a'))
      .toBe('/doc/ABCDEFGHIJKLMNOP#section-a');
  });
  it('combines thread + heading', () => {
    expect(buildDocUrlByHandle('ABCDEFGHIJKLMNOP', 'h', 'T1'))
      .toBe('/doc/ABCDEFGHIJKLMNOP?thread=T1#h');
  });
});

describe('buildDocUrlByPath (legacy fallback)', () => {
  it('encodes path segments individually', () => {
    expect(buildDocUrlByPath('Notes/Hello World.md'))
      .toBe('/doc/Notes/Hello%20World.md');
  });
});

describe('buildShareLinkUrl (recipient copy — no path leak)', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  beforeAll(() => {
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'https://kalepin.test' },
    };
  });
  afterAll(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('produces an origin-prefixed code-only URL with no path', () => {
    const url = buildShareLinkUrl(
      '_users/admin@kalepin.local/New folder/note 2.md',
      'KpxiFe0Zxt',
    );
    expect(url).toBe('https://kalepin.test/s/KpxiFe0Zxt');
    expect(url).not.toContain('New-folder');
    expect(url).not.toContain('note-2');
  });
});

describe('parseDocUrl — handle / code / legacy-path arms', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  function withPathname(pathname: string, fn: () => void) {
    (globalThis as { window?: unknown }).window = { location: { pathname } };
    try { fn(); } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }

  it('parses /doc/<id> as a handle', () => {
    withPathname('/doc/ABCDEFGHIJKLMNOP', () => {
      expect(parseDocUrl()).toEqual({ handleId: 'ABCDEFGHIJKLMNOP' });
    });
  });

  it('parses /doc/<file/path> as a legacy filePath when the first segment is not a handle', () => {
    withPathname('/doc/Folder/note.md', () => {
      expect(parseDocUrl()).toEqual({ filePath: 'Folder/note.md' });
    });
  });

  it('parses /doc/<single-non-handle-segment> as a legacy filePath (no slash but not 16 base32)', () => {
    withPathname('/doc/notebook', () => {
      expect(parseDocUrl()).toEqual({ filePath: 'notebook' });
    });
  });

  it('parses /s/<code> as a code', () => {
    withPathname('/s/AbC123XyZ0', () => {
      expect(parseDocUrl()).toEqual({ code: 'AbC123XyZ0' });
    });
  });

  it('parses legacy /d/<code> as a code', () => {
    withPathname('/d/AbC123XyZ0', () => {
      expect(parseDocUrl()).toEqual({ code: 'AbC123XyZ0' });
    });
  });

  it('parses pre-deploy /s/<code>/<cosmetic> by code only (cosmetic dropped)', () => {
    withPathname('/s/AbC123XyZ0/Folder/note', () => {
      expect(parseDocUrl()).toEqual({ code: 'AbC123XyZ0' });
    });
  });

  it('parses pre-deploy /d/<code>/<cosmetic> by code only', () => {
    withPathname('/d/AbC123XyZ0/Folder/note', () => {
      expect(parseDocUrl()).toEqual({ code: 'AbC123XyZ0' });
    });
  });

  it('returns null for unrelated paths', () => {
    withPathname('/something-else', () => {
      expect(parseDocUrl()).toBeNull();
    });
  });

  it('returns null for bare /s/ or /doc/', () => {
    withPathname('/s/', () => {
      expect(parseDocUrl()).toBeNull();
    });
    withPathname('/doc/', () => {
      expect(parseDocUrl()).toBeNull();
    });
  });
});
