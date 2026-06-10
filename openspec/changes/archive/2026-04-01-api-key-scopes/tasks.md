## 1. Backend — Permission Model

- [x] 1.1 Create `packages/backend/src/auth/permissions.ts` with permission atoms, `SCOPE_PERMISSIONS` map, and `ApiKeyScope` type (`'ro' | 'rc' | 'rw'`)
- [x] 1.2 Add `scope` column (string, default `'rw'`, nullable) to `ApiKey` entity
- [x] 1.3 Update `verifyApiKey` in `AuthService` to return `scope` in the payload (treat NULL as `'rw'`)

## 2. Backend — Guard Enforcement

- [x] 2.1 Create `@RequiredScope(permission)` decorator using `SetMetadata`
- [x] 2.2 Update `CombinedAuthGuard` to read `@RequiredScope` metadata, check API key scope against `SCOPE_PERMISSIONS`, and throw `ForbiddenException` (403) if insufficient. JWT requests bypass the check.
- [x] 2.3 Add `@RequiredScope(...)` to all routes in `FilesController`, `AttachmentsController`, `CommentsController`, `StarsController`, `LinksController`, `UpdatesController`, `SearchController`, `McpController`, `BackupController`, `AuthController`

## 3. Backend — API Changes

- [x] 3.1 Update `createApiKey` in `AuthService` and `AuthController` to accept `scope` parameter (default `'rw'`)
- [x] 3.2 Update `listApiKeys` to return `scope` in response
- [x] 3.3 Add `GET /api/auth/api-keys/whoami` endpoint returning `{ scope, permissions[] }`

## 4. Frontend — Settings Page

- [x] 4.1 Update `ApiKeyInfo` type in `api.ts` to include `scope` field
- [x] 4.2 Update `createApiKey` in `api.ts` to send `scope` in request body
- [x] 4.3 Add scope radio picker (Read-only / Read + Comments / Full access) to the create key form, defaulting to Read-only
- [x] 4.4 Show scope badge next to each key name in the key list

## 5. MCP Server — Tool Filtering

- [x] 5.1 Add `whoami()` method to `KalepinClient` calling `GET /api/auth/api-keys/whoami`
- [x] 5.2 On startup, call `whoami()` and conditionally register tools based on returned permissions
- [x] 5.3 Log which tools were registered and which were skipped due to scope

## 6. Testing

- [x] 6.1 Test that `ro` key can read notes and is rejected (403) on write endpoints
- [x] 6.2 Test that `rc` key can read notes and add comments, but is rejected on create/edit/delete note
- [x] 6.3 Test that `rw` key has full access (no regression)
- [x] 6.4 Test that legacy keys (NULL scope) are treated as `rw`
- [x] 6.5 Test `/whoami` returns correct scope and permissions for each profile
