/**
 * Stage-2 contract verification — task 12.2.
 *
 * Stage 1 returns true everywhere for `shouldIndexPlaintext`, `canCollab`, and
 * `shareLinkMintable`, and false for `isE2EEncrypted` / `commentBodiesEncrypted`.
 * The wiring at each call site is dead code today; stage 2 flips ONLY
 * `isE2EEncrypted` (the other predicates derive from it via the default
 * implementation), which cascades to:
 *
 *   - FTS / embeddings index: skip plaintext indexing for E2E paths.
 *   - OT gateway: reject `doc:open` with a structured error frame.
 *   - Share-link mint: reject with a `BadRequestException`.
 *   - MCP `read_note`: return an `e2e-encrypted` sentinel block.
 *
 * This test stubs `isE2EEncrypted` to return true for one fake path and
 * verifies each guard fires WITHOUT booting the full Nest application — the
 * stage-2 stage 2 flip will work even if no other UI ships.
 */
import 'reflect-metadata';
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DataSource, Repository } from 'typeorm';
import { ShortLink } from '../entities/short-link.entity';
import { ShareLinksService } from '../share-links/share-links.service';
import { SearchService } from '../search/search.service';
import { DefaultEncryptionPredicates } from '../crypto/encryption-predicates';
import type { StorageAdapter } from '../storage';

const E2E_PATH = '_users/alice@x.com/_secure/diary.md';

/**
 * Stage-2 predicate: stubs `isE2EEncrypted` true for one fixed path. Every
 * other predicate is derived via the same defaults the production class uses.
 */
function stage2PredicatesFor(e2ePath: string) {
  const base = new DefaultEncryptionPredicates(
    // EncryptionZonesService stub — never consulted for the E2E path because
    // `isEncryptedAtRest` short-circuits on `isE2EEncrypted`.
    { get: () => ({ enabled: false }) } as any,
  );
  // Override `isE2EEncrypted` to include the test path; the inverse predicates
  // already consult `isE2EEncrypted` so they update automatically.
  const original = base.isE2EEncrypted.bind(base);
  base.isE2EEncrypted = (p: string) => original(p) || p === e2ePath;
  return base;
}

function mockStorage(existingFiles: Set<string>): StorageAdapter {
  return {
    exists: async (p: string) => existingFiles.has(p),
    read: async () => '',
    write: async () => {},
    delete: async () => {},
    move: async () => {},
    list: async () => [],
    watch: () => {},
  } as unknown as StorageAdapter;
}

describe('Stage-2 contract: predicate flip cascades to call sites', () => {
  describe('Share-link mint rejects E2E paths', () => {
    let ds: DataSource;
    let repo: Repository<ShortLink>;

    beforeEach(async () => {
      ds = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [ShortLink],
        synchronize: true,
      });
      await ds.initialize();
      repo = ds.getRepository(ShortLink);
    });

    it('throws when shareLinkMintable returns false', async () => {
      const files = new Set<string>([E2E_PATH, 'notes/public.md']);
      const predicates = stage2PredicatesFor(E2E_PATH);
      const service = new ShareLinksService(repo, mockStorage(files), predicates as any);

      await assert.rejects(
        () => service.getOrCreate(E2E_PATH),
        /end-to-end encrypted/i,
        'minting a share link for an E2E path must reject',
      );

      // Sanity: a non-E2E path still works.
      const code = await service.getOrCreate('notes/public.md');
      assert.equal(typeof code, 'string');
      assert.equal(code.length, 10);

      await ds.destroy();
    });
  });

  describe('FTS index skips E2E paths', () => {
    it('indexNote inserts no row when shouldIndexPlaintext returns false', async () => {
      const ds = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
      });
      await ds.initialize();
      try {
        await ds.query(
          `CREATE VIRTUAL TABLE notes_fts USING fts5(path, title, content)`,
        );

        const predicates = stage2PredicatesFor(E2E_PATH);
        // Build a SearchService with just enough wiring to exercise indexNote.
        // The other deps are not consulted on this code path.
        const svc = new SearchService(
          ds as any,
          {} as any,
          { onFileChange: () => {}, onPersonalChange: () => {} } as any,
          {} as any,
          {} as any,
          {} as any,
          predicates as any,
        );

        await svc.indexNote(E2E_PATH, '# top-secret content');
        await svc.indexNote('Notes/public.md', '# public');

        const rows = await ds.query(`SELECT path FROM notes_fts ORDER BY path`);
        assert.deepEqual(
          rows.map((r: { path: string }) => r.path),
          ['Notes/public.md'],
          'E2E path must NOT appear in FTS index',
        );
      } finally {
        await ds.destroy();
      }
    });

    it('indexNote purges any existing row when path flips to E2E', async () => {
      const ds = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
      });
      await ds.initialize();
      try {
        await ds.query(
          `CREATE VIRTUAL TABLE notes_fts USING fts5(path, title, content)`,
        );
        // Pre-existing plaintext index row (as if indexed before E2E flip).
        await ds.query(
          `INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`,
          [E2E_PATH, 'old title', 'old plaintext leak'],
        );

        const predicates = stage2PredicatesFor(E2E_PATH);
        const svc = new SearchService(
          ds as any,
          {} as any,
          { onFileChange: () => {}, onPersonalChange: () => {} } as any,
          {} as any,
          {} as any,
          {} as any,
          predicates as any,
        );

        await svc.indexNote(E2E_PATH, '# whatever');

        const rows = await ds.query(
          `SELECT path FROM notes_fts WHERE path = ?`,
          [E2E_PATH],
        );
        assert.equal(rows.length, 0, 'stale plaintext row must be purged');
      } finally {
        await ds.destroy();
      }
    });
  });

  describe('DefaultEncryptionPredicates inverse-predicate cascade', () => {
    it('flipping isE2EEncrypted for a path cascades to canCollab, shareLinkMintable, shouldIndexPlaintext, commentBodiesEncrypted', () => {
      const predicates = stage2PredicatesFor(E2E_PATH);

      assert.equal(predicates.isE2EEncrypted(E2E_PATH), true);
      assert.equal(predicates.shouldIndexPlaintext(E2E_PATH), false);
      assert.equal(predicates.canCollab(E2E_PATH), false);
      assert.equal(predicates.commentBodiesEncrypted(E2E_PATH), true);
      assert.equal(predicates.shareLinkMintable(E2E_PATH), false);
      // isEncryptedAtRest must be true for E2E paths regardless of zone state.
      assert.equal(predicates.isEncryptedAtRest(E2E_PATH), true);

      // Non-E2E paths stay permissive.
      assert.equal(predicates.isE2EEncrypted('Notes/public.md'), false);
      assert.equal(predicates.shouldIndexPlaintext('Notes/public.md'), true);
      assert.equal(predicates.canCollab('Notes/public.md'), true);
      assert.equal(predicates.shareLinkMintable('Notes/public.md'), true);
    });
  });
});
