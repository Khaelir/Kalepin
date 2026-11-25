import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  HEARTBEAT_STALE_MS,
  ServerHeartbeatService,
  readLiveServerHeartbeat,
  serverHeartbeatPath,
} from './server-heartbeat';

let tmpRoot: string;
let file: string;
let prevDbPath: string | undefined;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-heartbeat-'));
  prevDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(tmpRoot, 'db', 'kalepin.sqlite');
  file = serverHeartbeatPath();
});

afterEach(async () => {
  if (prevDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = prevDbPath;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('server heartbeat', () => {
  it('lives next to the database', () => {
    assert.equal(file, path.join(tmpRoot, 'db', 'kalepin-server.heartbeat'));
  });

  it('is written while the server runs and removed on shutdown', async () => {
    const service = new ServerHeartbeatService();
    await service.onApplicationBootstrap();
    try {
      const live = readLiveServerHeartbeat(file);
      assert.ok(live);
      assert.equal(live.pid, process.pid);
    } finally {
      await service.onApplicationShutdown();
    }
    assert.equal(readLiveServerHeartbeat(file), null);
    await assert.rejects(fs.access(file));
  });

  it('counts a heartbeat as live only until it goes stale', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const now = Date.now();
    await fs.writeFile(file, JSON.stringify({ pid: 1, host: 'h', heartbeatAt: now - 5_000 }));
    assert.equal(readLiveServerHeartbeat(file, now)?.host, 'h');
    assert.equal(readLiveServerHeartbeat(file, now + HEARTBEAT_STALE_MS), null);
  });

  it('falls back to the file time when the content is unreadable', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"pid');
    assert.ok(readLiveServerHeartbeat(file));
  });

  it('reports no server when there is no heartbeat file', () => {
    assert.equal(readLiveServerHeartbeat(file), null);
  });
});
