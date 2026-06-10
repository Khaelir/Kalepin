// Frontend build-time feature flags. The values are injected by Vite's
// `define:` from `process.env` at build time (see `vite.config.ts`), so the
// rest of the codebase imports typed constants instead of touching raw env.

/**
 * Encrypted Folder UI. Backend pipeline (envelope crypto, predicates, secure
 * read/write/move/reset endpoints, ClientKEKSource) is always live. The UI
 * surfaces — sidebar placeholder, Move-to/from context menu items, setup/
 * unlock dialogs, `SecureEditor` mount, Settings → Security panel — are gated
 * here until a richer secure editor (editor parity work) ships.
 *
 * Set via `E2E_SECURE_FOLDER=1` at `vite build` / `vite dev` time. Default off.
 */
export const SECURE_FOLDER_ENABLED: boolean = __E2E_SECURE_FOLDER_ENABLED__;
