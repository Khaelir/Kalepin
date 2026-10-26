import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { CachedEmbedding, SearchService } from './search.service';
import { isVisibleTo } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';
import {
  ENCRYPTION_PREDICATES,
  EncryptionPredicates,
} from '../crypto/encryption-predicates';
import { PinService } from '../pin';
import type { LinkIndexService } from '../links/link-index.service';
import {
  bestChunkPair,
  clampRelatedLimit,
  dot,
  excerptOf,
  isRelatedCandidatePath,
  meanVector,
  relatedMinScore,
  relatedNoteTitle,
} from './related-notes';

export interface RelatedNoteReason {
  /** Heading of the best-matching section of the related note ('' before any heading). */
  heading: string;
  /** Heading of the best-matching section of the source note. */
  sourceHeading: string;
  excerpt: string;
}

export interface RelatedNote {
  path: string;
  title: string;
  /** Cosine similarity of the two notes' mean vectors. */
  score: number;
  /** True when either note links to the other. */
  linked: boolean;
  /** Null when the related note is PIN-locked: its excerpt would bypass the PIN. */
  reason: RelatedNoteReason | null;
}

export interface RelatedNotesResult {
  /** False when the embedding model isn't loaded or the source note is end-to-end encrypted. */
  available: boolean;
  items: RelatedNote[];
}

/**
 * Semantic neighbours of a note: compares the note's mean chunk vector with
 * every other note's, behind the same visibility predicate as vectorSearch.
 */
@Injectable()
export class RelatedNotesService implements OnModuleInit {
  // Per-note L2-normalised mean of its note-chunk embeddings. Filled lazily
  // from SearchService's chunk cache; entries drop whenever the note's
  // embeddings are written or removed.
  private meanVectors = new Map<string, Float32Array>();

  constructor(
    private readonly searchService: SearchService,
    private readonly embeddingService: EmbeddingService,
    private readonly visibility: GrantAwareVisibility,
    private readonly pinService: PinService,
    @Inject(ENCRYPTION_PREDICATES)
    private readonly predicates: EncryptionPredicates,
    @Optional() @Inject('LINK_INDEX_SERVICE')
    private readonly linkIndex?: LinkIndexService,
  ) {}

  onModuleInit(): void {
    this.searchService.onNoteEmbeddingsChanged((notePath) => this.invalidate(notePath));
  }

  /** Drop one note's cached mean vector, or all of them (`null`). */
  invalidate(notePath: string | null): void {
    if (notePath === null) {
      this.meanVectors.clear();
    } else {
      this.meanVectors.delete(notePath);
    }
  }

  /** Test-only — number of cached mean vectors. */
  cachedMeanCount(): number {
    return this.meanVectors.size;
  }

  /**
   * Notes most similar to `sourcePath`. Throws NotFound when `userEmail` cannot
   * read the source; answers `available: false` instead of failing when the
   * model is missing or the note is end-to-end encrypted.
   */
  async findRelated(
    sourcePath: string,
    opts: { limit?: number; userEmail?: string } = {},
  ): Promise<RelatedNotesResult> {
    const email = opts.userEmail;
    if (email) await this.visibility.assertReadableBy(sourcePath, email);
    if (!this.embeddingService.ready) return { available: false, items: [] };
    if (!this.predicates.shouldIndexPlaintext(sourcePath)) return { available: false, items: [] };

    const limit = clampRelatedLimit(opts.limit);
    const minScore = relatedMinScore();
    const grants = email ? await this.visibility.visibleGrantSet(email) : new Set<string>();
    const cache = await this.searchService.getNoteChunkVectors();

    // No awaits from here until the reasons are built, so every mean comes
    // from the chunk entries current at this point.
    const sourceMean = this.meanFor(sourcePath, cache.get(sourcePath));
    if (!sourceMean) return { available: true, items: [] };

    const scored: { path: string; score: number }[] = [];
    for (const [candidatePath, entries] of cache) {
      if (candidatePath === sourcePath) continue;
      if (!isRelatedCandidatePath(candidatePath)) continue;
      if (!this.predicates.shouldIndexPlaintext(candidatePath)) continue;
      // Gate before scoring, as vectorSearch does: a hidden note never gets a score.
      if (email && !isVisibleTo(candidatePath, email) && !grants.has(candidatePath)) continue;
      const mean = this.meanFor(candidatePath, entries);
      if (!mean) continue;
      const score = dot(sourceMean, mean);
      if (score >= minScore) scored.push({ path: candidatePath, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    if (top.length === 0) return { available: true, items: [] };

    const sourceChunks = noteChunks(cache.get(sourcePath));
    const withPairs = top.map((t) => ({
      ...t,
      pair: bestChunkPair(sourceChunks, noteChunks(cache.get(t.path))),
    }));

    const linked = (await this.linkIndex?.getLinkedPaths(sourcePath)) ?? new Set<string>();
    const items = await Promise.all(withPairs.map(async ({ path, score, pair }): Promise<RelatedNote> => {
      const locked = await this.pinService.hasPin(path);
      return {
        path,
        title: relatedNoteTitle(path),
        score,
        linked: linked.has(path),
        reason: pair && !locked
          ? {
            heading: pair.candidate.heading,
            sourceHeading: pair.source.heading,
            excerpt: excerptOf(pair.candidate.chunkText),
          }
          : null,
      };
    }));
    return { available: true, items };
  }

  private meanFor(
    notePath: string,
    entries: readonly CachedEmbedding[] | undefined,
  ): Float32Array | null {
    if (!entries) return null;
    const cached = this.meanVectors.get(notePath);
    if (cached) return cached;
    const mean = meanVector(noteChunks(entries).map((e) => e.embedding));
    if (mean) this.meanVectors.set(notePath, mean);
    return mean;
  }
}

function noteChunks(entries: readonly CachedEmbedding[] | undefined): CachedEmbedding[] {
  return entries ? entries.filter((e) => e.source === 'note') : [];
}
