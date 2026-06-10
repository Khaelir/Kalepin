# @kalepin/backend

NestJS backend for Kalepin — serves the REST API, WebSocket OT gateway, and MCP server.

## Admin Endpoints

### Usage Stats

MCP tool call analytics, accessible to admin-scoped API keys (`admin:stats` permission).

| Endpoint | Description |
|---|---|
| `GET /api/admin/stats/overview` | Daily aggregates over the last 14 days |
| `GET /api/admin/stats/mcp-tools` | Per-tool breakdown |
| `GET /api/admin/stats/users` | Per-user breakdown |

**Example responses:**

```bash
# Daily overview
curl -H "Authorization: Bearer kp_..." http://localhost:3000/api/admin/stats/overview
```

```json
{
  "days": [
    { "date": "2026-04-08", "totalCalls": 142, "errors": 3, "avgDurationMs": 45 }
  ]
}
```

```bash
# Per-tool stats
curl -H "Authorization: Bearer kp_..." http://localhost:3000/api/admin/stats/mcp-tools
```

```json
{
  "tools": [
    { "toolName": "search_notes", "totalCalls": 512, "avgDurationMs": 120, "maxDurationMs": 890, "errors": 2 }
  ]
}
```

```bash
# Per-user stats
curl -H "Authorization: Bearer kp_..." http://localhost:3000/api/admin/stats/users
```

```json
{
  "users": [
    { "userId": 1, "email": "alice@example.com", "totalCalls": 420, "lastActive": "2026-04-08T14:30:00Z", "topTools": ["search_notes", "read_note", "list_files"] }
  ]
}
```

Usage logs are automatically pruned after 14 days (daily cron + startup cleanup).
