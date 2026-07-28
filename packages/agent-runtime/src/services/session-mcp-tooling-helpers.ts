/**
 * Session 的 MCP tooling / image 辅助（从 session.service.ts 拆分，D-13）。
 *
 * 包含：
 * - buildImageGenerationSystemPrompt：图片生成 system prompt 模板
 * - mergeUniqueStrings：去重合并（通用工具）
 * - extractPresentedFiles / parsePresentedFilesPayload：从 present_files 工具结果里提取文件
 * - resolve*McpServerPath：8 个内置 MCP server 路径解析（image / media / platform / web / memory / canvas / debug）
 * - resolvePresentFilesMcpServer：present_files MCP server 配置（返回 SDKMcpServerConfig）
 * - *_TOOL_NAMES：SDK 命名空间的工具白名单（platform / search / present_files / validation / debug）
 * - *_SYSTEM_PROMPT / *_TOOL_DESCRIPTION：相关 system prompt 片段
 *
 * 依赖：node 内置模块 + AgentEvent (protocol) + SDKMcpServerConfig (sdk) + createLogger (shared)
 *
 * session.service.ts 顶部 re-export 关键的 system prompt 和工具名常量，
 * 保持向后兼容。
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent } from '@spark/protocol'
import type { SDKMcpServerConfig } from '../sdk/index.js'
import { createLogger } from '@spark/shared'

const log = createLogger('session.service')

// ─── Image generation ────────────────────────────────────────────────────────

export function resolveImageGenerationMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/image-generation-mcp-server.mjs'),
    path.resolve(here, '../tools/image-generation-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/image-generation-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function resolveMediaGenerationMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/media-generation-mcp-server.mjs'),
    path.resolve(here, '../tools/media-generation-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/media-generation-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function buildImageGenerationSystemPrompt(input: {
  name: string
  model: string
  provider: string
  apiType: string
  outputDir: string
  apiEndpoint?: string
}): string {
  return [
    '## Image Generation Capability',
    'The current runtime has a configured image generation model.',
    '',
    `- Configuration name: ${input.name}`,
    `- Model ID: ${input.model}`,
    `- Image provider: ${input.provider}`,
    `- Invocation mode: ${input.apiType}`,
    `- API base URL: ${input.apiEndpoint ?? '(provider default)'}`,
    `- Output directory: ${input.outputDir}`,
    '',
    'Use `mcp__spark_image__generate_image` when the user explicitly asks to create an image, poster, illustration, visual draft, icon, cover, or other generated image asset.',
    'Do not ask for or reveal API keys. Credentials are injected only into the local image MCP server.',
    'If the user gives semantic sizing such as square, portrait, landscape, poster, or banner, translate it to an appropriate `size` value before calling the tool.',
    'Pass provider-specific fields through `extraJson` only when they are relevant and reasonably supported by the configured provider.',
    'After success, call `mcp__spark_files__present_files` with every generated local image file so the application renders a preview for the user.',
    'Returning only a URL or filesystem path is not complete. If a provider returns only a URL, materialize it in the configured output directory before presenting it.',
    'Do not auto-retry image generation after a provider failure; report the error and suggest model, prompt, size, or provider-configuration adjustments.',
  ].join('\n')
}

export function mergeUniqueStrings(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])]
}

export function extractPresentedFiles(
  event: AgentEvent,
  workspaceRootPath: string,
): Array<{ path: string; title?: string }> | null {
  if (
    event.type !== 'tool_result' ||
    event.status !== 'success' ||
    !event.toolName.toLowerCase().endsWith('present_files')
  ) {
    return null
  }

  const payload = parsePresentedFilesPayload(event.output)
  if (payload == null || !Array.isArray(payload.files)) return null

  let workspaceRoot: string
  try {
    workspaceRoot = realpathSync(workspaceRootPath)
  } catch {
    return null
  }

  const files: Array<{ path: string; title?: string }> = []
  const seen = new Set<string>()
  for (const item of payload.files.slice(0, 20)) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || record.path.trim().length === 0) continue
    try {
      const resolved = realpathSync(
        path.isAbsolute(record.path) ? record.path : path.resolve(workspaceRoot, record.path),
      )
      const relative = path.relative(workspaceRoot, resolved)
      const outsideWorkspace =
        relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      if (outsideWorkspace || !statSync(resolved).isFile()) {
        continue
      }
      if (seen.has(resolved)) continue
      seen.add(resolved)
      const title = typeof record.title === 'string' ? record.title.trim().slice(0, 120) : ''
      files.push({ path: resolved, ...(title ? { title } : {}) })
    } catch {
      // The tool result is untrusted input; silently drop invalid or vanished files.
    }
  }
  return files
}

export function parsePresentedFilesPayload(output: unknown): Record<string, unknown> | null {
  if (output != null && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>
    if (Array.isArray(record.files)) return record
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        const parsed = parsePresentedFilesPayload(block)
        if (parsed != null) return parsed
      }
    }
    if (typeof record.text === 'string') return parsePresentedFilesPayload(record.text)
  }
  if (typeof output !== 'string') return null
  try {
    const parsed = JSON.parse(output) as unknown
    return parsePresentedFilesPayload(parsed)
  } catch {
    return null
  }
}

// ─── Platform / Web / Memory / Canvas / Debug MCP server paths ──────────────

export function resolveMcpNodeRuntimeExecutable(): string {
  const standalone = process.env.SPARK_STANDALONE_NODE?.trim()
  if (standalone != null && standalone !== '' && existsSync(standalone)) return standalone
  if (!('electron' in process.versions)) return process.execPath
  throw new Error(
    'Standalone Node runtime is unavailable; refusing to launch an MCP server through Electron RunAsNode',
  )
}

/**
 * All platform management tool names (SDK namespace: mcp__spark_platform__).
 *
 * The Platform Management MCP server (`packages/agent-runtime/src/tools/platform-management-mcp-server.mjs`)
 * exposes this set; if you add a new tool to `toolDefinitions()` in that file,
 * also append its SDK-namespaced name here, otherwise Claude SDK will refuse
 * to dispatch the tool call (it filters by the `allowedTools` allow-list).
 */
export const PLATFORM_TOOL_NAMES: string[] = [
  // Skills
  'mcp__spark_platform__skills_list',
  'mcp__spark_platform__skills_load',
  'mcp__spark_platform__skills_search',
  'mcp__spark_platform__skills_search_github',
  'mcp__spark_platform__skills_install',
  'mcp__spark_platform__skills_install_github',
  'mcp__spark_platform__skills_uninstall',
  'mcp__spark_platform__skills_toggle',
  // MCP Servers
  'mcp__spark_platform__mcp_list',
  'mcp__spark_platform__mcp_create',
  'mcp__spark_platform__mcp_update',
  'mcp__spark_platform__mcp_delete',
  'mcp__spark_platform__mcp_status',
  // Providers
  'mcp__spark_platform__providers_list',
  'mcp__spark_platform__providers_get',
  'mcp__spark_platform__providers_create',
  'mcp__spark_platform__providers_update',
  'mcp__spark_platform__providers_delete',
  'mcp__spark_platform__providers_health_check',
  'mcp__spark_platform__providers_set_default',
  'mcp__spark_platform__providers_set_default_model',
  // Workflows
  'mcp__spark_platform__workflows_list',
  'mcp__spark_platform__workflows_get',
  'mcp__spark_platform__workflows_create',
  'mcp__spark_platform__workflows_update',
  'mcp__spark_platform__workflows_delete',
  // Agents
  'mcp__spark_platform__agents_list',
  'mcp__spark_platform__agents_get',
  'mcp__spark_platform__agents_create',
  'mcp__spark_platform__agents_update',
  'mcp__spark_platform__agents_delete',
  // Teams
  'mcp__spark_platform__teams_list',
  'mcp__spark_platform__teams_get',
  'mcp__spark_platform__teams_create',
  'mcp__spark_platform__teams_update',
  'mcp__spark_platform__teams_delete',
  // Spark install artifacts
  'mcp__spark_platform__artifacts_list',
  'mcp__spark_platform__artifacts_resolve',
  // Settings
  'mcp__spark_platform__settings_get',
  'mcp__spark_platform__settings_set',
  'mcp__spark_platform__settings_get_category',
  'mcp__spark_platform__settings_get_all',
  // GitHub Connector
  'mcp__spark_platform__github_status',
  'mcp__spark_platform__github_list_repositories',
  'mcp__spark_platform__github_get_repository',
  'mcp__spark_platform__github_read_repository_file',
  'mcp__spark_platform__github_create_branch',
  'mcp__spark_platform__github_upsert_repository_file',
  'mcp__spark_platform__github_list_issues',
  'mcp__spark_platform__github_get_issue',
  'mcp__spark_platform__github_create_issue',
  'mcp__spark_platform__github_update_issue',
  'mcp__spark_platform__github_comment_issue',
  'mcp__spark_platform__github_list_pull_requests',
  'mcp__spark_platform__github_get_pull_request',
  'mcp__spark_platform__github_create_pull_request',
  'mcp__spark_platform__github_comment_pull_request',
  // Sessions (self-management)
  'mcp__spark_platform__sessions_get',
  'mcp__spark_platform__sessions_switch_model',
  'mcp__spark_platform__sessions_switch_provider',
  'mcp__spark_platform__sessions_switch_mode',
  'mcp__spark_platform__sessions_switch_permission',
  'mcp__spark_platform__sessions_switch_reasoning_effort',
  // Board Tasks
  'mcp__spark_platform__board_list',
  'mcp__spark_platform__board_get',
  'mcp__spark_platform__board_create',
  'mcp__spark_platform__board_update',
  'mcp__spark_platform__board_delete',
  'mcp__spark_platform__board_batch_create',
  'mcp__spark_platform__board_batch_update',
  'mcp__spark_platform__board_batch_delete',
  'mcp__spark_platform__board_restore',
  'mcp__spark_platform__board_permanent_delete',
]

export function resolvePlatformManagementMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // Packed desktop build: `apps/desktop/out/main/index.js` + copied `tools/*.mjs`
    path.resolve(here, 'tools/platform-management-mcp-server.mjs'),
    // When bundled one level deeper (defensive)
    path.resolve(here, '../tools/platform-management-mcp-server.mjs'),
    // Dev / monorepo source checkout
    path.resolve(
      process.cwd(),
      'packages/agent-runtime/src/tools/platform-management-mcp-server.mjs',
    ),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function resolveWebSearchMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/web-search-mcp-server.mjs'),
    path.resolve(here, '../tools/web-search-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/web-search-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function resolveSparkMemoryMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/spark-memory-mcp-server.mjs'),
    path.resolve(here, '../tools/spark-memory-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/spark-memory-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function resolveSparkCanvasMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/spark-canvas-mcp-server.mjs'),
    path.resolve(here, '../tools/spark-canvas-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/spark-canvas-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function resolvePresentFilesMcpServer(workspaceRootPath: string): SDKMcpServerConfig | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/present-files-mcp-server.mjs'),
    path.resolve(here, '../tools/present-files-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/present-files-mcp-server.mjs'),
  ]
  const serverPath = candidates.find((candidate) => existsSync(candidate))
  if (serverPath == null) {
    log.warn('Present files MCP server script not found')
    return null
  }
  return {
    type: 'stdio',
    command: resolveMcpNodeRuntimeExecutable(),
    args: [serverPath],
    cwd: workspaceRootPath,
    env: {
      SPARK_WORKSPACE_ROOT: workspaceRootPath,
    },
  }
}

export function resolveDebugMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/debug-mode-mcp-server.mjs'),
    path.resolve(here, '../tools/debug-mode-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/debug-mode-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** SDK-namespaced tool names exposed by the spark_search MCP server. */
export const SEARCH_TOOL_NAMES: string[] = [
  'mcp__spark_search__web_search',
  'mcp__spark_search__fetch_url',
]

export const PRESENT_FILES_TOOL_NAMES = ['mcp__spark_files__present_files']

export const VALIDATION_SUGGESTION_TOOL_NAMES = ['mcp__spark_verify__suggest_validation']

export const VALIDATION_SUGGESTION_TOOL_DESCRIPTION = [
  'Show the user a "run validation" card suggesting relevant project scripts (typecheck/lint/tests) for the files you changed this turn.',
  'When to use: after making source-code changes, if a quick validation pass would genuinely help the user catch regressions.',
  'When NOT to use: trivial or doc-only edits, changes outside source code, or when you already ran the equivalent checks yourself this turn.',
  'This is optional — skip it whenever it would just be noise.',
].join('\n')

export const PRESENT_FILES_SYSTEM_PROMPT = [
  '## User-facing file cards',
  'When this turn produces or identifies files that should be delivered to the user, call `mcp__spark_files__present_files` immediately before the final response.',
  'This is mandatory for generated or edited images, screenshots, audio, video, documents, slides, spreadsheets, PDFs, and exported visual assets. Returning only a path or address is not complete.',
  'For image, screenshot, audio, and video deliverables, make sure the file card is emitted so the chat can render an inline preview or playback control.',
  'Include only files the user should open, preview, or otherwise receive as deliverables.',
  'Do not include source files, dependencies, temporary files, caches, build metadata, or incidental workspace changes unless the user explicitly asked to receive that file.',
  'Do not call the tool when there are no user-facing files to present.',
  'The tool call controls the app file cards; mentioning a path in prose does not add it to that list.',
  'After calling the tool, do not repeat the same paths as standalone file links in the final response.',
].join('\n')

/**
 * System prompt section injected when the built-in web search MCP server is
 * available. The whole point: SDK 自带 WebSearch/WebFetch 在第三方 provider 下失效，
 * 这里指引模型改用始终可用的 spark_search 工具。
 */
export const WEB_SEARCH_SYSTEM_PROMPT = [
  '## Web Search Capability (built-in, always available)',
  'You have a built-in internet search that works regardless of the model provider:',
  '- `mcp__spark_search__web_search` — search the web, returns ranked {title, url, snippet}.',
  '- `mcp__spark_search__fetch_url` — fetch a page and return its readable text.',
  '',
  'Use these whenever you need current information, to verify facts, or to read a page.',
  'Prefer them over the SDK built-in `WebSearch`/`WebFetch`, which are unavailable when',
  'running on third-party (non-default) API providers. Cite the source URLs you used.',
  '',
  'Search based on how quickly the answer can change. Verify present-day roles, laws, prices,',
  'schedules, product capabilities, software versions, and other time-sensitive claims instead',
  'of relying on model memory. Stable concepts and well-established historical facts usually do',
  'not need a search unless the user asks for sources or verification.',
  'Prefer primary and authoritative sources. Fetch the underlying page when snippets are not',
  'enough, reconcile material conflicts instead of hiding them, and place source URLs near the',
  'claims they support. Never present the absence of a search result as proof that something does not exist.',
].join('\n')

/**
 * System prompt section injected when the built-in `builtin:spark-web-tool` skill is
 * available for the session. Nudges the model to prefer that skill for the common
 * "produce a document / deck / web page / report" intents instead of hand-rolling
 * output, and tells it how to load the skill on demand (progressive disclosure).
 */
export const SPARK_WEB_TOOL_SYSTEM_PROMPT = [
  '## Content Authoring Capability (built-in skill: spark-web-tool)',
  'When the user asks to produce any of the following, prefer the `builtin:spark-web-tool` skill over hand-writing output:',
  '- 演示文稿 / PPT / slide decks / 幻灯片',
  '- 文档与文件（DOCX / Markdown / PPTX）',
  '- 调研报告、专题报告、数据分析报告',
  '- 网页 / HTML 内容',
  '- 课件、交互式讲解、数据可视化页面',
  '',
  'The skill runs a clarify → outline → produce workflow and emits high-quality artifacts.',
  'Load its full instructions on demand:',
  '  - via the native `Skill` tool with name `builtin:spark-web-tool`, OR',
  '  - via `mcp__spark_platform__skills_load` with id `builtin:spark-web-tool`.',
  "After loading, follow the skill's guidance instead of improvising the artifact by hand.",
].join('\n')

/** SDK-namespaced tool names exposed by the spark_debug MCP server. */
export const DEBUG_TOOL_NAMES: string[] = [
  'mcp__spark_debug__begin',
  'mcp__spark_debug__read',
  'mcp__spark_debug__next_round',
  'mcp__spark_debug__status',
  'mcp__spark_debug__finish',
]

/**
 * System prompt section injected only when the session has debug mode enabled.
 * Brief — the full state machine lives in the `builtin:spark-debug` skill. The
 * point here is to make the agent aware the闭环 tools exist and the human is in
 * the loop for reproduction.
 */
export const DEBUG_MODE_SYSTEM_PROMPT = [
  '## Debug Mode (enabled for this session)',
  'You are in interactive debug mode. A local log server is running; instrumentation you',
  'add reports back to it (browser/webview logs included — CORS is handled). Use the',
  '`mcp__spark_debug__*` tools to run a hypothesis-driven loop WITH the user in the loop:',
  '1. `begin` to get the session id + ready-to-paste instrumentation snippets.',
  '2. Form a hypothesis, instrument the code (wrap logs in the `__SPARK_DEBUG_*` markers',
  '   from the snippet), then ask the user to reproduce and END your turn.',
  "3. When the user says they reproduced, call `read` to pull this round's logs and analyze.",
  '   If `status.thisRound` is 0, they likely did not hit the path — adjust, do not guess.',
  '4. Fix or re-hypothesize; use `next_round` (record the hypothesis) before each new batch.',
  '5. When the user confirms it is fixed, call `finish`, then strip ALL instrumentation',
  '   (grep `__SPARK_DEBUG`), verify zero residue, and deliver root cause + fix + evidence.',
  "Never claim you reproduced the bug yourself — reproduction is always the user's step.",
].join('\n')

/**
 * System prompt section injected when the Platform Management MCP server is available.
 * Brief — the full instructions live in the `builtin:platform-manager` skill definition.
 */
export const PLATFORM_MANAGEMENT_SYSTEM_PROMPT = [
  '## Platform Management Capability',
  'You can manage this platform using `mcp__spark_platform__*` tools.',
  'Available capabilities:',
  '- **Skills**: list, load, search, search_github, install, install_github, uninstall, toggle',
  '- **MCP Servers**: list, create, update, delete, status',
  '- **Providers**: list, get, create, update, delete, health_check, set_default, set_default_model',
  '- **Workflows**: list, get, create, update, delete',
  '- **Agents**: list, get, create, update, delete',
  '- **Teams**: list, get, create, update, delete',
  '- **Install Artifacts**: list, resolve (Spark self-hosted skill/runtime/dependency packages)',
  '- **Settings**: get, set, get_category, get_all',
  '- **Sessions (self)**: get, switch_model, switch_provider, switch_mode, switch_permission, switch_reasoning_effort',
  '- **Board Tasks**: list, get, create, update, delete, batch_create, batch_update, batch_delete, restore, permanent_delete',
  '',
  'When the user asks to manage any of these, use the corresponding tool directly.',
  'When a task requires external dependency, runtime, or environment installation, first call `mcp__spark_platform__artifacts_list` / `mcp__spark_platform__artifacts_resolve` to look in the Spark self-hosted artifact manifest (`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`), then use domestic mirrors, and only then fall back to public overseas sources.',
  'For missing Python on Windows, do not start with `winget install Python...`; first resolve `runtime.python-3.11.9.win32-x64` from the Spark artifact manifest. For ppt-master Python packages, resolve the platform-specific `python-wheelhouse.ppt-master-py311.*` artifact before using pip indexes.',
  'Before installing Node.js on the host, check whether Spark exposes a separately packaged Node runtime via `SPARK_STANDALONE_NODE`. Use it for Node-script/MCP subprocess needs when suitable; install a system/portable Node.js only when npm/npx or normal shell `node` is required and the bundled runtime is insufficient. Never launch the Electron executable with `ELECTRON_RUN_AS_NODE`.',
  'When the environment is missing, prefer helping the user install and verify the needed environment after explaining the plan and obtaining consent for network/system changes; do not treat bypassing the missing environment as the first option.',
  'For destructive operations (delete, uninstall), always confirm with the user first.',
  'Never reveal or ask for full API keys — only show whether a key is configured.',
].join('\n')
