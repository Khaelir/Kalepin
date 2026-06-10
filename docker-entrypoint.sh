#!/bin/sh
# Self-heal /data ownership before dropping to the unprivileged `node` user.
#
# Why: the runtime image runs as uid 1000 (`node`) and chowns /data at build
# time, but Docker named volumes that pre-date the non-root rollout retain
# their original (often uid 0) host-side ownership when re-attached. Without
# this fixup, SQLite returns SQLITE_READONLY on the first write and the
# service crash-loops. In Swarm there is no opportunity to run a one-shot
# `chown` from the operator side, so the image fixes itself on every boot.
#
# Cost: a single `stat` per top-level data dir on the steady state. The
# `chown -R` only runs when ownership is actually wrong.
set -e

for d in /data/vault /data/personal /data/db; do
  [ -d "$d" ] || continue
  if [ "$(stat -c '%u' "$d")" != "1000" ]; then
    echo "kalepin-entrypoint: fixing ownership of $d (was uid $(stat -c '%u' "$d"))"
    chown -R 1000:1000 "$d"
  fi
done

# Normalize the KEK secret so FileKEKSource's checks pass.
#
# Why: Docker Swarm mounts secrets at mode 0444; FileKEKSource requires 0400|0600.
# Portainer's secret editor accepts text only — not binary — so operators paste
# 64 hex chars. We decode that here to 32 raw bytes at /run/kalepin/kek (mode
# 0600, owned by node). Raw 32-byte secrets pass through unchanged with the
# perms tightened. Anything else is rejected loudly.
if [ -n "${KALEPIN_KEK_FILE:-}" ] && [ -f "$KALEPIN_KEK_FILE" ]; then
  node -e '
    const fs = require("fs");
    const path = require("path");
    const src = process.env.KALEPIN_KEK_FILE;
    const dst = "/run/kalepin/kek";
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const raw = fs.readFileSync(src);
    const trimmed = raw.toString("utf8").trim();
    let out;
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      out = Buffer.from(trimmed, "hex");
    } else if (raw.length === 32) {
      out = raw;
    } else {
      console.error(`kalepin-entrypoint: KALEPIN_KEK_FILE has bad shape (size=${raw.length} bytes); expected 32 raw bytes or 64 hex chars`);
      process.exit(1);
    }
    fs.writeFileSync(dst, out, { mode: 0o600 });
    fs.chownSync(dst, 1000, 1000);
  '
  export KALEPIN_KEK_FILE=/run/kalepin/kek
fi

# `setpriv` is in util-linux (already part of debian-slim) — no extra install
# needed, signal-clean for PID 1, drops privs and exec's in one shot.
exec setpriv --reuid=1000 --regid=1000 --init-groups -- "$@"
