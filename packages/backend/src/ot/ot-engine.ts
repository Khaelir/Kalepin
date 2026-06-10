import { OTOperation, OTOpComponent } from '@kalepin/shared';

/** Returns the total length consumed by an operation on the input string. */
function inputLength(op: OTOperation): number {
  let len = 0;
  for (const c of op) {
    if (c.type === 'retain') len += c.count;
    else if (c.type === 'delete') len += c.count;
    // insert doesn't consume input
  }
  return len;
}

/** Apply an operation to a document string. */
export function apply(doc: string, op: OTOperation): string {
  let result = '';
  let pos = 0;

  for (const c of op) {
    switch (c.type) {
      case 'retain':
        result += doc.slice(pos, pos + c.count);
        pos += c.count;
        break;
      case 'insert':
        result += c.text;
        break;
      case 'delete':
        pos += c.count;
        break;
    }
  }

  // Append any remaining text
  result += doc.slice(pos);
  return result;
}

/**
 * Transform two concurrent operations so they can be applied in sequence.
 * Given operations A and B that were both based on the same document state,
 * returns [A', B'] such that apply(apply(doc, A), B') === apply(apply(doc, B), A').
 */
export function transform(
  opA: OTOperation,
  opB: OTOperation,
): [OTOperation, OTOperation] {
  const aPrime: OTOperation = [];
  const bPrime: OTOperation = [];

  let ia = 0;
  let ib = 0;

  while (ia < opA.length || ib < opB.length) {
    const a = opA[ia];
    const b = opB[ib];

    // If A inserts, it goes into A' and B' retains over it
    if (a && a.type === 'insert') {
      aPrime.push(a);
      bPrime.push({ type: 'retain', count: a.text.length });
      ia++;
      continue;
    }

    // If B inserts, it goes into B' and A' retains over it
    if (b && b.type === 'insert') {
      bPrime.push(b);
      aPrime.push({ type: 'retain', count: b.text.length });
      ib++;
      continue;
    }

    if (!a || !b) break;

    if (a.type === 'retain' && b.type === 'retain') {
      const min = Math.min(a.count, b.count);
      aPrime.push({ type: 'retain', count: min });
      bPrime.push({ type: 'retain', count: min });
      consumeN(opA, ia, min, (newOp, newI) => { opA = newOp; ia = newI; });
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    } else if (a.type === 'delete' && b.type === 'delete') {
      const min = Math.min(a.count, b.count);
      // Both delete the same region — skip in both primes
      consumeN(opA, ia, min, (newOp, newI) => { opA = newOp; ia = newI; });
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    } else if (a.type === 'delete' && b.type === 'retain') {
      const min = Math.min(a.count, b.count);
      aPrime.push({ type: 'delete', count: min });
      // B's retain is consumed by A's delete — skip in B'
      consumeN(opA, ia, min, (newOp, newI) => { opA = newOp; ia = newI; });
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    } else if (a.type === 'retain' && b.type === 'delete') {
      const min = Math.min(a.count, b.count);
      bPrime.push({ type: 'delete', count: min });
      // A's retain is consumed by B's delete — skip in A'
      consumeN(opA, ia, min, (newOp, newI) => { opA = newOp; ia = newI; });
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    }
  }

  return [compact(aPrime), compact(bPrime)];
}

/**
 * Consume N units from a retain or delete component at index i.
 * If the component has more than N, split it; otherwise advance.
 */
function consumeN(
  op: OTOperation,
  i: number,
  n: number,
  update: (newOp: OTOperation, newI: number) => void,
): void {
  const c = op[i];
  if (c.type === 'retain' || c.type === 'delete') {
    const total = c.count;
    if (n < total) {
      // Split: keep remainder at same index
      const newOp = [...op];
      newOp[i] = { ...c, count: total - n };
      update(newOp, i);
    } else {
      update(op, i + 1);
    }
  } else {
    update(op, i + 1);
  }
}

/** Merge adjacent same-type components. */
function compact(op: OTOperation): OTOperation {
  const result: OTOperation = [];
  for (const c of op) {
    const last = result[result.length - 1];
    if (last && last.type === c.type) {
      if (last.type === 'insert' && c.type === 'insert') {
        result[result.length - 1] = { type: 'insert', text: last.text + c.text };
      } else if (last.type === 'retain' && c.type === 'retain') {
        result[result.length - 1] = { type: 'retain', count: last.count + c.count };
      } else if (last.type === 'delete' && c.type === 'delete') {
        result[result.length - 1] = { type: 'delete', count: last.count + c.count };
      }
    } else {
      result.push(c);
    }
  }
  return result;
}

/** Compose two sequential operations into one. */
export function compose(opA: OTOperation, opB: OTOperation): OTOperation {
  const result: OTOperation = [];
  let ia = 0;
  let ib = 0;

  while (ia < opA.length || ib < opB.length) {
    const a = opA[ia];
    const b = opB[ib];

    if (a && a.type === 'delete') {
      result.push(a);
      ia++;
      continue;
    }

    if (b && b.type === 'insert') {
      result.push(b);
      ib++;
      continue;
    }

    if (!a || !b) break;

    if (a.type === 'retain' && b.type === 'retain') {
      const min = Math.min(a.count, b.count);
      result.push({ type: 'retain', count: min });
      consumeN(opA, ia, min, (newOp, newI) => { opA = newOp; ia = newI; });
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    } else if (a.type === 'insert' && b.type === 'retain') {
      const min = Math.min(a.text.length, b.count);
      result.push({ type: 'insert', text: a.text.slice(0, min) });
      if (min < a.text.length) {
        opA = [...opA];
        opA[ia] = { type: 'insert', text: a.text.slice(min) };
      } else {
        ia++;
      }
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    } else if (a.type === 'insert' && b.type === 'delete') {
      const min = Math.min(a.text.length, b.count);
      // Insert then delete cancels out
      if (min < a.text.length) {
        opA = [...opA];
        opA[ia] = { type: 'insert', text: a.text.slice(min) };
      } else {
        ia++;
      }
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    } else if (a.type === 'retain' && b.type === 'delete') {
      const min = Math.min(a.count, b.count);
      result.push({ type: 'delete', count: min });
      consumeN(opA, ia, min, (newOp, newI) => { opA = newOp; ia = newI; });
      consumeN(opB, ib, min, (newOp, newI) => { opB = newOp; ib = newI; });
    }
  }

  return compact(result);
}
