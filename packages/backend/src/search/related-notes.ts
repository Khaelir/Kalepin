import * as path from 'path';

export const RELATED_DEFAULT_LIMIT = 5;
export const RELATED_MAX_LIMIT = 20;

/**
 * Minimum mean-vector cosine for a note to count as related. e5 passage
 * similarities sit in a narrow, high band (≈0.82–0.91 for unrelated notes,
 * ≈0.87–0.95 for related ones on the calibration corpus — see
 * openspec/changes/add-related-notes/design.md). 0.88 drops clearly off-topic
 * notes while keeping ~95% of related ones. Override with RELATED_NOTES_MIN_SCORE.
 */
export const RELATED_MIN_SCORE = 0.88;

const EXCERPT_MAX_CHARS = 160;

export function relatedMinScore(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RELATED_NOTES_MIN_SCORE;
  if (raw === undefined || raw.trim() === '') return RELATED_MIN_SCORE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= -1 && n <= 1 ? n : RELATED_MIN_SCORE;
}

/** Default for missing / non-numeric / < 1 input; capped at RELATED_MAX_LIMIT. */
export function clampRelatedLimit(raw: unknown): number {
  const n = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return RELATED_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), RELATED_MAX_LIMIT);
}

/** L2-normalised mean of `vectors`; null when there are none or they cancel out. */
export function meanVector(vectors: readonly Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const mean = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += mean[i] * mean[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  for (let i = 0; i < dim; i++) mean[i] /= norm;
  return mean;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : d / denom;
}

export interface ChunkLike {
  heading: string;
  chunkText: string;
  embedding: Float32Array;
}

/** The (source chunk, candidate chunk) pair with the highest cosine similarity. */
export function bestChunkPair<T extends ChunkLike>(
  source: readonly T[],
  candidate: readonly T[],
): { source: T; candidate: T; score: number } | null {
  let best: { source: T; candidate: T; score: number } | null = null;
  for (const s of source) {
    for (const c of candidate) {
      const score = cosine(s.embedding, c.embedding);
      if (!best || score > best.score) best = { source: s, candidate: c, score };
    }
  }
  return best;
}

/**
 * Notes that may be offered as related: markdown only, never attachments, and
 * nothing under a dot-folder (`.trash/`, `.obsidian/` — the watcher ignores
 * those, so they should have no embeddings; this is the backstop).
 */
export function isRelatedCandidatePath(notePath: string): boolean {
  if (!notePath.endsWith('.md')) return false;
  return notePath.split('/').every((seg) => seg !== '_attachments' && !seg.startsWith('.'));
}

export function relatedNoteTitle(notePath: string): string {
  return path.posix.basename(notePath, '.md');
}

/** Plain-text excerpt of a chunk: heading lines and inline markdown dropped, whitespace collapsed. */
export function excerptOf(chunkText: string, max = EXCERPT_MAX_CHARS): string {
  const text = chunkText
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) => line.replace(/^\s*(?:>\s?)*(?:(?:[-*+]|\d+\.)\s+)?(?:\[[ xX]\]\s+)?/, ''))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
