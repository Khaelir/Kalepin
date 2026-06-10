import React, { useEffect, useRef, useState } from 'react';

interface ConnectClaudeWizardProps {
  onClose: () => void;
}

const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors?modal=add-custom-connector';
const CLAUDE_PLAN_DOCS_URL = 'https://support.anthropic.com/en/articles/11176164-pre-built-connectors-using-remote-mcp';

export function ConnectClaudeWizard({ onClose }: ConnectClaudeWizardProps) {
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const mcpUrl = `${window.location.origin}/mcp`;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="connect-wizard-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-wizard-title"
      onMouseDown={handleBackdropClick}
    >
      <div className="connect-wizard" ref={dialogRef}>
        <header className="connect-wizard-header">
          <h2 id="connect-wizard-title" className="connect-wizard-title">Connect to Claude.ai</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="connect-wizard-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <p className="connect-wizard-plan-note">
          Adding a custom connector requires a Pro, Max, Team, or Enterprise Claude.ai plan. On
          Team and Enterprise workspaces, only an <strong>organization Owner</strong> can add a
          custom connector — once they do, every member can connect their own account.{' '}
          <a href={CLAUDE_PLAN_DOCS_URL} target="_blank" rel="noopener noreferrer">
            See Claude's documentation
          </a>
          .
        </p>

        <ol className="connect-wizard-steps">
          <li className="connect-wizard-step">
            <div className="connect-wizard-step-number">1</div>
            <div className="connect-wizard-step-body">
              <h3 className="connect-wizard-step-title">Open Claude.ai connectors</h3>
              <p className="connect-wizard-step-desc">
                Opens <strong>Settings → Connectors</strong> in Claude.ai with the
                <em> Add custom connector </em> dialog ready. You will need to be signed in to
                your Claude account.
              </p>
              <a
                className="connect-wizard-link-btn"
                href={CLAUDE_CONNECTORS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Claude.ai connectors
              </a>
            </div>
          </li>

          <li className="connect-wizard-step">
            <div className="connect-wizard-step-number">2</div>
            <div className="connect-wizard-step-body">
              <h3 className="connect-wizard-step-title">Add a custom connector</h3>
              <p className="connect-wizard-step-desc">
                If the dialog didn't open automatically, scroll to the bottom of the connectors
                list and click <strong>Add custom connector</strong>. Paste the URL below into
                the dialog and click <strong>Add</strong>.
              </p>
              <div className="connect-wizard-url-row">
                <input
                  type="text"
                  className="connect-wizard-url-input"
                  value={mcpUrl}
                  readOnly
                  onFocus={(e) => e.target.select()}
                  aria-label="Kalepin MCP server URL"
                />
                <button
                  type="button"
                  className="connect-wizard-copy-btn"
                  onClick={handleCopy}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </li>

          <li className="connect-wizard-step">
            <div className="connect-wizard-step-number">3</div>
            <div className="connect-wizard-step-body">
              <h3 className="connect-wizard-step-title">Approve in Kalepin</h3>
              <p className="connect-wizard-step-desc">
                Claude will redirect you back to Kalepin to confirm the connection. After you click "Allow",
                Claude will be able to read and (depending on the scope you grant) edit your notes.
                You can revoke this access at any time from this Settings page.
              </p>
            </div>
          </li>
        </ol>

        <footer className="connect-wizard-footer">
          <button type="button" className="connect-wizard-done-btn" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
