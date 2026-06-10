import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as Database from 'better-sqlite3';
import { escapeLike } from './like-escape';

describe('escapeLike', () => {
  it('escapes underscore', () => {
    assert.equal(escapeLike('john_doe'), 'john\\_doe');
  });

  it('escapes percent', () => {
    assert.equal(escapeLike('a%b'), 'a\\%b');
  });

  it('escapes backslash', () => {
    assert.equal(escapeLike('a\\b'), 'a\\\\b');
  });

  it('escapes backslash before underscore (correct ordering)', () => {
    // a\_b → backslash escapes first to a\\_b, THEN _ escapes to a\\\_b.
    // If order were wrong (_ first), result would be a\\\\_b (4 backslashes before _).
    assert.equal(escapeLike('a\\_b'), 'a\\\\\\_b');
  });

  it('handles empty string', () => {
    assert.equal(escapeLike(''), '');
  });

  it('does not modify safe chars', () => {
    assert.equal(escapeLike('alice@example.com'), 'alice@example.com');
  });

  it('escapes multiple metacharacters', () => {
    assert.equal(escapeLike('a_b%c\\d'), 'a\\_b\\%c\\\\d');
  });

  describe('SQLite LIKE round-trip property', () => {
    it('escaped pattern matches the literal string and only the literal string', () => {
      const db = new Database(':memory:');
      try {
        db.exec(`CREATE TABLE t (s TEXT)`);
        const insert = db.prepare(`INSERT INTO t (s) VALUES (?)`);

        const samples = [
          'john_doe',
          'a%b',
          'a\\b',
          'a_b%c',
          'plain',
          'a__b',
          '%%',
          '___',
        ];
        // Insert each sample plus a "near miss" that the metachar would match unescaped
        for (const s of samples) {
          insert.run(s);
        }
        // Near-miss strings: replace _ with X, % with XYZ
        const nearMisses = [
          'johnxdoe',     // matches 'john_doe' under unescaped _
          'aXYZb',        // matches 'a%b' under unescaped %
          'axb',          // matches 'a%b' (single char % is multi-char wildcard, so this also matches)
          'aXbYc',        // for 'a_b%c'
          'aXXb',         // for 'a__b'
          'XYZ',          // for '%%' or '___'
        ];
        for (const s of nearMisses) {
          insert.run(s);
        }

        const selectExact = db.prepare(`SELECT s FROM t WHERE s LIKE ? ESCAPE '\\'`);

        for (const sample of samples) {
          const pattern = escapeLike(sample);
          const rows = selectExact.all(pattern) as { s: string }[];
          // Pattern with no trailing/leading wildcard should match only the exact literal.
          assert.deepEqual(
            rows.map((r) => r.s).sort(),
            [sample].sort(),
            `LIKE pattern from escapeLike(${JSON.stringify(sample)}) should match exactly its literal`,
          );
        }
      } finally {
        db.close();
      }
    });

    it('escaped email does not match a different user with similar name (LIKE-injection regression)', () => {
      const db = new Database(':memory:');
      try {
        db.exec(`CREATE TABLE notes (path TEXT)`);
        const insert = db.prepare(`INSERT INTO notes (path) VALUES (?)`);
        insert.run('_users/john_doe@x.com/secret.md');
        insert.run('_users/johnxdoe@x.com/secret.md');

        const select = db.prepare(
          `SELECT path FROM notes WHERE path LIKE '\\_users/' || ? || '/%' ESCAPE '\\'`,
        );

        // Alice (john_doe) is the requester. With raw binding the `_` in her email
        // becomes a LIKE wildcard, so the pattern \_users/john_doe@x.com/% would also
        // match _users/johnxdoe@x.com/secret.md — i.e. Alice would see Bob's data.
        const rawRows = select.all('john_doe@x.com') as { path: string }[];
        assert.equal(
          rawRows.length,
          2,
          'sanity: raw binding without escapeLike DOES leak across john_doe/johnxdoe',
        );

        // With escapeLike, the `_` is escaped to `\_` so it matches a literal underscore.
        const escapedAlice = escapeLike('john_doe@x.com');
        const rows = select.all(escapedAlice) as { path: string }[];
        assert.deepEqual(
          rows.map((r) => r.path),
          ['_users/john_doe@x.com/secret.md'],
          'escaped email binding must not cross user boundary via LIKE _ wildcard',
        );
      } finally {
        db.close();
      }
    });
  });
});
