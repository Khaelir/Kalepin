import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { assertReadableBy, isUnderPersonalRoot, personalRootFor } from '../auth/visibility';
import { GrantAwareVisibility } from '../auth/grant-aware-visibility.service';

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

@Injectable()
export class AttachmentsService {
  private readonly vaultPath: string;
  private readonly personalPath: string | undefined;
  private readonly sharedAttachmentsDir: string;

  constructor(@Optional() private readonly visibility?: GrantAwareVisibility) {
    this.vaultPath = process.env.VAULT_PATH || './data/vault';
    this.personalPath = process.env.PERSONAL_PATH || undefined;
    this.sharedAttachmentsDir = path.join(this.vaultPath, '_attachments');
  }

  // Exposed for unit tests and the cleanup walker.
  personalAttachmentsDir(email: string): string | null {
    if (!this.personalPath) return null;
    return path.join(this.personalPath, email, '_attachments');
  }

  async upload(
    file: Express.Multer.File,
    docPath: string,
    userEmail?: string,
  ): Promise<{ name: string; relativePath: string; doc?: string }> {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} is not allowed`,
      );
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const name = `${hash.slice(0, 16)}${ext}`;

    const personal = this.shouldRouteToPersonal(docPath, userEmail);
    const targetDir = personal && userEmail
      ? this.personalAttachmentsDir(userEmail.toLowerCase())!
      : this.sharedAttachmentsDir;
    const filePath = path.join(targetDir, name);

    await fs.mkdir(targetDir, { recursive: true });

    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, file.buffer);
    }

    const docDir = path.dirname(docPath);
    const relativePath = path.posix.join(
      path.posix.relative(docDir, '.'),
      '_attachments',
      name,
    );

    if (personal) {
      return { name, relativePath, doc: docPath };
    }
    return { name, relativePath };
  }

  /**
   * Serve an attachment in trusted (no-auth) mode. The caller has already
   * proven access via a share-link scoped token; this method skips the
   * email-based visibility check and resolves the namespace purely from the
   * shared note's path (personal vs shared `_attachments/`).
   *
   * Used only by the share-links asset endpoint. Other entry points must keep
   * going through `serve()` so the visibility gate stays enforced.
   */
  async serveForShareLink(
    name: string,
    sharedNotePath: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new BadRequestException('Invalid attachment name');
    }

    let baseDir: string;
    if (isUnderPersonalRoot(sharedNotePath) && this.personalPath) {
      // Personal-folder shares route to the path owner's _attachments. We
      // derive the email from the path itself (`_users/<email>/...`) — the
      // share-code already authorised the read, no caller-supplied email
      // needed.
      const segments = sharedNotePath.split('/');
      // segments = ['_users', '<email>', ...]
      const ownerEmail = segments[1]?.toLowerCase();
      const personalDir = ownerEmail
        ? this.personalAttachmentsDir(ownerEmail)
        : null;
      if (!personalDir) throw new NotFoundException('Attachment not found');
      baseDir = personalDir;
    } else {
      baseDir = this.sharedAttachmentsDir;
    }

    const filePath = path.join(baseDir, name);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      throw new BadRequestException('Invalid attachment name');
    }

    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(name).toLowerCase();
      const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
      return { buffer, contentType };
    } catch {
      throw new NotFoundException('Attachment not found');
    }
  }

  async serve(
    name: string,
    doc?: string,
    requesterEmail?: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new BadRequestException('Invalid attachment name');
    }

    let baseDir: string;
    if (doc && doc.length > 0) {
      // Doc context provided: gate by visibility, then derive namespace from the doc.
      // requesterEmail comes from the authenticated session, never from the URL.
      if (!requesterEmail) {
        throw new NotFoundException('Attachment not found');
      }
      if (this.visibility) {
        await this.visibility.assertReadableBy(doc, requesterEmail);
      } else {
        assertReadableBy(doc, requesterEmail);
      }
      if (this.shouldRouteToPersonal(doc, requesterEmail)) {
        const personalDir = this.personalAttachmentsDir(requesterEmail.toLowerCase());
        if (!personalDir) throw new NotFoundException('Attachment not found');
        baseDir = personalDir;
      } else {
        baseDir = this.sharedAttachmentsDir;
      }
    } else {
      baseDir = this.sharedAttachmentsDir;
    }

    const filePath = path.join(baseDir, name);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      throw new BadRequestException('Invalid attachment name');
    }

    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(name).toLowerCase();
      const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
      return { buffer, contentType };
    } catch {
      throw new NotFoundException('Attachment not found');
    }
  }

  /**
   * Copy an attachment file from one namespace's `_attachments/` to another.
   * Used by FilesService.move when the move crosses the shared/personal boundary
   * so the referenced attachment continues to render at the destination.
   * Source-side copy is intentionally NOT deleted; the cleanup sweeper reaps orphans.
   */
  async copyBetweenNamespaces(
    name: string,
    src: { kind: 'shared' } | { kind: 'personal'; email: string },
    dest: { kind: 'shared' } | { kind: 'personal'; email: string },
  ): Promise<void> {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return;
    const srcDir = src.kind === 'shared'
      ? this.sharedAttachmentsDir
      : this.personalAttachmentsDir(src.email.toLowerCase());
    const destDir = dest.kind === 'shared'
      ? this.sharedAttachmentsDir
      : this.personalAttachmentsDir(dest.email.toLowerCase());
    if (!srcDir || !destDir || srcDir === destDir) return;

    const srcFile = path.join(srcDir, name);
    const destFile = path.join(destDir, name);
    await fs.mkdir(destDir, { recursive: true });
    try {
      await fs.access(destFile);
      return;
    } catch {
      // doesn't exist yet
    }
    try {
      await fs.copyFile(srcFile, destFile);
    } catch {
      // source missing — nothing to do
    }
  }

  async cleanup(): Promise<{
    orphansFound: number;
    movedToTrash: number;
    purgedFromTrash: number;
  }> {
    let orphansFound = 0;
    let movedToTrash = 0;
    let purgedFromTrash = 0;

    const sharedResult = await this.cleanupNamespace({
      kind: 'shared',
      attachmentsDir: this.sharedAttachmentsDir,
      docsRoot: this.vaultPath,
    });
    orphansFound += sharedResult.orphansFound;
    movedToTrash += sharedResult.movedToTrash;
    purgedFromTrash += sharedResult.purgedFromTrash;

    if (this.personalPath) {
      let userDirs: string[] = [];
      try {
        userDirs = await fs.readdir(this.personalPath);
      } catch {
        // personal root doesn't exist; nothing to walk
      }
      for (const userDir of userDirs) {
        if (userDir.startsWith('.')) continue; // skip .deleted, hidden
        const userRoot = path.join(this.personalPath, userDir);
        const result = await this.cleanupNamespace({
          kind: 'personal',
          attachmentsDir: path.join(userRoot, '_attachments'),
          docsRoot: userRoot,
        });
        orphansFound += result.orphansFound;
        movedToTrash += result.movedToTrash;
        purgedFromTrash += result.purgedFromTrash;
      }
    }

    return { orphansFound, movedToTrash, purgedFromTrash };
  }

  private async cleanupNamespace(opts: {
    kind: 'shared' | 'personal';
    attachmentsDir: string;
    docsRoot: string;
  }): Promise<{ orphansFound: number; movedToTrash: number; purgedFromTrash: number }> {
    try {
      await fs.access(opts.attachmentsDir);
    } catch {
      return { orphansFound: 0, movedToTrash: 0, purgedFromTrash: 0 };
    }

    const referenced = new Set<string>();
    await this.scanReferences(opts.docsRoot, referenced);

    const entries = await fs.readdir(opts.attachmentsDir);
    const actualFiles = entries.filter((e) => !e.startsWith('.'));
    const orphans = actualFiles.filter((f) => !referenced.has(f));

    const trashDir = path.join(opts.attachmentsDir, '.trash');
    if (orphans.length > 0) {
      await fs.mkdir(trashDir, { recursive: true });
    }

    for (const orphan of orphans) {
      const timestamp = new Date().toISOString();
      const trashName = `${timestamp}_${orphan}`;
      await fs.rename(
        path.join(opts.attachmentsDir, orphan),
        path.join(trashDir, trashName),
      );
    }

    let purgedFromTrash = 0;
    try {
      const trashEntries = await fs.readdir(trashDir);
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      for (const entry of trashEntries) {
        const match = entry.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_/);
        if (match) {
          const trashedAt = new Date(match[1]).getTime();
          if (now - trashedAt > sevenDays) {
            await fs.unlink(path.join(trashDir, entry));
            purgedFromTrash++;
          }
        }
      }
    } catch {
      // .trash/ doesn't exist
    }

    return {
      orphansFound: orphans.length,
      movedToTrash: orphans.length,
      purgedFromTrash,
    };
  }

  private async scanReferences(
    dir: string,
    referenced: Set<string>,
  ): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_attachments' || entry.name === 'node_modules') {
          continue;
        }
        await this.scanReferences(fullPath, referenced);
      } else if (entry.name.endsWith('.md')) {
        const content = await fs.readFile(fullPath, 'utf-8');
        const regex = /_attachments\/([^\s)]+)/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          referenced.add(match[1]);
        }
      }
    }
  }

  private shouldRouteToPersonal(docPath: string | undefined, userEmail: string | undefined): boolean {
    if (!docPath || !userEmail || !this.personalPath) return false;
    if (!isUnderPersonalRoot(docPath)) return false;
    const root = personalRootFor(userEmail.toLowerCase());
    return docPath === root || docPath.startsWith(root + '/');
  }
}
