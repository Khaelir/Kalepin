## Purpose

Standardizes MCP tool responses as compact JSON strings for efficient transport.

## Requirements

### Requirement: Compact JSON serialization for MCP
All MCP tool handlers returning structured data SHALL use `JSON.stringify(data)` (no indentation) instead of `JSON.stringify(data, null, 2)`.

#### Scenario: Any MCP tool returning JSON
- **WHEN** an MCP tool returns structured data (arrays, objects)
- **THEN** the JSON text content has no indentation or extra whitespace

### Requirement: REST API unaffected
The REST API response serialization SHALL remain unchanged. NestJS default serialization handles formatting for browser consumers.
