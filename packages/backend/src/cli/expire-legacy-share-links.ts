/**
 * Legacy share-link expiry CLI.
 *
 *   node dist/backend/src/cli/expire-legacy-share-links.js --before 2026-05-01
 *   node dist/backend/src/cli/expire-legacy-share-links.js --before 2026-05-01 --apply
 *
 * Marks every `short_links` row that:
 *   - was minted by the auto-mint code path (`created_by_email IS NULL`), and
 *   - was created strictly before the `--before` date, and
 *   - is not already expired or revoked
 *
 * as expired (`expires_at = now`). This is the operator-controlled clean-break
 * for deployments that were running before the explicit-mint contract shipped:
 * those rows have indeterminate provenance and cannot be retired safely on
 * upgrade alone (some are still being used, some are leaked URLs).
 *
 * Default is dry-run; pass `--apply` to actually update rows.
 */
import Database from 'better-sqlite3';

interface Args {
  before: string;
  apply: boolean;
  dbPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    before: '',
    apply: false,
    dbPath: process.env.DB_PATH || './data/kalepin.sqlite',
  };
  for (const arg of argv) {
    if (arg.startsWith('--before=')) {
      args.before = arg.slice('--before='.length);
    } else if (arg === '--before') {
      // handled below by positional pairing
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg.startsWith('--db=')) {
      args.dbPath = arg.slice('--db='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  // Support `--before 2026-05-01` as well as `--before=2026-05-01`.
  const idx = argv.indexOf('--before');
  if (idx !== -1 && idx + 1 < argv.length && !args.before) {
    args.before = argv[idx + 1];
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      'Usage: expire-legacy-share-links --before YYYY-MM-DD [--apply] [--db=PATH]',
      '',
      'Marks legacy auto-minted share-link rows (created_by_email IS NULL) as',
      'expired when their created_at is older than the given date. Default is',
      'dry-run; pass --apply to commit the change.',
      '',
      'Use this when migrating a pre-existing deployment to the explicit-mint',
      'contract and you want a clean break on URLs that were minted before any',
      'auditable provenance was attached.',
    ].join('\n'),
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.before) {
    console.error('error: --before YYYY-MM-DD is required');
    process.exit(1);
  }

  const beforeMs = Date.parse(args.before);
  if (Number.isNaN(beforeMs)) {
    console.error(`error: --before "${args.before}" is not a valid date`);
    process.exit(1);
  }

  const db = new Database(args.dbPath);
  // CreateDateColumn stores ISO-8601 strings with a CURRENT_TIMESTAMP default.
  // Comparing as strings works lexicographically for that format, but we use
  // the Unix-epoch comparison via the helper to avoid timezone surprises.
  const selectSql = `
    SELECT code, path, created_at
    FROM short_links
    WHERE created_by_email IS NULL
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
      AND CAST(strftime('%s', created_at) AS INTEGER) * 1000 < ?
  `;
  const now = Date.now();
  const candidates = db.prepare(selectSql).all(now, beforeMs) as Array<{
    code: string;
    path: string;
    created_at: string;
  }>;

  console.log(
    `Found ${candidates.length} legacy share-link rows created before ${args.before} (cutoff = ${beforeMs}).`,
  );
  for (const row of candidates) {
    console.log(`  ${row.code}  ${row.created_at}  ${row.path}`);
  }

  if (!args.apply) {
    console.log('\nDry run — pass --apply to mark these rows as expired.');
    db.close();
    return;
  }

  const updateSql = `UPDATE short_links SET expires_at = ? WHERE code = ?`;
  const stmt = db.prepare(updateSql);
  const trx = db.transaction((rows: typeof candidates) => {
    for (const r of rows) stmt.run(now, r.code);
  });
  trx(candidates);
  console.log(`\nApplied: ${candidates.length} rows updated. expires_at = ${now}.`);
  db.close();
}

main();
