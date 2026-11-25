import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { LocalFSAdapter } from './local-fs.adapter';
import { RoutingStorageAdapter } from './routing-fs.adapter';
import { EncryptingStorageAdapter } from './encrypting-fs.adapter';
import { MemoryKEKSource } from '../crypto/kek-source';
import { hasEnvelopeMagic } from '../crypto/envelope';
import { EncryptionPredicates, isE2EPath } from '../crypto/encryption-predicates';
import { FilesService } from '../files/files.service';

// Case-only renames (`Foo.md` -> `foo.md`) in an encrypted zone. On a
// case-insensitive filesystem (macOS, Windows, Docker Desktop bind mounts)
// both names are the same directory entry, so a re-encrypting move that
// writes the destination and then deletes the source deletes the note.

/**
 * Looks each path segment up case-insensitively, the way a case-insensitive
 * filesystem does, so the scenario also runs on case-sensitive CI hosts. A
 * rename between two spellings of one entry is a no-op here, as it is on
 * Linux over a case-insensitive mount.
 */
class CaseInsensitiveLocalFSAdapter extends LocalFSAdapter {
  protected resolve(filePath: string): string {
    const root = path.resolve(this.vaultPath);
    const rel = path.relative(root, super.resolve(filePath));
    if (!rel) return root;
    let cur = root;
    for (const seg of rel.split(path.sep)) {
      let names: string[] = [];
      try {
        names = fsSync.readdirSync(cur);
      } catch {
        // parent does not exist yet
      }
      const hit = names.find((n) => n.toLowerCase() === seg.toLowerCase());
      cur = path.join(cur, hit ?? seg);
    }
    return cur;
  }
}

class PersonalZonePredicates implements EncryptionPredicates {
  isEncryptedAtRest(p: string): boolean { return p.startsWith('_users/'); }
  isE2EEncrypted(p: string): boolean { return isE2EPath(p); }
  shouldIndexPlaintext(): boolean { return true; }
  canCollab(): boolean { return true; }
  commentBodiesEncrypted(): boolean { return false; }
  shareLinkMintable(): boolean { return true; }
}

const USER = 'alice@x.com';
const ROOT = `_users/${USER}`;

const variants: { name: string; make: (root: string) => LocalFSAdapter }[] = [
  { name: 'host filesystem', make: (root) => new LocalFSAdapter(root) },
  { name: 'emulated case-insensitive filesystem', make: (root) => new CaseInsensitiveLocalFSAdapter(root) },
];

for (const variant of variants) {
  describe(`EncryptingStorageAdapter — case-only rename (${variant.name})`, () => {
    let tmpRoot: string;
    let personalRoot: string;
    let adapter: EncryptingStorageAdapter;
    let files: FilesService;

    beforeEach(async () => {
      tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalepin-case-rename-'));
      const sharedRoot = path.join(tmpRoot, 'vault');
      personalRoot = path.join(tmpRoot, 'personal');
      await fs.mkdir(sharedRoot, { recursive: true });
      await fs.mkdir(path.join(personalRoot, USER), { recursive: true });
      const routing = new RoutingStorageAdapter(variant.make(sharedRoot), variant.make(personalRoot));
      adapter = new EncryptingStorageAdapter(
        routing,
        new MemoryKEKSource(crypto.randomBytes(32)),
        new PersonalZonePredicates(),
      );
      files = new FilesService(adapter);
    });

    afterEach(async () => {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    const onDisk = (rel: string) => fs.readdir(path.join(personalRoot, USER, rel));

    it('keeps a note and its comment sidecar', async () => {
      await adapter.write(`${ROOT}/Plan.md`, 'body');
      await adapter.write(`${ROOT}/.Plan.md.collab`, '{"comments":{}}');

      await files.move(`${ROOT}/Plan.md`, `${ROOT}/plan.md`);

      assert.deepEqual((await onDisk('')).sort(), ['.plan.md.collab', 'plan.md']);
      assert.equal(await adapter.read(`${ROOT}/plan.md`), 'body');
      assert.equal(await adapter.read(`${ROOT}/.plan.md.collab`), '{"comments":{}}');
      assert.equal(hasEnvelopeMagic(await fs.readFile(path.join(personalRoot, USER, 'plan.md'))), true);
    });

    it('keeps a folder, its notes and their sidecars', async () => {
      await adapter.write(`${ROOT}/Drafts/a.md`, 'A');
      await adapter.write(`${ROOT}/Drafts/.a.md.collab`, '{"a":1}');
      await adapter.write(`${ROOT}/Drafts/Sub/b.md`, 'B');

      await files.move(`${ROOT}/Drafts`, `${ROOT}/drafts`);

      assert.deepEqual(await onDisk(''), ['drafts']);
      assert.deepEqual((await onDisk('drafts')).sort(), ['.a.md.collab', 'Sub', 'a.md']);
      assert.equal(await adapter.read(`${ROOT}/drafts/a.md`), 'A');
      assert.equal(await adapter.read(`${ROOT}/drafts/.a.md.collab`), '{"a":1}');
      assert.equal(await adapter.read(`${ROOT}/drafts/Sub/b.md`), 'B');
    });
  });
}
