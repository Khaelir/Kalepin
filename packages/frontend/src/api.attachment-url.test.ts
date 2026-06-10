import { describe, it, expect } from 'vitest';
import { attachmentUrl } from './api';

describe('attachmentUrl', () => {
  it('emits the legacy ?name=X shape for shared notes (no doc param)', () => {
    expect(attachmentUrl('img.png')).toBe('/api/files/attachment?name=img.png');
    expect(attachmentUrl('img.png', 'Notes/foo.md')).toBe('/api/files/attachment?name=img.png');
  });

  it('appends &doc=path for attachments rendered inside a personal note', () => {
    expect(attachmentUrl('img.png', '_users/alice@example.com/Diary.md'))
      .toBe('/api/files/attachment?name=img.png&doc=_users%2Falice%40example.com%2FDiary.md');
  });

  it('encodes special characters in the attachment name', () => {
    expect(attachmentUrl('a b/c.png'))
      .toBe('/api/files/attachment?name=a%20b%2Fc.png');
  });

  it('treats an empty docPath as shared', () => {
    expect(attachmentUrl('x.png', '')).toBe('/api/files/attachment?name=x.png');
  });
});
