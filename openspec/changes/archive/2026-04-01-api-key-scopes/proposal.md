## Why

All API keys currently grant full access — the same power as a JWT session. When handing a key to an MCP client (Claude, Cursor), there's no way to restrict it to read-only. A key meant for browsing can delete notes, overwrite content, or trigger backups. Scoped API keys let users issue least-privilege keys to external tools.

## What Changes

- API keys gain a **scope** field: `ro` (Read-only), `rc` (Read + Comments), or `rw` (Full access)
- Backend enforces scope at the guard level — insufficient scope returns 403
- A new `/api/auth/api-keys/whoami` endpoint lets key holders discover their scope
- MCP server calls `/whoami` on startup and only registers tools the key's scope allows
- Frontend settings page adds a scope picker when creating keys and shows scope in the key list
- Existing keys default to `rw` (backwards-compatible, no breakage)

## Capabilities

### New Capabilities
- `api-key-scopes`: Scope profiles (ro, rc, rw) for API keys with dual enforcement (backend guard + MCP tool filtering)

### Modified Capabilities
- `api-keys-management`: Key creation now accepts a scope parameter; key listing returns scope
- `mcp-server`: MCP server dynamically filters registered tools based on key scope

## Impact

- **Backend**: `ApiKey` entity, `CombinedAuthGuard`, `AuthService`, `AuthController`, and all controllers using `CombinedAuthGuard` (need route-level permission decorators)
- **Frontend**: `SettingsPage.tsx` UI, `api.ts` client
- **MCP Server**: `index.ts` startup flow, `kalepin-client.ts`
- **API**: New `whoami` endpoint; `createApiKey` accepts `scope` body param; `listApiKeys` response includes `scope`
- **Database**: New `scope` column on `api_key` table (auto-synced by TypeORM `synchronize: true`)
