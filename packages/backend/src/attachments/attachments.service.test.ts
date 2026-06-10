import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AttachmentsService } from './attachments.service';

let tmpDir: string;
let service: AttachmentsService;

function makeFile(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Express.Multer.File {
  return {
    buffer,
    originalname,
    mimetype,
    size: buffer.length,
    fieldname: 'file',
    encoding: '7bit',
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
  };
}

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-test-'));
  process.env.VAULT_PATH = tmpDir;
  service = new AttachmentsService();
}

async function cleanup() {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_PATH;
}

// --- 7.1 Image Upload Tests ---

describe('Image Upload', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('uploads a valid image file', async () => {
    const buffer = Buffer.from('fake-png-data');
    const file = makeFile(buffer, 'photo.png', 'image/png');
    const result = await service.upload(file, 'notes/doc.md');

    const expectedHash = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex')
      .slice(0, 16);

    assert.equal(result.name, `${expectedHash}.png`);
    assert.equal(result.relativePath, `../_attachments/${expectedHash}.png`);

    // File should exist on disk
    const filePath = path.join(tmpDir, '_attachments', result.name);
    const stat = await fs.stat(filePath);
    assert.ok(stat.isFile());
  });

  it('deduplicates identical uploads', async () => {
    const buffer = Buffer.from('same-data');
    const file1 = makeFile(buffer, 'a.png', 'image/png');
    const file2 = makeFile(buffer, 'b.png', 'image/png');

    const r1 = await service.upload(file1, 'doc.md');
    const r2 = await service.upload(file2, 'doc.md');

    assert.equal(r1.name, r2.name);

    // Only one file on disk
    const files = await fs.readdir(path.join(tmpDir, '_attachments'));
    assert.equal(files.length, 1);
  });

  it('rejects invalid MIME type', async () => {
    const file = makeFile(Buffer.from('data'), 'doc.pdf', 'application/pdf');
    await assert.rejects(() => service.upload(file, 'doc.md'), {
      message: /not allowed/,
    });
  });
});

// --- 7.2 Image Serving Tests ---

describe('Image Serving', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('serves an existing file', async () => {
    const dir = path.join(tmpDir, '_attachments');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'abc123.png'), Buffer.from('img'));

    const result = await service.serve('abc123.png');
    assert.equal(result.contentType, 'image/png');
    assert.deepEqual(result.buffer, Buffer.from('img'));
  });

  it('returns 404 for missing file', async () => {
    await assert.rejects(() => service.serve('missing.png'), {
      name: 'NotFoundException',
    });
  });

  it('rejects path traversal', async () => {
    await assert.rejects(() => service.serve('../../etc/passwd'), {
      name: 'BadRequestException',
    });
  });
});

// --- 7.3 File Move Path Rewriting ---
// Note: Path rewriting is tested via FilesService.move() which needs the full
// storage adapter. We test the logic inline here with a focused test.

describe('Path Rewriting Logic', () => {
  it('computes correct relative path depth changes', () => {
    // From notes/doc.md → _attachments/ is ../_attachments/
    // From notes/sub/doc.md → _attachments/ is ../../_attachments/
    const srcDir = 'notes';
    const destDir = 'notes/sub';

    const oldPrefix = path.posix.join(
      path.posix.relative(srcDir, '.'),
      '_attachments',
    );
    const newPrefix = path.posix.join(
      path.posix.relative(destDir, '.'),
      '_attachments',
    );

    assert.equal(oldPrefix, '../_attachments');
    assert.equal(newPrefix, '../../_attachments');

    const content = '![img](../_attachments/abc.png)';
    const updated = content.replaceAll(oldPrefix, newPrefix);
    assert.equal(updated, '![img](../../_attachments/abc.png)');
  });

  it('same directory rename keeps paths unchanged', () => {
    const srcDir = 'notes';
    const destDir = 'notes';

    const oldPrefix = path.posix.join(
      path.posix.relative(srcDir, '.'),
      '_attachments',
    );
    const newPrefix = path.posix.join(
      path.posix.relative(destDir, '.'),
      '_attachments',
    );

    assert.equal(oldPrefix, newPrefix);
  });
});

// --- 7.4 Cleanup Tests ---

describe('Cleanup', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('detects orphaned attachments', async () => {
    const attDir = path.join(tmpDir, '_attachments');
    await fs.mkdir(attDir, { recursive: true });
    await fs.writeFile(path.join(attDir, 'used.png'), 'img');
    await fs.writeFile(path.join(attDir, 'orphan.png'), 'img');

    // Create a doc referencing only used.png
    await fs.writeFile(
      path.join(tmpDir, 'doc.md'),
      '![img](_attachments/used.png)',
    );

    const result = await service.cleanup();
    assert.equal(result.orphansFound, 1);
    assert.equal(result.movedToTrash, 1);

    // orphan.png should be in .trash/
    const trashFiles = await fs.readdir(path.join(attDir, '.trash'));
    assert.equal(trashFiles.length, 1);
    assert.ok(trashFiles[0].endsWith('_orphan.png'));
  });

  it('purges old trash entries', async () => {
    const attDir = path.join(tmpDir, '_attachments');
    const trashDir = path.join(attDir, '.trash');
    await fs.mkdir(trashDir, { recursive: true });

    // Create an old trash entry (10 days ago)
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      .toISOString();
    await fs.writeFile(
      path.join(trashDir, `${oldDate}_old.png`),
      'img',
    );

    // Create a recent trash entry (1 day ago)
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      .toISOString();
    await fs.writeFile(
      path.join(trashDir, `${recentDate}_recent.png`),
      'img',
    );

    const result = await service.cleanup();
    assert.equal(result.purgedFromTrash, 1);

    const remaining = await fs.readdir(trashDir);
    assert.equal(remaining.length, 1);
    assert.ok(remaining[0].includes('recent.png'));
  });

  it('handles no-op cleanup gracefully', async () => {
    // No _attachments/ directory at all
    const result = await service.cleanup();
    assert.equal(result.orphansFound, 0);
    assert.equal(result.movedToTrash, 0);
    assert.equal(result.purgedFromTrash, 0);
  });
});
