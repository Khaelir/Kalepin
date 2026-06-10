import type { OTOperation } from '@kalepin/shared';
import { WSClient } from '../ws/ws-client';

type OpCallback = (ops: OTOperation) => void;
type ErrorCallback = (error: string) => void;

enum ClientState {
  Synchronized,
  AwaitingConfirm,
  AwaitingWithBuffer,
}

export class OTClient {
  private state = ClientState.Synchronized;
  private revision = 0;
  private pending: OTOperation | null = null;
  private buffer: OTOperation | null = null;
  private onRemoteOp: OpCallback;
  private onError?: ErrorCallback;
  private ws: WSClient;
  private docId: string;
  private cleanupFns: (() => void)[] = [];
  private confirmedShadow: string = '';

  constructor(ws: WSClient, docId: string, revision: number, onRemoteOp: OpCallback, opts?: { onError?: ErrorCallback; initialShadow?: string }) {
    this.ws = ws;
    this.docId = docId;
    this.revision = revision;
    this.onRemoteOp = onRemoteOp;
    this.onError = opts?.onError;
    this.confirmedShadow = opts?.initialShadow ?? '';

    const offAck = ws.on('ack', (msg: any) => {
      if (msg.docId !== docId) return;
      this.handleAck(msg.rev);
    });

    const offOp = ws.on('op', (msg: any) => {
      if (msg.docId !== docId) return;
      this.handleRemoteOp(msg.ops, msg.rev);
    });

    const offError = ws.on('error', (msg: any) => {
      if (msg.docId && msg.docId !== docId) return;
      this.handleError(msg.message || 'Unknown error');
    });

    this.cleanupFns = [offAck, offOp, offError];
  }

  destroy(): void {
    console.debug(`[OTClient] destroy docId="${this.docId}", state=${ClientState[this.state]}, pending=${!!this.pending}, buffer=${!!this.buffer}`);
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];
  }

  /** Get the confirmed shadow (last server-acknowledged content). */
  getConfirmedShadow(): string {
    return this.confirmedShadow;
  }

  /** Update the confirmed shadow (called externally when shadow is known). */
  setConfirmedShadow(shadow: string): void {
    this.confirmedShadow = shadow;
  }

  setRemoteOpCallback(cb: OpCallback): void {
    this.onRemoteOp = cb;
  }

  flush(): void {
    // If we have a buffered operation, send it immediately
    if (this.state === ClientState.AwaitingWithBuffer && this.buffer) {
      // Buffer will be sent when ack arrives — nothing extra to do here.
      // The pending op is already in-flight.
    }
    // If synchronized with pending ops — they're already sent.
    // This is a best-effort flush: we can't force the server to ack faster,
    // but we ensure no local ops are sitting unsent.
  }

  sendOp(ops: OTOperation): void {
    console.debug(`[OTClient] sendOp docId="${this.docId}", state=${ClientState[this.state]}, rev=${this.revision}`);
    switch (this.state) {
      case ClientState.Synchronized:
        this.pending = ops;
        this.state = ClientState.AwaitingConfirm;
        console.debug(`[OTClient] Sending op to server docId="${this.docId}", rev=${this.revision}`);
        this.ws.send({ type: 'op', docId: this.docId, ops, rev: this.revision });
        break;
      case ClientState.AwaitingConfirm:
        this.buffer = ops;
        this.state = ClientState.AwaitingWithBuffer;
        break;
      case ClientState.AwaitingWithBuffer:
        // Compose with existing buffer
        this.buffer = composeOps(this.buffer!, ops);
        break;
    }
  }

  private handleAck(rev: number): void {
    console.debug(`[OTClient] handleAck docId="${this.docId}", newRev=${rev}, state=${ClientState[this.state]}`);
    this.revision = rev;
    switch (this.state) {
      case ClientState.AwaitingConfirm:
        this.pending = null;
        this.state = ClientState.Synchronized;
        break;
      case ClientState.AwaitingWithBuffer:
        this.pending = this.buffer;
        this.buffer = null;
        this.state = ClientState.AwaitingConfirm;
        this.ws.send({ type: 'op', docId: this.docId, ops: this.pending!, rev: this.revision });
        break;
    }
  }

  private handleError(message: string): void {
    console.warn(`[OTClient] error docId="${this.docId}", state=${ClientState[this.state]}, message="${message}"`);
    // Reset OT state: clear pending/buffer, return to Synchronized
    this.pending = null;
    this.buffer = null;
    this.state = ClientState.Synchronized;
    // Invoke error callback so the editor can transition to ERROR state
    this.onError?.(message);
  }

  private handleRemoteOp(ops: OTOperation, rev: number): void {
    console.debug(`[OTClient] handleRemoteOp docId="${this.docId}", rev=${rev}`);
    this.revision = rev;

    switch (this.state) {
      case ClientState.Synchronized:
        this.onRemoteOp(ops);
        break;
      case ClientState.AwaitingConfirm:
        // Transform pending against server op
        const [pendingPrime1, serverPrime1] = transformOps(this.pending!, ops);
        this.pending = pendingPrime1;
        this.onRemoteOp(serverPrime1);
        break;
      case ClientState.AwaitingWithBuffer:
        // Transform pending, then buffer
        const [pendingPrime, serverPrime2] = transformOps(this.pending!, ops);
        this.pending = pendingPrime;
        const [bufferPrime, serverPrime3] = transformOps(this.buffer!, serverPrime2);
        this.buffer = bufferPrime;
        this.onRemoteOp(serverPrime3);
        break;
    }
  }
}

// Minimal client-side OT transform (mirrors server logic)
function transformOps(a: OTOperation, b: OTOperation): [OTOperation, OTOperation] {
  const aPrime: OTOperation = [];
  const bPrime: OTOperation = [];
  let ia = 0, ib = 0;
  let aArr = [...a], bArr = [...b];

  while (ia < aArr.length || ib < bArr.length) {
    const ca = aArr[ia];
    const cb = bArr[ib];

    if (ca && ca.type === 'insert') {
      aPrime.push(ca);
      bPrime.push({ type: 'retain', count: ca.text.length });
      ia++;
      continue;
    }
    if (cb && cb.type === 'insert') {
      bPrime.push(cb);
      aPrime.push({ type: 'retain', count: cb.text.length });
      ib++;
      continue;
    }

    if (!ca || !cb) break;

    if (ca.type === 'retain' && cb.type === 'retain') {
      const min = Math.min(ca.count, cb.count);
      aPrime.push({ type: 'retain', count: min });
      bPrime.push({ type: 'retain', count: min });
      splitConsume(aArr, ia, min, (arr, i) => { aArr = arr; ia = i; });
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    } else if (ca.type === 'delete' && cb.type === 'delete') {
      const min = Math.min(ca.count, cb.count);
      splitConsume(aArr, ia, min, (arr, i) => { aArr = arr; ia = i; });
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    } else if (ca.type === 'delete' && cb.type === 'retain') {
      const min = Math.min(ca.count, cb.count);
      aPrime.push({ type: 'delete', count: min });
      splitConsume(aArr, ia, min, (arr, i) => { aArr = arr; ia = i; });
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    } else if (ca.type === 'retain' && cb.type === 'delete') {
      const min = Math.min(ca.count, cb.count);
      bPrime.push({ type: 'delete', count: min });
      splitConsume(aArr, ia, min, (arr, i) => { aArr = arr; ia = i; });
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    }
  }

  return [aPrime, bPrime];
}

function splitConsume(
  arr: OTOperation,
  i: number,
  n: number,
  update: (arr: OTOperation, i: number) => void,
): void {
  const c = arr[i];
  if ((c.type === 'retain' || c.type === 'delete') && c.count > n) {
    const newArr = [...arr];
    newArr[i] = { ...c, count: c.count - n } as any;
    update(newArr, i);
  } else {
    update(arr, i + 1);
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

/** Compose two sequential operations into one (mirrors server ot-engine.ts). */
function composeOps(a: OTOperation, b: OTOperation): OTOperation {
  const result: OTOperation = [];
  let ia = 0;
  let ib = 0;
  let aArr = [...a], bArr = [...b];

  while (ia < aArr.length || ib < bArr.length) {
    const ca = aArr[ia];
    const cb = bArr[ib];

    // Deletes from A pass through (they consume input before B sees it)
    if (ca && ca.type === 'delete') {
      result.push(ca);
      ia++;
      continue;
    }

    // Inserts from B pass through (they don't consume A's output)
    if (cb && cb.type === 'insert') {
      result.push(cb);
      ib++;
      continue;
    }

    if (!ca || !cb) break;

    if (ca.type === 'retain' && cb.type === 'retain') {
      const min = Math.min(ca.count, cb.count);
      result.push({ type: 'retain', count: min });
      splitConsume(aArr, ia, min, (arr, i) => { aArr = arr; ia = i; });
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    } else if (ca.type === 'insert' && cb.type === 'retain') {
      const min = Math.min(ca.text.length, cb.count);
      result.push({ type: 'insert', text: ca.text.slice(0, min) });
      if (min < ca.text.length) {
        aArr = [...aArr];
        aArr[ia] = { type: 'insert', text: ca.text.slice(min) };
      } else {
        ia++;
      }
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    } else if (ca.type === 'insert' && cb.type === 'delete') {
      // Insert then delete cancels out
      const min = Math.min(ca.text.length, cb.count);
      if (min < ca.text.length) {
        aArr = [...aArr];
        aArr[ia] = { type: 'insert', text: ca.text.slice(min) };
      } else {
        ia++;
      }
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    } else if (ca.type === 'retain' && cb.type === 'delete') {
      const min = Math.min(ca.count, cb.count);
      result.push({ type: 'delete', count: min });
      splitConsume(aArr, ia, min, (arr, i) => { aArr = arr; ia = i; });
      splitConsume(bArr, ib, min, (arr, i) => { bArr = arr; ib = i; });
    }
  }

  return compact(result);
}
