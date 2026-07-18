import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManagedCodexCli {
  executablePath: string
  pathDirs: string[]
  version: string
  targetTriple: string
}

export interface ManagedCodexRuntimeState {
  version: string
  targetTriple: string
  installed: boolean
  executablePath: string | null
}

/**
 * Codex native runtime 的平台标识，与 @openai/codex 的 vendor 目录保持一致。
 * 这段逻辑不依赖 Electron，因此 agent-runtime 也能在测试和 CLI 场景复用。
 */
export function codexTargetTriple(
  platform = process.platform,
  arch = process.arch,
): string | null {
  switch (platform) {
    case 'linux':
    case 'android':
      if (arch === 'x64') return 'x86_64-unknown-linux-musl'
      if (arch === 'arm64') return 'aarch64-unknown-linux-musl'
      return null
    case 'darwin':
      if (arch === 'x64') return 'x86_64-apple-darwin'
      if (arch === 'arm64') return 'aarch64-apple-darwin'
      return null
    case 'win32':
      if (arch === 'x64') return 'x86_64-pc-windows-msvc'
      if (arch === 'arm64') return 'aarch64-pc-windows-msvc'
      return null
    default:
      return null
  }
}

/**
 * 用户目录中的 Codex runtime 根目录。桌面端在 app ready 后设置这个环境变量，
 * 这样基础安装包可以完全不携带 Codex vendor 二进制，而 SDK JS 仍可正常加载。
 */
export function getCodexRuntimeRoot(): string | null {
  const value = process.env.SPARK_CODEX_RUNTIME_ROOT?.trim()
  return value ? value : null
}

export function resolveManagedCodexCli(
  runtimeRoot = getCodexRuntimeRoot(),
): ManagedCodexCli | null {
  if (!runtimeRoot) return null
  const targetTriple = codexTargetTriple()
  if (!targetTriple) return null

  const activePath = join(runtimeRoot, 'active.json')
  let active: { version?: string; targetTriple?: string; sdkPackage?: string }
  try {
    active = JSON.parse(readFileSync(activePath, 'utf8')) as {
      version?: string
      targetTriple?: string
      sdkPackage?: string
    }
  } catch {
    return null
  }
  const version = active.version?.trim()
  if (!version || active.targetTriple !== targetTriple || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return null
  }
  const expectedSdkVersion = process.env.SPARK_CODEX_SDK_VERSION?.trim()
  if (expectedSdkVersion) {
    const expectedPackage = `@openai/codex-sdk@${expectedSdkVersion}`
    if (active.sdkPackage ? active.sdkPackage !== expectedPackage : version !== expectedSdkVersion) {
      return null
    }
  }

  const packageRoot = join(runtimeRoot, version, targetTriple)
  const executablePath = join(packageRoot, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
  const manifestPath = join(packageRoot, 'codex-package.json')
  if (!existsSync(executablePath) || !existsSync(manifestPath)) return null

  const codexPathDir = join(packageRoot, 'codex-path')
  return {
    executablePath,
    pathDirs: existsSync(codexPathDir) ? [codexPathDir] : [],
    version,
    targetTriple,
  }
}

export function readManagedCodexRuntimeState(
  runtimeRoot = getCodexRuntimeRoot(),
): ManagedCodexRuntimeState {
  const targetTriple = codexTargetTriple() ?? 'unsupported'
  const managed = resolveManagedCodexCli(runtimeRoot)
  let version = ''
  if (runtimeRoot) {
    try {
      const active = JSON.parse(readFileSync(join(runtimeRoot, 'active.json'), 'utf8')) as {
        version?: string
      }
      version = active.version?.trim() ?? ''
    } catch {
      // 尚未安装或 active.json 损坏，统一按未安装处理。
    }
  }
  return {
    version,
    targetTriple,
    installed: managed != null,
    executablePath: managed?.executablePath ?? null,
  }
}
