import { Injectable } from '@nestjs/common';

// Per-grant in-process lock so concurrent /oauth/token refreshes on the same
// grant cannot split the rotation chain (see design.md Decision 13 and the
// "Per-grant refresh serialisation" spec requirement).
//
// Implementation: a Map<grantId, Promise<unknown>> chains every acquire onto
// the previous tail. When the tail settles, the slot is cleared so finished
// grants don't accumulate. Single-process only; if the backend is ever scaled
// horizontally this needs to move to a row-level DB lock or external store.
@Injectable()
export class GrantLock {
  private tails = new Map<number, Promise<unknown>>();

  async withLock<T>(grantId: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(grantId) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const next = previous.then(() => gate);
    this.tails.set(grantId, next);

    try {
      await previous;
      return await fn();
    } finally {
      release();
      // Clear the slot only if no later acquirer chained on top of us.
      if (this.tails.get(grantId) === next) {
        this.tails.delete(grantId);
      }
    }
  }
}
