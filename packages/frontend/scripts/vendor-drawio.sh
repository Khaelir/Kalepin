#!/usr/bin/env bash
# Downloads draw.io webapp assets from a specific GitHub release.
# Vendored files are stored in packages/frontend/public/drawio/ and served
# as static assets (not bundled in JS).
#
# Idempotent: skips download if the target version is already vendored.
# This makes it Docker-layer-cache-friendly — the layer only rebuilds when
# DRAWIO_VERSION changes.
#
# Usage: bash packages/frontend/scripts/vendor-drawio.sh [VERSION]
# Default version: v26.2.2

set -euo pipefail

VERSION="${1:-v26.2.2}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$SCRIPT_DIR/../public/drawio"

# Skip if already vendored at the correct version
if [ -f "$DEST/VERSION" ] && [ "$(cat "$DEST/VERSION")" = "$VERSION" ]; then
  echo "draw.io $VERSION already vendored — skipping download."
  exit 0
fi

TMP_DIR=$(mktemp -d)
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "Downloading draw.io $VERSION..."
ARCHIVE_URL="https://github.com/jgraph/drawio/archive/refs/tags/${VERSION}.tar.gz"
curl -fsSL "$ARCHIVE_URL" -o "$TMP_DIR/drawio.tar.gz"

echo "Extracting..."
tar xzf "$TMP_DIR/drawio.tar.gz" -C "$TMP_DIR"

SRC="$TMP_DIR/drawio-${VERSION#v}/src/main/webapp"

if [ ! -d "$SRC" ]; then
  echo "ERROR: Expected directory not found: $SRC"
  ls -la "$TMP_DIR"
  exit 1
fi

# Clean previous vendor (preserve custom embed.html)
if [ -f "$DEST/embed.html" ]; then
  cp "$DEST/embed.html" "$TMP_DIR/_drawio_embed.html.bak"
fi
rm -rf "$DEST"
mkdir -p "$DEST"

# Copy with original directory structure (app.min.js expects these relative paths)
echo "Copying core JS..."
mkdir -p "$DEST/js"
cp "$SRC/js/app.min.js" "$DEST/js/"
# draw.io lazy-loads these after app.min.js — required for editor init
for f in shapes-14-6-5.min.js stencils.min.js extensions.min.js; do
  [ -f "$SRC/js/$f" ] && cp "$SRC/js/$f" "$DEST/js/" && echo "  copied js/$f"
done

echo "Copying styles..."
mkdir -p "$DEST/styles"
for f in "$SRC"/styles/*.css "$SRC"/styles/*.xml "$SRC"/styles/*.png; do
  [ -f "$f" ] && cp "$f" "$DEST/styles/"
done
# Fonts used by draw.io shapes
if [ -d "$SRC/styles/fonts" ]; then
  cp -r "$SRC/styles/fonts" "$DEST/styles/"
  echo "  copied styles/fonts/"
fi
# mxGraph CSS — app.min.js loads from mxgraph/css/ despite mxBasePath="."
mkdir -p "$DEST/css" "$DEST/mxgraph/css"
if [ -f "$SRC/mxgraph/css/common.css" ]; then
  cp "$SRC/mxgraph/css/common.css" "$DEST/css/"
  cp "$SRC/mxgraph/css/common.css" "$DEST/mxgraph/css/"
fi

echo "Copying resources..."
cp -r "$SRC/resources" "$DEST/"

echo "Copying images..."
[ -d "$SRC/images" ] && cp -r "$SRC/images" "$DEST/"
# Merge mxGraph images into images/ (resize handles, window chrome, etc.)
if [ -d "$SRC/mxgraph/images" ]; then
  cp "$SRC/mxgraph/images"/* "$DEST/images/" 2>/dev/null || true
  echo "  merged mxgraph images into images/"
fi

# Skip stencils/shapes/math to reduce size (loaded lazily by draw.io, optional)

# Restore custom embed.html if it was backed up
if [ -f "$TMP_DIR/_drawio_embed.html.bak" ]; then
  mv "$TMP_DIR/_drawio_embed.html.bak" "$DEST/embed.html"
  echo "Restored custom embed.html"
fi

# Write version marker for idempotency check
echo "$VERSION" > "$DEST/VERSION"

TOTAL_SIZE=$(du -sh "$DEST" | cut -f1)
echo "Done! Vendored draw.io $VERSION → $DEST ($TOTAL_SIZE)"
