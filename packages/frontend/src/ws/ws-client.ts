type MessageHandler = (data: unknown) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private token: string;
  private readyResolve: (() => void) | null = null;
  private _ready: Promise<void>;
  private _connected = false;
  private _wasConnected = false;
  private reconnectDelay = 2000;
  private static readonly RECONNECT_BASE = 2000;
  private static readonly RECONNECT_MAX = 30000;
  private static readonly HEARTBEAT_INTERVAL = 30000;
  private static readonly PONG_TIMEOUT = 10000;

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
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
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

    ws.onmessage = (event) => {
      // Any frame shows the socket is alive
      this.clearPongTimer();
      try {
        const msg = JSON.parse(event.data as string);
        const type = msg.type as string;
        this.emit(type, msg);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => this.handleClose();

    ws.onerror = () => {
      this.ws?.close();
    };
  }

  private handleClose(): void {
    const wasConnected = this._connected;
    this._connected = false;
    this.stopHeartbeat();

    // Emit disconnected lifecycle event (only if we were previously connected)
    if (wasConnected) {
      this.emit('disconnected', { type: 'disconnected' });
    }

    this.scheduleReconnect();
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
    this.heartbeatTimer = setInterval(this.probe, WSClient.HEARTBEAT_INTERVAL);
    // Back from sleep or on a new network: check the socket now, not at the next beat
    window.addEventListener('online', this.probe);
    document.addEventListener('visibilitychange', this.probe);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimer();
    window.removeEventListener('online', this.probe);
    document.removeEventListener('visibilitychange', this.probe);
  }

  /**
   * Ping, and give up on the socket if nothing comes back in time. After
   * sleep/wake or a network change a dead socket can stay OPEN for minutes,
   * silently swallowing every frame sent on it.
   */
  private probe = (): void => {
    if (this.pongTimer || this.ws?.readyState !== WebSocket.OPEN) return;
    this.send({ type: 'ping' });
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      console.warn('[WSClient] No pong, reconnecting');
      this.dropDeadSocket();
    }, WSClient.PONG_TIMEOUT);
  };

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /** Stop listening to a dead socket (its close event may never come) and reconnect. */
  private dropDeadSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
    this.handleClose();
  }
}
