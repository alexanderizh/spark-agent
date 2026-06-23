#!/usr/bin/env bash
#
# Rebuild Electron native modules against the Electron runtime ABI.
#
# This must run before electron-builder packages node_modules. If these modules
# are left compiled for the developer/CI Node.js ABI, the installed app exits
# during startup when Electron tries to load better-sqlite3/keytar/node-pty.
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail() { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step() { echo -e "\n${CYAN}========== $* ==========${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

if [ "${1:-}" = "--" ]; then
  shift
fi

TARGET_ARCH="${1:-${npm_config_arch:-$(node -p 'process.arch')}}"
HOST_ARCH="$(node -p 'process.arch')"
NATIVE_MODULES="${NATIVE_MODULES:-node-pty,better-sqlite3,keytar}"

case "$TARGET_ARCH" in
  arm64|x64)
    ;;
  universal)
    echo "Universal native rebuilds are intentionally unsupported. Build arm64 and x64 artifacts separately."
    exit 1
    ;;
  *)
    echo "Unsupported Electron native module target arch: $TARGET_ARCH"
    exit 1
    ;;
esac

ensure_python_for_node_gyp() {
  # node-gyp 9.x imports distutils, which was removed from Python 3.12+ stdlib.
  if python3 -c "import distutils" >/dev/null 2>&1; then
    return 0
  fi

  warn "Python distutils unavailable (common on 3.12+); installing setuptools for node-gyp"
  # Homebrew / macOS system Python is PEP 668 externally-managed.
  if python3 -m pip install --upgrade setuptools 2>/dev/null \
    || python3 -m pip install --user --break-system-packages --upgrade setuptools; then
    return 0
  fi

  fail "Could not prepare Python for node-gyp. Use Python 3.11 or run: python3 -m pip install --user --break-system-packages setuptools"
}

step "Electron native module rebuild"
echo "  App dir      : $APP_DIR"
echo "  Host arch    : $HOST_ARCH"
echo "  Target arch  : $TARGET_ARCH"
echo "  Modules      : $NATIVE_MODULES"

ensure_python_for_node_gyp

pnpm exec electron-rebuild -f --arch "$TARGET_ARCH" -w "$NATIVE_MODULES"
ok "Native modules rebuilt for Electron ($TARGET_ARCH)"

if [ "$TARGET_ARCH" = "$HOST_ARCH" ]; then
  step "Electron native module ABI verification"
  pnpm run native:verify
  ok "Native modules load under Electron"
else
  warn "Skipping runtime ABI verification because host arch ($HOST_ARCH) differs from target arch ($TARGET_ARCH)"
  warn "Run this build on a $TARGET_ARCH runner before release so Electron can load-test native modules."
fi
