#!/usr/bin/env bash
#
# Rebuild Electron native modules against the Electron runtime ABI.
#
# This must run before electron-builder packages node_modules. If these modules
# are left compiled for the developer/CI Node.js ABI, the installed app exits
# during startup when Electron tries to load better-sqlite3/keytar/node-pty.
set -euo pipefail

# Windows hardened environments may export NoDefaultCurrentDirectoryInExePath,
# which makes cmd.exe refuse to run executables from the current directory.
# node-pty's winpty.gyp runs `cmd /c "cd shared && GetCommitHash.bat"` and fails
# with "'GetCommitHash.bat' is not recognized as a command" when this is set.
# Clear it for this process tree so gyp actions resolve local .bat files.
# Harmless no-op on macOS/Linux.
unset NoDefaultCurrentDirectoryInExePath

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

# Resolve each native module to the canonical physical directory that
# electron-builder will eventually package. This works for hoisted pnpm
# installs, isolated installs, and leftover symlinked layouts.
ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"
APP_NM="$APP_DIR/node_modules"
echo "  Electron version   : $ELECTRON_VERSION"

IFS=',' read -ra _MODS <<< "$NATIVE_MODULES"

resolve_module_dirs() {
  node - "${_MODS[@]}" <<'NODE'
const fs = require('fs')
const path = require('path')
const mods = process.argv.slice(2)
for (const m of mods) {
  let key = ''
  try {
    const pj = require.resolve(`${m}/package.json`, { paths: [process.cwd()] })
    key = fs.realpathSync(path.dirname(pj))
  } catch (e) {
    // Leave empty so the shell side can report a missing install.
  }
  process.stdout.write(`${m}\t${key}\n`)
}
NODE
}

_MOD_KEYS=()
while IFS=$'\t' read -r _m _key; do
  [ -n "$_m" ] || continue
  _MOD_KEYS+=("$_key")
done < <(resolve_module_dirs)

echo "  Native modules resolved (module -> physical dir):"
_module_index=0
for m in "${_MODS[@]}"; do
  echo "    $m -> ${_MOD_KEYS[$_module_index]:-<unresolved>}"
  _module_index=$((_module_index + 1))
done

# Stage missing module directories into the app-local node_modules so
# electron-rebuild can always resolve them from apps/desktop.
_STAGED=()
_STAGED_KEYS=()
_module_index=0
for m in "${_MODS[@]}"; do
  _key="${_MOD_KEYS[$_module_index]:-}"
  [ -n "$_key" ] || fail "Unable to resolve native module $m physical directory; run pnpm install first"
  if [ ! -e "$APP_NM/$m" ]; then
    mkdir -p "$APP_NM"
    cp -R "$_key" "$APP_NM/$m"
    _STAGED+=("$m")
    _STAGED_KEYS+=("$_key")
  fi
  _module_index=$((_module_index + 1))
done

cleanup_staged() {
  [ "${#_STAGED[@]}" -gt 0 ] || return 0
  for m in "${_STAGED[@]}"; do
    [ -n "${m:-}" ] && rm -rf "$APP_NM/$m"
  done
  return 0
}
trap cleanup_staged EXIT

pnpm exec electron-rebuild -f --arch "$TARGET_ARCH" --only "$NATIVE_MODULES" --version "$ELECTRON_VERSION"

# Copy staged rebuild outputs back to the canonical module directories.
if [ "${#_STAGED[@]}" -gt 0 ]; then
  for (( _module_index=0; _module_index<${#_STAGED[@]}; _module_index++ )); do
    m="${_STAGED[$_module_index]}"
    _key="${_STAGED_KEYS[$_module_index]:-}"
    [ -n "$_key" ] && [ -d "$_key" ] || continue
    [ -d "$APP_NM/$m" ] || continue
    cp -R "$APP_NM/$m/." "$_key/"
  done
fi
ok "Native modules rebuilt for Electron ($TARGET_ARCH)"

if [ "$TARGET_ARCH" = "$HOST_ARCH" ]; then
  step "Electron native module ABI verification"
  pnpm run native:verify
  ok "Native modules load under Electron"
else
  warn "Skipping runtime ABI verification because host arch ($HOST_ARCH) differs from target arch ($TARGET_ARCH)"
  warn "Run this build on a $TARGET_ARCH runner before release so Electron can load-test native modules."
fi
