import { describe, it, expect } from 'vitest';
import { relatedFolderLabel, relatedReasonLabel, wikilinkTargetFor } from './related-notes';

describe('relatedFolderLabel', () => {
  it('returns the parent folder, empty at the vault root', () => {
    expect(relatedFolderLabel('Engineering/Ops/Deploy.md')).toBe('Engineering/Ops');
    expect(relatedFolderLabel('Deploy.md')).toBe('');
  });

  it('prettifies personal folders', () => {
    expect(relatedFolderLabel('_users/alice@x.com/Projects/a.md')).toBe('/alice@x.com/Projects');
  });
});

describe('relatedReasonLabel', () => {
  it('combines heading and excerpt', () => {
    expect(relatedReasonLabel({ heading: 'Deployment', sourceHeading: 'Rollout', excerpt: 'Build the image…' }))
      .toBe('§ Deployment — Build the image…');
  });

  it('falls back to the excerpt or heading alone', () => {
    expect(relatedReasonLabel({ heading: '', sourceHeading: '', excerpt: 'Short note.' })).toBe('Short note.');
    expect(relatedReasonLabel({ heading: 'Intro', sourceHeading: '', excerpt: '' })).toBe('§ Intro');
  });

  it('is empty without a reason (PIN-locked note)', () => {
    expect(relatedReasonLabel(null)).toBe('');
  });
});

describe('wikilinkTargetFor', () => {
  const all = ['Ops/Deploy.md', 'Ops/Rollback.md', 'Archive/Rollback.md', 'Notes/Plan.md'];

  it('uses the bare note name when it resolves to the target', () => {
    expect(wikilinkTargetFor('Ops/Deploy.md', 'Notes/Plan.md', all)).toBe('Deploy');
  });

  it('uses the full path when the name is ambiguous and would resolve elsewhere', () => {
    // From Notes/, [[Rollback]] is ambiguous (the backend would pick Ops/Rollback.md).
    expect(wikilinkTargetFor('Archive/Rollback.md', 'Notes/Plan.md', all)).toBe('Archive/Rollback');
  });

  it('keeps the bare name when the ambiguity resolves to the target anyway', () => {
    expect(wikilinkTargetFor('Archive/Rollback.md', 'Archive/Index.md', all)).toBe('Rollback');
  });
});
