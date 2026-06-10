/**
 * Pins the audit invariant from `add-personal-user-folders` design.md#LIKE-escape:
 * any production SQL site that uses LIKE/GLOB on a path containing `_users/{email}`
 * MUST either bind `escapeLike(email)` OR use the static prefix `'\_users/%' ESCAPE '\'`
 * with no email concatenation. New sites that violate this fail this test.
 *
 * The check is purely textual; if you add a NEW LIKE-on-_users SQL site, either:
 *   1. use `escapeLike(...)` for any param that contains an email, OR
 *   2. use the literal prefix only, OR
 *   3. add the file to ALLOWED_NEW below with a comment explaining why it's safe.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

// Walk the .ts source tree, not the compiled dist/ output. The test runner runs
// from packages/backend (cwd), so src/ is the canonical location of the source files.
const SRC_DIR = path.resolve(process.cwd(), 'src');

const ALLOWED_FILES = new Set([
  // The auth module is the home of the canonical helpers and their tests.
  'auth/email.ts',
  'auth/email.test.ts',
  'auth/like-escape.ts',
  'auth/like-escape.test.ts',
  'auth/visibility.ts',
  'auth/visibility.test.ts',
  'auth/like-on-email-audit.test.ts',
  // The search service applies the predicate; the test pins the predicate string.
  'search/search.service.ts',
  'search/search-predicate.test.ts',
  // The link-index unlinked-mentions FTS sub-query inherits the same predicate (Phase 7.4).
  'links/link-index.service.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('LIKE-on-email audit', () => {
  it('every backend file using LIKE/GLOB on _users is on the allow-list', () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of walk(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file);
      if (ALLOWED_FILES.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (/LIKE.*_users|GLOB.*_users|MATCH.*_users/.test(line)) {
          offenders.push({ file: rel, line: i + 1, text: line.trim() });
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `New LIKE/GLOB/MATCH on _users found in non-allowed file(s). ` +
        `Either use escapeLike for the email binding, or add the file to ALLOWED_FILES with a justification:\n` +
        offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n'),
    );
  });
});
