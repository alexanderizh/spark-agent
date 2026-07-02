import { execFile, exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ProviderProfile,
  ProviderHealthCheckResponse,
  ProviderFetchedModel,
  ProviderExportPayload,
  ProviderExportProfile,
  ProviderImportMode,
  ProviderImportResult,
} from '@spark/protocol'
import {
  isMediaApiType,
  isMediaCapabilityId,
  isMediaProviderKind,
  type MediaProviderKind,
  type MediaApiType,
  type MediaCapabilityId,
  type ProviderMediaDefaults,
  type ProviderMediaModelRef,
  ProviderMediaModelRefSchema,
} from '@spark/protocol'
import {
  PROVIDER_EXPORT_VERSION,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_PROVIDER_NAME,
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
} from '@spark/protocol'
import { ProviderProfileRepository } from '@spark/storage'
import * as keystore from '@spark/shared/keystore'
import { createLogger } from '@spark/shared'

const log = createLogger('provider.service')
const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)
const isWin = process.platform === 'win32'
type ProviderModelType = NonNullable<ProviderProfile['modelType']>
type ImageGenApiType = NonNullable<ProviderProfile['imageApiType']>
type TextProviderKind = 'anthropic' | 'openai' | 'deepseek' | 'ollama' | 'openai-compatible'
const PROVIDER_MODEL_TYPES = new Set<ProviderModelType>(['image', 'text', 'multimodal', 'voice', 'video'])
const IMAGE_API_TYPES = new Set<ImageGenApiType>(['sync', 'async', 'auto'])
const TEXT_PROVIDER_KINDS = new Set<TextProviderKind>(['anthropic', 'openai', 'deepseek', 'ollama', 'openai-compatible'])
const LOCAL_CLI_CHECK_TTL_MS = 10_000
const PROVIDER_HTTP_TIMEOUT_MS = 8_000
const PROVIDER_CONNECTION_TIMEOUT_MS = 15_000
const MODELS_ERROR_BODY_MAX_CHARS = 512

/**
 * Windows 下 npm 全局包生成的可执行 shim 实际是 `claude.cmd` / `claude.ps1`，
 * 而 Node 的 execFile 走 CreateProcess，不会按 PATHEXT 自动尝试这些扩展名，
 * 直接传 `claude` 会 ENOENT。这里列出所有候选名 + 兜底用 `where`/`which` 解析。
 *
 * Unix 下还有一个独立问题：Electron GUI 应用从 launchd 继承的 PATH 通常只有
 * `/usr/bin:/bin:/usr/sbin:/sbin`，不会加载用户的 .zshrc / .bashrc —— 因此
 * 通过 nvm / Volta / Homebrew / 原生安装脚本 (`curl … | sh`) 装在用户目录
 * (`~/.local/bin`、`~/.nvm/...`、`/opt/homebrew/bin` 等) 的 CLI 检测不到。
 * 所以 Unix 下还额外枚举常见安装路径，作为 PATH 检测的兜底。
 */
const CLAUDE_CLI_CANDIDATES = isWin
  ? ['claude.cmd', 'claude.exe', 'claude.bat', 'claude.ps1', 'claude']
  : ['claude']
const CODEX_CLI_CANDIDATES = isWin
  ? ['codex.cmd', 'codex.exe', 'codex.bat', 'codex.ps1', 'codex']
  : ['codex']

/**
 * Unix 下用户常用安装方式对应的固定路径。Electron GUI 应用继承的 PATH 不含
 * 这些目录，需要显式探测。用 existsSync 过滤后再尝试 --version。
 */
function getUnixClaudeKnownPaths(): string[] {
  if (isWin) return []
  const home = homedir()
  const paths = [
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    join(home, '.npm-global', 'bin', 'claude'),
    join(home, '.volta', 'bin', 'claude'),
    join(home, '.yarn', 'bin', 'claude'),
    join(home, '.bun', 'bin', 'claude'),
    join(home, '.fnm', 'aliases', 'default', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
    '/snap/bin/claude',
  ]
  // nvm 一个用户可能有多个 node 版本，每个版本都可能在 bin/ 下有 claude；
  // 简单 glob 一下，把最新几个版本都纳入候选。
  const nvmVersionsDir = join(home, '.nvm', 'versions', 'node')
  try {
    for (const ver of readdirSync(nvmVersionsDir)) {
      paths.push(join(nvmVersionsDir, ver, 'bin', 'claude'))
    }
  } catch {
    // nvm 不存在或目录不可读，忽略
  }
  return paths.filter((p) => existsSync(p))
}

function getUnixCodexKnownPaths(): string[] {
  if (isWin) return []
  const home = homedir()
  const paths = [
    join(home, '.local', 'bin', 'codex'),
    join(home, '.codex', 'local', 'codex'),
    join(home, '.npm-global', 'bin', 'codex'),
    join(home, '.volta', 'bin', 'codex'),
    join(home, '.yarn', 'bin', 'codex'),
    join(home, '.bun', 'bin', 'codex'),
    join(home, '.fnm', 'aliases', 'default', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/bin/codex',
    '/snap/bin/codex',
  ]
  const nvmVersionsDir = join(home, '.nvm', 'versions', 'node')
  try {
    for (const ver of readdirSync(nvmVersionsDir)) {
      paths.push(join(nvmVersionsDir, ver, 'bin', 'codex'))
    }
  } catch {
    // ignore
  }
  return paths.filter((p) => existsSync(p))
}

/**
 * 用 login shell (`-l -c`) 解析用户的"真实" PATH —— 这是覆盖 .zshrc/.bashrc
 * 里 nvm/volta 等初始化的最后兜底。GUI 启动的子进程拿不到这些，必须重启
 * 一个登录 shell 才能拿到完整的 PATH 定义。
 *
 * 仅在 PATH 检测 + 固定路径检测都失败时调用，避免每次 listProviders 都拉起 shell。
 */
async function resolveCliFromLoginShell(binaryName: string): Promise<string | null> {
  if (isWin) return null
  const shellCandidates = ['/bin/zsh', '/bin/bash', '/usr/bin/zsh', '/usr/bin/bash']
  for (const shell of shellCandidates) {
    if (!existsSync(shell)) continue
    try {
      // -l: login shell (加载 ~/.zprofile / ~/.bash_profile)
      // -c: 执行完命令后退出
      // command -v <name>: shell 内建，等价于 which 但更可靠
      const { stdout } = await execFileAsync(shell, ['-lc', `command -v ${binaryName}`], {
        timeout: 4000,
        windowsHide: true,
      })
      const first = stdout.split(/[\r\n]+/).find((line) => line.trim().length > 0)
      if (first) return first.trim()
    } catch {
      // 当前 shell 不可用或命令不存在，尝试下一个
    }
  }
  return null
}

let localCliAvailabilityCache: { checkedAt: number; available: boolean } | null = null
let localCodexCliAvailabilityCache: { checkedAt: number; available: boolean } | null = null

/**
 * 解析 `claude` CLI 的实际可执行路径（用于校验存在性，不执行它）。
 *
 * - Unix: `which claude`
 * - Windows: `where claude` （where 会按 PATHEXT 找到 claude.cmd 等）
 *
 * 返回首个解析到的路径；找不到返回 null。
 */
async function resolveClaudeCliPath(): Promise<string | null> {
  return resolveCliPath('claude')
}

async function resolveCodexCliPath(): Promise<string | null> {
  return resolveCliPath('codex')
}

async function resolveCliPath(binaryName: string): Promise<string | null> {
  const finder = isWin ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(finder, [binaryName], {
      timeout: 3000,
      windowsHide: true,
    })
    const first = stdout.split(/[\r\n]+/).find((line) => line.trim().length > 0)
    return first ? first.trim() : null
  } catch {
    return null
  }
}

/**
 * 对单个候选命令尝试 `--version`；成功即返回 true。
 * Windows 上若直接 execFile 失败，再走一次 `where` 解析完整路径调用。
 */
async function tryClaudeVersion(command: string): Promise<boolean> {
  return tryCliVersion(command)
}

async function tryCodexVersion(command: string): Promise<boolean> {
  return tryCliVersion(command)
}

async function tryCliVersion(command: string): Promise<boolean> {
  try {
    if (isWin) {
      // Windows npm/pnpm 全局包装出的 shim 实际是 `claude.cmd` / `claude.ps1`，
      // 而 Node 自 CVE-2024-27980 修复后，execFile（不走 shell）的 CreateProcess
      // 拒绝直接启动 .cmd/.bat/.ps1，会抛 EINVAL/EFTYPE，导致即使 PATH 上能
      // `where claude` 也检测不到。这里改走 cmd.exe；command 可能是带空格的完整
      // 路径，需自行加引号（--version 为静态参数，无注入风险）。
      const quoted = /[\s&|()<>^]/.test(command) ? `"${command}"` : command
      await execAsync(`${quoted} --version`, {
        timeout: 3000,
        windowsHide: true,
      })
    } else {
      await execFileAsync(command, ['--version'], {
        timeout: 3000,
        windowsHide: true,
      })
    }
    return true
  } catch {
    return false
  }
}

async function checkClaudeCliAvailable(): Promise<boolean> {
  // 1. 直接按命令名调用（依赖 PATH，对 /usr/local/bin 等系统目录有效）
  for (const candidate of CLAUDE_CLI_CANDIDATES) {
    if (await tryClaudeVersion(candidate)) return true
  }
  // 2. 枚举常见安装路径的绝对路径（不依赖 PATH，覆盖 nvm/Volta/Homebrew/sh 脚本安装）
  for (const known of getUnixClaudeKnownPaths()) {
    if (await tryClaudeVersion(known)) return true
  }
  // 3. 用 where/which 解析 PATH（兜底，覆盖 shim 名字不规范的情况）
  const resolved = await resolveClaudeCliPath()
  if (resolved != null && await tryClaudeVersion(resolved)) return true
  // 4. 最后兜底：用 login shell 重新解析用户的真实 PATH
  //    （Electron GUI 进程的 PATH 来自 launchd，不含 .zshrc 里 nvm/volta 等初始化，
  //    导致 ~/.nvm/versions/node/*/bin/claude 这类用户级安装检测不到）
  const loginResolved = await resolveCliFromLoginShell('claude')
  if (loginResolved != null && loginResolved !== resolved && await tryClaudeVersion(loginResolved)) {
    return true
  }
  return false
}

async function checkCodexCliAvailable(): Promise<boolean> {
  for (const candidate of CODEX_CLI_CANDIDATES) {
    if (await tryCodexVersion(candidate)) return true
  }
  for (const known of getUnixCodexKnownPaths()) {
    if (await tryCodexVersion(known)) return true
  }
  const resolved = await resolveCodexCliPath()
  if (resolved != null && await tryCodexVersion(resolved)) return true
  const loginResolved = await resolveCliFromLoginShell('codex')
  if (loginResolved != null && loginResolved !== resolved && await tryCodexVersion(loginResolved)) {
    return true
  }
  return false
}

function rowToProfile(row: {
  id: string
  provider_type: string
  name: string
  config_json: string
  keystore_ref: string | null
  is_default: number
  created_at: string
}): ProviderProfile {
  const rawConfig = JSON.parse(row.config_json) as ProviderConfig
  const config = isBuiltInLocalCliProvider(row)
    ? normalizeLocalCliProviderConfig(row.id, rawConfig)
    : normalizeProviderConfig(rawConfig)
  const name = isLocalCodexCliProvider(row)
    ? LOCAL_CODEX_CLI_PROVIDER_NAME
    : row.id === LOCAL_CLI_PROVIDER_ID
      ? LOCAL_CLI_PROVIDER_NAME
      : row.name
  return {
    id: row.id,
    name,
    provider: normalizeProviderType(row.provider_type),
    defaultModel: config.defaultModel,
    modelIds: config.modelIds,
    ...(config.apiEndpoint !== undefined && { apiEndpoint: config.apiEndpoint }),
    ...(config.codexApiKind !== undefined && { codexApiKind: config.codexApiKind }),
    supportsMillionContext: config.supportsMillionContext === true,
    ...(typeof config.contextWindow === 'number' && config.contextWindow > 0 && { contextWindow: config.contextWindow }),
    ...(config.haikuModel !== undefined && { haikuModel: config.haikuModel }),
    ...(config.sonnetModel !== undefined && { sonnetModel: config.sonnetModel }),
    ...(config.opusModel !== undefined && { opusModel: config.opusModel }),
    modelType: normalizeModelType(config.modelType),
    ...(config.imageProvider !== undefined && { imageProvider: config.imageProvider }),
    ...(config.imageApiType !== undefined && { imageApiType: config.imageApiType }),
    ...(config.mediaProvider !== undefined && { mediaProvider: config.mediaProvider }),
    ...(config.mediaApiType !== undefined && { mediaApiType: config.mediaApiType }),
    ...(config.mediaCapabilities !== undefined && { mediaCapabilities: config.mediaCapabilities }),
    ...(config.mediaDefaults !== undefined && { mediaDefaults: config.mediaDefaults }),
    ...(config.mediaModelRefs !== undefined && { mediaModelRefs: config.mediaModelRefs }),
    keystoreRef: row.keystore_ref ?? '',
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  }
}

export class ProviderService {
  constructor(private readonly repo: ProviderProfileRepository) {}

  async listProviders(): Promise<ProviderProfile[]> {
    const profiles = this.repo.listAll().map(rowToProfile)
    const [claudeAvailable, codexAvailable] = await Promise.all([
      this.isLocalCliAvailable(),
      this.isLocalCodexCliAvailable(),
    ])
    return profiles.filter((profile) => {
      if (profile.id === LOCAL_CLI_PROVIDER_ID) return claudeAvailable
      if (profile.id === LOCAL_CODEX_CLI_PROVIDER_ID) return codexAvailable
      return true
    })
  }

  async isLocalCliAvailable(): Promise<boolean> {
    const now = Date.now()
    if (
      localCliAvailabilityCache != null &&
      now - localCliAvailabilityCache.checkedAt < LOCAL_CLI_CHECK_TTL_MS
    ) {
      return localCliAvailabilityCache.available
    }

    const available = await checkClaudeCliAvailable()
    localCliAvailabilityCache = { checkedAt: now, available }
    if (!available) {
      log.warn(
        `Local claude CLI not found. Tried candidates [${CLAUDE_CLI_CANDIDATES.join(', ')}]` +
        ` and ${isWin ? 'where' : 'which'} resolution.`,
      )
    }
    return available
  }

  async isLocalCodexCliAvailable(): Promise<boolean> {
    const now = Date.now()
    if (
      localCodexCliAvailabilityCache != null &&
      now - localCodexCliAvailabilityCache.checkedAt < LOCAL_CLI_CHECK_TTL_MS
    ) {
      return localCodexCliAvailabilityCache.available
    }

    const available = await checkCodexCliAvailable()
    localCodexCliAvailabilityCache = { checkedAt: now, available }
    if (!available) {
      log.warn(
        `Local codex CLI not found. Tried candidates [${CODEX_CLI_CANDIDATES.join(', ')}]` +
        ` and ${isWin ? 'where' : 'which'} resolution.`,
      )
    }
    return available
  }

  /**
   * 幂等保证内置 "本地 CLI" provider 存在。
   *
   * 这是默认 provider，类似 ccswitch 的 "system" 配置：不需要填 Key/Endpoint，
   * 选中后 SDK 会沿用宿主机本地 claude CLI 配置（OAuth credentials、ANTHROPIC_* 环境变量）。
   *
   * - id 固定为 LOCAL_CLI_PROVIDER_ID，保证整库唯一
   * - keystore_ref 留空，不进 Keychain
   * - 不强制设为 isDefault，避免覆盖用户已有的默认选择
   */
  async ensureLocalCliProvider(): Promise<ProviderProfile> {
    if (!(await this.isLocalCliAvailable())) {
      throw new Error('Local claude CLI not found')
    }

    const existing = this.repo.get(LOCAL_CLI_PROVIDER_ID)
    if (existing != null) {
      const rawConfig = JSON.parse(existing.config_json) as ProviderConfig
      const normalizedConfig = normalizeLocalCliProviderConfig(LOCAL_CLI_PROVIDER_ID, rawConfig)
      if (
        existing.name !== LOCAL_CLI_PROVIDER_NAME ||
        rawConfig.defaultModel !== LOCAL_CLI_DEFAULT_MODEL ||
        rawConfig.modelIds?.length !== 1 ||
        rawConfig.modelIds[0] !== LOCAL_CLI_DEFAULT_MODEL
      ) {
        this.repo.update(LOCAL_CLI_PROVIDER_ID, {
          name: LOCAL_CLI_PROVIDER_NAME,
          config: normalizedConfig,
        })
      }
      return rowToProfile(existing)
    }

    const row = this.repo.create({
      id: LOCAL_CLI_PROVIDER_ID,
      providerType: 'anthropic',
      name: LOCAL_CLI_PROVIDER_NAME,
      config: normalizeProviderConfig({
        defaultModel: LOCAL_CLI_DEFAULT_MODEL,
        modelIds: [LOCAL_CLI_DEFAULT_MODEL],
      }),
      keystoreRef: '',
      isDefault: false,
    })
    log.info(`Seeded built-in local CLI provider id=${LOCAL_CLI_PROVIDER_ID}`)
    return rowToProfile(row)
  }

  async ensureLocalCodexCliProvider(): Promise<ProviderProfile> {
    if (!(await this.isLocalCodexCliAvailable())) {
      throw new Error('Local codex CLI not found')
    }

    const existing = this.repo.get(LOCAL_CODEX_CLI_PROVIDER_ID)
    if (existing != null) {
      const rawConfig = JSON.parse(existing.config_json) as ProviderConfig
      const normalizedConfig = normalizeLocalCliProviderConfig(LOCAL_CODEX_CLI_PROVIDER_ID, rawConfig)
      if (
        existing.name !== LOCAL_CODEX_CLI_PROVIDER_NAME ||
        existing.provider_type !== 'openai' ||
        rawConfig.defaultModel !== LOCAL_CODEX_CLI_DEFAULT_MODEL ||
        rawConfig.modelIds?.length !== 1 ||
        rawConfig.modelIds[0] !== LOCAL_CODEX_CLI_DEFAULT_MODEL ||
        rawConfig.codexApiKind !== 'responses'
      ) {
        this.repo.update(LOCAL_CODEX_CLI_PROVIDER_ID, {
          name: LOCAL_CODEX_CLI_PROVIDER_NAME,
          config: normalizedConfig,
        })
      }
      return rowToProfile(existing)
    }

    const row = this.repo.create({
      id: LOCAL_CODEX_CLI_PROVIDER_ID,
      providerType: 'openai',
      name: LOCAL_CODEX_CLI_PROVIDER_NAME,
      config: normalizeProviderConfig({
        defaultModel: LOCAL_CODEX_CLI_DEFAULT_MODEL,
        modelIds: [LOCAL_CODEX_CLI_DEFAULT_MODEL],
        codexApiKind: 'responses',
      }),
      keystoreRef: '',
      isDefault: false,
    })
    log.info(`Seeded built-in local Codex CLI provider id=${LOCAL_CODEX_CLI_PROVIDER_ID}`)
    return rowToProfile(row)
  }

  async createProvider(params: {
    name: string
    provider: string
    defaultModel?: string
    modelIds?: string[]
    model?: string
    apiEndpoint?: string
    codexApiKind?: 'chat' | 'responses'
    supportsMillionContext?: boolean
    contextWindow?: number
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
    modelType?: string
    imageProvider?: string | null
    imageApiType?: 'sync' | 'async' | 'auto' | null
    mediaProvider?: MediaProviderKind | null
    mediaApiType?: MediaApiType | null
    mediaCapabilities?: MediaCapabilityId[]
    mediaDefaults?: ProviderMediaDefaults
    mediaModelRefs?: ProviderMediaModelRef[]
    apiKey: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const id = crypto.randomUUID()
    const providerType = normalizeProviderType(params.provider)
    const defaultModel = params.defaultModel ?? params.model
    if (defaultModel == null || defaultModel.trim().length === 0) {
      throw new Error('Provider defaultModel is required')
    }
    const hasApiKey = params.apiKey != null && params.apiKey.length > 0
    const ref = hasApiKey ? keystore.makeKeystoreRef(providerType, id) : ''
    if (hasApiKey) {
      await keystore.setSecret(ref as keystore.KeystoreRef, params.apiKey)
      log.info(`Stored API key for provider=${providerType} id=${id} key=${keystore.maskSecret(params.apiKey)}`)
    } else {
      log.info(`Created provider without API key (local CLI / pending key): provider=${providerType} id=${id}`)
    }

    if (params.isDefault) {
      // clear existing defaults first
      this.repo.listAll().forEach((r) => {
        if (r.is_default) this.repo.update(r.id, {})
      })
    }

    const row = this.repo.create({
      id,
      providerType,
      name: params.name,
      config: normalizeProviderConfig({
        defaultModel,
        ...(params.modelIds !== undefined && { modelIds: params.modelIds }),
        ...(params.apiEndpoint !== undefined && { apiEndpoint: params.apiEndpoint }),
        ...(params.codexApiKind !== undefined && { codexApiKind: params.codexApiKind }),
        ...(params.supportsMillionContext !== undefined && { supportsMillionContext: params.supportsMillionContext }),
        ...(params.contextWindow !== undefined && params.contextWindow > 0 && { contextWindow: Math.floor(params.contextWindow) }),
        ...(params.haikuModel !== undefined && params.haikuModel.trim().length > 0 && { haikuModel: params.haikuModel.trim() }),
        ...(params.sonnetModel !== undefined && params.sonnetModel.trim().length > 0 && { sonnetModel: params.sonnetModel.trim() }),
        ...(params.opusModel !== undefined && params.opusModel.trim().length > 0 && { opusModel: params.opusModel.trim() }),
        ...(params.modelType !== undefined && { modelType: normalizeModelType(params.modelType) }),
        ...(params.imageProvider !== undefined && { imageProvider: params.imageProvider }),
        ...(params.imageApiType !== undefined && { imageApiType: params.imageApiType }),
        ...(params.mediaProvider !== undefined && { mediaProvider: params.mediaProvider }),
        ...(params.mediaApiType !== undefined && { mediaApiType: params.mediaApiType }),
        ...(params.mediaCapabilities !== undefined && { mediaCapabilities: params.mediaCapabilities }),
        ...(params.mediaDefaults !== undefined && { mediaDefaults: params.mediaDefaults }),
        ...(params.mediaModelRefs !== undefined && { mediaModelRefs: params.mediaModelRefs }),
      }),
      keystoreRef: ref,
      isDefault: params.isDefault ?? false,
    })

    if (params.isDefault) {
      this.repo.setDefault(id)
    }

    return rowToProfile(row)
  }

  async updateProvider(params: {
    id: string
    name?: string
    defaultModel?: string
    modelIds?: string[]
    model?: string
    apiEndpoint?: string | null
    codexApiKind?: 'chat' | 'responses'
    supportsMillionContext?: boolean
    /** 0 清除自定义窗口；正整数设置；undefined 不修改 */
    contextWindow?: number
    /** null 清除该档自定义；string 设置；undefined 不修改 */
    haikuModel?: string | null
    sonnetModel?: string | null
    opusModel?: string | null
    modelType?: string
    imageProvider?: string | null
    imageApiType?: 'sync' | 'async' | 'auto' | null
    mediaProvider?: MediaProviderKind | null
    mediaApiType?: MediaApiType | null
    mediaCapabilities?: MediaCapabilityId[]
    mediaDefaults?: ProviderMediaDefaults
    mediaModelRefs?: ProviderMediaModelRef[]
    apiKey?: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const existing = this.repo.get(params.id)
    if (!existing) throw new Error(`Provider not found: ${params.id}`)

    if (params.apiKey !== undefined) {
      const ref = existing.keystore_ref ?? keystore.makeKeystoreRef(existing.provider_type, params.id)
      await keystore.setSecret(ref as keystore.KeystoreRef, params.apiKey)
      log.info(`Updated API key for id=${params.id} key=${keystore.maskSecret(params.apiKey)}`)
    }

    const existingConfig = normalizeProviderConfig(JSON.parse(existing.config_json) as ProviderConfig)
    const nextDefaultModel = params.defaultModel ?? params.model
    const tierTouched =
      params.haikuModel !== undefined ||
      params.sonnetModel !== undefined ||
      params.opusModel !== undefined
    const mediaTouched =
      params.mediaProvider !== undefined ||
      params.mediaApiType !== undefined ||
      params.mediaCapabilities !== undefined ||
      params.mediaDefaults !== undefined ||
      params.mediaModelRefs !== undefined
    const newConfig =
      nextDefaultModel !== undefined ||
      params.modelIds !== undefined ||
      params.apiEndpoint !== undefined ||
      params.codexApiKind !== undefined ||
      params.supportsMillionContext !== undefined ||
      params.contextWindow !== undefined ||
      tierTouched ||
      params.modelType !== undefined ||
      params.imageProvider !== undefined ||
      params.imageApiType !== undefined ||
      mediaTouched
        ? { ...existingConfig }
        : undefined

    if (newConfig !== undefined && nextDefaultModel !== undefined) {
      newConfig.defaultModel = nextDefaultModel
      if (params.modelIds === undefined) {
        newConfig.modelIds = normalizeModelIds(nextDefaultModel, newConfig.modelIds)
      }
    }
    if (newConfig !== undefined && params.modelIds !== undefined) {
      newConfig.modelIds = normalizeModelIds(
        nextDefaultModel ?? newConfig.defaultModel,
        params.modelIds,
      )
    }
    if (newConfig !== undefined && params.apiEndpoint !== undefined) {
      if (params.apiEndpoint === null) {
        delete newConfig.apiEndpoint
      } else {
        newConfig.apiEndpoint = params.apiEndpoint
      }
    }
    if (newConfig !== undefined && params.codexApiKind !== undefined) {
      newConfig.codexApiKind = params.codexApiKind
    }
    if (newConfig !== undefined && params.supportsMillionContext !== undefined) {
      newConfig.supportsMillionContext = params.supportsMillionContext
    }
    if (newConfig !== undefined && params.contextWindow !== undefined) {
      if (params.contextWindow > 0) {
        newConfig.contextWindow = Math.floor(params.contextWindow)
      } else {
        delete newConfig.contextWindow
      }
    }
    if (newConfig !== undefined && params.haikuModel !== undefined) {
      const v = params.haikuModel?.trim()
      if (v != null && v.length > 0) newConfig.haikuModel = v
      else delete newConfig.haikuModel
    }
    if (newConfig !== undefined && params.sonnetModel !== undefined) {
      const v = params.sonnetModel?.trim()
      if (v != null && v.length > 0) newConfig.sonnetModel = v
      else delete newConfig.sonnetModel
    }
    if (newConfig !== undefined && params.opusModel !== undefined) {
      const v = params.opusModel?.trim()
      if (v != null && v.length > 0) newConfig.opusModel = v
      else delete newConfig.opusModel
    }
    if (newConfig !== undefined && params.modelType !== undefined) {
      newConfig.modelType = normalizeModelType(params.modelType)
    }
    if (newConfig !== undefined && params.imageProvider !== undefined) {
      const v = params.imageProvider?.trim()
      if (v != null && v.length > 0) newConfig.imageProvider = v
      else delete newConfig.imageProvider
    }
    if (newConfig !== undefined && params.imageApiType !== undefined) {
      if (params.imageApiType != null) newConfig.imageApiType = params.imageApiType
      else delete newConfig.imageApiType
    }
    // ── 多媒体能力更新 ──
    // 注意：image→media 同步在最后通过 normalizeProviderConfig 统一处理，
    // 这里只把显式传入的字段写入 newConfig，避免覆盖 image 分支的兜底。
    if (newConfig !== undefined && params.mediaProvider !== undefined) {
      if (params.mediaProvider == null) delete newConfig.mediaProvider
      else newConfig.mediaProvider = params.mediaProvider
    }
    if (newConfig !== undefined && params.mediaApiType !== undefined) {
      if (params.mediaApiType == null) delete newConfig.mediaApiType
      else newConfig.mediaApiType = params.mediaApiType
    }
    if (newConfig !== undefined && params.mediaCapabilities !== undefined) {
      newConfig.mediaCapabilities = params.mediaCapabilities
    }
    if (newConfig !== undefined && params.mediaDefaults !== undefined) {
      newConfig.mediaDefaults = params.mediaDefaults
    }
    if (newConfig !== undefined && params.mediaModelRefs !== undefined) {
      newConfig.mediaModelRefs = params.mediaModelRefs
    }
    // 重新走 normalize，确保 image→media 同步、能力兜底、枚举校验一致
    if (newConfig !== undefined) {
      Object.assign(newConfig, normalizeProviderConfig(newConfig))
    }

    this.repo.update(params.id, {
      ...(params.name !== undefined && { name: params.name }),
      ...(newConfig !== undefined && { config: newConfig }),
    })

    if (params.isDefault) {
      this.repo.setDefault(params.id)
    }

    const updated = this.repo.get(params.id)!
    return rowToProfile(updated)
  }

  async deleteProvider(id: string): Promise<void> {
    if (id === LOCAL_CLI_PROVIDER_ID || id === LOCAL_CODEX_CLI_PROVIDER_ID) {
      throw new Error('Cannot delete the built-in local CLI provider')
    }
    const row = this.repo.get(id)
    if (!row) throw new Error(`Provider not found: ${id}`)

    if (row.keystore_ref) {
      await keystore.deleteSecret(row.keystore_ref as keystore.KeystoreRef)
    }
    this.repo.delete(id)
  }

  async healthCheck(id: string): Promise<ProviderHealthCheckResponse> {
    const row = this.repo.get(id)
    if (!row) return { healthy: false, errorMessage: `Provider not found: ${id}` }

    // Local CLI provider 走宿主 claude CLI 的本地凭证，没有可检测的 endpoint —
    // 视为始终可用；真正的鉴权失败会在 turn 启动时由 SDK 抛错。
    if (id === LOCAL_CLI_PROVIDER_ID) {
      const available = await this.isLocalCliAvailable()
      return available
        ? { healthy: true, latencyMs: 0 }
        : { healthy: false, errorMessage: 'Local claude CLI not found' }
    }
    if (id === LOCAL_CODEX_CLI_PROVIDER_ID) {
      const available = await this.isLocalCodexCliAvailable()
      return available
        ? { healthy: true, latencyMs: 0 }
        : { healthy: false, errorMessage: 'Local codex CLI not found' }
    }

    if (!row.keystore_ref) return { healthy: false, errorMessage: 'No API key configured' }

    const apiKey = await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef)
    if (!apiKey) return { healthy: false, errorMessage: 'API key not found in keychain' }

    const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
    return this.testConnection({
      id,
      provider: normalizeProviderType(row.provider_type),
      ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
      defaultModel: config.defaultModel,
      ...(config.codexApiKind !== undefined ? { codexApiKind: config.codexApiKind } : {}),
      apiKey,
    })
  }

  async testConnection(params: {
    id?: string
    provider: string
    apiEndpoint?: string | null
    defaultModel: string
    codexApiKind?: 'chat' | 'responses'
    apiKey?: string
  }): Promise<ProviderHealthCheckResponse> {
    const providerType = normalizeProviderType(params.provider)
    const apiKey = await this.resolveProviderApiKey(params.id, params.apiKey)
    if (!apiKey) return { healthy: false, errorMessage: 'No API key configured' }

    const endpoint = await this.resolveProviderEndpoint(params.id, params.apiEndpoint)
    const defaultModel = params.defaultModel.trim()
    if (!defaultModel) return { healthy: false, errorMessage: 'Default model is required' }

    const start = Date.now()

    try {
      const res = providerType === 'anthropic'
        ? await fetchAnthropicMessagesPing(endpoint, apiKey, defaultModel)
        : await fetchOpenAiCompatiblePing(
          endpoint ?? getDefaultEndpointBase(providerType),
          apiKey,
          defaultModel,
          params.codexApiKind ?? 'chat',
        )
      const latencyMs = Date.now() - start
      if (res.ok || res.status === 401) {
        // 401 means key is wrong but endpoint is reachable
        if (res.ok) return { healthy: true, latencyMs }
        return { healthy: false, latencyMs, errorMessage: `HTTP ${res.status}` }
      }
      return { healthy: false, latencyMs, errorMessage: `HTTP ${res.status}` }
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        errorMessage: formatProviderConnectionError(err, PROVIDER_CONNECTION_TIMEOUT_MS),
      }
    }
  }

  async fetchModels(params: {
    id?: string
    provider: string
    apiEndpoint?: string | null
    apiKey?: string
    modelsUrl?: string | null
    isFullUrl?: boolean
  }): Promise<ProviderFetchedModel[]> {
    const providerType = normalizeProviderType(params.provider)
    const apiKey = await this.resolveProviderApiKey(params.id, params.apiKey)
    if (!apiKey) throw new Error('API Key is required to fetch models')

    const endpoint = await this.resolveProviderEndpoint(params.id, params.apiEndpoint)
    const baseUrl = endpoint ?? getDefaultEndpointBase(providerType)
    const candidates = getModelsUrlCandidates(baseUrl, params.isFullUrl === true, params.modelsUrl ?? null)
    if (candidates.length === 0) throw new Error('Cannot derive models endpoint')

    let lastNotFound: string | null = null
    for (const url of candidates) {
      const res = await fetch(url, {
        headers: getModelsRequestHeaders(providerType, apiKey),
        signal: AbortSignal.timeout(PROVIDER_HTTP_TIMEOUT_MS),
      })
      if (res.ok) {
        const json = await res.json() as ModelsListResponse
        return normalizeFetchedModels(json)
      }
      const body = truncateResponseBody(await res.text().catch(() => ''))
      if (res.status === 404 || res.status === 405) {
        lastNotFound = `HTTP ${res.status}: ${body}`
        continue
      }
      throw new Error(`HTTP ${res.status}: ${body}`)
    }
    throw new Error(`All model endpoints failed: ${lastNotFound ?? 'no candidates'}`)
  }

  /** 读取指定 profile 在 Keychain 中保存的明文 API Key；未配置时返回空串。 */
  async revealApiKey(id: string): Promise<string> {
    return this.resolveProviderApiKey(id, undefined)
  }

  private async resolveProviderApiKey(id: string | undefined, apiKey: string | undefined): Promise<string> {
    const direct = apiKey?.trim()
    if (direct) return direct
    if (!id) return ''
    const row = this.repo.get(id)
    if (!row?.keystore_ref) return ''
    return (await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef))?.trim() ?? ''
  }

  private async resolveProviderEndpoint(id: string | undefined, apiEndpoint: string | null | undefined): Promise<string | undefined> {
    const direct = apiEndpoint?.trim()
    if (direct) return direct
    if (apiEndpoint === null) return undefined
    if (!id) return undefined
    const row = this.repo.get(id)
    if (!row) return undefined
    const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
    return config.apiEndpoint
  }

  /**
   * 导出 provider 配置为 ExportPayload（含 apiKey）。
   *
   * - ids 为空时导出全部
   * - id 不存在时静默跳过（不抛错），方便前端多选时无需严格校验
   * - apiKey 从 Keychain 读取后附带到导出 profile 中
   */
  async exportProviders(ids: string[] = []): Promise<ProviderExportPayload> {
    const rows = this.repo.listAll()
    const idSet = ids.length > 0 ? new Set(ids) : null
    const profiles: ProviderExportProfile[] = []
    for (const row of rows) {
      if (idSet !== null && !idSet.has(row.id)) continue
      const apiKey = row.keystore_ref
        ? await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef)
        : null
      profiles.push(rowToExportProfile(row, apiKey ?? undefined))
    }
    return {
      version: PROVIDER_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: 'spark-agent',
      profiles,
    }
  }

  /**
   * 导入 ExportPayload 到数据库。
   *
   * - 模式 merge：按 name 去重，已存在则跳过（计入 skipped）
   * - 模式 replace：按 name 去重，已存在则更新（保留本地 keystoreRef，更新 apiKey）
   * - 单个 profile 失败不中断整体流程；错误累加到 errors
   * - 导入新建的 profile 强制 isDefault=false（避免覆盖本地默认）
   * - 导入更新的 profile 保留原 isDefault 标志
   * - 若 payload 中包含 apiKey，写入 Keychain；否则保留本地已有的 key
   */
  async importProviders(
    payload: ProviderExportPayload,
    mode: ProviderImportMode,
  ): Promise<ProviderImportResult> {
    const result: ProviderImportResult = { imported: 0, skipped: 0, errors: [] }
    if (payload.profiles.length === 0) return result

    const existing = new Map<string, ReturnType<typeof this.repo.listAll>[number]>()
    for (const row of this.repo.listAll()) {
      existing.set(row.name, row)
    }

    for (const profile of payload.profiles) {
      try {
        const match = existing.get(profile.name)
        if (match != null) {
          if (mode === 'merge') {
            result.skipped += 1
            continue
          }
          // replace: 更新已存在的（保留 keystoreRef、本地 isDefault）
          // 若导入数据包含 apiKey，则更新 Keychain 中的 key
          if (profile.apiKey && match.keystore_ref) {
            await keystore.setSecret(
              match.keystore_ref as keystore.KeystoreRef,
              profile.apiKey,
            )
            log.info(`Updated API key during import for id=${match.id} name=${profile.name}`)
          }
          this.repo.update(match.id, {
            name: profile.name,
            config: buildConfigFromExport(profile),
          })
          result.imported += 1
          continue
        }

        // 新建：创建 keystoreRef，apiKey 写入 Keychain
        const newId = crypto.randomUUID()
        const providerType = profile.provider
        const ref = keystore.makeKeystoreRef(providerType, newId)
        if (profile.apiKey) {
          await keystore.setSecret(ref, profile.apiKey)
          log.info(`Imported provider with API key for id=${newId} name=${profile.name}`)
        } else {
          // 无 apiKey：不写入 keychain（keytar 不接受空密码），
          // 用户需要在编辑面板补 Key 才能 healthCheck
          log.info(`Imported provider without API key for id=${newId} name=${profile.name}`)
        }

        this.repo.create({
          id: newId,
          providerType,
          name: profile.name,
          config: buildConfigFromExport(profile),
          keystoreRef: ref,
          // 导入时强制非默认，避免覆盖本地默认设置
          isDefault: false,
        })
        result.imported += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`[${profile.name}] ${message}`)
        log.warn(`Failed to import provider "${profile.name}": ${message}`)
      }
    }

    return result
  }
}

function fetchAnthropicMessagesPing(
  apiEndpoint: string | undefined,
  apiKey: string,
  model: string,
): Promise<Response> {
  return fetch(getAnthropicMessagesEndpoint(apiEndpoint), {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
    signal: AbortSignal.timeout(PROVIDER_CONNECTION_TIMEOUT_MS),
  })
}

function fetchOpenAiCompatiblePing(
  apiEndpoint: string,
  apiKey: string,
  model: string,
  codexApiKind: 'chat' | 'responses',
): Promise<Response> {
  const endpoint = codexApiKind === 'responses'
    ? getOpenAiResponsesEndpoint(apiEndpoint)
    : getOpenAiChatCompletionsEndpoint(apiEndpoint)
  const body = codexApiKind === 'responses'
    ? {
      model,
      input: 'ping',
      max_output_tokens: 1,
      stream: false,
    }
    : {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    }

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_CONNECTION_TIMEOUT_MS),
  })
}

function formatProviderConnectionError(err: unknown, timeoutMs: number): string {
  const fallback = String(err)
  if (!(err instanceof Error)) return fallback
  const normalized = `${err.name}: ${err.message}`.toLowerCase()
  if (
    err.name === 'TimeoutError'
    || normalized.includes('timed out')
    || normalized.includes('aborted due to timeout')
  ) {
    return `连接测试超时（>${Math.ceil(timeoutMs / 1000)}s），请检查网络、代理或接口地址后重试`
  }
  return err.message || fallback
}

interface ProviderConfig {
  defaultModel?: string
  model?: string
  modelIds?: string[]
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses'
  supportsMillionContext?: boolean
  /** 自定义上下文窗口（tokens），优先级高于 supportsMillionContext。 */
  contextWindow?: number
  maxTokens?: number
  temperature?: number
  /** 档位映射；未配置则回落 defaultModel */
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  modelType?: ProviderModelType
  imageProvider?: string | null
  imageApiType?: ImageGenApiType | null
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider?: MediaProviderKind | null
  /** 多媒体调用方式 */
  mediaApiType?: MediaApiType | null
  /** 已声明支持的多媒体能力列表 */
  mediaCapabilities?: MediaCapabilityId[]
  /** 多媒体能力默认值 */
  mediaDefaults?: ProviderMediaDefaults
  /** 启用的多媒体模型 manifest 引用 */
  mediaModelRefs?: ProviderMediaModelRef[]
}

interface ModelsListResponse {
  data?: Array<{
    id?: unknown
    owned_by?: unknown
    ownedBy?: unknown
  }>
}

function normalizeProviderType(providerType: string): TextProviderKind {
  return TEXT_PROVIDER_KINDS.has(providerType as TextProviderKind)
    ? providerType as TextProviderKind
    : 'openai'
}

function normalizeModelIds(defaultModel: string, modelIds?: string[]): string[] {
  const normalized = [defaultModel, ...(modelIds ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return [...new Set(normalized)]
}

type NormalizedProviderConfig = Required<Pick<ProviderConfig, 'defaultModel' | 'modelIds'>> & Omit<ProviderConfig, 'defaultModel' | 'modelIds'>

/**
 * 把 imageProvider 字符串归一到 mediaProvider 枚举：
 *   openai / openai-compatible → 'openai-compatible'
 *   apimart / xai / custom     → 原值
 *   其它（gemini / seeddance / bailian / zhipu / openrouter …）→ 'custom' 兜底
 */
function mediaProviderFromImageProvider(imageProvider: string): MediaProviderKind {
  const v = imageProvider.trim().toLowerCase()
  if (isMediaProviderKind(v)) return v
  if (v === 'apimart') return 'apimart'
  if (v === 'xai') return 'xai'
  if (v === 'bailian') return 'bailian'
  if (v === 'seeddance' || v === 'seedance' || v === 'volcengine') return 'volcengine-ark'
  if (v === 'custom') return 'custom'
  if (v === 'openai' || v === 'openai-compatible') return 'openai-compatible'
  if (v === 'gemini' || v === 'google') return 'google-generative-ai'
  return 'custom'
}

function normalizeMediaCapabilities(
  capabilities: MediaCapabilityId[] | undefined,
  modelType: ProviderModelType | undefined,
): MediaCapabilityId[] | undefined {
  const normalized = Array.from(new Set((capabilities ?? []).filter(isMediaCapabilityId)))
  if (normalized.length > 0) return normalized
  // 兜底：未显式声明时按 modelType 推默认能力
  if (modelType === 'image') return ['image.generate']
  if (modelType === 'voice') return ['audio.speech']
  if (modelType === 'video') return ['video.generate']
  return undefined
}

function normalizeProviderConfig(config: ProviderConfig): NormalizedProviderConfig {
  const defaultModel = (config.defaultModel ?? config.model ?? '').trim()
  const modelType = config.modelType !== undefined ? normalizeModelType(config.modelType) : undefined
  const imageProvider = modelType === 'image'
    ? (config.imageProvider?.trim() || 'openai')
    : undefined
  const imageApiType = modelType === 'image'
    ? normalizeImageApiType(config.imageApiType)
    : undefined
  const normalized: NormalizedProviderConfig = {
    ...config,
    defaultModel,
    modelIds: normalizeModelIds(defaultModel, config.modelIds),
  }
  if (modelType !== undefined) normalized.modelType = modelType
  if (imageProvider !== undefined) normalized.imageProvider = imageProvider
  else delete normalized.imageProvider
  if (imageApiType !== undefined) normalized.imageApiType = imageApiType
  else delete normalized.imageApiType

  // ── 多媒体能力归一化 ──
  // modelType=image 时，把 imageProvider/imageApiType 同步到 mediaProvider/mediaApiType，
  // 并保证 mediaCapabilities 至少包含 image.generate（design doc §5.1 兼容规则）。
  if (modelType === 'image') {
    const inferredProvider = mediaProviderFromImageProvider(
      config.mediaProvider ?? (config.imageProvider ?? 'openai'),
    )
    const inferredApiType =
      config.mediaApiType != null && isMediaApiType(config.mediaApiType)
        ? config.mediaApiType
        : (normalizeImageApiType(config.imageApiType) as MediaApiType)
    normalized.mediaProvider = inferredProvider
    normalized.mediaApiType = inferredApiType
    const caps = normalizeMediaCapabilities(config.mediaCapabilities, 'image') ?? ['image.generate']
    if (!caps.includes('image.generate')) caps.push('image.generate')
    normalized.mediaCapabilities = caps
  } else {
    // 非 image：保留显式声明的 mediaProvider / mediaApiType / mediaCapabilities
    if (config.mediaProvider != null && isMediaProviderKind(config.mediaProvider)) {
      normalized.mediaProvider = config.mediaProvider
    } else if (config.mediaProvider === null) {
      normalized.mediaProvider = null
    } else {
      delete normalized.mediaProvider
    }
    if (config.mediaApiType != null && isMediaApiType(config.mediaApiType)) {
      normalized.mediaApiType = config.mediaApiType
    } else if (config.mediaApiType === null) {
      normalized.mediaApiType = null
    } else {
      delete normalized.mediaApiType
    }
    const inferredCaps = normalizeMediaCapabilities(config.mediaCapabilities, modelType)
    if (inferredCaps != null) normalized.mediaCapabilities = inferredCaps
    else delete normalized.mediaCapabilities
  }
  if (config.mediaDefaults != null) {
    normalized.mediaDefaults = config.mediaDefaults
  } else {
    delete normalized.mediaDefaults
  }
  if (Array.isArray(config.mediaModelRefs)) {
    normalized.mediaModelRefs = config.mediaModelRefs
      .filter((ref) => ref != null && typeof ref.manifestId === 'string' && ref.manifestId.trim().length > 0)
      .map((ref) => {
        const normalizedRef: ProviderMediaModelRef = {
          manifestId: ref.manifestId.trim(),
          ...(ref.modelId != null && ref.modelId.trim().length > 0 ? { modelId: ref.modelId.trim() } : {}),
          ...(ref.enabled !== undefined ? { enabled: ref.enabled } : {}),
          ...(ref.defaults !== undefined ? { defaults: ref.defaults } : {}),
          ...(ref.manifest !== undefined ? { manifest: ref.manifest } : {}),
        }
        return ProviderMediaModelRefSchema.parse(normalizedRef)
      })
  } else {
    delete normalized.mediaModelRefs
  }

  return normalized
}

function normalizeLocalCliProviderConfig(providerId: string, config: ProviderConfig): NormalizedProviderConfig {
  if (providerId === LOCAL_CODEX_CLI_PROVIDER_ID) {
    return normalizeProviderConfig({
      ...config,
      defaultModel: LOCAL_CODEX_CLI_DEFAULT_MODEL,
      modelIds: [LOCAL_CODEX_CLI_DEFAULT_MODEL],
      codexApiKind: 'responses',
    })
  }
  return normalizeProviderConfig({
    ...config,
    defaultModel: LOCAL_CLI_DEFAULT_MODEL,
    modelIds: [LOCAL_CLI_DEFAULT_MODEL],
  })
}

function normalizeModelType(value: unknown): ProviderModelType {
  return typeof value === 'string' && PROVIDER_MODEL_TYPES.has(value as ProviderModelType)
    ? value as ProviderModelType
    : 'multimodal'
}

function normalizeImageApiType(value: unknown): ImageGenApiType {
  return typeof value === 'string' && IMAGE_API_TYPES.has(value as ImageGenApiType)
    ? value as ImageGenApiType
    : 'sync'
}

function getDefaultEndpointBase(providerType: string): string {
  switch (providerType) {
    case 'anthropic': return 'https://api.anthropic.com'
    case 'openai': return 'https://api.openai.com/v1'
    default: return 'https://api.openai.com/v1'
  }
}

function getAnthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function getOpenAiChatCompletionsEndpoint(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (endsWithVersionSegment(base)) return `${base}/chat/completions`
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function getOpenAiResponsesEndpoint(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions')) return `${base.slice(0, -'/chat/completions'.length)}/responses`
  if (endsWithVersionSegment(base)) return `${base}/responses`
  if (base.endsWith('/v1')) return `${base}/responses`
  return `${base}/v1/responses`
}

const KNOWN_MODELS_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
] as const

function getModelsUrlCandidates(
  baseUrl: string,
  isFullUrl: boolean,
  modelsUrlOverride: string | null | undefined,
): string[] {
  const override = modelsUrlOverride?.trim()
  if (override) return [override]

  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return []

  const candidates: string[] = []
  if (isFullUrl) {
    const v1Index = trimmed.indexOf('/v1/')
    if (v1Index >= 0) candidates.push(`${trimmed.slice(0, v1Index)}/v1/models`)
    const lastSlash = trimmed.lastIndexOf('/')
    if (lastSlash > trimmed.indexOf('://') + 2) candidates.push(`${trimmed.slice(0, lastSlash)}/models`)
    return uniqStrings(candidates)
  }

  const stripped = stripKnownCompatSuffix(trimmed)

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`)
    if (!trimmed.endsWith('/v1')) candidates.push(`${trimmed}/v1/models`)
  } else {
    candidates.push(`${trimmed}/v1/models`)
    if (stripped == null) candidates.push(`${trimmed}/models`)
  }

  if (stripped != null) {
    const root = stripped.replace(/\/+$/, '')
    if (root.includes('://')) {
      candidates.push(`${root}/v1/models`)
      candidates.push(`${root}/models`)
    }
  }

  return uniqStrings(candidates)
}

function getModelsRequestHeaders(providerType: string, apiKey: string): Record<string, string> {
  if (providerType === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  return { Authorization: `Bearer ${apiKey}` }
}

function normalizeFetchedModels(response: ModelsListResponse): ProviderFetchedModel[] {
  return (response.data ?? [])
    .flatMap((item): ProviderFetchedModel[] => {
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!id) return []
      const ownedBy = typeof item.owned_by === 'string'
        ? item.owned_by
        : typeof item.ownedBy === 'string'
          ? item.ownedBy
          : null
      return [{ id, ownedBy }]
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function truncateResponseBody(body: string): string {
  return body.length > MODELS_ERROR_BODY_MAX_CHARS
    ? `${body.slice(0, MODELS_ERROR_BODY_MAX_CHARS)}...`
    : body
}

function endsWithVersionSegment(value: string): boolean {
  const last = value.split('/').pop() ?? ''
  return /^v\d+$/i.test(last)
}

function stripKnownCompatSuffix(value: string): string | null {
  for (const suffix of KNOWN_MODELS_COMPAT_SUFFIXES) {
    if (value.endsWith(suffix)) return value.slice(0, -suffix.length)
  }
  return null
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

/* ─── 导入导出辅助 ─────────────────────────────────────────────────────────── */

/**
 * 把数据库行（已含 config_json）转成可导出的 ProviderExportProfile。
 *
 * 故意丢弃：
 *   - keystoreRef（导入时不复用；新建时会生成新 ref）
 *   - createdAt（导入时由 DB 自动生成）
 *
 * apiKey 通过参数传入（从 Keychain 读取），非空时附带到导出数据中。
 */
function rowToExportProfile(
  row: {
    id: string
    provider_type: string
    name: string
    config_json: string
    is_default: number
  },
  apiKey?: string,
): ProviderExportProfile {
  const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
  return {
    id: row.id,
    name: row.name,
    provider: normalizeProviderType(row.provider_type),
    apiEndpoint: config.apiEndpoint ?? null,
    defaultModel: config.defaultModel,
    modelIds: config.modelIds,
    supportsMillionContext: config.supportsMillionContext === true,
    ...(typeof config.contextWindow === 'number' && config.contextWindow > 0 && { contextWindow: config.contextWindow }),
    isDefault: row.is_default === 1,
    ...(config.haikuModel !== undefined && { haikuModel: config.haikuModel }),
    ...(config.sonnetModel !== undefined && { sonnetModel: config.sonnetModel }),
    ...(config.opusModel !== undefined && { opusModel: config.opusModel }),
    ...(config.codexApiKind !== undefined && { codexApiKind: config.codexApiKind }),
    modelType: normalizeModelType(config.modelType),
    ...(config.imageProvider !== undefined && { imageProvider: config.imageProvider }),
    ...(config.imageApiType !== undefined && { imageApiType: config.imageApiType }),
    ...(config.mediaProvider !== undefined && { mediaProvider: config.mediaProvider }),
    ...(config.mediaApiType !== undefined && { mediaApiType: config.mediaApiType }),
    ...(config.mediaCapabilities !== undefined && { mediaCapabilities: config.mediaCapabilities }),
    ...(config.mediaDefaults !== undefined && { mediaDefaults: config.mediaDefaults }),
    ...(config.mediaModelRefs !== undefined && { mediaModelRefs: config.mediaModelRefs }),
    ...(apiKey && apiKey.length > 0 && { apiKey }),
  }
}

/**
 * 从 ProviderExportProfile 重建可写入 config_json 的对象。
 *
 * 字段默认值：import 时 apiEndpoint 是 null 表示"使用默认"，
 * 此时不写入 apiEndpoint 键（保持与 rowToProfile 行为一致）。
 */
function buildConfigFromExport(profile: ProviderExportProfile): {
  defaultModel: string
  modelIds: string[]
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses'
  supportsMillionContext?: boolean
  contextWindow?: number
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  modelType?: ProviderModelType
  imageProvider?: string | null
  imageApiType?: ImageGenApiType | null
  mediaProvider?: MediaProviderKind | null
  mediaApiType?: MediaApiType | null
  mediaCapabilities?: MediaCapabilityId[]
  mediaDefaults?: ProviderMediaDefaults
  mediaModelRefs?: ProviderMediaModelRef[]
} {
  return {
    defaultModel: profile.defaultModel,
    modelIds: profile.modelIds,
    ...(profile.apiEndpoint != null && { apiEndpoint: profile.apiEndpoint }),
    ...(profile.codexApiKind !== undefined && { codexApiKind: profile.codexApiKind }),
    supportsMillionContext: profile.supportsMillionContext,
    ...(typeof profile.contextWindow === 'number' && profile.contextWindow > 0 && { contextWindow: profile.contextWindow }),
    ...(profile.haikuModel != null && profile.haikuModel.length > 0 && { haikuModel: profile.haikuModel }),
    ...(profile.sonnetModel != null && profile.sonnetModel.length > 0 && { sonnetModel: profile.sonnetModel }),
    ...(profile.opusModel != null && profile.opusModel.length > 0 && { opusModel: profile.opusModel }),
    ...(profile.modelType !== undefined && { modelType: profile.modelType }),
    ...(profile.imageProvider !== undefined && { imageProvider: profile.imageProvider }),
    ...(profile.imageApiType !== undefined && { imageApiType: profile.imageApiType }),
    ...(profile.mediaProvider !== undefined && { mediaProvider: profile.mediaProvider }),
    ...(profile.mediaApiType !== undefined && { mediaApiType: profile.mediaApiType }),
    ...(profile.mediaCapabilities !== undefined && { mediaCapabilities: profile.mediaCapabilities }),
    ...(profile.mediaDefaults !== undefined && { mediaDefaults: profile.mediaDefaults }),
    ...(profile.mediaModelRefs !== undefined && { mediaModelRefs: profile.mediaModelRefs }),
  }
}
