import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import { compareRuntimeVersions, resolveManagedCodexCli } from './codex-runtime.js'
import type { SDKExecutorConfig } from './types.js'

const log = createLogger('codex-model-catalog')

type CatalogModel = Record<string, unknown> & { slug?: unknown }
type ModelCatalog = { models: CatalogModel[] }

const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 100

/**
 * 旧版 native runtime 的 model catalog schema 分界线（本仓库实测矩阵）：
 *   - 0.144.5 要求条目必须显式携带 `base_instructions` / `supports_reasoning_summaries`，
 *     且无法解析 0.149+ 写出的 models_cache.json 条目；
 *   - 0.149.0 / 0.153.4 既接受现代条目，也接受下面的 legacy 完整形状。
 * 因此低于该版本一律按 legacy 形状生成，绝不复用现代形状的源条目，
 * 否则整份 catalog 会被旧 runtime 在启动阶段拒绝，导致对话直接不可用。
 */
export const LEGACY_MODEL_CATALOG_RUNTIME_CEILING = '0.149.0'

/** 旧 runtime 必需的顶层字段；缺失会让 serde 直接拒绝整份 catalog。 */
const LEGACY_REQUIRED_MODEL_FIELDS = ['base_instructions', 'supports_reasoning_summaries'] as const

/**
 * Codex 给未知模型使用的 fallback metadata 上限是 272K，`model_context_window`
 * 只能在该上限内覆盖。自定义 Provider 必须把模型先放入 model_catalog_json，才能
 * 让 Codex 使用 Spark 已解析出的上下文窗口。
 */
export async function withCodexModelCatalog(config: SDKExecutorConfig): Promise<SDKExecutorConfig> {
  if (
    config.codexCliProvider == null ||
    typeof config.contextWindowTokens !== 'number' ||
    !Number.isFinite(config.contextWindowTokens) ||
    config.contextWindowTokens <= 0 ||
    config.codexModelCatalogPath != null
  ) {
    return config
  }

  const configuredCodexHome = resolveCodexHome(config)
  const catalogPath = await ensureCodexModelCatalog({
    model: config.model,
    contextWindowTokens: config.contextWindowTokens,
    ...(configuredCodexHome != null ? { codexHome: configuredCodexHome } : {}),
    runtimeVersion: resolveActiveCodexRuntimeVersion(),
  })
  return catalogPath == null ? config : { ...config, codexModelCatalogPath: catalogPath }
}

/**
 * 创建/复用一个由 Spark 管理的 Codex model_catalog_json。
 *
 * 目录内容以 Codex 自己的 models_cache.json 为模板，保留运行时版本需要的字段；
 * 当前 Provider 的模型条目始终覆盖为 Spark 配置的窗口，并关闭 Codex 额外的 95%
 * effective headroom。Spark 已经用自己的 70% soft limit 和 Runtime 的 90% auto
 * compact 规则留出安全空间，这样 UI 与 Provider 配置都以同一个 1M 硬窗口为准。
 */
export async function ensureCodexModelCatalog(params: {
  model: string
  contextWindowTokens: number
  codexHome?: string | undefined
  runtimeVersion?: string | null | undefined
}): Promise<string | null> {
  const model = params.model.trim()
  const contextWindowTokens = Math.floor(params.contextWindowTokens)
  if (model.length === 0 || !Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    return null
  }

  const codexHome =
    params.codexHome?.trim() || process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex')
  const sourceCatalog = await readSourceCatalog(path.join(codexHome, 'models_cache.json'))
  const catalog = createCodexModelCatalog({
    model,
    contextWindowTokens,
    sourceCatalog,
    runtimeVersion: params.runtimeVersion ?? null,
  })
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`
  const digest = createHash('sha256').update(serialized).digest('hex').slice(0, 20)
  const catalogPath = path.join(codexHome, `spark-model-catalog-${digest}.json`)

  try {
    await mkdir(codexHome, { recursive: true })
    let existing: string | null = null
    try {
      existing = await readFile(catalogPath, 'utf8')
    } catch {
      // The generated catalog does not exist yet.
    }
    // 崩溃自愈：一旦本机 runtime 拒绝过这份目录，就不再硬塞，直接退化为
    // 「不注入 catalog」——上下文窗口覆盖会丢，但对话必须保持可用。
    if (isCodexModelCatalogRejected(catalogPath, params.runtimeVersion)) {
      log.warn(`catalog 已被本机 runtime 拒绝，跳过注入：${catalogPath}`)
      return null
    }
    if (existing !== serialized) await writeFile(catalogPath, serialized, 'utf8')
    return catalogPath
  } catch {
    // A catalog is a compatibility bridge. If the user's Codex home is read-only,
    // retain the original config and let the Runtime report its own limit.
    return null
  }
}

/** Pure builder exported for focused tests and future catalog diagnostics. */
export function createCodexModelCatalog(params: {
  model: string
  contextWindowTokens: number
  sourceCatalog?: ModelCatalog | null
  runtimeVersion?: string | null
}): ModelCatalog {
  const legacyRuntime = usesLegacyModelCatalogSchema(params.runtimeVersion)
  const rawSourceModels = params.sourceCatalog?.models ?? []
  // 旧 runtime 只能解析自己那一代的条目（必须自带 base_instructions）。现代形状的
  // models_cache.json 条目对它是硬失败，因此整批剔除，只保留确定可解析的条目。
  const sourceModels = legacyRuntime
    ? rawSourceModels.filter((entry) => hasLegacyRequiredFields(entry))
    : rawSourceModels
  if (legacyRuntime && sourceModels.length < rawSourceModels.length) {
    log.warn(
      `丢弃 ${rawSourceModels.length - sourceModels.length} 个现代形状条目：` +
        `runtime ${params.runtimeVersion} 无法解析，继续沿用会让整个 catalog 解析失败`,
    )
  }

  // 只复用同名条目；把任意已知模型（例如 gpt）的 instructions/capability
  // 拷贝给第三方模型会改变 Codex 的行为。未知模型使用下面的中性 fallback。
  const sourceModel = sourceModels.find((entry) => entry.slug === params.model)
  const modelEntry: CatalogModel = {
    ...(sourceModel != null ? cloneRecord(sourceModel) : createFallbackModel(params.model)),
    slug: params.model,
    display_name: params.model,
    context_window: Math.floor(params.contextWindowTokens),
    max_context_window: Math.floor(params.contextWindowTokens),
    effective_context_window_percent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
    // Let Codex derive its normal 90% auto-compact threshold from the configured window.
    auto_compact_token_limit: null,
  }

  const modelIndex = sourceModels.findIndex((entry) => entry.slug === params.model)
  const models = sourceModels.map((entry) => cloneRecord(entry))
  if (modelIndex >= 0) models[modelIndex] = modelEntry
  else models.push(modelEntry)
  return { models }
}

/**
 * 运行中的 native runtime 版本。读不到时返回 null（开发态直接用捆绑 CLI、
 * 或尚未安装受管 runtime），此时按现代形状生成，保持既有行为。
 */
export function resolveActiveCodexRuntimeVersion(): string | null {
  try {
    return resolveManagedCodexCli()?.version ?? null
  } catch {
    return null
  }
}

/** 低于该版本的 runtime 需要 legacy 完整形状条目。 */
export function usesLegacyModelCatalogSchema(runtimeVersion: string | null | undefined): boolean {
  const version = runtimeVersion?.trim()
  if (!version) return false
  return compareRuntimeVersions(version, LEGACY_MODEL_CATALOG_RUNTIME_CEILING) < 0
}

function hasLegacyRequiredFields(entry: CatalogModel): boolean {
  return LEGACY_REQUIRED_MODEL_FIELDS.every((field) => entry[field] != null)
}

/** 目录被本机 runtime 拒绝的标记路径；与目录同目录同摘要，避免误伤其他版本。 */
export function codexModelCatalogRejectedPath(catalogPath: string): string {
  return `${catalogPath}.rejected`
}

/**
 * 该目录是否已被拒绝过。
 *
 * 标记记录写标记时的 runtime 版本：升级/更换 runtime 后旧结论不再成立
 * （拒绝是某个版本对某份内容的判断），此时自动失效，避免用户升完 runtime
 * 仍被永久锁在「不注入 catalog」的降级状态。标记内容不可读时按已拒绝处理。
 */
export function isCodexModelCatalogRejected(
  catalogPath: string,
  currentRuntimeVersion?: string | null,
): boolean {
  const markerPath = codexModelCatalogRejectedPath(catalogPath)
  try {
    if (!existsSync(markerPath)) return false
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as { runtimeVersion?: unknown }
    const rejectedVersion =
      typeof parsed.runtimeVersion === 'string' ? parsed.runtimeVersion.trim() : ''
    const current = currentRuntimeVersion?.trim() ?? ''
    if (rejectedVersion.length > 0 && current.length > 0 && rejectedVersion !== current) {
      return false
    }
    return true
  } catch {
    // 标记存在但不可解析：保守地继续停用该目录。
    return existsSync(markerPath)
  }
}

/**
 * 记录「本机 runtime 拒绝这份 catalog」。下次生成同摘要目录且 runtime 版本未变时
 * 会被跳过，保证轮次不会因为目录不兼容而彻底不可用。
 */
export async function markCodexModelCatalogRejected(
  catalogPath: string,
  runtimeVersion?: string | null,
): Promise<boolean> {
  try {
    await writeFile(
      codexModelCatalogRejectedPath(catalogPath),
      `${JSON.stringify({
        rejectedAt: new Date().toISOString(),
        runtimeVersion: runtimeVersion?.trim() ?? null,
      })}\n`,
      'utf8',
    )
    return true
  } catch {
    return false
  }
}

async function readSourceCatalog(filePath: string): Promise<ModelCatalog | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      models?: unknown
    }
    if (!Array.isArray(parsed.models)) return null
    const models = parsed.models.filter(isCatalogModel)
    return models.length > 0 ? { models } : null
  } catch {
    return null
  }
}

function isCatalogModel(value: unknown): value is CatalogModel {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: CatalogModel): CatalogModel {
  return JSON.parse(JSON.stringify(value)) as CatalogModel
}

export function resolveCodexHome(config: SDKExecutorConfig): string {
  const candidates = [config.customEnv?.CODEX_HOME, config.codexCliProvider?.env?.CODEX_HOME]
  return (
    candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ||
    process.env.CODEX_HOME?.trim() ||
    path.join(homedir(), '.codex')
  )
}

function createFallbackModel(model: string): CatalogModel {
  return {
    slug: model,
    display_name: model,
    description: null,
    default_reasoning_level: null,
    supported_reasoning_levels: [],
    shell_type: 'unified_exec',
    visibility: 'none',
    supported_in_api: true,
    priority: 99,
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    // 旧 runtime（<= 0.144.5）把该字段当必需项，缺失就拒绝整份 catalog；
    // 0.149+ 接受空串且行为不变（本仓库对 0.144.5/0.149.0/0.153.4 实测）。
    base_instructions: '',
    model_messages: { instructions_template: '' },
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    supports_reasoning_summaries: true,
    default_reasoning_summary: 'auto',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'bytes', limit: 10_000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    supports_search_tool: false,
    supports_experimental_context: false,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
    auto_review_model_override: null,
    model_specialty: null,
    tool_mode: null,
    multi_agent_version: null,
    multi_agent_reasoning_effort: null,
  }
}
