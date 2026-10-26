import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { FileWatcherService } from '../files/file-watcher.service';
import { NoteLink } from '../entities';
import { FileEntry } from '@kalepin/shared';
import { parseLinksFromMarkdown, resolveWikilink, resolveMarkdownLink } from './link-parser';
import { OTService } from '../ot/ot.service';
import { isVisibleTo } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import { escapeLike } from '../auth/like-escape';
import * as path from 'path';
import * as WebSocket from 'ws';

export interface BacklinkEntry {
  sourcePath: string;
  lineNumber: number;
  context: string | null;
  linkType: 'wikilink' | 'markdown';
}

export interface OutgoingLinkEntry {
  targetPath: string | null;
  rawTarget: string;
  lineNumber: number;
  linkType: 'wikilink' | 'markdown';
}

export interface UnlinkedMentionEntry {
  sourcePath: string;
  lineNumber: number;
  context: string;
}

export interface GraphNode {
  path: string;
  title: string;
  inCount: number;
  outCount: number;
  lastModified: string | null;
  isBroken?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const LINK_HEAL_SWEEP_INTERVAL_MS = 10 * 60_000;

@Injectable()
export class LinkIndexService {
  private readonly logger = new Logger(LinkIndexService.name);
  private allPaths: string[] = [];
  private healSweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Callback set by OT gateway to broadcast operations to clients. */
  private otBroadcast?: (docId: string, ops: unknown, rev: number, exclude?: WebSocket) => void;

  constructor(
    @InjectRepository(NoteLink) private readonly linkRepo: Repository<NoteLink>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileWatcher: FileWatcherService,
    @Optional() @Inject(OTService) private readonly otService?: OTService,
    @Optional() private readonly visibility?: GrantAwareVisibility,
  ) {}

  private async grantSet(userEmail?: string): Promise<Set<string>> {
    if (!userEmail || !this.visibility) return new Set();
    return this.visibility.visibleGrantSet(userEmail);
  }

  /** Set the broadcast function so rename ops can be pushed to WebSocket clients. */
  setOTBroadcast(fn: (docId: string, ops: unknown, rev: number, exclude?: WebSocket) => void) {
    this.otBroadcast = fn;
  }

  async onModuleInit() {
    // Build path list
    this.allPaths = await this.collectMarkdownFiles('');

    await this.createMetaTable();

    // Full scan if table is empty
    const count = await this.linkRepo.count();
    if (count === 0) {
      await this.fullScan();
    }

    // Subscribe to file watcher for incremental updates
    this.fileWatcher.onFileChange(async (event) => {
      if (!event.path.endsWith('.md')) return;

      if (event.event === 'add') {
        // Add to path list
        if (!this.allPaths.includes(event.path)) {
          this.allPaths.push(event.path);
        }
        try {
          const content = await this.storage.read(event.path);
          await this.indexFile(event.path, content);
          await this.setIndexedMtimeFromDisk(event.path);
        } catch {
          // File might be gone
        }
      } else if (event.event === 'change') {
        try {
          const content = await this.storage.read(event.path);
          await this.indexFile(event.path, content);
          await this.setIndexedMtimeFromDisk(event.path);
        } catch {
          // File might be gone
        }
      } else if (event.event === 'unlink') {
        this.allPaths = this.allPaths.filter((p) => p !== event.path);
        await this.removeFile(event.path);
        await this.clearIndexedMtime(event.path);
      }
    });

    // Internal-write fast path: indexer consumes content with no disk read.
    this.fileWatcher.onInternalWrite(async (notePath, content) => {
      if (!notePath.endsWith('.md')) return;
      if (!this.allPaths.includes(notePath)) {
        this.allPaths.push(notePath);
      }
      try {
        await this.indexFile(notePath, content);
        await this.setIndexedMtimeFromDisk(notePath);
      } catch (err) {
        this.logger.warn(
          `internal-write index update failed for "${notePath}": ${(err as Error).message}`,
        );
      }
    });

    // Heal sweep — every 10 min, reconcile link index against disk.
    this.healSweepTimer = setInterval(() => {
      this.healSweep().catch((err) => {
        this.logger.warn(`heal sweep failed: ${(err as Error).message}`);
      });
    }, LINK_HEAL_SWEEP_INTERVAL_MS);
    this.healSweepTimer.unref?.();
  }

  private async createMetaTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS note_links_meta (
        path TEXT PRIMARY KEY,
        indexed_mtime INTEGER
      )
    `);
  }

  private async setIndexedMtimeFromDisk(filePath: string): Promise<void> {
    if (!this.storage.stat) return;
    try {
      const s = await this.storage.stat(filePath);
      await this.dataSource.query(
        `INSERT INTO note_links_meta (path, indexed_mtime) VALUES (?, ?)
           ON CONFLICT(path) DO UPDATE SET indexed_mtime = excluded.indexed_mtime`,
        [filePath, s.mtime.getTime()],
      );
    } catch {
      // ignore
    }
  }

  private async clearIndexedMtime(filePath: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM note_links_meta WHERE path = ?`, [filePath]);
  }

  /**
   * Reconcile the link index against on-disk state. Re-parses any path whose
   * disk mtime exceeds `indexed_mtime` (or where `indexed_mtime` is NULL) and
   * removes link records for paths that no longer exist on disk.
   */
  async healSweep(): Promise<{ reindexed: number; removed: number }> {
    const rows: { path: string; indexed_mtime: number | null }[] = await this.dataSource.query(
      `SELECT path, indexed_mtime FROM note_links_meta`,
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
            await this.indexFile(row.path, content);
            await this.dataSource.query(
              `UPDATE note_links_meta SET indexed_mtime = ? WHERE path = ?`,
              [diskMs, row.path],
            );
            reindexed++;
          } catch {
            // skip; next sweep retries
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          await this.removeFile(row.path);
          await this.clearIndexedMtime(row.path);
          this.allPaths = this.allPaths.filter((p) => p !== row.path);
          removed++;
        }
      }
    }
    if (reindexed > 0 || removed > 0) {
      this.logger.log(`heal sweep: reindexed=${reindexed}, removed=${removed}`);
    }
    return { reindexed, removed };
  }

  async indexFile(filePath: string, content: string): Promise<void> {
    // Delete existing links from this source
    await this.linkRepo.delete({ sourcePath: filePath });

    // Parse and resolve links
    const parsed = parseLinksFromMarkdown(content);
    const links: NoteLink[] = [];

    for (const link of parsed) {
      const noteLink = new NoteLink();
      noteLink.sourcePath = filePath;
      noteLink.rawTarget = link.rawTarget;
      noteLink.linkType = link.linkType;
      noteLink.lineNumber = link.lineNumber;
      noteLink.context = link.context;

      if (link.linkType === 'wikilink') {
        noteLink.targetPath = resolveWikilink(link.rawTarget, filePath, this.allPaths);
      } else {
        noteLink.targetPath = resolveMarkdownLink(link.rawTarget, filePath);
        // Verify target exists
        if (!this.allPaths.includes(noteLink.targetPath)) {
          noteLink.targetPath = null;
        }
      }

      links.push(noteLink);
    }

    if (links.length > 0) {
      await this.linkRepo.save(links);
    }
  }

  async fullScan(): Promise<void> {
    this.logger.log('Starting full vault link scan...');
    const t0 = Date.now();
    this.allPaths = await this.collectMarkdownFiles('');
    await this.createMetaTable();
    await this.dataSource.query(`DELETE FROM note_links_meta`);

    let indexed = 0;
    for (const filePath of this.allPaths) {
      try {
        const content = await this.storage.read(filePath);
        await this.indexFile(filePath, content);
        await this.setIndexedMtimeFromDisk(filePath);
        indexed++;
      } catch {
        // Skip unreadable files
      }
    }
    this.logger.log(`Full link scan complete: ${indexed} files indexed in ${Date.now() - t0}ms`);
  }

  async removeFile(filePath: string): Promise<void> {
    await this.linkRepo.delete({ sourcePath: filePath });
  }

  async getBacklinks(targetPath: string, userEmail?: string): Promise<BacklinkEntry[]> {
    const links = await this.linkRepo.find({ where: { targetPath } });
    const grants = await this.grantSet(userEmail);
    return links
      .filter((l) => !userEmail || isVisibleTo(l.sourcePath, userEmail) || grants.has(l.sourcePath))
      .map((l) => ({
        sourcePath: l.sourcePath,
        lineNumber: l.lineNumber,
        context: l.context,
        linkType: l.linkType,
      }));
  }

  async getOutgoingLinks(sourcePath: string, userEmail?: string): Promise<OutgoingLinkEntry[]> {
    const links = await this.linkRepo.find({ where: { sourcePath } });
    const grants = await this.grantSet(userEmail);
    return links
      .filter((l) =>
        !userEmail
        || l.targetPath === null
        || isVisibleTo(l.targetPath, userEmail)
        || grants.has(l.targetPath),
      )
      .map((l) => ({
        targetPath: l.targetPath,
        rawTarget: l.rawTarget,
        lineNumber: l.lineNumber,
        linkType: l.linkType,
      }));
  }

  /**
   * Paths linked with `notePath` in either direction: resolved outgoing targets
   * plus backlink sources. Not visibility-filtered — callers use it to flag
   * paths they have already gated.
   */
  async getLinkedPaths(notePath: string): Promise<Set<string>> {
    const [outgoing, incoming] = await Promise.all([
      this.linkRepo.find({ where: { sourcePath: notePath } }),
      this.linkRepo.find({ where: { targetPath: notePath } }),
    ]);
    const linked = new Set<string>();
    for (const l of outgoing) if (l.targetPath) linked.add(l.targetPath);
    for (const l of incoming) linked.add(l.sourcePath);
    return linked;
  }

  async getUnlinkedMentions(targetPath: string, userEmail?: string): Promise<UnlinkedMentionEntry[]> {
    // Derive title from filename
    const title = path.basename(targetPath, '.md');
    if (!title) return [];

    // Query FTS5 for notes mentioning the title — gated by viewer's visibility.
    const ftsQuery = `"${title}"`;
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
    let ftsResults: any[];
    try {
      ftsResults = await this.dataSource.query(
        `SELECT path, content FROM notes_fts WHERE notes_fts MATCH ? ${visibilityClause} LIMIT 200`,
        params,
      );
    } catch {
      return [];
    }

    // Get all notes that already link to this target
    const existingLinks = await this.linkRepo.find({ where: { targetPath } });
    const linkedSources = new Set(existingLinks.map((l) => l.sourcePath));

    const mentions: UnlinkedMentionEntry[] = [];

    for (const row of ftsResults) {
      // Skip self
      if (row.path === targetPath) continue;
      // Skip notes that already link to this file
      if (linkedSources.has(row.path)) continue;

      // Post-filter: check for contiguous phrase match (case-insensitive)
      const content: string = row.content;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(title.toLowerCase())) {
          mentions.push({
            sourcePath: row.path,
            lineNumber: i + 1,
            context: lines[i],
          });
          break; // One mention per source file
        }
      }
    }

    return mentions;
  }

  async convertMention(sourcePath: string, lineNumber: number, title: string): Promise<void> {
    const content = await this.storage.read(sourcePath);
    const lines = content.split('\n');
    const idx = lineNumber - 1;
    if (idx < 0 || idx >= lines.length) return;

    // Replace first occurrence of title on the specified line with [[title]]
    const line = lines[idx];
    const pos = line.toLowerCase().indexOf(title.toLowerCase());
    if (pos === -1) return;

    // Preserve original casing from the document
    const originalText = line.substring(pos, pos + title.length);
    lines[idx] = line.substring(0, pos) + `[[${originalText}]]` + line.substring(pos + title.length);

    await this.storage.write(sourcePath, lines.join('\n'));
  }

  // --- Rename support ---

  async rewriteLinksOnRename(oldPath: string, newPath: string): Promise<void> {
    // Find all notes that link to the old path
    const linksToOld = await this.linkRepo.find({ where: { targetPath: oldPath } });
    if (linksToOld.length === 0) return;

    const oldBasename = path.basename(oldPath, '.md');
    const newBasename = path.basename(newPath, '.md');

    for (const link of linksToOld) {
      try {
        // Compute the old and new text for this link
        let oldText: string;
        let newText: string;

        if (link.linkType === 'wikilink') {
          const newTarget = link.rawTarget.includes('/')
            ? link.rawTarget.replace(oldBasename, newBasename)
            : newBasename;
          // For OT replacement we match exact wikilink text (without alias part)
          oldText = `[[${link.rawTarget}`;
          newText = `[[${newTarget}`;
        } else {
          const sourceDir = path.dirname(link.sourcePath);
          const newRelative = path.posix.relative(sourceDir, newPath);
          oldText = `](${link.rawTarget})`;
          newText = `](${newRelative})`;
        }

        // Check if source file has an active OT session
        const session = this.otService?.sessionManager?.getSession(link.sourcePath);
        if (session) {
          // Emit OT operation instead of writing to disk
          const result = await this.otService!.applyServerReplacement(
            link.sourcePath,
            oldText,
            newText,
          );
          if (result) {
            this.otBroadcast?.(link.sourcePath, result.ops, result.revision);
          }
        } else {
          // No active session — read-replace-write to disk
          const content = await this.storage.read(link.sourcePath);
          let updated = content;

          if (link.linkType === 'wikilink') {
            const escapedRaw = link.rawTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const wikilinkRegex = new RegExp(`\\[\\[${escapedRaw}(\\|[^\\]]*)?\\]\\]`, 'g');
            updated = updated.replace(wikilinkRegex, (_match, alias) => {
              const newTarget = link.rawTarget.includes('/')
                ? link.rawTarget.replace(oldBasename, newBasename)
                : newBasename;
              return `[[${newTarget}${alias || ''}]]`;
            });
          } else {
            const sourceDir = path.dirname(link.sourcePath);
            const newRelative = path.posix.relative(sourceDir, newPath);
            const escapedRaw = link.rawTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const mdLinkRegex = new RegExp(`(\\[[^\\]]*\\])\\(${escapedRaw}\\)`, 'g');
            updated = updated.replace(mdLinkRegex, `$1(${newRelative})`);
          }

          if (updated !== content) {
            await this.storage.write(link.sourcePath, updated);
          }
        }
      } catch {
        this.logger.warn(`Failed to rewrite links in ${link.sourcePath}`);
      }
    }

    // Update target_path entries in the index
    await this.linkRepo
      .createQueryBuilder()
      .update(NoteLink)
      .set({ targetPath: newPath })
      .where('targetPath = :oldPath', { oldPath })
      .execute();

    // Update allPaths
    this.allPaths = this.allPaths.map((p) => (p === oldPath ? newPath : p));
  }

  async getGraphData(centerPath?: string, depth = 2, userEmail?: string): Promise<GraphData> {
    // Get all links, then drop any whose endpoints aren't visible to the viewer.
    const allLinksRaw = await this.linkRepo.find();
    const grants = await this.grantSet(userEmail);
    const visible = (p: string | null) =>
      !userEmail || p === null || isVisibleTo(p, userEmail) || grants.has(p);
    const allLinks = allLinksRaw.filter(
      (l) => visible(l.sourcePath) && visible(l.targetPath),
    );

    // Build adjacency lists (bidirectional for BFS traversal)
    const outEdges = new Map<string, Set<string>>();
    const inEdges = new Map<string, Set<string>>();
    const brokenTargets = new Map<string, string>(); // rawTarget -> sourcePath

    for (const link of allLinks) {
      if (link.targetPath) {
        if (!outEdges.has(link.sourcePath)) outEdges.set(link.sourcePath, new Set());
        outEdges.get(link.sourcePath)!.add(link.targetPath);
        if (!inEdges.has(link.targetPath)) inEdges.set(link.targetPath, new Set());
        inEdges.get(link.targetPath)!.add(link.sourcePath);
      } else {
        // Broken link — track it
        brokenTargets.set(link.rawTarget, link.sourcePath);
      }
    }

    // Determine which paths to include
    let includedPaths: Set<string>;

    if (centerPath) {
      // BFS from centerPath up to depth hops (following both directions)
      includedPaths = new Set<string>();
      const queue: { p: string; d: number }[] = [{ p: centerPath, d: 0 }];
      includedPaths.add(centerPath);

      while (queue.length > 0) {
        const { p, d } = queue.shift()!;
        if (d >= depth) continue;

        const neighbors = new Set<string>();
        for (const n of outEdges.get(p) || []) neighbors.add(n);
        for (const n of inEdges.get(p) || []) neighbors.add(n);

        for (const n of neighbors) {
          if (!includedPaths.has(n)) {
            includedPaths.add(n);
            queue.push({ p: n, d: d + 1 });
          }
        }
      }
    } else {
      // Full vault — all paths that appear as source or target, gated by viewer.
      includedPaths = new Set<string>();
      for (const p of this.allPaths) {
        if (visible(p)) includedPaths.add(p);
      }
      for (const link of allLinks) {
        if (link.targetPath && visible(link.targetPath)) includedPaths.add(link.targetPath);
      }
    }

    // Get last-modified timestamps from note_changes — only for visible paths.
    const lastModifiedMap = new Map<string, string>();
    if (includedPaths.size > 0) {
      const rows: { path: string; lastMod: string }[] = await this.dataSource.query(
        `SELECT path, MAX(createdAt) as lastMod FROM note_changes WHERE action != 'deleted' GROUP BY path`,
      );
      for (const row of rows) {
        if (visible(row.path)) lastModifiedMap.set(row.path, row.lastMod);
      }
    }

    // Count in/out links per node
    const inCountMap = new Map<string, number>();
    const outCountMap = new Map<string, number>();
    for (const link of allLinks) {
      if (link.targetPath) {
        outCountMap.set(link.sourcePath, (outCountMap.get(link.sourcePath) || 0) + 1);
        inCountMap.set(link.targetPath, (inCountMap.get(link.targetPath) || 0) + 1);
      }
    }

    // Build nodes
    const nodes: GraphNode[] = [];
    for (const p of includedPaths) {
      nodes.push({
        path: p,
        title: path.basename(p, '.md'),
        inCount: inCountMap.get(p) || 0,
        outCount: outCountMap.get(p) || 0,
        lastModified: lastModifiedMap.get(p) || null,
      });
    }

    // Add ghost nodes for broken links whose source is included
    if (centerPath) {
      for (const link of allLinks) {
        if (!link.targetPath && includedPaths.has(link.sourcePath)) {
          const ghostId = `broken:${link.rawTarget}`;
          if (!nodes.some((n) => n.path === ghostId)) {
            nodes.push({
              path: ghostId,
              title: link.rawTarget,
              inCount: 0,
              outCount: 0,
              lastModified: null,
              isBroken: true,
            });
          }
        }
      }
    }

    // Build edges (only between included nodes)
    const edges: GraphEdge[] = [];
    const nodeSet = new Set(nodes.map((n) => n.path));
    for (const link of allLinks) {
      if (link.targetPath && nodeSet.has(link.sourcePath) && nodeSet.has(link.targetPath)) {
        edges.push({ source: link.sourcePath, target: link.targetPath });
      } else if (!link.targetPath && nodeSet.has(link.sourcePath)) {
        const ghostId = `broken:${link.rawTarget}`;
        if (nodeSet.has(ghostId)) {
          edges.push({ source: link.sourcePath, target: ghostId });
        }
      }
    }

    // Deduplicate edges
    const edgeSet = new Set<string>();
    const uniqueEdges = edges.filter((e) => {
      const key = `${e.source}->${e.target}`;
      if (edgeSet.has(key)) return false;
      edgeSet.add(key);
      return true;
    });

    return { nodes, edges: uniqueEdges };
  }

  private async collectMarkdownFiles(dir: string): Promise<string[]> {
    const entries = await this.storage.list(dir);
    return this.flattenMarkdownFiles(entries);
  }

  private flattenMarkdownFiles(entries: FileEntry[]): string[] {
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.type === 'file' && entry.path.endsWith('.md')) {
        paths.push(entry.path);
      } else if (entry.type === 'directory' && entry.children) {
        paths.push(...this.flattenMarkdownFiles(entry.children));
      }
    }
    return paths;
  }
}
