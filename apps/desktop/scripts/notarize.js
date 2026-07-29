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
const { spawn } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Arch } = require('builder-util');
const {
  inspectWindowsAuthenticode,
  normalizePublisherThumbprint,
} = require('./package-windows-native-host.js');

const DEFAULT_MAX_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    const output = [];

    child.stdout.on('data', (chunk) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk) => output.push(chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({
        code,
        output: output.join(''),
      });
    });
  });
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function authArgs({ appleId, appleIdPassword, teamId }) {
  return [
    '--apple-id',
    appleId,
    '--password',
    appleIdPassword,
    '--team-id',
    teamId,
  ];
}

function summarizeOutput(output) {
  return output.trim().replace(/\s+/g, ' ').slice(0, 1000) || '<empty output>';
}

function parseNotarytoolJson(result) {
  try {
    return JSON.parse(result.output.trim());
  } catch (err) {
    const parseError = new Error(
      `notarytool did not return JSON (exit ${result.code}): ${summarizeOutput(result.output)}`,
    );
    parseError.cause = err;
    parseError.rawOutput = result.output;
    parseError.transient = isTransientNotarytoolOutput(result.output);
    throw parseError;
  }
}

function isTransientNotarytoolOutput(output) {
  return /(^|\b)(HTTP|timed? ?out|timeout|network|connection|temporarily|unavailable|try again|ECONN|ETIMEDOUT|EAI_AGAIN|TLS|SSL|502|503|504)(\b|$)/i.test(
    output,
  );
}

async function checkSignature(appPath) {
  const result = await runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  if (result.code !== 0) {
    throw new Error(`codesign verification failed before notarization:\n\n${result.output}`);
  }
}

async function zipApp(appPath, zipPath) {
  const result = await runCommand(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', path.basename(appPath), zipPath],
    { cwd: path.dirname(appPath) },
  );
  if (result.code !== 0) {
    throw new Error(`Failed to zip application before notarization:\n\n${result.output}`);
  }
}

async function fetchNotarizationLog(submissionId, credentials) {
  const result = await runCommand('xcrun', ['notarytool', 'log', submissionId, ...authArgs(credentials)]);
  return result.output;
}

async function submitForNotarization(zipPath, credentials) {
  const result = await runCommand('xcrun', [
    'notarytool',
    'submit',
    zipPath,
    ...authArgs(credentials),
    '--wait',
    '--output-format',
    'json',
  ]);
  const parsed = parseNotarytoolJson(result);

  if (result.code === 0 && parsed.status === 'Accepted') {
    return parsed;
  }

  const status = parsed.status || 'unknown';
  const message = parsed.message || parsed.statusSummary || summarizeOutput(result.output);
  const error = new Error(`notarytool submission failed with status ${status}: ${message}`);
  error.submission = parsed;
  error.rawOutput = result.output;
  error.transient = isTransientNotarytoolOutput(result.output) || /in progress|timeout/i.test(message);
  throw error;
}

async function stapleApp(appPath) {
  const result = await runCommand('xcrun', ['stapler', 'staple', '-v', path.basename(appPath)], {
    cwd: path.dirname(appPath),
  });
  if (result.code !== 0) {
    throw new Error(`Failed to staple notarization ticket:\n\n${result.output}`);
  }
}

async function stapleAppWithRetry(appPath) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await stapleApp(appPath);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 3) break;
      console.warn(`[notarize] stapler 第 ${attempt}/3 次失败，10 秒后重试：${err.message}`);
      await delay(10000);
    }
  }

  throw lastError;
}

async function notarizeApp({ appPath, credentials }) {
  const maxAttempts = parsePositiveInteger(process.env.NOTARIZE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = parsePositiveInteger(process.env.NOTARIZE_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-agent-notarize-'));
  const zipPath = path.join(tempDir, `${path.parse(appPath).name}.zip`);

  try {
    console.log('[notarize] 校验 .app 签名');
    await checkSignature(appPath);

    console.log(`[notarize] 压缩 .app：${zipPath}`);
    await zipApp(appPath, zipPath);

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        console.log(`[notarize] 上传 Apple notarytool（第 ${attempt}/${maxAttempts} 次）`);
        const submission = await submitForNotarization(zipPath, credentials);
        console.log(`[notarize] Apple 接受公证：${submission.id || '<no submission id>'}`);
        await stapleAppWithRetry(appPath);
        return;
      } catch (err) {
        lastError = err;
        const submissionId = err.submission && err.submission.id;

        if (submissionId) {
          try {
            const log = await fetchNotarizationLog(submissionId, credentials);
            console.error(`[notarize] Apple 公证日志（${submissionId}）：\n${log}`);
          } catch (logErr) {
            console.warn(`[notarize] 拉取 Apple 公证日志失败：${logErr.message}`);
          }
        }

        if (!err.transient || attempt === maxAttempts) {
          throw err;
        }

        const attemptDelayMs = retryDelayMs * attempt;
        console.warn(`[notarize] Apple 上传/等待返回临时错误，${Math.round(attemptDelayMs / 1000)} 秒后重试：${err.message}`);
        await delay(attemptDelayMs);
      }
    }

    throw lastError;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function verifyWindowsPackageSigners(params, options = {}) {
  const architecture = Arch[params.arch];
  if (architecture !== 'x64' && architecture !== 'arm64') {
    throw new Error(`Unsupported Windows after-sign architecture: ${architecture}`);
  }
  const expectedPublisherThumbprint = normalizePublisherThumbprint(
    options.expectedPublisherThumbprint || process.env.SPARK_WINDOWS_PUBLISHER_THUMBPRINT || '',
  );
  const executableName =
    params.packager.platformSpecificBuildOptions.executableName ||
    params.packager.appInfo.productFilename;
  const appExecutable = path.join(params.appOutDir, `${executableName}.exe`);
  const hostDirectory = path.join(
    params.appOutDir,
    'resources',
    'native-host',
    `windows-${architecture}`,
  );
  const hostExecutable = path.join(hostDirectory, 'SparkComputerHost.exe');
  const nodeExecutable = path.join(
    params.appOutDir,
    'resources',
    'runtime',
    'node',
    'node.exe',
  );
  const manifestPath = path.join(hostDirectory, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.protocolVersion !== 1 ||
    manifest.platform !== 'windows' ||
    manifest.architecture !== architecture ||
    manifest.executableFileName !== 'SparkComputerHost.exe' ||
    manifest.signingPublisherThumbprint !== expectedPublisherThumbprint ||
    typeof manifest.sha256 !== 'string'
  ) {
    throw new Error('Final Windows Native Host manifest is incompatible or untrusted');
  }
  const hostBytes = await fs.readFile(hostExecutable);
  if (createHash('sha256').update(hostBytes).digest('hex') !== manifest.sha256) {
    throw new Error('Final Windows Native Host bytes do not match the signed manifest');
  }

  const inspect =
    options.inspect ||
    ((executablePath) =>
      inspectWindowsAuthenticode(executablePath, {
        expectedPublisherThumbprint,
      }));
  // Keep checks sequential so the first signer mismatch fails before inspecting
  // later executables and the verification log remains deterministic.
  const appSignature = await inspect(appExecutable);
  const hostSignature = await inspect(hostExecutable);
  const nodeSignature = await inspect(nodeExecutable);
  for (const signature of [appSignature, hostSignature, nodeSignature]) {
    if (
      normalizePublisherThumbprint(signature.publisherThumbprint) !==
        expectedPublisherThumbprint ||
      signature.timestamped !== true
    ) {
      throw new Error(
        'Final SparkWork application, Native Host, and standalone Node runtime must share a timestamped Authenticode publisher',
      );
    }
  }
}

module.exports = async function (params) {
  if (params.electronPlatformName === 'win32') {
    await verifyWindowsPackageSigners(params);
    return;
  }
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
    await notarizeApp({
      appPath,
      credentials: {
        appleId,
        appleIdPassword,
        teamId,
      },
    });
    console.log('[notarize] ✅ 公证完成，票据已 staple 到 .app\n');
  } catch (err) {
    console.error('[notarize] ❌ 公证失败：', err);
    throw err;
  }
};

module.exports.verifyWindowsPackageSigners = verifyWindowsPackageSigners;
