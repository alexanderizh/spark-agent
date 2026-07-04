#!/usr/bin/env bash
#
# Switch the better-sqlite3 native binary between the Node ABI (for vitest,
# run under plain Node) and the Electron ABI (for `pnpm dev` / packaging).
#
# Both prebuilt binaries are checked into vendor/prebuilds/better-sqlite3/ so
# switching is a file copy, not a recompile. Regenerate them if better-sqlite3
# is upgraded (see README in that directory).
set -euo pipefail

TARGET="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PREBUILD_DIR="$ROOT_DIR/vendor/prebuilds/better-sqlite3"
LIVE_BINARY="$ROOT_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

case "$TARGET" in
  node|electron)
    ;;
  *)
    echo "Usage: scripts/sqlite-abi.sh <node|electron>" >&2
    exit 1
    ;;
esac

SOURCE_BINARY="$PREBUILD_DIR/better_sqlite3.node.$TARGET"

if [ ! -f "$SOURCE_BINARY" ]; then
  echo "Missing prebuilt binary: $SOURCE_BINARY" >&2
  echo "Regenerate it (see vendor/prebuilds/better-sqlite3/README.md) before switching." >&2
  exit 1
fi

if [ ! -f "$LIVE_BINARY" ]; then
  echo "better-sqlite3 not installed yet at $LIVE_BINARY — run pnpm install first." >&2
  exit 1
fi

# Overwriting in place reuses the same inode, which macOS's dyld can keep
# mmap-cached and serve stale — remove first so the copy gets a fresh inode.
rm -f "$LIVE_BINARY"
cp "$SOURCE_BINARY" "$LIVE_BINARY"
echo "[sqlite-abi] switched better-sqlite3 to $TARGET ABI"
