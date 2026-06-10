import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  FileKEKSource,
  EnvKEKSource,
  MemoryKEKSource,
  computeKEKFingerprint,
} from './kek-source';

let tmpRoot: string;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-kek-test-'));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeKekFile(name: string, bytes: Buffer, mode: number): Promise<string> {
  const p = path.join(tmpRoot, name);
  await fs.writeFile(p, bytes);
  await fs.chmod(p, mode);
  return p;
}

describe('FileKEKSource', () => {
  it('loads a 32-byte key with mode 0600', async () => {
    const bytes = crypto.randomBytes(32);
    const p = await writeKekFile('ok-0600', bytes, 0o600);
    const src = new FileKEKSource(p);
    assert.equal(src.fingerprint.length, 8);
    assert.deepEqual(src.fingerprint, computeKEKFingerprint(bytes));
  });

  it('loads a 32-byte key with mode 0400', async () => {
    const bytes = crypto.randomBytes(32);
    const p = await writeKekFile('ok-0400', bytes, 0o400);
    const src = new FileKEKSource(p);
    assert.equal(src.fingerprint.length, 8);
  });

  it('rejects mode 0644', async () => {
    const p = await writeKekFile('insecure', crypto.randomBytes(32), 0o644);
    assert.throws(() => new FileKEKSource(p), /too permissive/);
  });

  it('rejects wrong length (16 bytes)', async () => {
    const p = await writeKekFile('short', crypto.randomBytes(16), 0o600);
    assert.throws(() => new FileKEKSource(p), /32 bytes/);
  });

  it('rejects wrong length (64 bytes)', async () => {
    const p = await writeKekFile('long', crypto.randomBytes(64), 0o600);
    assert.throws(() => new FileKEKSource(p), /32 bytes/);
  });

  it('round-trips wrap/unwrap', async () => {
    const bytes = crypto.randomBytes(32);
    const p = await writeKekFile('rt', bytes, 0o600);
    const src = new FileKEKSource(p);
    const cek = crypto.randomBytes(32);
    const wrapped = await src.wrap(cek);
    const unwrapped = await src.unwrap(wrapped);
    assert.deepEqual(unwrapped, cek);
    assert.notDeepEqual(wrapped, cek);
  });
});

describe('EnvKEKSource', () => {
  let savedNodeEnv: string | undefined;
  let savedKalepinKek: string | undefined;
  let savedKalepinKekFile: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    savedKalepinKek = process.env.KALEPIN_KEK;
    savedKalepinKekFile = process.env.KALEPIN_KEK_FILE;
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedKalepinKek === undefined) delete process.env.KALEPIN_KEK;
    else process.env.KALEPIN_KEK = savedKalepinKek;
    if (savedKalepinKekFile === undefined) delete process.env.KALEPIN_KEK_FILE;
    else process.env.KALEPIN_KEK_FILE = savedKalepinKekFile;
  });

  it('loads from KALEPIN_KEK in dev', () => {
    process.env.NODE_ENV = 'development';
    process.env.KALEPIN_KEK = crypto.randomBytes(32).toString('hex');
    delete process.env.KALEPIN_KEK_FILE;
    const src = new EnvKEKSource();
    assert.equal(src.fingerprint.length, 8);
  });

  it('refuses production unless KALEPIN_KEK_FILE is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.KALEPIN_KEK = crypto.randomBytes(32).toString('hex');
    delete process.env.KALEPIN_KEK_FILE;
    assert.throws(() => new EnvKEKSource(), /production/);
  });

  it('rejects missing env var', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.KALEPIN_KEK;
    assert.throws(() => new EnvKEKSource(), /not set/);
  });

  it('rejects non-hex value', () => {
    process.env.NODE_ENV = 'development';
    process.env.KALEPIN_KEK = 'not-hex-zzz';
    assert.throws(() => new EnvKEKSource(), /hex/);
  });

  it('rejects wrong length', () => {
    process.env.NODE_ENV = 'development';
    process.env.KALEPIN_KEK = '00'.repeat(16);
    assert.throws(() => new EnvKEKSource(), /32 bytes/);
  });
});

describe('KEK fingerprint determinism', () => {
  it('identical KEK bytes yield identical fingerprints across sources', async () => {
    const bytes = crypto.randomBytes(32);
    const memSrc = new MemoryKEKSource(bytes);
    const fileP = await writeKekFile('eq-0600', bytes, 0o600);
    const fileSrc = new FileKEKSource(fileP);
    assert.deepEqual(memSrc.fingerprint, fileSrc.fingerprint);
    assert.deepEqual(fileSrc.fingerprint, computeKEKFingerprint(bytes));
  });

  it('different KEK bytes yield different fingerprints', () => {
    const a = new MemoryKEKSource(crypto.randomBytes(32));
    const b = new MemoryKEKSource(crypto.randomBytes(32));
    assert.notDeepEqual(a.fingerprint, b.fingerprint);
  });
});

// Sanity: keep tmpRoot referenced so TS doesn't dead-strip
void fsSync;
