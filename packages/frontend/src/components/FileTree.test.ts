import { describe, it, expect } from 'vitest';
import type { FileEntry } from '@kalepin/shared';
import { isPersonalRootSegment, partitionTree, PERSONAL_PREFIX } from './FileTree';

describe('isPersonalRootSegment', () => {
  it('matches the bare _users/{email} segment', () => {
    expect(isPersonalRootSegment('_users/alice@example.com')).toBe(true);
    expect(isPersonalRootSegment('_users/bob@example.com')).toBe(true);
  });

  it('rejects nested paths under a personal root', () => {
    expect(isPersonalRootSegment('_users/alice@example.com/Diary.md')).toBe(false);
    expect(isPersonalRootSegment('_users/alice@example.com/sub/note.md')).toBe(false);
  });

  it('rejects the bare _users folder', () => {
    expect(isPersonalRootSegment('_users')).toBe(false);
    expect(isPersonalRootSegment('_users/')).toBe(false);
  });

  it('rejects unrelated paths', () => {
    expect(isPersonalRootSegment('Notes/foo.md')).toBe(false);
    expect(isPersonalRootSegment('')).toBe(false);
    expect(isPersonalRootSegment('Folder/_users/x@y.com')).toBe(false);
  });
});

describe('partitionTree', () => {
  it('returns no personalRoot when the user has no personal folder', () => {
    const files: FileEntry[] = [
      { name: 'Notes', path: 'Notes', type: 'directory', children: [] },
      { name: 'Projects', path: 'Projects', type: 'directory', children: [] },
    ];
    const { personalRoot, sharedFiles } = partitionTree(files);
    expect(personalRoot).toBeNull();
    expect(sharedFiles.map((f) => f.path)).toEqual(['Notes', 'Projects']);
  });

  it('lifts the personal subtree out of the _users wrapper', () => {
    const personalRootEntry: FileEntry = {
      name: 'alice@example.com',
      path: '_users/alice@example.com',
      type: 'directory',
      children: [
        { name: 'Diary.md', path: '_users/alice@example.com/Diary.md', type: 'file' },
      ],
    };
    const files: FileEntry[] = [
      {
        name: '_users',
        path: '_users',
        type: 'directory',
        children: [personalRootEntry],
      },
      { name: 'Notes', path: 'Notes', type: 'directory', children: [] },
    ];
    const { personalRoot, sharedFiles } = partitionTree(files);
    expect(personalRoot).toBe(personalRootEntry);
    expect(sharedFiles.map((f) => f.path)).toEqual(['Notes']);
  });

  it('treats an empty _users wrapper as no personal folder', () => {
    const files: FileEntry[] = [
      { name: '_users', path: '_users', type: 'directory', children: [] },
      { name: 'Notes', path: 'Notes', type: 'directory', children: [] },
    ];
    const { personalRoot, sharedFiles } = partitionTree(files);
    expect(personalRoot).toBeNull();
    expect(sharedFiles.map((f) => f.path)).toEqual(['Notes']);
  });

  it('drops any stray _users/* siblings (defense-in-depth against legacy data)', () => {
    // Should never happen with layout B but the partitioner should not surface
    // foreign personal entries even if the backend ever returned them.
    const files: FileEntry[] = [
      { name: 'mallory@x', path: `${PERSONAL_PREFIX}mallory@x`, type: 'directory', children: [] },
      { name: 'Notes', path: 'Notes', type: 'directory', children: [] },
    ];
    const { personalRoot, sharedFiles } = partitionTree(files);
    expect(personalRoot).toBeNull();
    expect(sharedFiles.map((f) => f.path)).toEqual(['Notes']);
  });

  it('extracts the _shared_with_me virtual root when present', () => {
    const swm: FileEntry = {
      name: '_shared_with_me',
      path: '_shared_with_me',
      type: 'directory',
      children: [
        { name: 'alice@example.com', path: '_shared_with_me/alice@example.com', type: 'directory', children: [
          { name: 'foo.md', path: '_users/alice@example.com/foo.md', type: 'file' },
        ]},
      ],
    };
    const files: FileEntry[] = [
      swm,
      { name: 'Notes', path: 'Notes', type: 'directory', children: [] },
    ];
    const { personalRoot, sharedWithMeRoot, sharedFiles } = partitionTree(files);
    expect(personalRoot).toBeNull();
    expect(sharedWithMeRoot).toBe(swm);
    expect(sharedFiles.map((f) => f.path)).toEqual(['Notes']);
  });

  it('returns both a populated personal section and shared roots together', () => {
    const personal: FileEntry = {
      name: 'alice@example.com',
      path: '_users/alice@example.com',
      type: 'directory',
      children: [
        { name: 'Diary.md', path: '_users/alice@example.com/Diary.md', type: 'file' },
        { name: 'Scratch.md', path: '_users/alice@example.com/Scratch.md', type: 'file' },
      ],
    };
    const files: FileEntry[] = [
      { name: '_users', path: '_users', type: 'directory', children: [personal] },
      { name: 'Notes', path: 'Notes', type: 'directory', children: [
        { name: 'shared.md', path: 'Notes/shared.md', type: 'file' },
      ]},
    ];
    const { personalRoot, sharedFiles } = partitionTree(files);
    expect(personalRoot?.path).toBe('_users/alice@example.com');
    expect(personalRoot?.children?.length).toBe(2);
    expect(sharedFiles.length).toBe(1);
    expect(sharedFiles[0].path).toBe('Notes');
  });
});
