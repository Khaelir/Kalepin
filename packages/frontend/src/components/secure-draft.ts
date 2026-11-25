export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface SecureDraftOptions {
  path: string;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  /** Save-state changes. Not called once the draft is closed. */
  onState?: (state: SaveState, error?: unknown) => void;
  /** Debounce between the last edit and its save. */
  delayMs?: number;
}

/**
 * One encrypted note open in the SecureEditor: its read, its unsaved edits
 * and their debounced save. A draft is bound to a single path for its whole
 * life, so a save can only write to the note the text was typed in; closing
 * it (switching notes) saves what is pending instead of dropping it, and a
 * read that comes back after that is ignored.
 */
export class SecureDraft {
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private readSeq = 0;
  private closed = false;

  constructor(private readonly opts: SecureDraftOptions) {}

  /**
   * Read the note. Resolves null when the draft was closed, or a newer read
   * started, before this one came back.
   */
  async load(): Promise<string | null> {
    const seq = ++this.readSeq;
    const stale = () => this.closed || seq !== this.readSeq;
    try {
      const text = await this.opts.read(this.opts.path);
      return stale() ? null : text;
    } catch (err) {
      if (stale()) return null;
      throw err;
    }
  }

  /** Record an edit and (re)arm the debounced save. */
  edit(content: string): void {
    if (this.closed) return;
    this.pending = content;
    this.emit('dirty');
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.delayMs ?? 800);
  }

  /** Save pending edits now. Saves run one at a time, so the last edit is the one that sticks. */
  flush(): Promise<void> {
    this.clearTimer();
    this.saving = this.saving.then(() => this.save());
    return this.saving;
  }

  /** Leave the note: save what is pending to this draft's path; later edits and reads are ignored. */
  close(): Promise<void> {
    if (this.closed) return this.saving;
    const done = this.flush();
    this.closed = true;
    return done;
  }

  private async save(): Promise<void> {
    const content = this.pending;
    if (content === null) return;
    this.emit('saving');
    try {
      await this.opts.write(this.opts.path, content);
      if (this.pending === content) this.pending = null;
      this.emit(this.pending === null ? 'saved' : 'dirty');
    } catch (err) {
      if (this.closed) console.error(`[SecureEditor] Could not save "${this.opts.path}" after leaving it:`, err);
      this.emit('error', err);
    }
  }

  private emit(state: SaveState, error?: unknown): void {
    if (!this.closed) this.opts.onState?.(state, error);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
