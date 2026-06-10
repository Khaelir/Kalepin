import type { OTOperation, OTOpComponent } from '@kalepin/shared';

/**
 * Compute OT operations by diffing two markdown strings.
 * Uses a simple prefix/suffix match to find the changed region.
 */
export function diffMarkdownToOps(oldMd: string, newMd: string): OTOperation | null {
  if (oldMd === newMd) return null;

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldMd.length, newMd.length);
  while (prefixLen < minLen && oldMd[prefixLen] === newMd[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  const maxSuffix = minLen - prefixLen;
  while (
    suffixLen < maxSuffix &&
    oldMd[oldMd.length - 1 - suffixLen] === newMd[newMd.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const ops: OTOpComponent[] = [];

  if (prefixLen > 0) {
    ops.push({ type: 'retain', count: prefixLen });
  }

  const deleteCount = oldMd.length - prefixLen - suffixLen;
  if (deleteCount > 0) {
    ops.push({ type: 'delete', count: deleteCount });
  }

  const insertEnd = suffixLen > 0 ? newMd.length - suffixLen : newMd.length;
  const insertText = newMd.slice(prefixLen, insertEnd);
  if (insertText.length > 0) {
    ops.push({ type: 'insert', text: insertText });
  }

  if (suffixLen > 0) {
    ops.push({ type: 'retain', count: suffixLen });
  }

  return ops.length > 0 ? ops : null;
}

/**
 * Apply OT operations to a markdown string.
 */
export function applyOpsToMarkdown(markdown: string, ops: OTOperation): string {
  let result = '';
  let pos = 0;

  for (const op of ops) {
    switch (op.type) {
      case 'retain':
        result += markdown.slice(pos, pos + op.count);
        pos += op.count;
        break;
      case 'delete':
        pos += op.count;
        break;
      case 'insert':
        result += op.text;
        break;
    }
  }

  result += markdown.slice(pos);
  return result;
}

/**
 * Transform a cursor position against an OT operation.
 * Walks the op components and adjusts the position based on
 * retains, inserts, and deletes occurring before it.
 */
export function transformPosition(cursor: number, ops: OTOperation): number {
  let offset = 0; // tracks position in the old document

  for (const op of ops) {
    switch (op.type) {
      case 'retain':
        offset += op.count;
        break;
      case 'delete':
        if (offset + op.count <= cursor) {
          cursor -= op.count;
        } else if (offset < cursor) {
          cursor = offset;
        }
        offset += op.count;
        break;
      case 'insert':
        if (offset <= cursor) {
          cursor += op.text.length;
        }
        break;
    }
  }

  return Math.max(0, cursor);
}

/**
 * Transform a selection range against an OT operation.
 */
export function transformRange(
  range: { from: number; to: number },
  ops: OTOperation,
): { from: number; to: number } {
  return {
    from: transformPosition(range.from, ops),
    to: transformPosition(range.to, ops),
  };
}
