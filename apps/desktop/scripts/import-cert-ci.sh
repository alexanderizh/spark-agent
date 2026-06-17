#!/usr/bin/env bash
#
# CI 环境导入 Developer ID Application 证书到临时钥匙串。
# 仅在 GitHub Actions 的 macOS runner 上执行。
#
# 依赖环境变量（由 workflow 注入）：
#   CSC_LINK                base64 编码的 .p12
#   CSC_KEY_PASSWORD        .p12 密码
#
# 成功后 electron-builder 会自动从钥匙串里找到证书签名。
#
set -euo pipefail

# 仅在 macOS runner 上执行
[ "$(uname -s)" != "Darwin" ] && { echo "[import-cert] 非 macOS，跳过"; exit 0; }

# 凭据缺失则跳过（兼容未配置签名的分支）
if [ -z "${CSC_LINK:-}" ] || [ -z "${CSC_KEY_PASSWORD:-}" ]; then
  echo "[import-cert] ⚠️  缺少 CSC_LINK / CSC_KEY_PASSWORD，跳过证书导入（产物将不签名）"
  exit 0
fi

KEYCHAIN="spark-build.keychain"
KEYCHAIN_PASS="$(uuidgen)"

echo "[import-cert] 创建临时钥匙串 $KEYCHAIN ..."
# 创建钥匙串（-p 设密码）
security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"
# 设为默认（这样 codesign 默认能找到）
security default-keychain -s "$KEYCHAIN"
# 允许 codesign 读取（不弹授权框，CI 无图形界面）
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"

echo "[import-cert] 解码 base64 证书..."
echo "$CSC_LINK" | base64 --decode > /tmp/cert.p12

echo "[import-cert] 导入证书到钥匙串..."
security import /tmp/cert.p12 \
  -k "$KEYCHAIN" \
  -P "$CSC_KEY_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  -T "$(command -v electron-builder)" \
  -T "$(command -v node)" \
  -o flakes

# 允许 codesign 无交互访问私钥（关键，否则 CI 上会卡在授权弹窗）
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASS" "$KEYCHAIN"

# 清理临时文件
rm -f /tmp/cert.p12

echo "[import-cert] ✅ 当前可用签名身份："
security find-identity -v -p codesigning | grep "Developer ID" || true
