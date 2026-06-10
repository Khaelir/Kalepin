import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { McpService } from './mcp.service';

function readSource(): string {
  // Path resolution differs between test runner contexts (build dir vs source).
  const candidates = [
    path.join(__dirname, 'mcp.service.ts'),
    path.join(__dirname, '../../../../src/mcp/mcp.service.ts'), // dist/backend/src/mcp -> src/mcp
    path.join(__dirname, '../../src/mcp/mcp.service.ts'),
    path.join(process.cwd(), 'src/mcp/mcp.service.ts'),
    path.join(process.cwd(), 'packages/backend/src/mcp/mcp.service.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf-8');
  }
  throw new Error(`mcp.service.ts not found. Tried: ${candidates.join(', ')}`);
}

function extractWrapToolNames(src: string): Set<string> {
  // Match: this.wrapTool('<name>', user, ...)
  const re = /this\.wrapTool\(\s*'([^']+)'\s*,/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    found.add(m[1]);
  }
  return found;
}

describe('MCP tool registration', () => {
  it('REGISTERED_TOOLS catalog equals the set of wrapTool names in source', () => {
    const src = readSource();
    const fromSource = extractWrapToolNames(src);
    const fromCatalog = new Set<string>(McpService.REGISTERED_TOOLS);

    const missingInCatalog = [...fromSource].filter((n) => !fromCatalog.has(n));
    const stale = [...fromCatalog].filter((n) => !fromSource.has(n));

    assert.deepEqual(
      missingInCatalog,
      [],
      `tools registered via wrapTool() but not in McpService.REGISTERED_TOOLS — add: ${missingInCatalog.join(', ')}`,
    );
    assert.deepEqual(
      stale,
      [],
      `tools listed in McpService.REGISTERED_TOOLS but not registered via wrapTool() — remove: ${stale.join(', ')}`,
    );
  });

  it('every wrapTool body that takes a `path` arg threads `user.email` into a leaf call', () => {
    const src = readSource();
    // Naive but high-signal scan: split by `this.wrapTool('<name>', user, async (` and check each block.
    const re = /this\.wrapTool\(\s*'([^']+)'\s*,\s*user\s*,\s*async\s*\(\s*\{([^}]*)\}\s*\)\s*=>\s*\{([\s\S]*?)\n\s{6}\}\s*\)/g;
    const failures: string[] = [];
    let m: RegExpExecArray | null;
    const exemptTools = new Set([
      // No path arg — pure global / admin observers
      'list_backups',
      'create_backup',
      'restore_backup',
      'mcp_stats',
      // Operates on global query string only — visibility is enforced inside SearchService
      // via the FTS predicate when user.email is passed
      'get_updates',
    ]);
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      const args = m[2];
      const body = m[3];
      if (exemptTools.has(name)) continue;
      if (!/\bpath\b|notePath/.test(args)) continue; // tool has no path-like arg
      const usesEmail =
        body.includes('user.email') ||
        body.includes('assertReadableBy') ||
        body.includes('assertWritableBy');
      if (!usesEmail) {
        failures.push(`tool "${name}" takes a path argument but does not thread user.email or call assert*By`);
      }
    }
    assert.deepEqual(failures, []);
  });
});
