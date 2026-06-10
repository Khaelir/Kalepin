import type { StorageAdapter } from '../storage/storage-adapter.interface';
import { isUnderPersonalRoot } from '../auth/visibility';
import { isE2EPath } from '../crypto/encryption-predicates';

/**
 * Minimal interface of `archiver.Archiver` that the helper uses. Decoupled so
 * unit tests can capture appended entries without spinning up a real archive.
 */
export interface ArchiveLike {
  append(data: Buffer | string, opts: { name: string }): void;
}

/** One entry in the export manifest. */
export interface ManifestEntry {
  path: string;
  kind: 'plaintext' | 'e2e-encrypted';
}

/**
 * Walk a virtual-path subtree through the storage adapter and append each file
 * as a zip entry. The storage adapter decrypts envelopes transparently, so the
 * archive ends up with plaintext bytes that the user can open without a KEK.
 * For `_secure/` paths the bytes are passed through unchanged — the server
 * cannot decrypt them — and the manifest flags the entry as `e2e-encrypted`
 * so a recipient knows which entries need a client-side decrypt step.
 *
 * The `skipPersonalAtRoot` flag drops `_users` entries when walking the shared
 * tree from the root — those subtrees are added separately for the requester's
 * own email so that one user's zip never includes another user's data.
 */
export async function appendVirtualTreeToArchive(
  archive: ArchiveLike,
  storage: StorageAdapter,
  root: string,
  options: { skipPersonalAtRoot: boolean; manifest?: ManifestEntry[] } = { skipPersonalAtRoot: false },
): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const entries = await storage.list(entryPath);
    for (const entry of entries) {
      if (
        options.skipPersonalAtRoot &&
        entryPath === '' &&
        (entry.path === '_users' || isUnderPersonalRoot(entry.path))
      ) {
        continue;
      }
      if (entry.type === 'directory') {
        await visit(entry.path);
      } else if (storage.readBytes) {
        const bytes = await storage.readBytes(entry.path);
        archive.append(bytes, { name: entry.path });
        if (options.manifest) {
          options.manifest.push({
            path: entry.path,
            // For E2E paths, `readBytes` returns the raw envelope (the server
            // never decrypts). For other paths, the storage adapter decrypts
            // transparently and we get plaintext.
            kind: isE2EPath(entry.path) ? 'e2e-encrypted' : 'plaintext',
          });
        }
      } else {
        // Adapters without byte-level I/O (e.g., Git) only handle plaintext;
        // encryption is unsupported on those storage backends anyway.
        const text = await storage.read(entry.path);
        archive.append(text, { name: entry.path });
        if (options.manifest) {
          options.manifest.push({ path: entry.path, kind: 'plaintext' });
        }
      }
    }
  };
  await visit(root);
}
