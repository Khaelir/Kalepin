import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { OTOperation } from '@kalepin/shared';
import { apply, transform } from './ot-engine';
import { diffToOps } from './text-diff';

function inputLength(op: OTOperation): number {
  return op.reduce((n, c) => n + (c.type === 'insert' ? 0 : c.count), 0);
}

function roundTrip(oldText: string, newText: string): OTOperation {
  const op = diffToOps(oldText, newText);
  assert.ok(op, 'a change gives an op');
  assert.equal(apply(oldText, op), newText);
  assert.equal(inputLength(op), oldText.length, 'the op spans the whole old text');
  return op;
}

/** Deterministic pseudo-random numbers, so a failure can be replayed. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe('diffToOps', () => {
  it('returns null for equal texts', () => {
    assert.equal(diffToOps('', ''), null);
    assert.equal(diffToOps('same\n', 'same\n'), null);
  });

  it('turns the old text into the new one', () => {
    roundTrip('', 'hello');
    roundTrip('hello', '');
    roundTrip('hello', 'help');
    roundTrip('a\nb\nc', 'a\nb\nc\n');
    roundTrip('a\r\nb\r\n', 'a\r\nB\r\n');
    roundTrip('# Title\n\nSome text.\n', '# Title\n\nSome more text.\n\n- item\n');
    roundTrip('😀 smile\n', '😃 smile\n');
  });

  it('turns random texts into each other', () => {
    const random = rng(42);
    const pieces = ['a', 'b', '\n', ' ', 'line\n', '# h\n', '😀', '\r\n'];
    const text = (n: number) => Array.from({ length: n }, () => pieces[Math.floor(random() * pieces.length)]).join('');
    for (let i = 0; i < 500; i++) {
      roundTrip(text(Math.floor(random() * 40)), text(Math.floor(random() * 40)));
    }
  });

  it('keeps edits far apart as separate regions', () => {
    const op = roundTrip('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\nE\n');
    assert.deepEqual(op, [
      { type: 'delete', count: 1 },
      { type: 'insert', text: 'A' },
      { type: 'retain', count: 7 },
      { type: 'delete', count: 1 },
      { type: 'insert', text: 'E' },
      { type: 'retain', count: 1 },
    ]);
  });

  it('lets a concurrent edit between two changed lines keep its place', () => {
    const base = 'top\nmiddle\nbottom\n';
    const external = diffToOps(base, 'TOP\nmiddle\nBOTTOM\n')!;
    const local = diffToOps(base, 'top\nmiddle!\nbottom\n')!;
    const [externalAfterLocal] = transform(external, local);
    assert.equal(apply('top\nmiddle!\nbottom\n', externalAfterLocal), 'TOP\nmiddle!\nBOTTOM\n');
  });

  it('falls back to one replaced region for a huge rewrite', () => {
    const lines = (prefix: string) => Array.from({ length: 5_000 }, (_, i) => `${prefix}${i}\n`).join('');
    roundTrip(lines('a'), lines('b'));
  });
});
