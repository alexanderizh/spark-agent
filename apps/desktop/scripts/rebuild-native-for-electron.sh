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

# ── 在 pnpm nodeLinker:hoisted 布局下正确重编译原生模块 ───────────────────────
#
# 背景：hoisted 把生产原生模块（better-sqlite3/node-pty/keytar）提升到 monorepo 根
# node_modules，apps/desktop/node_modules 里没有。electron-rebuild 只会重编译
# 「项目 package.json 声明 + 物理位于该项目 node_modules」的模块——hoisted 下两者
# 分离（apps/desktop 声明、根物理），导致 electron-rebuild 找不到、不重编译，
# 最终发布出 Node-ABI 二进制 → 安装后启动崩 (NODE_MODULE_VERSION 127 vs 125)。
#
# 不能用的几种办法：① 改根 package.json 声明依赖 → 触发 pnpm verify-deps 自动 install
# 把重建冲掉；② 软链进 apps/desktop → arborist 不跟随跨目录软链 (ENOENT)。
#
# 可行办法：把根上的原生模块「复制」进 apps/desktop/node_modules（arborist 认实目录），
# 从 apps/desktop 跑 electron-rebuild（package.json 与 lockfile 一致，不触发自动安装），
# 重编译后把整模块覆盖拷回根——即 electron-builder 实际收集（require.resolve 解析）处。
ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"
NATIVE_NM_DIR="$(node -e "const path=require('path');const p=require.resolve('better-sqlite3/package.json');console.log(path.dirname(path.dirname(p)))")"
APP_NM="$APP_DIR/node_modules"
echo "  Electron version   : $ELECTRON_VERSION"
echo "  Native modules dir : $NATIVE_NM_DIR"

IFS=',' read -ra _MODS <<< "$NATIVE_MODULES"
_STAGED=()
_HOISTED=0
if [ "$NATIVE_NM_DIR" != "$APP_NM" ]; then
  _HOISTED=1
  mkdir -p "$APP_NM"
  for m in "${_MODS[@]}"; do
    if [ -d "$NATIVE_NM_DIR/$m" ] && [ ! -e "$APP_NM/$m" ]; then
      cp -R "$NATIVE_NM_DIR/$m" "$APP_NM/$m"
      _STAGED+=("$m")
    fi
  done
fi

# 即使中途失败也清理暂存副本，避免污染 apps/desktop/node_modules
cleanup_staged() {
  for m in "${_STAGED[@]:-}"; do
    [ -n "${m:-}" ] && rm -rf "$APP_NM/$m"
  done
}
trap cleanup_staged EXIT

pnpm exec electron-rebuild -f --arch "$TARGET_ARCH" --only "$NATIVE_MODULES" --version "$ELECTRON_VERSION"

# 把重编译产物覆盖拷回根（electron-builder 收集处）。覆盖式拷贝（不 rm 根目录），
# 保留模块结构、仅更新 build/Release、bin/<platform>-<abi>、prebuilds 等二进制。
if [ "$_HOISTED" = "1" ]; then
  for m in "${_MODS[@]}"; do
    if [ -d "$APP_NM/$m" ] && [ -d "$NATIVE_NM_DIR/$m" ]; then
      cp -R "$APP_NM/$m/." "$NATIVE_NM_DIR/$m/"
    fi
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
