import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  RELATED_DEFAULT_LIMIT,
  RELATED_MAX_LIMIT,
  RELATED_MIN_SCORE,
  bestChunkPair,
  clampRelatedLimit,
  cosine,
  excerptOf,
  isRelatedCandidatePath,
  meanVector,
  relatedMinScore,
  relatedNoteTitle,
} from './related-notes';

const v = (...xs: number[]) => Float32Array.from(xs);

describe('meanVector', () => {
  it('returns the L2-normalised mean', () => {
    const mean = meanVector([v(1, 0), v(0, 1)])!;
    assert.ok(Math.abs(mean[0] - Math.SQRT1_2) < 1e-6);
    assert.ok(Math.abs(mean[1] - Math.SQRT1_2) < 1e-6);
  });

  it('is independent of chunk count for identical chunks', () => {
    const one = meanVector([v(3, 4)])!;
    const three = meanVector([v(3, 4), v(3, 4), v(3, 4)])!;
    assert.deepEqual(Array.from(one), Array.from(three));
    assert.ok(Math.abs(one[0] - 0.6) < 1e-6 && Math.abs(one[1] - 0.8) < 1e-6);
  });

  it('returns null for no vectors or vectors that cancel out', () => {
    assert.equal(meanVector([]), null);
    assert.equal(meanVector([v(1, 0), v(-1, 0)]), null);
  });
});

describe('cosine', () => {
  it('handles unnormalised and zero vectors', () => {
    assert.ok(Math.abs(cosine(v(2, 0), v(5, 0)) - 1) < 1e-6);
    assert.equal(cosine(v(0, 0), v(1, 0)), 0);
  });
});

describe('bestChunkPair', () => {
  it('picks the pair with the highest cosine', () => {
    const source = [
      { heading: 'Rollout', chunkText: 'a', embedding: v(1, 0, 0) },
      { heading: 'Budget', chunkText: 'b', embedding: v(0, 0, 1) },
    ];
    const candidate = [
      { heading: 'Misc', chunkText: 'c', embedding: v(0, 1, 0) },
      { heading: 'Deployment', chunkText: 'd', embedding: v(0.9, 0.1, 0) },
    ];
    const best = bestChunkPair(source, candidate)!;
    assert.equal(best.source.heading, 'Rollout');
    assert.equal(best.candidate.heading, 'Deployment');
  });

  it('returns null when either side has no chunks', () => {
    assert.equal(bestChunkPair([], [{ heading: '', chunkText: '', embedding: v(1) }]), null);
  });
});

describe('isRelatedCandidatePath', () => {
  it('accepts notes, rejects attachments, dot-folders and non-markdown', () => {
    assert.equal(isRelatedCandidatePath('Notes/a.md'), true);
    assert.equal(isRelatedCandidatePath('_users/alice@example.com/a.md'), true);
    assert.equal(isRelatedCandidatePath('_attachments/readme.md'), false);
    assert.equal(isRelatedCandidatePath('_users/alice@example.com/_attachments/x.md'), false);
    assert.equal(isRelatedCandidatePath('.trash/Notes/a.md'), false);
    assert.equal(isRelatedCandidatePath('Notes/.obsidian/x.md'), false);
    assert.equal(isRelatedCandidatePath('Notes/image.png'), false);
  });
});

describe('relatedNoteTitle', () => {
  it('is the basename without .md', () => {
    assert.equal(relatedNoteTitle('Engineering/Deployment runbook.md'), 'Deployment runbook');
  });
});

describe('excerptOf', () => {
  it('drops heading lines and inline markdown', () => {
    const text = '# Title\n\n## Rolling out\n- Build the **image** and push it, see [[Release notes|notes]] and [docs](http://x).';
    assert.equal(excerptOf(text), 'Build the image and push it, see notes and docs.');
  });

  it('keeps intra-word underscores and emphasis-free text', () => {
    assert.equal(excerptOf('Set max_connections to 200.'), 'Set max_connections to 200.');
  });

  it('truncates on a word boundary with an ellipsis', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const out = excerptOf(words, 50);
    assert.ok(out.endsWith('…'));
    assert.ok(out.length <= 51);
    const kept = out.slice(0, -1);
    assert.ok(words.startsWith(`${kept} `), 'cut falls between two words');
  });
});

describe('clampRelatedLimit', () => {
  it('defaults, floors and caps', () => {
    assert.equal(clampRelatedLimit(undefined), RELATED_DEFAULT_LIMIT);
    assert.equal(clampRelatedLimit(''), RELATED_DEFAULT_LIMIT);
    assert.equal(clampRelatedLimit('abc'), RELATED_DEFAULT_LIMIT);
    assert.equal(clampRelatedLimit('0'), RELATED_DEFAULT_LIMIT);
    assert.equal(clampRelatedLimit(-3), RELATED_DEFAULT_LIMIT);
    assert.equal(clampRelatedLimit('3'), 3);
    assert.equal(clampRelatedLimit(7.9), 7);
    assert.equal(clampRelatedLimit('50'), RELATED_MAX_LIMIT);
  });
});

describe('relatedMinScore', () => {
  it('defaults to the calibrated floor and accepts a valid override', () => {
    assert.equal(relatedMinScore({}), RELATED_MIN_SCORE);
    assert.equal(relatedMinScore({ RELATED_NOTES_MIN_SCORE: '0.9' }), 0.9);
    assert.equal(relatedMinScore({ RELATED_NOTES_MIN_SCORE: 'nope' }), RELATED_MIN_SCORE);
    assert.equal(relatedMinScore({ RELATED_NOTES_MIN_SCORE: '3' }), RELATED_MIN_SCORE);
  });
});
