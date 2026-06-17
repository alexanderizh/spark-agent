/**
 * Apple Notarization Hook (called by electron-builder via `afterSign`).
 *
 * 流程：
 *   1. electron-builder 用 Developer ID Application 证书签完 .app
 *   2. 触发本脚本：把 .app 压成 zip → 上传 Apple notarytool → 轮询等待通过
 *   3. 通过后 staple notary 票据回 .app
 *   4. electron-builder 继续用 stapled 的 .app 生成 .dmg
 *
 * 必需环境变量：
 *   APPLE_ID                          开发者账号邮箱
 *   APPLE_APP_SPECIFIC_PASSWORD       App-specific password（在 appleid.apple.com 生成）
 *   APPLE_TEAM_ID                     开发者团队 ID（10 位）
 *
 * 若环境变量缺失则跳过公证（用于本地开发构建），CI 会强制要求。
 */
const { notarize } = require('@electron/notarize');
const path = require('path');

module.exports = async function (params) {
  // 仅处理 macOS 产物
  if (process.platform !== 'darwin' && params.electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  // 本地构建或无凭据时跳过，避免阻塞开发
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('\n[notarize] ⚠️  缺少 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID，跳过公证。');
    console.log('[notarize]    该产物无法通过 macOS Gatekeeper，仅限本地开发使用。\n');
    return;
  }

  const appBundleId = params.appOutDir;
  const appName = params.packager.appInfo.productFilename;
  const appPath = path.join(appBundleId, `${appName}.app`);

  console.log(`\n[notarize] 开始公证：${appPath}`);
  console.log(`[notarize]   Apple ID : ${appleId}`);
  console.log(`[notarize]   Team ID  : ${teamId}\n`);

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId: params.packager.appInfo.id,
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('[notarize] ✅ 公证完成，票据已 staple 到 .app\n');
  } catch (err) {
    console.error('[notarize] ❌ 公证失败：', err);
    throw err;
  }
};
