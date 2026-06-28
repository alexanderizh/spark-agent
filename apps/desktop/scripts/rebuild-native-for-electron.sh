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

# ── 在 pnpm 各类布局下正确重编译 Electron 原生模块 ────────────────────────────
#
# 背景：electron-rebuild 只重编译「项目 package.json 声明 + 物理位于该项目 node_modules」
# 的模块。但 pnpm 可能把原生模块放在别处：
#   - hoisted（nodeLinker: hoisted）：模块提升到 monorepo 根 node_modules，
#     apps/desktop/node_modules 里没有 → electron-rebuild 找不到、不重编译，
#     发布出 Node-ABI 二进制 → 安装后启动崩 (NODE_MODULE_VERSION 127 vs 125)。
#   - isolated（默认）/ shamefully-hoist + 残留软链：apps/desktop/node_modules/$m 是
#     指向 .pnpm/<pkg>/node_modules/$m 的软链；electron-rebuild 能跟随软链重编译，
#     但若脚本再 `cp -R 软链/. 物理目录/` 会因 "are the same file" 直接失败。
#
# 不能用的几种办法：① 改根 package.json 声明依赖 → 触发 pnpm verify-deps 自动 install
# 把重建冲掉；② 软链进 apps/desktop → arborist 不跟随跨目录软链 (ENOENT)。
#
# 可行办法（按模块各自解析 require.resolve 的物理目录）：
#   - hoisted：把模块暂存复制进 apps/desktop/node_modules（arborist 认实目录），
#     跑 electron-rebuild 重编译，再覆盖拷回 electron-builder 实际收集处。
#   - isolated / 软链：apps/desktop 里已有软链，无需复制；electron-rebuild 就地改写
#     物理目录；拷回阶段比对物理路径，相同则短路跳过，避免 "are the same file"。
ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"
APP_NM="$APP_DIR/node_modules"
echo "  Electron version   : $ELECTRON_VERSION"

IFS=',' read -ra _MODS <<< "$NATIVE_MODULES"

# 为每个原生模块解析「electron-builder 实际收集处的物理目录」（模块自身目录，跟随软链）。
#
# 三种布局下 require.resolve 都从 apps/desktop 出发：
#   - hoisted：模块物理在 monorepo 根 node_modules，apps/desktop 里没有该目录；
#   - isolated / shamefully-hoist+残留软链：apps/desktop/node_modules/$m 是指向
#     .pnpm/<pkg>/node_modules/$m 的软链，require.resolve 跟随软链落在真正的物理目录。
# electron-builder 收集规则与 require.resolve 一致，故取 require.resolve 结果的 dirname
# 再 realpathSync，即得到该模块的物理目录。旧实现把 better-sqlite3 的父容器目录
# （node_modules）当作所有模块共用，在 isolated 下指向一个不含 node-pty/keytar 的 .pnpm
# 子目录，导致这两个模块拷回目标错误；改为按模块各自解析修正。
resolve_module_dirs() {
  node - "${_MODS[@]}" <<'NODE'
const fs = require('fs')
const path = require('path')
const mods = process.argv.slice(2)
for (const m of mods) {
  let key = ''
  try {
    const pj = require.resolve(`${m}/package.json`, { paths: [process.cwd()] })
    key = fs.realpathSync(path.dirname(pj)) // 模块自身的物理目录（含 package.json）
  } catch (e) {
    // 留空，调用侧按未安装报错
  }
  // 用 \t 分隔，避免路径含空格被 word splitting 破坏
  process.stdout.write(`${m}\t${key}\n`)
}
NODE
}

declare -A MOD_KEY=() # 模块 -> 该模块的物理目录（electron-builder 收集处）
while IFS=$'\t' read -r _m _key; do
  [ -n "$_m" ] || continue
  MOD_KEY[$_m]="$_key"
done < <(resolve_module_dirs)

echo "  Native modules resolved (module -> physical dir):"
for m in "${_MODS[@]}"; do
  echo "    $m -> ${MOD_KEY[$m]:-<unresolved>}"
done

# 是否需要把模块「暂存复制」进 apps/desktop/node_modules：
# 仅当 apps/desktop 里既无真实目录也无软链（electron-rebuild 解析不到）时才需要。
# isolated / 残留软链布局下软链已存在，无需复制；hoisted 布局下才走这条分支。
_STAGED=()
for m in "${_MODS[@]}"; do
  _key="${MOD_KEY[$m]:-}"
  [ -n "$_key" ] || fail "无法解析原生模块 $m 的物理目录；请确认已 pnpm install"
  if [ ! -e "$APP_NM/$m" ]; then
    mkdir -p "$APP_NM"
    cp -R "$_key" "$APP_NM/$m"
    _STAGED+=("$m")
  fi
done

# 即使中途失败也清理「暂存副本」（仅限本次复制进来的，绝不触碰既有的软链 / 真实目录），
# 避免污染 apps/desktop/node_modules。
#
# 注意空数组陷阱：`${_STAGED[@]:-}` 在数组为空时会展开成单个空串元素，使 for 循环跑
# 一次、`[ -n "" ]` 返回假(退出码 1)；作为 trap EXIT 的最后一条命令，它会把整个脚本
# 的退出码污染成 1。故先判空早退，并保证函数末尾退出码为 0。
cleanup_staged() {
  [ "${#_STAGED[@]}" -gt 0 ] || return 0
  for m in "${_STAGED[@]}"; do
    [ -n "${m:-}" ] && rm -rf "$APP_NM/$m"
  done
  return 0
}
trap cleanup_staged EXIT

pnpm exec electron-rebuild -f --arch "$TARGET_ARCH" --only "$NATIVE_MODULES" --version "$ELECTRON_VERSION"

# 把重编译产物覆盖拷回 electron-builder 收集处（覆盖式，不 rm 目标目录），
# 保留模块结构、仅更新 build/Release、bin/<platform>-<abi>、prebuilds 等二进制。
#
# 进入 _STAGED 的模块都经过 `[ ! -e $APP_NM/$m ]` 判定（既无真实目录也无软链），
# 是本次 cp -R 出来的全新真实副本，其物理路径必不等于 require.resolve 得到的
# canonical 收集处 MOD_KEY[$m]，故无需「同一物理目录」短路保护。
if [ "${#_STAGED[@]}" -gt 0 ]; then
  for m in "${_STAGED[@]}"; do
    _key="${MOD_KEY[$m]:-}"
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
