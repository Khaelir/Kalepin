import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WSClient } from './ws-client';

/** In-memory stand-in for the browser WebSocket. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: any[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  // A dead socket never completes the closing handshake, so no close event.
  close() {
    this.readyState = FakeSocket.CLOSING;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function connectedClient() {
  const client = new WSClient('token');
  const events: string[] = [];
  client.on('connected', (m: any) => events.push(m.wasReconnect ? 'reconnected' : 'connected'));
  client.on('disconnected', () => events.push('disconnected'));
  client.connect();
  FakeSocket.all[0].open();
  return { client, events };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'https:', host: 'kalepin.example.com' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', new EventTarget());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WSClient doc:open hold', () => {
  it('sends doc:open only once the edits in flight are acked', async () => {
    const { client } = connectedClient();
    const socket = FakeSocket.all[0];
    let acked!: () => void;
    client.holdDocOpenUntil(new Promise<void>((resolve) => { acked = resolve; }));

    client.send({ type: 'doc:open', docId: 'b.md' });
    client.send({ type: 'op', docId: 'a.md', ops: [], rev: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.sent.map((f) => f.event)).toEqual(['op']);

    acked();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.map((f) => f.event)).toEqual(['op', 'doc:open']);
  });

  it('does not hold doc:open for long', async () => {
    const { client } = connectedClient();
    client.holdDocOpenUntil(new Promise<void>(() => {}));
    client.send({ type: 'doc:open', docId: 'b.md' });
    await vi.advanceTimersByTimeAsync(400);
    expect(FakeSocket.all[0].sent).toContainEqual({ event: 'doc:open', data: { docId: 'b.md' } });
  });
});

describe('WSClient heartbeat', () => {
  it('drops a socket that stops answering pings and reconnects', () => {
    const { events } = connectedClient();
    const dead = FakeSocket.all[0];

    vi.advanceTimersByTime(30_000);
    expect(dead.sent).toContainEqual({ event: 'ping', data: {} });
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual(['connected', 'disconnected']);

    vi.advanceTimersByTime(2_000); // reconnect backoff
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].open();
    expect(events).toEqual(['connected', 'disconnected', 'reconnected']);

    // The abandoned socket no longer drives the client.
    dead.onclose?.({});
    dead.receive({ type: 'op' });
    expect(events).toEqual(['connected', 'disconnected', 'reconnected']);
  });

  it('checks the socket right away when the network comes back', () => {
    const { events } = connectedClient();
    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.all[0].sent).toContainEqual({ event: 'ping', data: {} });
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual(['connected', 'disconnected']);
  });

  it('keeps a socket that answers', () => {
    const { events } = connectedClient();
    const socket = FakeSocket.all[0];

    vi.advanceTimersByTime(30_000);
    socket.receive({ type: 'pong' });
    vi.advanceTimersByTime(30_000);
    // Any frame counts as a sign of life, not just the pong.
    socket.receive({ type: 'presence' });
    vi.advanceTimersByTime(15_000);

    expect(events).toEqual(['connected']);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket.sent.filter((f) => f.event === 'ping')).toHaveLength(2);
  });
});
