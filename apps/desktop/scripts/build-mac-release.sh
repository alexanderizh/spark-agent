#!/usr/bin/env bash
#
# 本地签名+公证构建脚本（macOS）
#
# 用法：
#   ./scripts/build-mac-release.sh [arch]
#     arch 可选：arm64（默认）/ x64
#
# 前置条件：
#   1. 钥匙串里已有 "Developer ID Application: ..." 证书 + 私钥
#   2. 已安装 Xcode（提供 notarytool / stapler）
#   3. 环境变量（若未设置会用默认值，密码类必须显式提供）：
#      APPLE_ID                          开发者账号邮箱
#      APPLE_APP_SPECIFIC_PASSWORD       App 专用密码（appleid.apple.com 生成）
#      APPLE_TEAM_ID                     Team ID
#
# 示例：
#   APPLE_ID=you@example.com \
#   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
#   APPLE_TEAM_ID=CCUUJZC28D \
#   ./scripts/build-mac-release.sh arm64
#
set -euo pipefail

# ============ 颜色 ============
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step()  { echo -e "\n${CYAN}========== $* ==========${NC}"; }

# ============ 路径 ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

ARCH="${1:-arm64}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$ARCH" in
  arm64|x64)
    ;;
  universal)
    fail "不再支持 universal 单包构建；请分别构建 arm64 和 x64，避免原生模块 ABI/架构混包。"
    ;;
  *)
    fail "不支持的 macOS 架构：$ARCH"
    ;;
esac

# ============ 1. 前置检查 ============
step "1/6 环境检查"

[ -z "${APPLE_ID:-}" ] && fail "缺少环境变量 APPLE_ID"
[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && fail "缺少环境变量 APPLE_APP_SPECIFIC_PASSWORD"
[ -z "${APPLE_TEAM_ID:-}" ] && fail "缺少环境变量 APPLE_TEAM_ID"

echo "  Apple ID : $APPLE_ID"
echo "  Team ID  : $APPLE_TEAM_ID"
echo "  Arch     : $ARCH"

# 检查证书
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  fail "钥匙串未找到 'Developer ID Application' 证书，请先在 Apple 后台创建并安装。"
fi
CERT_NAME="$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed -E 's/.*"(.*)"$/\1/')"
ok "签名证书：$CERT_NAME"

# 检查公证工具
command -v xcrun >/dev/null || fail "未安装 Xcode Command Line Tools"
xcrun notarytool --version >/dev/null 2>&1 || fail "notarytool 不可用，请安装完整 Xcode"
ok "notarytool 可用"

# ============ 2. 清理旧产物 ============
step "2/6 清理旧产物"
rm -rf dist/mac* dist/*.dmg dist/*.blockmap 2>/dev/null || true
ok "已清理 dist/"

# ============ 3. 编译 + 打包 ============
step "3/6 编译 Vite 产物"
pnpm run build

step "4/6 重编译并校验 Electron 原生模块"
pnpm run rebuild:native -- "$ARCH"

step "5/6 electron-builder 签名 + 公证（这一步会上传 Apple，约 5~15 分钟）"
# electron-builder 会自动读取钥匙串证书；afterSign 钩子(notarize.js)会做公证
pnpm exec electron-builder --mac "--$ARCH" "$@"
ok "打包完成"

# ============ 4. 定位产物 ============
step "6/6 验证签名 + 公证状态"

# 找 .app 和 .dmg
APP_PATH="$(find dist/mac* -maxdepth 1 -name "*.app" 2>/dev/null | head -1)"
DMG_PATH="$(find dist -maxdepth 1 -name "*.dmg" 2>/dev/null | head -1)"

[ -z "$APP_PATH" ] && fail "找不到打包后的 .app"
[ -z "$DMG_PATH" ] && warn "找不到 .dmg（可能还在生成），跳过 DMG 验证"

echo ""
echo "  📦 APP: $APP_PATH"
[ -n "$DMG_PATH" ] && echo "  📦 DMG: $DMG_PATH"

# ---- 验证 .app 代码签名 ----
echo ""
echo "--- codesign 签名信息 ---"
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier|Flags|Signature|Sealed" || true

# ---- 验证 Gatekeeper 评估（公证状态） ----
echo ""
echo "--- spctl Gatekeeper 评估 ---"
if spctl -a -vvv -t install "$APP_PATH" 2>&1; then
  ok "Gatekeeper 评估通过"
else
  warn "spctl 评估未通过（如果是 'rejected' 说明未公证成功）"
fi

# ---- 验证 staple ----
echo ""
echo "--- staple 票据 ---"
if xcrun stapler validate "$APP_PATH" 2>&1; then
  ok "staple 票据有效"
else
  warn "无 staple 票据"
fi

# ============ 报告 ============
echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}  ✅ 构建完成${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
echo "产物位置："
[ -n "$APP_PATH" ] && echo "  $APP_PATH"
[ -n "$DMG_PATH" ] && echo "  $DMG_PATH"
echo ""
echo "关键判定标准（理想结果）："
echo "  - codesign Authority 含 'Developer ID Application: yang zhang'"
echo "  - spctl 输出 'source=Notarized Developer ID'"
echo "  - stapler validate 输出 'The validate action worked!'"
