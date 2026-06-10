import { Controller, Get, Header } from '@nestjs/common';

// Documentation page advertised by the OAuth resource and AS metadata
// (`resource_documentation`, `service_documentation`). Returned as a small
// self-contained HTML page so it remains accessible from claude.ai's
// connector setup flow without requiring the SPA to be loaded.
@Controller('docs')
export class DocsController {
  private get baseUrl(): string {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }

  @Get('mcp')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  mcpDocs(): string {
    const mcpUrl = `${this.baseUrl}/mcp`;
    const settingsUrl = `${this.baseUrl}/`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kalepin MCP connector</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1f2937; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 32px; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95em; }
  pre { background: #f3f4f6; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
  ol li { margin-bottom: 8px; }
  .note { background: #eff6ff; border-left: 3px solid #3b82f6; padding: 10px 14px; border-radius: 4px; margin: 20px 0; font-size: 14px; }
  a { color: #2563eb; }
</style>
</head>
<body>
<h1>Connect Claude to your Kalepin notes</h1>
<p>This Kalepin instance exposes a Model Context Protocol (MCP) server you can add to Claude as a custom connector. Once connected, Claude can read your notes, search them, and (with your permission) edit them on your behalf.</p>

<h2>Prerequisites</h2>
<ul>
  <li>A Kalepin account on this instance.</li>
  <li>A Claude.ai plan that supports custom connectors (Pro, Max, Team, or Enterprise).</li>
</ul>

<h2>Add the connector in Claude</h2>
<ol>
  <li>Open <a href="https://claude.ai/settings/connectors?modal=add-custom-connector" target="_blank" rel="noopener">claude.ai → Settings → Connectors</a> (this deep link opens the <em>Add custom connector</em> dialog directly).</li>
  <li>If the dialog didn't open automatically, scroll to the bottom of the connectors list and click <strong>Add custom connector</strong>.</li>
  <li>Paste the MCP server URL: <pre><code>${mcpUrl}</code></pre></li>
  <li>Claude redirects you back to this Kalepin instance to confirm the connection. Sign in if needed, choose a permission level (read, comment, or full), and click <strong>Allow</strong>.</li>
</ol>
<p><em>Team / Enterprise plans:</em> only an organization Owner can add a custom connector. Once an Owner has added it, every member can connect their own account.</p>

<h2>Permission levels</h2>
<ul>
  <li><strong>Read notes</strong> (<code>notes.read</code>): see note content, titles, and metadata.</li>
  <li><strong>Read + Comment</strong> (<code>notes.comment</code>): also lets Claude post and resolve comments.</li>
  <li><strong>Full</strong> (<code>notes.write</code>): also lets Claude create, edit, and delete notes.</li>
</ul>

<h2>Manage or revoke access</h2>
<p>Open Kalepin → Settings → Connections (<a href="${settingsUrl}">${settingsUrl}</a>). Each Claude connection appears alongside any CLI API keys. Revoking a connection immediately invalidates Claude's access — in-flight tool calls will fail with HTTP 401 and the connector surfaces the error.</p>

<div class="note">
  Need the connector for the Claude Code CLI instead? Use the <strong>+ New API key</strong> card in Settings — that path uses the original kp_ API key flow rather than OAuth.
</div>

<h2>Standards</h2>
<p>This server implements OAuth 2.1 with PKCE, RFC 7591 (Dynamic Client Registration), RFC 7009 (Token Revocation), RFC 8414 (Authorization Server Metadata), and RFC 9728 (Protected Resource Metadata). See the <code>/.well-known/oauth-authorization-server</code> and <code>/.well-known/oauth-protected-resource</code> endpoints for machine-readable details.</p>
</body>
</html>`;
  }
}
