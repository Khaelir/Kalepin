## Why

The backend already exposes REST endpoints for API key management (`POST/GET/DELETE /api/auth/api-keys`), but there is no frontend UI to use them. Users currently need curl or similar tools to create keys for the MCP server integration. Adding a settings panel makes key management self-service and accessible.

## What Changes

- Add a settings/account page accessible from the main app sidebar
- Display a list of the user's API keys showing name and creation date
- Allow creating new API keys with a custom name, with a one-time copy flow for the generated key
- Allow revoking (deleting) existing API keys with confirmation
- Add navigation to reach the settings page from the main workspace

## Capabilities

### New Capabilities
- `api-keys-management`: Frontend UI for creating, listing, and revoking API keys tied to the authenticated user's account

### Modified Capabilities
<!-- No existing spec-level requirements are changing -->

## Impact

- **Frontend**: New settings page component, updates to App.tsx for navigation/routing
- **Backend**: No changes — existing endpoints (`POST/GET/DELETE /api/auth/api-keys`) are sufficient
- **Styles**: New CSS for the settings page, consistent with existing dark theme
