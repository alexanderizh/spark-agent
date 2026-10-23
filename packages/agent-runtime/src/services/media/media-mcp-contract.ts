export const SPARK_MEDIA_TOOL_NAMES = [
  'mcp__spark_media__list_models',
  'mcp__spark_media__describe_model',
  'mcp__spark_media__generate_image',
  'mcp__spark_media__edit_image',
  'mcp__spark_media__generate_audio',
  'mcp__spark_media__transcribe_audio',
  'mcp__spark_media__generate_video',
  'mcp__spark_media__upload_file',
  'mcp__spark_media__get_file',
  'mcp__spark_media__list_files',
  'mcp__spark_media__delete_file',
  'mcp__spark_media__list_tasks',
  'mcp__spark_media__get_task',
  'mcp__spark_media__cancel_task',
] as const

export interface MediaGenerationPromptInput {
  name: string
  model: string
  provider: string
  apiType: string
  outputDir: string
  capabilities: string[]
  providerConfigurations?: Array<{
    id: string
    name: string
    model: string
    provider: string
  }>
  apiEndpoint?: string
}

/**
 * 常驻状态段（Tier A）：配置摘要 + 路由有界摘要 + 首次调用前先 load 手册的
 * 核心规则。静态使用规则手册见 MEDIA_GENERATION_GUIDE_PROMPT（Tier B），
 * 由 `mcp__spark_platform__capability_load`（id: media-generation）按需加载。
 */
export function buildMediaGenerationStatusPrompt(
  input: MediaGenerationPromptInput,
  options?: { capabilityLoadAvailable?: boolean },
): string {
  const caps =
    input.capabilities.length > 0 ? input.capabilities.join(', ') : 'audio.speech, video.generate'
  // P1-6 瘦身：逐路由清单（随路由数线性增长，19 路由时 ~5k 字符）与工具动词
  // 枚举均与 `mcp__spark_media__list_models` 输出 / 工具 description 重复——
  // 改为「渠道名 [默认模型]」有界摘要（截断 12 个，超出走 list_models），
  // 行为契约段全部保留；渠道名保留路由可发现性（"用百炼画"类请求免查询）。
  const configurations = input.providerConfigurations ?? []
  const routeSegments = configurations.map(
    (configuration) => `${configuration.name} [${configuration.model}]`,
  )
  const ROUTE_NAME_LIMIT = 12
  const shown = routeSegments.slice(0, ROUTE_NAME_LIMIT).join(', ')
  const hidden = Math.max(0, routeSegments.length - ROUTE_NAME_LIMIT)
  const routeSummary =
    routeSegments.length > 0
      ? `- Configured provider routes (${routeSegments.length}): ${shown}${
          hidden > 0 ? `, …(+${hidden} more via list_models)` : ''
        }; default ${input.model}. Call \`mcp__spark_media__list_models\` to inspect every model route, capability, and manifest id.`
      : '- No extra provider routes configured; call `mcp__spark_media__list_models` to inspect the active model.'
  return [
    '## Media Generation Capability',
    'The current runtime has configured multimedia models (image / audio / video) and can route each selected model to its owning provider.',
    'Credentials are injected only into the local media MCP server — never ask for or reveal API keys.',
    '',
    `- Configuration name: ${input.name}`,
    `- Model ID: ${input.model}`,
    `- Platform adapter: ${input.provider}`,
    `- Invocation mode: ${input.apiType}`,
    `- API base URL: ${input.apiEndpoint ?? '(provider default)'}`,
    `- Declared capabilities: ${caps}`,
    `- Output directory: ${input.outputDir}`,
    routeSummary,
    '',
    // 尾行按加载手段门控：capability_load 不可用（spark_platform 未挂载）时不给
    // load 指引（避免指向不存在的工具），完整手册由组装点回退为全文常驻注入。
    options?.capabilityLoadAvailable === false
      ? 'Before the first `generate_video`, `generate_image`, or `edit_image` call in this conversation, call `mcp__spark_media__describe_model` for the selected model/capability unless you already inspected it in this turn.'
      : 'Before the first `generate_video`, `generate_image`, or `edit_image` call in this conversation, load the full usage guide via `mcp__spark_platform__capability_load` with id `media-generation`, and call `mcp__spark_media__describe_model` for the selected model/capability unless you already inspected it in this turn.',
  ].join('\n')
}

/** 静态使用规则手册（Tier B）：capability_load(media-generation) 的加载正文，单一事实源。 */
export const MEDIA_GENERATION_GUIDE_PROMPT = [
  '## Media Generation Usage Guide',
  'Available tools (each description carries its own usage and constraints): `mcp__spark_media__generate_image`, `mcp__spark_media__generate_video`, and `mcp__spark_media__describe_model` (inspect parameter schemas before calling a model), plus edit_image / generate_audio / transcribe_audio / upload_file / get_file / list_files / delete_file / list_tasks / get_task / cancel_task under the same `mcp__spark_media__` prefix. `delete_file` requires explicit user confirmation first.',
  '',
  'Image generation and image editing may also be available through the active model, SDK, CLI, or executor. Treat `mcp__spark_media__generate_image` and `mcp__spark_media__edit_image` as Spark platform routes, not as replacements for those native capabilities.',
  "For image requests they are routing guidelines rather than hard restrictions: honor an explicit route choice; explain and adapt if it is unavailable or clearly unsuitable; ask the user only when the choice materially affects quality, cost, latency, privacy, or workflow — otherwise choose a reasonable route without blocking the task. Without an explicit choice, consider the active model or executor's native image capability first, and use the Spark platform route whenever it better fits the task, native generation is unavailable, or the user selects Spark.",
  '',
  'Before calling `generate_video`, `generate_image`, or `edit_image`, you must call `mcp__spark_media__describe_model` for the selected model/capability unless you already inspected it in this turn.',
  'When the user names a configured model, pass that exact manifest id or model id in the generation tool `model` field. The media server will select the matching provider credentials and endpoint; never substitute the default model silently.',
  'Use the returned `maxImages`, `maxVideos`, `maxAudios`, `rolePolicy`, and parameter schema to tell the user: supported input counts, supported roles (first frame / last frame / reference image/video/audio), and the default role assignment rule.',
  'If the user provides more media inputs than a declared maximum, ask which inputs to keep before generation; do not silently drop extra inputs.',
  'Provider file objects must be active before model use. Files API ids for Chat/Responses understanding must not be passed to media generation endpoints unless that model schema explicitly supports file ids.',
  '',
  'After success, call `mcp__spark_files__present_files` with every generated or edited image, audio, and video file from the structured result.',
  'Returning only a URL or filesystem path is not complete; the application must receive a file card so it can render a preview or playback control.',
  'Do not auto-retry after a provider failure; report the error and suggest model, prompt, or provider-configuration adjustments.',
].join('\n')

/** 状态段 + 完整手册的组合（测试与外部消费方的单一事实源组合口）。 */
export function buildMediaGenerationSystemPrompt(input: MediaGenerationPromptInput): string {
  return `${buildMediaGenerationStatusPrompt(input)}\n\n${MEDIA_GENERATION_GUIDE_PROMPT}`
}
