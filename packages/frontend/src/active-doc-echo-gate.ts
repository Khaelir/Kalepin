// Decides whether a `file:changed` event for an active document should
// surface the "File changed externally" toast. When the OT session received a
// revision (ack/op) within the last 2 seconds, the watcher event is the
// echo of our own flush — not a real external edit — and the toast is noise.
//
// Out-of-band edits (no recent OT activity) still produce the toast.
// Non-active-doc events are always toasted (different code path; this helper
// is only consulted when the path matches the active document).

const ECHO_WINDOW_MS = 2000;

export interface EchoGateInput {
  isActive: boolean;
  /** ms-epoch of the last `op`/`ack` frame on the active doc; 0 if none. */
  lastOTRevisionAt: number;
  now: number;
}

export interface EchoGateDecision {
  /** Surface the "File changed externally" toast. */
  showToast: boolean;
  /** Re-read the file content from REST and refresh `docState`. */
  refreshContent: boolean;
}

export function decideActiveDocEcho(input: EchoGateInput): EchoGateDecision {
  const recentOT = input.now - input.lastOTRevisionAt < ECHO_WINDOW_MS;
  if (input.isActive && recentOT) {
    // Our own flush, echoed back. The OT engine already has the latest content.
    return { showToast: false, refreshContent: false };
  }
  if (input.isActive) {
    // Active doc but no recent OT signal → external editor wrote it. Toast +
    // refresh.
    return { showToast: true, refreshContent: true };
  }
  // Not active — toast only; the editor doesn't need a refresh.
  return { showToast: true, refreshContent: false };
}
