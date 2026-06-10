type MessageHandler = (data: unknown) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private url: string;
  private token: string;
  private readyResolve: (() => void) | null = null;
  private _ready: Promise<void>;
  private _connected = false;
  private _wasConnected = false;
  private reconnectDelay = 2000;
  private static readonly RECONNECT_BASE = 2000;
  private static readonly RECONNECT_MAX = 30000;

  constructor(token: string) {
    this.token = token;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
    this._ready = new Promise((resolve) => { this.readyResolve = resolve; });
  }

  /** Resolves when the WebSocket connection is open. */
  get ready(): Promise<void> {
    return this._ready;
  }

  /** Whether the WebSocket is currently connected. */
  get isConnected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = WSClient.RECONNECT_BASE; // reset backoff

      if (this.readyResolve) {
        this.readyResolve();
        this.readyResolve = null;
      }
      this.startHeartbeat();

      // Emit connected lifecycle event
      this.emit('connected', { type: 'connected', wasReconnect: this._wasConnected });
      this._wasConnected = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        const type = msg.type as string;
        this.emit(type, msg);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      const wasConnected = this._connected;
      this._connected = false;
      this.stopHeartbeat();

      // Emit disconnected lifecycle event (only if we were previously connected)
      if (wasConnected) {
        this.emit('disconnected', { type: 'disconnected' });
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // NestJS WsAdapter expects { event, data } format for @SubscribeMessage routing
      const { type, ...rest } = data as Record<string, unknown>;
      this.ws.send(JSON.stringify({ event: type, data: rest }));
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this._connected = false;
    this.ws?.close();
    this.ws = null;
  }

  private emit(type: string, data: unknown): void {
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(data);
      }
    }
  }

  private scheduleReconnect(): void {
    this._ready = new Promise((resolve) => { this.readyResolve = resolve; });
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    // Exponential backoff: 2s → 4s → 8s → 16s → 30s (capped)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, WSClient.RECONNECT_MAX);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
