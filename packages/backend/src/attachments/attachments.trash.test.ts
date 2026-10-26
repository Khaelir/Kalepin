import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AttachmentsService } from './attachments.service';

// A trashed note can still be restored, so the attachments it references must
// survive the orphan sweep. The scan walks dot folders (including `.trash/`);
// this pins that behaviour down.

let tmpDir: string;
let personalDir: string;
let service: AttachmentsService;
let prevVault: string | undefined;
let prevPersonal: string | undefined;

async function write(abs: string, body: string) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-attach-trash-'));
  personalDir = path.join(tmpDir, 'personal');
  prevVault = process.env.VAULT_PATH;
  prevPersonal = process.env.PERSONAL_PATH;
  process.env.VAULT_PATH = path.join(tmpDir, 'vault');
  process.env.PERSONAL_PATH = personalDir;
  service = new AttachmentsService();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  if (prevVault === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = prevVault;
  if (prevPersonal === undefined) delete process.env.PERSONAL_PATH;
  else process.env.PERSONAL_PATH = prevPersonal;
});

describe('Attachment cleanup — trashed notes', () => {
  it('keeps an attachment referenced only by a note in the shared trash', async () => {
    const vault = process.env.VAULT_PATH!;
    await write(path.join(vault, '_attachments/keep.png'), 'k');
    await write(path.join(vault, '_attachments/orphan.png'), 'o');
    await write(path.join(vault, '.trash/abc/doc.md'), '![](../_attachments/keep.png)');

    const result = await service.cleanup();

    assert.equal(result.orphansFound, 1);
    await fs.access(path.join(vault, '_attachments/keep.png'));
    await assert.rejects(fs.access(path.join(vault, '_attachments/orphan.png')));
  });

  it('keeps an attachment referenced only by a note in a personal trash', async () => {
    const user = path.join(personalDir, 'alice@x.com');
    await write(path.join(user, '_attachments/mine.png'), 'm');
    await write(path.join(user, '.trash/def/Drafts/doc.md'), '![](../../_attachments/mine.png)');

    const result = await service.cleanup();

    assert.equal(result.orphansFound, 0);
    await fs.access(path.join(user, '_attachments/mine.png'));
  });
});
