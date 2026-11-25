import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** How often a running server refreshes its heartbeat file. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A heartbeat older than this is left over from a server that has stopped. */
export const HEARTBEAT_STALE_MS = 60_000;

export interface ServerHeartbeat {
  pid?: number;
  host?: string;
  heartbeatAt: number;
}

/**
 * The file a running server keeps fresh, next to its database: offline tools
 * such as `rotate-kek` are given the same DB_PATH, whether they run inside the
 * server's container or in a sibling one sharing the volume.
 */
export function serverHeartbeatPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(env.DB_PATH || './data/kalepin.sqlite'), 'kalepin-server.heartbeat');
}

/**
 * The heartbeat of a server that is still running, or null when the file is
 * missing or older than HEARTBEAT_STALE_MS.
 */
export function readLiveServerHeartbeat(file: string, now = Date.now()): ServerHeartbeat | null {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = fs.readFileSync(file, 'utf-8');
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  let hb: ServerHeartbeat = { heartbeatAt: mtimeMs };
  try {
    const parsed = JSON.parse(raw) as Partial<ServerHeartbeat>;
    if (typeof parsed.heartbeatAt === 'number') hb = { ...parsed, heartbeatAt: parsed.heartbeatAt };
  } catch {
    // unreadable content: fall back to the file's mtime
  }
  return now - hb.heartbeatAt < HEARTBEAT_STALE_MS ? hb : null;
}

/**
 * Records that this server is running, so `rotate-kek` refuses to rewrap
 * envelopes under it: the server keeps the old KEK in memory and would go on
 * reading and writing with it.
 */
@Injectable()
export class ServerHeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ServerHeartbeat');
  private readonly file = serverHeartbeatPath();
  private timer: NodeJS.Timeout | null = null;

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await fs.promises.rm(this.file, { force: true }).catch(() => undefined);
  }

  private async beat(): Promise<void> {
    const hb: ServerHeartbeat = { pid: process.pid, host: os.hostname(), heartbeatAt: Date.now() };
    const tmp = `${this.file}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, JSON.stringify(hb));
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      this.logger.warn(`cannot write ${this.file}: ${(err as Error).message}`);
    }
  }
}
