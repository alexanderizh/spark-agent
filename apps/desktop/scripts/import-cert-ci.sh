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

if [ -z "${CSC_LINK:-}" ] || [ -z "${CSC_KEY_PASSWORD:-}" ]; then
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "[import-cert] ❌ CI 缺少 CSC_LINK / CSC_KEY_PASSWORD，无法生成可公证的 macOS 安装包"
    exit 1
  fi

  echo "[import-cert] ⚠️  缺少 CSC_LINK / CSC_KEY_PASSWORD，跳过证书导入（产物将不签名）"
  exit 0
fi

# 钥匙串用绝对路径，避免相对路径在 runner 不同工作目录下找不到
KEYCHAIN_PATH="$HOME/Library/Keychains/spark-build.keychain-db"
KEYCHAIN_NAME="spark-build.keychain-db"
KEYCHAIN_PASS="$(uuidgen)"

# 如果存在同名旧钥匙串先删掉（重跑或缓存场景）
if security list-keychains | grep -q "$KEYCHAIN_NAME"; then
  security delete-keychain "$KEYCHAIN_PATH" 2>/dev/null || true
fi

echo "[import-cert] 创建临时钥匙串 $KEYCHAIN_NAME ..."
security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN_PATH"
# 设为默认（codesign 默认从登录钥匙串找，CI 上登录钥匙串可能没有证书）
security default-keychain -s "$KEYCHAIN_PATH"
# 解锁并设置自动锁定策略（21600s = 6h，覆盖整个构建时长）
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN_PATH"

echo "[import-cert] 解码 base64 证书..."
# 用 -D 忽略可能的换行；部分 GitHub Secret 粘贴时会引入换行符
if ! echo "$CSC_LINK" | base64 --decode > /tmp/cert.p12 2>/dev/null; then
  echo "[import-cert] ❌ base64 解码失败，请检查 CSC_LINK 是否完整"
  exit 1
fi

# 验证解码后的文件确实是 p12（至少 > 1KB，且有 PKCS12 魔数）
DECODED_SIZE=$(stat -f%z /tmp/cert.p12 2>/dev/null || stat -c%s /tmp/cert.p12)
if [ "$DECODED_SIZE" -lt 1024 ]; then
  echo "[import-cert] ❌ 解码后文件仅 $DECODED_SIZE 字节，CSC_LINK 内容不完整或损坏"
  exit 1
fi

echo "[import-cert] 导入证书到钥匙串（$(echo "$DECODED_SIZE" | awk '{printf "%.1f KB", $1/1024}')）..."
# 关键点：
#   - macOS 的 security import 不支持 -o flakes（那是旧版/非 macOS 选项）
#   - -A 允许任意进程访问私钥（CI 无图形界面，无法响应授权弹窗，必须用 -A）
#   - -T 指定允许访问的应用（codesign 是签名主进程，必须包含）
#   - electron-builder 是 node 脚本，实际签名由 codesign 完成，无需单独 -T
#   - 不用 -x（不可导出），某些 codesign 路径需要可访问私钥
security import /tmp/cert.p12 \
  -k "$KEYCHAIN_PATH" \
  -P "$CSC_KEY_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  -A \
  || {
    echo "[import-cert] ❌ 证书导入失败，常见原因："
    echo "   1. CSC_KEY_PASSWORD 与 p12 密码不匹配"
    echo "   2. CSC_LINK base64 解码后不是有效的 p12"
    echo "   3. p12 文件已损坏"
    exit 1
  }

# 设置 partition-list，允许 codesign 无交互访问私钥
# （这是 CI 上签名不卡住的关键步骤；-s 静默，-k 钥匙串密码）
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASS" "$KEYCHAIN_PATH"

# 清理临时文件（凭证安全）
rm -f /tmp/cert.p12

echo "[import-cert] ✅ 证书导入完成，当前可用签名身份："
security find-identity -v -p codesigning

if ! security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -q "Developer ID Application"; then
  echo "[import-cert] ❌ 导入的 p12 中没有 Developer ID Application 证书"
  echo "[import-cert]    当前 CSC_LINK 可能是 Apple Development 证书，不能用于发布/公证 macOS app"
  exit 1
fi
