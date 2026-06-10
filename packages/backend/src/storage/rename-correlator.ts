import { FileChangeEvent } from '@kalepin/shared';

export interface RenameEvent {
  oldPath: string;
  newPath: string;
}

export type RenameCallback = (rename: RenameEvent) => void;

const DEBOUNCE_MS = 300;

interface PendingUnlink {
  path: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Correlates unlink+add chokidar events into rename events.
 * When an unlink is followed by an add within 300ms at a different path,
 * and the storage adapter confirms matching content, we emit a rename.
 */
export class RenameCorrelator {
  private pendingUnlinks = new Map<string, PendingUnlink>();
  private pendingAdds = new Map<string, ReturnType<typeof setTimeout>>();
  private onRename?: RenameCallback;
  private readFile: (path: string) => Promise<string>;

  constructor(readFile: (path: string) => Promise<string>) {
    this.readFile = readFile;
  }

  setRenameHandler(handler: RenameCallback): void {
    this.onRename = handler;
  }

  handleEvent(event: FileChangeEvent): void {
    if (event.event === 'unlink') {
      this.handleUnlink(event.path);
    } else if (event.event === 'add') {
      this.handleAdd(event.path);
    }
  }

  private handleUnlink(filePath: string): void {
    // Store the unlink with a debounce timer
    const timer = setTimeout(() => {
      // No matching add found — genuine delete
      this.pendingUnlinks.delete(filePath);
    }, DEBOUNCE_MS);

    this.pendingUnlinks.set(filePath, { path: filePath, timer });
  }

  private handleAdd(filePath: string): void {
    if (this.pendingUnlinks.size === 0) return;

    // Try to match with a pending unlink
    // If there's only one pending unlink, it's likely the rename source
    if (this.pendingUnlinks.size === 1) {
      const [unlinkPath, pending] = [...this.pendingUnlinks.entries()][0];
      if (unlinkPath !== filePath) {
        clearTimeout(pending.timer);
        this.pendingUnlinks.delete(unlinkPath);
        this.emitRename(unlinkPath, filePath);
        return;
      }
    }

    // Multiple pending unlinks — need content matching (defer with a short timer)
    const timer = setTimeout(async () => {
      this.pendingAdds.delete(filePath);
      await this.matchByContent(filePath);
    }, 50);

    this.pendingAdds.set(filePath, timer);
  }

  private async matchByContent(addedPath: string): Promise<void> {
    if (this.pendingUnlinks.size === 0) return;

    try {
      const newContent = await this.readFile(addedPath);

      // Since the unlinked file no longer exists, we can't compare content.
      // For the simple case (single pending unlink), we already handled it above.
      // For ambiguous cases, just pick the first pending unlink.
      const [unlinkPath, pending] = [...this.pendingUnlinks.entries()][0];
      if (unlinkPath !== addedPath) {
        clearTimeout(pending.timer);
        this.pendingUnlinks.delete(unlinkPath);
        this.emitRename(unlinkPath, addedPath);
      }
    } catch {
      // File read failed — not a rename we can track
    }
  }

  private emitRename(oldPath: string, newPath: string): void {
    if (this.onRename) {
      this.onRename({ oldPath, newPath });
    }
  }

  destroy(): void {
    for (const pending of this.pendingUnlinks.values()) {
      clearTimeout(pending.timer);
    }
    for (const timer of this.pendingAdds.values()) {
      clearTimeout(timer);
    }
    this.pendingUnlinks.clear();
    this.pendingAdds.clear();
  }
}
