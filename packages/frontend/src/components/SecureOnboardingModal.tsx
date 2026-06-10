import React from 'react';

const SEEN_KEY = 'e2e-onboarding-seen/v1';

export function shouldShowSecureOnboarding(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return false; }
}

function markSecureOnboardingSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private browsing — ignore */ }
}

interface Props {
  onDismiss: () => void;
}

/**
 * One-time modal shown the first time a user opens or interacts with anything
 * under `_secure/`. Names the trade-offs the encrypted folder makes — search,
 * collab, comments, and share-links are all turned off — so the user picks the
 * folder eyes-open rather than discovering missing features one feature at a
 * time.
 */
export function SecureOnboardingModal({ onDismiss }: Props) {
  const close = () => {
    markSecureOnboardingSeen();
    onDismiss();
  };
  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 540 }}>
        <h3 className="modal-title">Welcome to your Encrypted Folder</h3>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          <p>
            Files in your Encrypted Folder are end-to-end encrypted with a
            master-KEK that lives <strong>only</strong> in your browser. Kalepin servers cannot read
            anything you put here.
          </p>
          <p style={{ marginTop: 12 }}><strong>What you give up in exchange:</strong></p>
          <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
            <li>No full-text or semantic search inside the Encrypted Folder.</li>
            <li>No real-time collaboration. Edits save serially with a debounce.</li>
            <li>No comments. No share-links. No MCP read access.</li>
            <li>No diffs in the change feed (metadata only).</li>
          </ul>
          <p style={{ marginTop: 12 }}><strong>What stays the same:</strong></p>
          <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
            <li>Sidebar, file tree, rename, move-into / move-out actions.</li>
            <li>Per-user export via <code>download-zip</code> (envelopes ship as raw bytes, with a manifest).</li>
            <li>Per-user vault reset and 24h emailed undo as the lost-passphrase escape hatch.</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            <strong>Lose the passphrase, lose the data.</strong> Generate a 24-word recovery phrase
            during setup unless you&apos;re sure you&apos;ll remember the passphrase.
          </p>
        </div>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="modal-btn modal-btn-confirm" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
