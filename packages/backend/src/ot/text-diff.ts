import { diffLines } from 'diff';
import { OTOperation, OTOpComponent } from '@kalepin/shared';

/**
 * Past this many changed lines the line diff gets slow; the change is then
 * sent as one replaced region.
 */
const MAX_EDIT_LINES = 2_000;
const DIFF_TIMEOUT_MS = 200;

/**
 * An OT operation that turns `oldText` into `newText`, or null when they are
 * equal. Changes are found line by line, then each changed run of lines is
 * trimmed to the characters that differ, so edits far apart stay separate
 * regions: when the op is transformed against concurrent edits, those keep
 * their place instead of being swallowed by one large replacement.
 */
export function diffToOps(oldText: string, newText: string): OTOperation | null {
  if (oldText === newText) return null;
  const ops: OTOperation = [];
  const changes = diffLines(oldText, newText, { maxEditLength: MAX_EDIT_LINES, timeout: DIFF_TIMEOUT_MS });
  if (!changes) {
    replaceRegion(ops, oldText, newText);
    return ops;
  }
  let removed = '';
  let added = '';
  for (const change of changes) {
    if (change.removed) {
      removed += change.value;
    } else if (change.added) {
      added += change.value;
    } else {
      replaceRegion(ops, removed, added);
      removed = '';
      added = '';
      push(ops, { type: 'retain', count: change.value.length });
    }
  }
  replaceRegion(ops, removed, added);
  return ops;
}

/** Replace `removed` by `added`, keeping the characters they share at either end. */
function replaceRegion(ops: OTOperation, removed: string, added: string): void {
  const max = Math.min(removed.length, added.length);
  let prefix = 0;
  while (prefix < max && removed[prefix] === added[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    removed[removed.length - 1 - suffix] === added[added.length - 1 - suffix]
  ) {
    suffix++;
  }
  push(ops, { type: 'retain', count: prefix });
  push(ops, { type: 'delete', count: removed.length - prefix - suffix });
  push(ops, { type: 'insert', text: added.slice(prefix, added.length - suffix) });
  push(ops, { type: 'retain', count: suffix });
}

/** Append a component, merging it into the last one of the same type; drop empty ones. */
function push(ops: OTOperation, c: OTOpComponent): void {
  if (c.type === 'insert' ? c.text.length === 0 : c.count === 0) return;
  const last = ops[ops.length - 1];
  if (last?.type === 'insert' && c.type === 'insert') {
    ops[ops.length - 1] = { type: 'insert', text: last.text + c.text };
  } else if (last?.type === 'retain' && c.type === 'retain') {
    ops[ops.length - 1] = { type: 'retain', count: last.count + c.count };
  } else if (last?.type === 'delete' && c.type === 'delete') {
    ops[ops.length - 1] = { type: 'delete', count: last.count + c.count };
  } else {
    ops.push(c);
  }
}
