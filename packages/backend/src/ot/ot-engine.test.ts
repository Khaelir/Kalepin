import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { apply, compose } from './ot-engine';
import type { OTOperation } from '../../../shared/src/ot';

describe('compose', () => {
  it('retain + retain', () => {
    const a: OTOperation = [{ type: 'retain', count: 5 }];
    const b: OTOperation = [{ type: 'retain', count: 5 }];
    const c = compose(a, b);
    assert.deepStrictEqual(c, [{ type: 'retain', count: 5 }]);
  });

  it('insert + retain (identity)', () => {
    const a: OTOperation = [{ type: 'insert', text: 'hello' }];
    const b: OTOperation = [{ type: 'retain', count: 5 }];
    const c = compose(a, b);
    assert.deepStrictEqual(c, [{ type: 'insert', text: 'hello' }]);
  });

  it('insert + delete cancels out', () => {
    const a: OTOperation = [{ type: 'insert', text: 'hello' }];
    const b: OTOperation = [{ type: 'delete', count: 5 }];
    const c = compose(a, b);
    assert.deepStrictEqual(c, []);
  });

  it('insert + partial delete', () => {
    const a: OTOperation = [{ type: 'insert', text: 'hello' }];
    const b: OTOperation = [{ type: 'delete', count: 3 }, { type: 'retain', count: 2 }];
    const c = compose(a, b);
    assert.deepStrictEqual(c, [{ type: 'insert', text: 'lo' }]);
  });

  it('retain + delete', () => {
    const a: OTOperation = [{ type: 'retain', count: 5 }];
    const b: OTOperation = [{ type: 'delete', count: 5 }];
    const c = compose(a, b);
    assert.deepStrictEqual(c, [{ type: 'delete', count: 5 }]);
  });

  it('delete passes through from a', () => {
    const a: OTOperation = [
      { type: 'delete', count: 3 },
      { type: 'retain', count: 2 },
    ];
    const b: OTOperation = [{ type: 'retain', count: 2 }];
    const c = compose(a, b);
    assert.deepStrictEqual(c, [
      { type: 'delete', count: 3 },
      { type: 'retain', count: 2 },
    ]);
  });

  it('insert from b passes through', () => {
    const a: OTOperation = [{ type: 'retain', count: 3 }];
    const b: OTOperation = [
      { type: 'retain', count: 3 },
      { type: 'insert', text: '!' },
    ];
    const c = compose(a, b);
    assert.deepStrictEqual(c, [
      { type: 'retain', count: 3 },
      { type: 'insert', text: '!' },
    ]);
  });

  // The fundamental property: apply(apply(doc, a), b) === apply(doc, compose(a, b))
  describe('composition property: apply(apply(doc, a), b) === apply(doc, compose(a, b))', () => {
    const cases: { name: string; doc: string; a: OTOperation; b: OTOperation }[] = [
      {
        name: 'two inserts at start',
        doc: 'hello',
        a: [{ type: 'insert', text: 'A' }, { type: 'retain', count: 5 }],
        b: [{ type: 'insert', text: 'B' }, { type: 'retain', count: 6 }],
      },
      {
        name: 'insert then delete',
        doc: 'hello',
        a: [{ type: 'insert', text: 'X' }, { type: 'retain', count: 5 }],
        b: [{ type: 'delete', count: 1 }, { type: 'retain', count: 5 }],
      },
      {
        name: 'delete then insert',
        doc: 'hello',
        a: [{ type: 'delete', count: 2 }, { type: 'retain', count: 3 }],
        b: [{ type: 'insert', text: 'HE' }, { type: 'retain', count: 3 }],
      },
      {
        name: 'delete over delete',
        doc: 'hello world',
        a: [{ type: 'delete', count: 5 }, { type: 'retain', count: 6 }],
        b: [{ type: 'delete', count: 1 }, { type: 'retain', count: 5 }],
      },
      {
        name: 'multiple mixed operations',
        doc: 'abcdef',
        a: [
          { type: 'retain', count: 2 },
          { type: 'insert', text: 'XY' },
          { type: 'delete', count: 1 },
          { type: 'retain', count: 3 },
        ],
        b: [
          { type: 'retain', count: 3 },
          { type: 'delete', count: 1 },
          { type: 'retain', count: 3 },
        ],
      },
      {
        name: 'empty operations',
        doc: 'test',
        a: [{ type: 'retain', count: 4 }],
        b: [{ type: 'retain', count: 4 }],
      },
    ];

    for (const { name, doc, a, b } of cases) {
      it(name, () => {
        const sequential = apply(apply(doc, a), b);
        const composed = apply(doc, compose(a, b));
        assert.strictEqual(composed, sequential);
      });
    }
  });
});
