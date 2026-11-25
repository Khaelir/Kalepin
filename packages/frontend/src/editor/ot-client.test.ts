import { describe, it, expect } from 'vitest';
import type { OTOperation } from '@kalepin/shared';
import { OTClient, rebaseUnconfirmed } from './ot-client';
import { applyOpsToMarkdown, diffMarkdownToOps } from './ot-bridge';
import type { WSClient } from '../ws/ws-client';

/** Records sent frames and lets a test play server frames back. */
class FakeWS {
  sent: any[] = [];
  private handlers = new Map<string, Set<(msg: any) => void>>();
  on(type: string, handler: (msg: any) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => { this.handlers.get(type)?.delete(handler); };
  }
  send(frame: any) {
    this.sent.push(frame);
  }
  emit(type: string, msg: any) {
    for (const h of [...(this.handlers.get(type) ?? [])]) h(msg);
  }
  ops() {
    return this.sent.filter((f) => f.type === 'op');
  }
}

const edit = (from: string, to: string) => diffMarkdownToOps(from, to)!;

function client(text: string, rev = 0) {
  const ws = new FakeWS();
  const remote: OTOperation[] = [];
  const ot = new OTClient(ws as unknown as WSClient, 'n.md', rev, (ops) => remote.push(ops), { initialShadow: text });
  return { ws, ot, remote };
}

describe('OTClient confirmed shadow', () => {
  it('holds the acked text only, not the buffer sent on the ack', () => {
    const { ws, ot } = client('abc');
    ot.sendOp(edit('abc', 'abcX'));
    ot.sendOp(edit('abcX', 'abcXY'));
    ws.emit('ack', { docId: 'n.md', rev: 1 });
    // The buffer went out on that ack but is not confirmed yet.
    expect(ws.ops()).toHaveLength(2);
    expect(ot.getConfirmedShadow()).toBe('abcX');
    expect(ot.hasUnackedOps()).toBe(true);
    ws.emit('ack', { docId: 'n.md', rev: 2 });
    expect(ot.getConfirmedShadow()).toBe('abcXY');
    expect(ot.hasUnackedOps()).toBe(false);
  });

  it('follows remote ops while a local op is in flight', () => {
    const { ws, ot } = client('Hello\n');
    ot.sendOp(edit('Hello\n', 'Hello!\n'));
    ws.emit('op', { docId: 'n.md', ops: edit('Hello\n', 'Intro\nHello\n'), rev: 1 });
    expect(ot.getConfirmedShadow()).toBe('Intro\nHello\n');
    ws.emit('ack', { docId: 'n.md', rev: 2 });
    expect(ot.getConfirmedShadow()).toBe('Intro\nHello!\n');
  });
});

describe('OTClient.resync (reconnect)', () => {
  it('re-sends edits lost with a dead socket, rebased on what others wrote meanwhile', () => {
    const { ws, ot } = client('Hello world\n', 3);
    // Typed into a socket that was already dead: the in-flight op and the buffer never arrived.
    ot.sendOp(edit('Hello world\n', 'Hello brave world\n'));
    ot.sendOp(edit('Hello brave world\n', 'Hello brave new world\n'));
    const local = 'Hello brave new world\n';
    // Meanwhile a collaborator prepended a title.
    const server = '# Title\nHello world\n';

    const text = ot.resync(server, 7, local);

    expect(text).toBe('# Title\nHello brave new world\n');
    const sent = ws.ops().at(-1);
    expect(sent.rev).toBe(7);
    expect(applyOpsToMarkdown(server, sent.ops)).toBe(text);
    expect(ot.hasUnackedOps()).toBe(true);
    ws.emit('ack', { docId: 'n.md', rev: 8 });
    expect(ot.getConfirmedShadow()).toBe(text);
  });

  it('does not re-send an in-flight op the server applied before the ack was lost', () => {
    const { ws, ot } = client('abc', 0);
    ot.sendOp(edit('abc', 'abcX'));
    ot.sendOp(edit('abcX', 'abcXY'));
    const text = ot.resync('abcX', 1, 'abcXY');
    expect(text).toBe('abcXY');
    const sent = ws.ops().at(-1);
    expect(sent.rev).toBe(1);
    expect(applyOpsToMarkdown('abcX', sent.ops)).toBe('abcXY');
  });

  it('sends nothing when every edit was confirmed', () => {
    const { ws, ot } = client('abc', 0);
    ot.sendOp(edit('abc', 'abcX'));
    ws.emit('ack', { docId: 'n.md', rev: 1 });
    const before = ws.ops().length;
    expect(ot.resync('abcX!', 2, 'abcX')).toBe('abcX!');
    expect(ws.ops()).toHaveLength(before);
    expect(ot.hasUnackedOps()).toBe(false);
  });
});

describe('rebaseUnconfirmed', () => {
  it('diffs when the ops do not add up to the local text', () => {
    const r = rebaseUnconfirmed('one two', 'one 2 two', 'zero one two', null, null);
    expect(r.text).toBe('zero one 2 two');
    expect(applyOpsToMarkdown('zero one two', r.ops!)).toBe(r.text);
  });

  it('drops a rebased edit that became a no-op', () => {
    // Both sides deleted the same word.
    const r = rebaseUnconfirmed('a b c', 'a c', 'a c', null, null);
    expect(r).toEqual({ text: 'a c', ops: null });
  });
});
