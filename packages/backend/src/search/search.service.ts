import { Injectable, Inject, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { FileWatcherService } from '../files';
import { FileEntry, FileChangeEvent } from '@kalepin/shared';
import { SidecarService } from '../comments/sidecar.service';
import { DailyStatsService } from '../stats/daily-stats.service';
import { EmbeddingService } from './embedding.service';
import { chunkMarkdown, humanizePath } from './chunk-markdown';
import { escapeLike } from '../auth/like-escape';
import { isVisibleTo } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { Optional } from '@nestjs/common';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { OTService } from '../ot/ot.service';
import * as path from 'path';

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  heading?: string;
  type?: 'note' | 'comment';
  threadId?: string;
  commentAuthor?: string;
}

interface VectorResult {
  path: string;
  heading: string;
  chunkText: string;
  score: number;
  source: 'note' | 'comment';
}

const EMBEDDING_DIM = 768;
const VECTOR_COSINE_THRESHOLD = 0.4;
const QUERY_CACHE_CAPACITY = 50;
const MIN_VECTOR_QUERY_LENGTH = 3;
// Bump this when chunking/embedding logic changes to trigger auto-reindex
const EMBEDDING_SCHEMA_VERSION = 2;

const EMBEDDING_INACTIVITY_MS = 45_000;
const EMBEDDING_SAFETY_CAP_MS = 5 * 60_000;
const SHUTDOWN_DRAIN_BUDGET_MS = 30_000;
const HEAL_SWEEP_INTERVAL_MS = 10 * 60_000;

interface CachedEmbedding {
  path: string;
  heading: string;
  chunkText: string;
  embedding: Float32Array;
  source: 'note' | 'comment';
}

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);

  // LRU cache for query embeddings (avoids re-embedding repeated queries)
  private queryEmbeddingCache = new Map<string, Float32Array>();

  // In-memory vector cache: all embeddings keyed by path (lazy-loaded on first search)
  private vectorCache: Map<string, CachedEmbedding[]> | null = null;

  // Per-doc holding map for deferred embeddings — populated only while an OT
  // session is active. Latest content for a path replaces older content.
  private deferredEmbeddings = new Map<string, { content: string; firstDeferredAt: number }>();
  private inactivityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private safetyCapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private shutdownListener: (() => void) | null = null;
  private healSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(forwardRef(() => FileWatcherService))
    private readonly fileWatcher: FileWatcherService,
    private readonly embeddingService: EmbeddingService,
    private readonly sidecarService: SidecarService,
    private readonly dailyStatsService: DailyStatsService,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
    @Optional() private readonly visibility?: GrantAwareVisibility,
    @Optional() @Inject(forwardRef(() => OTService))
    private readonly otService?: OTService,
  ) {}

  /** Returns the set of paths the user can see via active grants (or empty). */
  private async grantSet(userEmail?: string): Promise<Set<string>> {
    if (!userEmail || !this.visibility) return new Set();
    return this.visibility.visibleGrantSet(userEmail);
  }

  async onModuleInit() {
    await this.createFtsTable();
    await this.createCommentsFtsTable();
    await this.createEmbeddingsTable();
    await this.createMetadataTable();
    await this.createFtsMetaTable();

    const count = await this.getIndexedCount();
    if (count === 0) {
      // Wait for embedding model before full reindex
      await this.embeddingService.whenReady();
      await this.reindexAll();
    } else {
      // Check if embeddings need (re)indexing: missing, wrong dimension, or stale schema version
      const embCount = await this.getEmbeddingCount();
      const schemaStale = await this.hasStaleSchemaVersion();
      const needsReindex = embCount === 0 || (await this.hasStaleEmbeddings()) || schemaStale;
      if (needsReindex) {
        if (embCount > 0) {
          const reason = schemaStale ? 'schema version changed' : `wrong dimension (expected ${EMBEDDING_DIM})`;
          this.logger.warn(`Embeddings stale (${reason}), clearing and re-indexing...`);
          await this.dataSource.query(`DELETE FROM note_embeddings`);
        }
        this.embeddingService.whenReady().then(() => {
          if (this.embeddingService.ready) {
            this.indexAllEmbeddingsAsync();
          }
        });
      }
    }

    // Hook into file watcher for automatic index updates. Both shared and
    // personal events feed the same FTS / embeddings pipeline — per Phase 6.8,
    // indexing is namespace-blind and the visibility predicate runs only at
    // query time. Skipping personal-event subscription here would mean an
    // owner can't search their own personal notes.
    const onChange = async (event: FileChangeEvent): Promise<void> => {
      if (!event.path.endsWith('.md')) return;

      if (event.event === 'add' || event.event === 'change') {
        try {
          const content = await this.storage.read(event.path);
          await this.indexNote(event.path, content);
          if (this.storage.stat) {
            try {
              const s = await this.storage.stat(event.path);
              await this.setIndexedMtime(event.path, s.mtime);
            } catch {
              // ignore — heal sweep will catch up
            }
          }
          if (this.embeddingService.ready) {
            this.scheduleEmbedding(event.path, content);
          }
        } catch {
          // File might have been deleted between event and read
        }
      } else if (event.event === 'unlink') {
        await this.removeNote(event.path);
        await this.removeNoteEmbeddings(event.path);
        await this.clearIndexedMtime(event.path);
        this.cancelDeferredEmbedding(event.path);
      }
    };
    this.fileWatcher.onFileChange(onChange);
    this.fileWatcher.onPersonalChange(onChange);

    // Internal-write fast path: indexer consumes content with no disk read or
    // decrypt, mirroring the chokidar branch above but without the storage.read.
    this.fileWatcher.onInternalWrite(async (notePath, content) => {
      if (!notePath.endsWith('.md')) return;
      try {
        await this.indexNote(notePath, content);
        if (this.storage.stat) {
          try {
            const s = await this.storage.stat(notePath);
            await this.setIndexedMtime(notePath, s.mtime);
          } catch {
            // ignore
          }
        }
        if (this.embeddingService.ready) {
          this.scheduleEmbedding(notePath, content);
        }
      } catch (err) {
        this.logger.warn(
          `internal-write index update failed for "${notePath}": ${(err as Error).message}`,
        );
      }
    });

    // Drain pending deferred embedding when an OT session closes.
    this.otService?.addSessionCloseListener(async (docId) => {
      await this.flushPendingEmbedding(docId);
    });

    // Drain pending deferred embeddings on graceful shutdown so a stuck embed
    // doesn't block exit indefinitely. Anything not drained inside the budget
    // is picked up by the next-startup heal sweep.
    this.shutdownListener = () => {
      this.drainOnShutdown().catch((err) => {
        this.logger.warn(`shutdown drain error: ${(err as Error).message}`);
      });
    };
    process.on('beforeExit', this.shutdownListener);

    // Heal sweep — runs every 10 min, reconciles index against disk to absorb
    // any chokidar/dedup miss within bounded staleness.
    this.healSweepTimer = setInterval(() => {
      this.healSweep().catch((err) => {
        this.logger.warn(`heal sweep failed: ${(err as Error).message}`);
      });
    }, HEAL_SWEEP_INTERVAL_MS);
    this.healSweepTimer.unref?.();
  }

  /**
   * Reconcile the FTS index against on-disk state. Walks `notes_fts_meta`,
   * compares each path's `indexed_mtime` to the live disk mtime, and re-indexes
   * any drift. Paths that have been deleted from disk have their index rows
   * removed.
   */
  async healSweep(): Promise<{ reindexed: number; removed: number }> {
    const rows: { path: string; indexed_mtime: number | null }[] = await this.dataSource.query(
      `SELECT path, indexed_mtime FROM notes_fts_meta`,
    );
    let reindexed = 0;
    let removed = 0;
    for (const row of rows) {
      try {
        if (!this.storage.stat) break;
        const s = await this.storage.stat(row.path);
        const diskMs = s.mtime.getTime();
        if (row.indexed_mtime === null || diskMs > row.indexed_mtime) {
          try {
            const content = await this.storage.read(row.path);
            await this.indexNote(row.path, content);
            await this.setIndexedMtime(row.path, s.mtime);
            reindexed++;
          } catch {
            // skip this iteration; will retry next sweep
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          await this.removeNote(row.path);
          await this.removeNoteEmbeddings(row.path);
          await this.clearIndexedMtime(row.path);
          removed++;
        }
        // Other errors: skip; next sweep retries.
      }
    }
    if (reindexed > 0 || removed > 0) {
      this.logger.log(`heal sweep: reindexed=${reindexed}, removed=${removed}`);
    }
    return { reindexed, removed };
  }

  // --- FTS5 ---

  private async createFtsTable(): Promise<void> {
    await this.dataSource.query(
      `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, content)`,
    );
  }

  private async createCommentsFtsTable(): Promise<void> {
    await this.dataSource.query(
      `CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(path, thread_id, content)`,
    );
  }

  private async getIndexedCount(): Promise<number> {
    const result = await this.dataSource.query(
      `SELECT COUNT(*) as count FROM notes_fts`,
    );
    return result[0].count;
  }

  async indexNote(notePath: string, content: string): Promise<void> {
    // Stage-2 seam: when `shouldIndexPlaintext` is false, the body is opaque to
    // the server. We still purge any prior index row so flipping a path to E2E
    // does not leave stale plaintext behind. In stage 1 the predicate is always
    // true; this branch is dead code today and the contract test verifies it
    // fires correctly when stubbed.
    if (!this.predicates.shouldIndexPlaintext(notePath)) {
      await this.dataSource.query(`DELETE FROM notes_fts WHERE path = ?`, [notePath]);
      return;
    }
    const title = this.extractTitle(notePath, content);
    await this.dataSource.query(`DELETE FROM notes_fts WHERE path = ?`, [notePath]);
    await this.dataSource.query(
      `INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`,
      [notePath, title, content],
    );
  }

  async removeNote(notePath: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM notes_fts WHERE path = ?`, [notePath]);
  }

  private buildFtsQuery(query: string, mode: 'AND' | 'OR'): string {
    // Extract quoted phrases (pass through as FTS5 phrase queries)
    const phrases: string[] = [];
    const remaining = query.replace(/"([^"]+)"/g, (_, phrase) => {
      phrases.push(`"${phrase}"`);
      return '';
    });

    // Prefix-match remaining terms
    const terms = remaining
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"*`);

    const all = [...phrases, ...terms];
    if (all.length === 0) return '';

    return all.join(mode === 'AND' ? ' AND ' : ' OR ');
  }

  private async executeFtsQuery(ftsQuery: string, userEmail?: string): Promise<SearchResult[]> {
    const grants = await this.grantSet(userEmail);
    const grantClause = grants.size > 0
      ? ` OR path IN (${Array.from({ length: grants.size }, () => '?').join(',')})`
      : '';
    const visibilityClause = userEmail
      ? `AND (path NOT LIKE '\\_users/%' ESCAPE '\\' OR path LIKE '\\_users/' || ? || '/%' ESCAPE '\\'${grantClause})`
      : '';
    const params: unknown[] = [ftsQuery];
    if (userEmail) {
      params.push(escapeLike(userEmail));
      for (const p of grants) params.push(p);
    }

    const results = await this.dataSource.query(
      `SELECT path, snippet(notes_fts, 2, '<mark>', '</mark>', '...', 32) as snippet, bm25(notes_fts, 5.0, 10.0, 1.0) as score
       FROM notes_fts
       WHERE notes_fts MATCH ?
       ${visibilityClause}
       ORDER BY bm25(notes_fts, 5.0, 10.0, 1.0)
       LIMIT 50`,
      params,
    );

    return results.map((row: any) => ({
      path: row.path,
      snippet: row.snippet,
      score: row.score,
    }));
  }

  private async ftsSearch(query: string, userEmail?: string): Promise<SearchResult[]> {
    // Try AND-mode first (higher precision)
    const andQuery = this.buildFtsQuery(query, 'AND');
    if (!andQuery) return [];

    this.logger.debug(`FTS AND query: "${andQuery}"`);
    let results = await this.executeFtsQuery(andQuery, userEmail);

    // Fall back to OR if AND returns < 3 results
    if (results.length < 3) {
      const orQuery = this.buildFtsQuery(query, 'OR');
      this.logger.debug(`FTS OR fallback: "${orQuery}"`);
      const orResults = await this.executeFtsQuery(orQuery, userEmail);
      if (orResults.length > results.length) {
        results = orResults;
      }
    }

    this.logger.debug(
      `FTS results (${results.length}): ${results.map((r: any) => `${r.path} [bm25=${r.score.toFixed(4)}]`).join(', ') || '(none)'}`,
    );

    return results;
  }

  private async commentFtsSearch(query: string, userEmail?: string): Promise<SearchResult[]> {
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"*`)
      .join(' OR ');

    if (!ftsQuery) return [];

    const grants = await this.grantSet(userEmail);
    const grantClause = grants.size > 0
      ? ` OR path IN (${Array.from({ length: grants.size }, () => '?').join(',')})`
      : '';
    const visibilityClause = userEmail
      ? `AND (path NOT LIKE '\\_users/%' ESCAPE '\\' OR path LIKE '\\_users/' || ? || '/%' ESCAPE '\\'${grantClause})`
      : '';
    const params: unknown[] = [ftsQuery];
    if (userEmail) {
      params.push(escapeLike(userEmail));
      for (const p of grants) params.push(p);
    }

    const results = await this.dataSource.query(
      `SELECT path, thread_id, snippet(comments_fts, 2, '<mark>', '</mark>', '...', 32) as snippet
       FROM comments_fts
       WHERE comments_fts MATCH ?
       ${visibilityClause}
       ORDER BY rank
       LIMIT 50`,
      params,
    );

    // Cache sidecar threads per path so we can enrich results with full text + author
    const threadCache = new Map<string, import('@kalepin/shared').CommentThread[]>();
    const searchResults: SearchResult[] = [];
    for (const row of results) {
      let threads = threadCache.get(row.path);
      if (!threads) {
        try {
          threads = await this.sidecarService.getThreadsForDocument(row.path);
        } catch {
          threads = [];
        }
        threadCache.set(row.path, threads);
      }
      const thread = threads.find((t) => t.id === row.thread_id);
      // Build full thread text instead of the truncated FTS snippet
      let fullText = row.snippet;
      let author: string | undefined;
      if (thread) {
        const parts: string[] = [];
        if (thread.quotedText) parts.push(`[quoted: "${thread.quotedText}"]`);
        for (const c of thread.comments) {
          parts.push(`${c.author}: ${c.text}`);
        }
        fullText = parts.join('\n');
        author = thread.comments[0]?.author;
      }
      searchResults.push({
        path: row.path,
        snippet: fullText,
        score: 0,
        type: 'comment',
        threadId: row.thread_id,
        commentAuthor: author,
      });
    }

    return searchResults;
  }

  // --- Embeddings ---

  private async createEmbeddingsTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS note_embeddings (
        path TEXT NOT NULL,
        chunk_idx INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        heading TEXT NOT NULL DEFAULT '',
        embedding BLOB NOT NULL,
        source TEXT NOT NULL DEFAULT 'note',
        PRIMARY KEY (path, source, chunk_idx)
      )
    `);
    // Migration: add source column if table already exists without it
    try {
      await this.dataSource.query(
        `ALTER TABLE note_embeddings ADD COLUMN source TEXT NOT NULL DEFAULT 'note'`,
      );
    } catch {
      // Column already exists — expected
    }
  }

  private async createMetadataTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS search_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  /**
   * Per-path FTS index state, used by the heal sweep to detect drift between
   * on-disk mtime and the last-indexed mtime. NULL `indexed_mtime` is the
   * legacy / unset state and is treated as "always re-index" until populated.
   */
  private async createFtsMetaTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS notes_fts_meta (
        path TEXT PRIMARY KEY,
        indexed_mtime INTEGER
      )
    `);
  }

  private async setIndexedMtime(notePath: string, mtime: Date | null): Promise<void> {
    const ms = mtime ? mtime.getTime() : null;
    await this.dataSource.query(
      `INSERT INTO notes_fts_meta (path, indexed_mtime) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET indexed_mtime = excluded.indexed_mtime`,
      [notePath, ms],
    );
  }

  private async clearIndexedMtime(notePath: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM notes_fts_meta WHERE path = ?`, [notePath]);
  }

  private async hasStaleSchemaVersion(): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT value FROM search_metadata WHERE key = 'embedding_schema_version'`,
    );
    if (rows.length === 0) return true;
    return parseInt(rows[0].value, 10) !== EMBEDDING_SCHEMA_VERSION;
  }

  private async setSchemaVersion(): Promise<void> {
    await this.dataSource.query(
      `INSERT OR REPLACE INTO search_metadata (key, value) VALUES ('embedding_schema_version', ?)`,
      [String(EMBEDDING_SCHEMA_VERSION)],
    );
  }

  private async getEmbeddingCount(): Promise<number> {
    const result = await this.dataSource.query(
      `SELECT COUNT(*) as count FROM note_embeddings`,
    );
    return result[0].count;
  }

  /** Check if stored embeddings have a different dimension than expected. */
  private async hasStaleEmbeddings(): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT embedding FROM note_embeddings LIMIT 1`,
    );
    if (rows.length === 0) return false;
    const storedDim = rows[0].embedding.byteLength / 4; // Float32 = 4 bytes
    return storedDim !== EMBEDDING_DIM;
  }

  /**
   * Backwards-compatible alias kept for existing callers that explicitly want
   * synchronous embedding (reindexAll, MCP tools). New event-driven callers
   * should use {@link scheduleEmbedding} instead so deferral applies for paths
   * with active OT sessions.
   */
  async indexNoteEmbeddings(notePath: string, content: string): Promise<void> {
    return this.embedNow(notePath, content);
  }

  /**
   * Decide whether to embed a path immediately or defer until the OT session
   * goes inactive. Documents without an active OT session (e.g., MCP-created
   * notes, externally written notes) embed inline; documents with at least one
   * connected client park their content under a per-doc inactivity timer that
   * fires 45 s after the latest flush.
   */
  scheduleEmbedding(notePath: string, content: string): void {
    if (!this.embeddingService.ready) return;
    if (!this.predicates.shouldIndexPlaintext(notePath)) {
      // Stage-2 seam: opaque body — purge any prior plaintext embeddings.
      this.removeNoteEmbeddings(notePath).catch((err) => {
        this.logger.warn(`removeNoteEmbeddings failed for "${notePath}": ${(err as Error).message}`);
      });
      this.cancelDeferredEmbedding(notePath);
      return;
    }

    const session = this.otService?.sessionManager.getSession(notePath);
    const hasActiveClients = !!session && session.clients.size > 0;
    if (!hasActiveClients) {
      // Cancel any prior deferral so the immediate run wins.
      this.cancelDeferredEmbedding(notePath);
      this.embedNow(notePath, content).catch((err) => {
        this.logger.error(`embedNow failed for "${notePath}"`, err);
      });
      return;
    }

    const now = Date.now();
    const existing = this.deferredEmbeddings.get(notePath);
    this.deferredEmbeddings.set(notePath, {
      content,
      firstDeferredAt: existing?.firstDeferredAt ?? now,
    });

    const prior = this.inactivityTimers.get(notePath);
    if (prior) clearTimeout(prior);
    const inactivityTimer = setTimeout(() => {
      this.firePendingEmbedding(notePath).catch((err) => {
        this.logger.error(`pending embedding (inactivity) failed for "${notePath}"`, err);
      });
    }, EMBEDDING_INACTIVITY_MS);
    inactivityTimer.unref?.();
    this.inactivityTimers.set(notePath, inactivityTimer);

    if (!this.safetyCapTimers.has(notePath)) {
      const capTimer = setTimeout(() => {
        this.firePendingEmbedding(notePath).catch((err) => {
          this.logger.error(`pending embedding (safety cap) failed for "${notePath}"`, err);
        });
      }, EMBEDDING_SAFETY_CAP_MS);
      capTimer.unref?.();
      this.safetyCapTimers.set(notePath, capTimer);
    }
  }

  /**
   * Drain the held content for a path and run the embedding inline. Clears
   * both inactivity and safety-cap timers regardless of which fired.
   */
  private async firePendingEmbedding(notePath: string): Promise<void> {
    const held = this.deferredEmbeddings.get(notePath);
    this.cancelDeferredEmbedding(notePath);
    if (!held) return;
    await this.embedNow(notePath, held.content);
  }

  /**
   * Force-flush a pending embedding (used by OT session-close listener). No-op
   * if nothing is pending for the path.
   */
  async flushPendingEmbedding(notePath: string): Promise<void> {
    if (!this.deferredEmbeddings.has(notePath)) return;
    await this.firePendingEmbedding(notePath);
  }

  private cancelDeferredEmbedding(notePath: string): void {
    this.deferredEmbeddings.delete(notePath);
    const inactivity = this.inactivityTimers.get(notePath);
    if (inactivity) {
      clearTimeout(inactivity);
      this.inactivityTimers.delete(notePath);
    }
    const cap = this.safetyCapTimers.get(notePath);
    if (cap) {
      clearTimeout(cap);
      this.safetyCapTimers.delete(notePath);
    }
  }

  private async drainOnShutdown(): Promise<void> {
    const paths = Array.from(this.deferredEmbeddings.keys());
    if (paths.length === 0) return;
    const deadline = Date.now() + SHUTDOWN_DRAIN_BUDGET_MS;
    for (const p of paths) {
      if (Date.now() >= deadline) {
        this.logger.warn(
          `shutdown drain budget exceeded; ${this.deferredEmbeddings.size} pending embeddings deferred to next-startup heal sweep`,
        );
        break;
      }
      try {
        await this.firePendingEmbedding(p);
      } catch (err) {
        this.logger.warn(`shutdown drain failed for "${p}": ${(err as Error).message}`);
      }
    }
  }

  /** Test-only — read pending deferred embeddings. */
  pendingDeferredCount(): number {
    return this.deferredEmbeddings.size;
  }

  /** Test-only — read content held for a path. */
  peekDeferredContent(notePath: string): string | undefined {
    return this.deferredEmbeddings.get(notePath)?.content;
  }

  /**
   * Run the ONNX inference + DB upsert + in-memory cache update for a single
   * path. Called inline by `scheduleEmbedding` for paths without an active OT
   * session, on inactivity-timer/safety-cap fire, on session close, and by
   * batch reindexers.
   */
  async embedNow(notePath: string, content: string): Promise<void> {
    if (!this.predicates.shouldIndexPlaintext(notePath)) {
      await this.removeNoteEmbeddings(notePath);
      return;
    }
    const chunks = chunkMarkdown(content, notePath);
    await this.removeNoteEmbeddings(notePath);

    const pathPrefix = humanizePath(notePath);
    const cachedEntries: CachedEmbedding[] = [];
    for (const chunk of chunks) {
      // Prepend humanized path to first chunk at embedding time only (not stored in DB)
      const textForEmbedding = chunk.chunkIdx === 0 && pathPrefix
        ? `${pathPrefix} — ${chunk.text}`
        : chunk.text;
      const embedding = await this.embeddingService.embed(textForEmbedding);
      const embeddingBuffer = Buffer.from(embedding.buffer);
      await this.dataSource.query(
        `INSERT INTO note_embeddings (path, chunk_idx, chunk_text, heading, embedding, source) VALUES (?, ?, ?, ?, ?, 'note')`,
        [notePath, chunk.chunkIdx, chunk.text, chunk.heading, embeddingBuffer],
      );
      // Update in-memory cache
      cachedEntries.push({
        path: notePath,
        heading: chunk.heading,
        chunkText: chunk.text,
        embedding,
        source: 'note',
      });
    }

    if (this.vectorCache) {
      // Merge new note entries with any existing comment entries for this path
      const existing = this.vectorCache.get(notePath) ?? [];
      const commentEntries = existing.filter((e) => e.source === 'comment');
      this.vectorCache.set(notePath, [...commentEntries, ...cachedEntries]);
    }
  }

  async removeNoteEmbeddings(notePath: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM note_embeddings WHERE path = ? AND source = 'note'`,
      [notePath],
    );

    // Update in-memory cache — keep comment entries if any
    if (this.vectorCache) {
      const existing = this.vectorCache.get(notePath) ?? [];
      const commentEntries = existing.filter((e) => e.source === 'comment');
      if (commentEntries.length > 0) {
        this.vectorCache.set(notePath, commentEntries);
      } else {
        this.vectorCache.delete(notePath);
      }
    }
  }

  // --- Comment Indexing ---

  async indexNoteComments(notePath: string): Promise<void> {
    const threads = await this.sidecarService.getThreadsForDocument(notePath);

    // Clear existing comment FTS entries for this note
    await this.dataSource.query(`DELETE FROM comments_fts WHERE path = ?`, [notePath]);

    for (const thread of threads) {
      const parts: string[] = [];
      if (thread.quotedText) parts.push(thread.quotedText);
      for (const comment of thread.comments) {
        parts.push(comment.text);
      }
      const content = parts.join(' ');
      if (content.trim()) {
        await this.dataSource.query(
          `INSERT INTO comments_fts (path, thread_id, content) VALUES (?, ?, ?)`,
          [notePath, thread.id, content],
        );
      }
    }
  }

  async indexCommentEmbeddings(notePath: string): Promise<void> {
    if (!this.embeddingService.ready) return;

    const threads = await this.sidecarService.getThreadsForDocument(notePath);

    // Clear existing comment embeddings for this note
    await this.dataSource.query(
      `DELETE FROM note_embeddings WHERE path = ? AND source = 'comment'`,
      [notePath],
    );

    let chunkIdx = 0;
    for (const thread of threads) {
      const parts: string[] = [];
      if (thread.quotedText) parts.push(thread.quotedText);
      for (const comment of thread.comments) {
        parts.push(comment.text);
      }
      const text = parts.join(' ');
      if (!text.trim()) continue;

      const embedding = await this.embeddingService.embed(text);
      const embeddingBuffer = Buffer.from(embedding.buffer);
      await this.dataSource.query(
        `INSERT INTO note_embeddings (path, chunk_idx, chunk_text, heading, embedding, source) VALUES (?, ?, ?, ?, ?, 'comment')`,
        [notePath, chunkIdx, text, '', embeddingBuffer],
      );
      chunkIdx++;
    }
  }

  async removeNoteComments(notePath: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM comments_fts WHERE path = ?`, [notePath]);
    await this.dataSource.query(
      `DELETE FROM note_embeddings WHERE path = ? AND source = 'comment'`,
      [notePath],
    );
  }

  // --- Query Embedding Cache ---

  private async embedQuery(query: string): Promise<Float32Array> {
    const cached = this.queryEmbeddingCache.get(query);
    if (cached) {
      // Move to end (most recently used)
      this.queryEmbeddingCache.delete(query);
      this.queryEmbeddingCache.set(query, cached);
      return cached;
    }

    const embedding = await this.embeddingService.embed(query, 'query');

    // Evict oldest if at capacity
    if (this.queryEmbeddingCache.size >= QUERY_CACHE_CAPACITY) {
      const oldest = this.queryEmbeddingCache.keys().next().value!;
      this.queryEmbeddingCache.delete(oldest);
    }
    this.queryEmbeddingCache.set(query, embedding);
    return embedding;
  }

  // --- In-Memory Vector Cache ---

  private async ensureVectorCache(): Promise<Map<string, CachedEmbedding[]>> {
    if (this.vectorCache) return this.vectorCache;

    const t0 = Date.now();
    const rows: any[] = await this.dataSource.query(
      `SELECT path, heading, chunk_text, embedding, source FROM note_embeddings`,
    );

    this.vectorCache = new Map();
    for (const row of rows) {
      const entry: CachedEmbedding = {
        path: row.path,
        heading: row.heading,
        chunkText: row.chunk_text,
        embedding: new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / 4,
        ),
        source: row.source as 'note' | 'comment',
      };
      const existing = this.vectorCache.get(row.path);
      if (existing) {
        existing.push(entry);
      } else {
        this.vectorCache.set(row.path, [entry]);
      }
    }

    this.logger.debug(`Vector cache loaded: ${rows.length} chunks in ${Date.now() - t0}ms`);
    return this.vectorCache;
  }

  // --- Vector Search ---

  async vectorSearch(query: string, limit: number, userEmail?: string): Promise<VectorResult[]> {
    if (!this.embeddingService.ready) {
      this.logger.debug('Vector search skipped: embedding service not ready');
      return [];
    }

    const t0 = Date.now();
    const queryEmbedding = await this.embedQuery(query);
    const embedMs = Date.now() - t0;

    const t1 = Date.now();
    const cache = await this.ensureVectorCache();
    const loadMs = Date.now() - t1;

    const t2 = Date.now();
    const grants = await this.grantSet(userEmail);
    const scored: { path: string; heading: string; chunkText: string; score: number; source: 'note' | 'comment' }[] = [];
    for (const entries of cache.values()) {
      for (const entry of entries) {
        // Predicate runs BEFORE the cosine compute — saves work and (more importantly)
        // never produces a score for a non-visible chunk that could leak via tied ordering.
        if (userEmail && !isVisibleTo(entry.path, userEmail) && !grants.has(entry.path)) continue;
        const score = cosineSimilarity(queryEmbedding, entry.embedding);
        scored.push({ path: entry.path, heading: entry.heading, chunkText: entry.chunkText, score, source: entry.source });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const scoreMs = Date.now() - t2;

    // Deduplicate by path+source — keep best chunk per note/comment, drop below threshold
    const seen = new Set<string>();
    const deduped: VectorResult[] = [];
    for (const item of scored) {
      if (item.score < VECTOR_COSINE_THRESHOLD) break;
      const key = `${item.path}:${item.source}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
      if (deduped.length >= limit) break;
    }

    const totalChunks = scored.length;
    this.logger.debug(
      `Vector search: ${totalChunks} chunks scored in ${embedMs + loadMs + scoreMs}ms ` +
        `(embed=${embedMs}ms, load=${loadMs}ms, score=${scoreMs}ms)`,
    );
    this.logger.debug(
      `Vector top-10: ${deduped.slice(0, 10).map((r) => `${r.path} [cos=${r.score.toFixed(4)}, chunk="${r.chunkText.slice(0, 60).replace(/\n/g, '\\n')}…"]`).join(', ')}`,
    );

    return deduped;
  }

  // --- Hybrid Search ---

  async search(query: string, source: 'frontend' | 'mcp' = 'frontend', userEmail?: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    this.logger.log(`Search: "${query}"`);
    const t0 = Date.now();

    const [ftsResults, commentFtsResults] = await Promise.all([
      this.ftsSearch(query, userEmail),
      this.commentFtsSearch(query, userEmail),
    ]);

    // Skip vector search for very short queries (FTS prefix matching is better)
    const skipVector = query.trim().length < MIN_VECTOR_QUERY_LENGTH;

    let merged: SearchResult[];

    // Graceful degradation: if embeddings not ready or query too short, return FTS-only
    if (!this.embeddingService.ready || skipVector) {
      if (!this.embeddingService.ready) {
        this.logger.warn(`Search returning FTS-only (embedding service not ready)`);
      } else {
        this.logger.debug(`Search returning FTS-only (query too short for vector search)`);
      }
      const mtimes = await this.collectMtimes(ftsResults, commentFtsResults, []);
      merged = this.mergeResults(ftsResults, commentFtsResults, [], mtimes);
    } else {
      let vectorResults: VectorResult[];
      try {
        vectorResults = await this.vectorSearch(query, 50, userEmail);
      } catch (err) {
        this.logger.error(`Vector search failed, falling back to FTS-only`, (err as Error).stack);
        const mtimes = await this.collectMtimes(ftsResults, commentFtsResults, []);
        merged = this.mergeResults(ftsResults, commentFtsResults, [], mtimes);
        this.trackSearchStats(query, merged, source);
        return merged;
      }

      const mtimes = await this.collectMtimes(ftsResults, commentFtsResults, vectorResults);
      merged = this.mergeResults(ftsResults, commentFtsResults, vectorResults, mtimes);
      this.logger.log(
        `Search complete in ${Date.now() - t0}ms: ${ftsResults.length} FTS + ${commentFtsResults.length} comment FTS + ${vectorResults.length} vector → ${merged.length} merged`,
      );
    }

    this.trackSearchStats(query, merged, source);
    return merged;
  }

  getVectorCacheStats(): { loaded: boolean; chunkCount: number; estimatedSizeBytes: number } {
    if (!this.vectorCache) return { loaded: false, chunkCount: 0, estimatedSizeBytes: 0 };
    let chunkCount = 0;
    for (const chunks of this.vectorCache.values()) chunkCount += chunks.length;
    return { loaded: true, chunkCount, estimatedSizeBytes: chunkCount * EMBEDDING_DIM * 4 };
  }

  getEmbeddingModelStatus(): { ready: boolean; modelName: string } {
    return { ready: this.embeddingService.ready, modelName: 'multilingual-e5-base' };
  }

  private trackSearchStats(query: string, results: SearchResult[], source: 'frontend' | 'mcp'): void {
    const empty = results.length === 0;
    this.dailyStatsService.trackSearch(empty);
    if (empty) {
      this.dailyStatsService.logFailedSearch(query, source).catch((err) => {
        this.logger.error('Failed to log failed search', err);
      });
    }
  }

  private async collectMtimes(
    ftsResults: SearchResult[],
    commentFtsResults: SearchResult[],
    vectorResults: VectorResult[],
  ): Promise<Map<string, Date>> {
    const paths = new Set<string>();
    for (const r of ftsResults) paths.add(r.path);
    for (const r of commentFtsResults) paths.add(r.path);
    for (const r of vectorResults) paths.add(r.path);

    const mtimes = new Map<string, Date>();
    if (!this.storage.stat) return mtimes;

    for (const p of paths) {
      try {
        const s = await this.storage.stat(p);
        mtimes.set(p, s.mtime);
      } catch {
        // File may have been deleted between search and stat
      }
    }
    return mtimes;
  }

  private mergeResults(
    ftsResults: SearchResult[],
    commentFtsResults: SearchResult[],
    vectorResults: VectorResult[],
    mtimes: Map<string, Date> = new Map(),
  ): SearchResult[] {
    const K = 20;
    const FTS_WEIGHT = 1.0;
    const VEC_WEIGHT = 1.5;
    // Comments are too short for embeddings to reliably pass cosine threshold,
    // so they rarely get a vector boost. Compensate by weighting comment FTS
    // as if it implied both keyword and semantic relevance.
    const COMMENT_FTS_WEIGHT = FTS_WEIGHT + VEC_WEIGHT;

    interface MergedEntry {
      rrfScore: number;
      snippet: string;
      heading?: string;
      type?: 'note' | 'comment';
      threadId?: string;
      commentAuthor?: string;
    }

    const scores = new Map<string, MergedEntry>();

    // Note FTS5 contribution
    for (let rank = 0; rank < ftsResults.length; rank++) {
      const r = ftsResults[rank];
      const rrfScore = FTS_WEIGHT * (1 / (K + rank + 1));
      scores.set(r.path, { rrfScore, snippet: r.snippet });
    }

    // Comment FTS5 contribution — keyed by path:threadId to avoid merging with note results
    for (let rank = 0; rank < commentFtsResults.length; rank++) {
      const r = commentFtsResults[rank];
      const rrfScore = COMMENT_FTS_WEIGHT * (1 / (K + rank + 1));
      const key = `${r.path}::comment::${r.threadId}`;
      scores.set(key, {
        rrfScore,
        snippet: r.snippet,
        type: 'comment',
        threadId: r.threadId,
        commentAuthor: r.commentAuthor,
      });
    }

    // Vector contribution (boosted) — rank note and comment vectors independently
    // so comment vectors aren't diluted by note vectors ahead of them
    const noteVectors = vectorResults.filter((r) => r.source === 'note');
    const commentVectors = vectorResults.filter((r) => r.source === 'comment');

    for (let rank = 0; rank < noteVectors.length; rank++) {
      const r = noteVectors[rank];
      const rrfScore = VEC_WEIGHT * (1 / (K + rank + 1));
      const existing = scores.get(r.path);
      if (existing) {
        existing.rrfScore += rrfScore;
        if (!existing.heading && r.heading) existing.heading = r.heading;
      } else {
        const snippet = r.chunkText.slice(0, 200);
        scores.set(r.path, { rrfScore, snippet, heading: r.heading || undefined });
      }
    }

    for (let rank = 0; rank < commentVectors.length; rank++) {
      const r = commentVectors[rank];
      const rrfScore = VEC_WEIGHT * (1 / (K + rank + 1));
      // Try to boost an existing comment FTS entry for same path, otherwise add new
      let boosted = false;
      for (const [key, entry] of scores) {
        if (key.startsWith(`${r.path}::comment::`) && entry.type === 'comment') {
          entry.rrfScore += rrfScore;
          boosted = true;
          break;
        }
      }
      if (!boosted) {
        const key = `${r.path}::comment::vec${rank}`;
        scores.set(key, {
          rrfScore,
          snippet: r.chunkText.slice(0, 200),
          type: 'comment',
        });
      }
    }

    // Apply recency boost: finalScore = rrfScore * (1 + 0.1 * exp(-daysSinceModified / 90))
    const now = Date.now();
    const merged = Array.from(scores.entries())
      .map(([key, v]) => {
        const p = v.type === 'comment' ? key.split('::comment::')[0] : key;
        let finalScore = v.rrfScore;
        const mtime = mtimes.get(p);
        if (mtime) {
          const daysSinceModified = (now - mtime.getTime()) / (1000 * 60 * 60 * 24);
          finalScore *= 1 + 0.1 * Math.exp(-daysSinceModified / 90);
        }
        return {
          path: p,
          snippet: v.snippet,
          score: finalScore,
          heading: v.heading,
          type: v.type,
          threadId: v.threadId,
          commentAuthor: v.commentAuthor,
        } as SearchResult;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    this.logger.debug(
      `RRF merged top-5: ${merged.slice(0, 5).map((r) => `${r.path} [rrf=${r.score.toFixed(4)}${r.type === 'comment' ? ' comment' : ''}]`).join(', ')}`,
    );

    return merged;
  }

  // --- Reindex ---

  async reindexAll(): Promise<number> {
    await this.dataSource.query(`DELETE FROM notes_fts`);
    await this.dataSource.query(`DELETE FROM comments_fts`);
    await this.dataSource.query(`DELETE FROM note_embeddings`);
    await this.dataSource.query(`DELETE FROM notes_fts_meta`);
    const files = await this.collectMarkdownFiles('');

    for (const filePath of files) {
      try {
        const content = await this.storage.read(filePath);
        await this.indexNote(filePath, content);
        if (this.storage.stat) {
          try {
            const s = await this.storage.stat(filePath);
            await this.setIndexedMtime(filePath, s.mtime);
          } catch {
            // ignore — heal sweep will catch up
          }
        }
        if (this.embeddingService.ready) {
          await this.indexNoteEmbeddings(filePath, content);
        }
        // Index comments from sidecar file
        await this.indexNoteComments(filePath);
        await this.indexCommentEmbeddings(filePath);
      } catch {
        // Skip files that can't be read
      }
    }
    await this.setSchemaVersion();
    return files.length;
  }

  /** Index embeddings for all notes in background (non-blocking). */
  private async indexAllEmbeddingsAsync(): Promise<void> {
    const files = await this.collectMarkdownFiles('');
    this.logger.log(`Indexing embeddings for ${files.length} notes in background...`);

    let indexed = 0;
    for (const filePath of files) {
      try {
        const content = await this.storage.read(filePath);
        await this.indexNoteEmbeddings(filePath, content);
        indexed++;
        if (indexed % 50 === 0) {
          this.logger.log(`Embedding progress: ${indexed}/${files.length}`);
        }
      } catch {
        // Skip
      }
    }
    await this.setSchemaVersion();
    this.logger.log(`Embedding indexing complete: ${indexed} notes indexed.`);
  }

  // --- Helpers ---

  private async collectMarkdownFiles(dir: string): Promise<string[]> {
    const entries = await this.storage.list(dir);
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'file' && entry.path.endsWith('.md')) {
        paths.push(entry.path);
      } else if (entry.type === 'directory' && entry.children) {
        paths.push(...this.collectChildMarkdownFiles(entry.children));
      }
    }
    return paths;
  }

  private collectChildMarkdownFiles(entries: FileEntry[]): string[] {
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'file' && entry.path.endsWith('.md')) {
        paths.push(entry.path);
      } else if (entry.type === 'directory' && entry.children) {
        paths.push(...this.collectChildMarkdownFiles(entry.children));
      }
    }
    return paths;
  }

  private extractTitle(filePath: string, content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
    return path.basename(filePath, '.md');
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
