## Context

Kalepin is a collaborative markdown editor with a React frontend (no router, custom components, dark theme) and a NestJS backend. The backend already has full API key CRUD endpoints (`POST/GET/DELETE /api/auth/api-keys`) protected by `JwtAuthGuard`. There is no frontend UI to access these endpoints — users must use curl. The frontend currently has no settings page or navigation beyond the workspace sidebar.

## Goals / Non-Goals

**Goals:**
- Provide a self-service UI for managing API keys (create, list, revoke)
- Integrate naturally into the existing app layout and dark theme
- Show the raw key exactly once after creation with a copy-to-clipboard flow

**Non-Goals:**
- Backend changes — existing endpoints are sufficient
- Key scoping or permissions (all keys have full access)
- Key expiration or rotation policies
- General settings page beyond API key management (can be extended later)

## Decisions

### 1. Navigation: View state in App.tsx, not a router

**Decision**: Add a simple view state (`workspace` | `settings`) to App.tsx and toggle between the editor workspace and a settings page.

**Rationale**: The app has no router and uses a single-page layout. Adding React Router for one page is over-engineering. A state toggle keeps things simple and consistent with the existing pattern. The settings view replaces the main content area while keeping the sidebar header.

**Alternative considered**: Adding React Router — rejected because it adds a dependency and complexity for a single additional view.

### 2. Settings page as a dedicated component

**Decision**: Create a `SettingsPage.tsx` component that handles the full API key lifecycle (list, create, revoke).

**Rationale**: Self-contained component with its own state management, using the existing `api.ts` helpers for HTTP calls. Follows the same pattern as other components like `LoginPage.tsx`.

### 3. One-time key display via inline reveal

**Decision**: After creating a key, show the raw key inline in the list with a copy button and a warning that it won't be shown again. The key display disappears on page navigation or refresh.

**Rationale**: Modal dialogs add complexity. An inline reveal is simpler and keeps the user in context. The transient nature (stored in component state, not persisted) ensures the key is only visible once.

### 4. Delete confirmation via inline prompt

**Decision**: Use an inline "Are you sure?" confirmation when revoking a key, rather than a modal.

**Rationale**: Consistent with the lightweight UI approach. Revocation is destructive but recoverable (user can create a new key).

## Risks / Trade-offs

- **[No key retrieval]** → Users who lose their key must revoke and create a new one. This is standard practice and documented in the UI.
- **[No router]** → Deep-linking to settings isn't possible. Acceptable for now; router can be added later if more pages emerge.
- **[Clipboard API]** → `navigator.clipboard.writeText` requires HTTPS or localhost. This matches the expected deployment. Fallback not needed for the target environments.
