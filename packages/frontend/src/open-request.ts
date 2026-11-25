/**
 * Bookkeeping for `App.openFile`. Every note open starts a request; starting
 * the next one cancels the previous, which runs its teardown (WebSocket
 * listeners, the REST-fallback timer) and turns its `isCurrent()` false, so a
 * response that arrives for a note the user has already left is dropped
 * instead of landing on the note now on screen.
 */
export interface OpenRequest {
  /** False once a newer open started or the request was cancelled. */
  isCurrent(): boolean;
  /** Register teardown for when the request is superseded; runs at once if it already was. */
  onCancel(fn: () => void): void;
}

interface RequestState {
  cancelled: boolean;
  teardown: Array<() => void>;
}

export class OpenRequests {
  private current: RequestState | null = null;

  /** Start a new open, cancelling the one in flight. */
  begin(): OpenRequest {
    this.cancel();
    const state: RequestState = { cancelled: false, teardown: [] };
    this.current = state;
    return {
      isCurrent: () => !state.cancelled,
      onCancel: (fn) => {
        if (state.cancelled) fn();
        else state.teardown.push(fn);
      },
    };
  }

  /** Cancel the open in flight, if any (e.g. the note was closed). */
  cancel(): void {
    const state = this.current;
    this.current = null;
    if (!state || state.cancelled) return;
    state.cancelled = true;
    for (const fn of state.teardown.splice(0)) fn();
  }
}
