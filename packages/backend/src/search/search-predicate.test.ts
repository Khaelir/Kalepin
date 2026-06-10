/**
 * Tests the SQL visibility predicate independent of the full SearchService boot
 * (which requires the embedding model). The predicate string and binding rules
 * mirror SearchService.executeFtsQuery / commentFtsSearch exactly — if those drift,
 * update both here and in search.service.ts.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as Database from 'better-sqlite3';
import { escapeLike } from '../auth/like-escape';

const SHARED_VISIBILITY = (
  `(path NOT LIKE '\\_users/%' ESCAPE '\\' OR path LIKE '\\_users/' || ? || '/%' ESCAPE '\\')`
);

function setupNotesFts() {
  const db = new (Database as any)(':memory:');
  db.exec(`CREATE VIRTUAL TABLE notes_fts USING fts5(path UNINDEXED, title, content)`);
  return db;
}

describe('Search visibility predicate (notes_fts)', () => {
  it('owner sees their own personal note; peer does not', () => {
    const db = setupNotesFts();
    try {
      const insert = db.prepare(`INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`);
      insert.run('Notes/shared.md', 'shared', 'TOK shared body');
      insert.run('_users/alice@example.com/diary.md', 'diary', 'TOK private body');

      const select = db.prepare(
        `SELECT path FROM notes_fts WHERE notes_fts MATCH ? AND ${SHARED_VISIBILITY}`,
      );
      const aliceRows = select.all('TOK', escapeLike('alice@example.com')) as { path: string }[];
      const bobRows = select.all('TOK', escapeLike('bob@example.com')) as { path: string }[];

      assert.deepEqual(
        aliceRows.map((r) => r.path).sort(),
        ['Notes/shared.md', '_users/alice@example.com/diary.md'],
      );
      assert.deepEqual(
        bobRows.map((r) => r.path).sort(),
        ['Notes/shared.md'],
      );
    } finally {
      db.close();
    }
  });

  it('LIKE-injection regression: john_doe vs johnxdoe (CRITICAL)', () => {
    const db = setupNotesFts();
    try {
      const insert = db.prepare(`INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`);
      insert.run('_users/john_doe@x.com/secret.md', 's1', 'LEAKTOK content');
      insert.run('_users/johnxdoe@x.com/secret.md', 's2', 'LEAKTOK content');

      const select = db.prepare(
        `SELECT path FROM notes_fts WHERE notes_fts MATCH ? AND ${SHARED_VISIBILITY}`,
      );

      // With escapeLike: john_doe sees ONLY their note.
      const escaped = select.all('LEAKTOK', escapeLike('john_doe@x.com')) as { path: string }[];
      assert.deepEqual(
        escaped.map((r) => r.path),
        ['_users/john_doe@x.com/secret.md'],
        'with escapeLike, john_doe must NOT see johnxdoe rows',
      );

      // Without escapeLike: john_doe SHOULD ALSO match johnxdoe (sanity / regression check).
      const raw = select.all('LEAKTOK', 'john_doe@x.com') as { path: string }[];
      assert.equal(
        raw.length,
        2,
        'sanity: raw email binding leaks across john_doe/johnxdoe — escapeLike is what protects us',
      );
    } finally {
      db.close();
    }
  });

  it('LIKE-injection regression: a%b vs axyzb', () => {
    const db = setupNotesFts();
    try {
      const insert = db.prepare(`INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`);
      insert.run('_users/a%b@x.com/secret.md', 's1', 'LEAKTOK content');
      insert.run('_users/axyzb@x.com/secret.md', 's2', 'LEAKTOK content');

      const select = db.prepare(
        `SELECT path FROM notes_fts WHERE notes_fts MATCH ? AND ${SHARED_VISIBILITY}`,
      );
      const escaped = select.all('LEAKTOK', escapeLike('a%b@x.com')) as { path: string }[];
      assert.deepEqual(
        escaped.map((r) => r.path),
        ['_users/a%b@x.com/secret.md'],
        'with escapeLike, a%b must NOT see axyzb rows',
      );
    } finally {
      db.close();
    }
  });

  it('predicate omitted when caller does not pass userEmail (legacy / system callers)', () => {
    const db = setupNotesFts();
    try {
      const insert = db.prepare(`INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`);
      insert.run('Notes/shared.md', 'shared', 'TOK shared');
      insert.run('_users/alice@example.com/diary.md', 'diary', 'TOK private');

      // No predicate at all (mirrors SearchService when called without userEmail).
      const all = db.prepare(`SELECT path FROM notes_fts WHERE notes_fts MATCH ?`).all('TOK') as { path: string }[];
      assert.equal(all.length, 2, 'system callers see all rows — by design');
    } finally {
      db.close();
    }
  });
});
