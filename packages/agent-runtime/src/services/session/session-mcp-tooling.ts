/**
 * MCP 工具面装配（P1-W3-S5 迁出，2026-08-20）。
 *
 * 承接 buildMcpServersForSDK、Platform Bridge 启动与各内置 MCP server
 * （platform-management / sub-app / canvas / memory / web-search / debug /
 * image / media）的解析装配。plugin runtime MCP（bearer 桥 + per-turn handle）
 * 因与 pluginManager 生命周期和 turn 回收强耦合，暂留 SessionService。
 * 对 SessionService 的依赖经窄接口 SessionMcpToolingHost 注入。
 */
import path from 'node:path'
import { homedir } from 'node:os'
import {
  AgentRepository,
  ConnectorConnectionRepository,
  McpServerRepository,
  ProviderProfileRepository,
  SubAppRepository,
  ScheduledTaskRepository,
  SettingsRepository,
  TaskExecutionRepository,
  WorkflowRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import type { SDKMcpServerConfig } from '../../sdk/index.js'
import type { McpService, McpOAuthTokenProvider } from '../mcp-server.service.js'
import type { PlatformBridgeService } from '../platform-bridge.service.js'
import type { PluginManager } from '../plugins/plugin-manager.service.js'
import type { CustomToolService } from '../custom-tools/custom-tool.service.js'
import type { ToolPackageService } from '../tool-packages/tool-package.service.js'
import type {
  CanvasMcpProvider,
  PlatformConfigChangedHandler,
  SessionService,
} from '../session.service.js'
import { resolveMcpConfig } from '../../mcp/index.js'
import { getDebugLogServer } from '../debug-log-server.service.js'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import { ScheduledTaskService } from '../scheduled-task.service.js'
import { SessionScheduleAgentTools } from '../session-schedule-agent-tools.js'
import {
  resolveMediaMcpProviderRoutes,
  writeMediaMcpRuntimeConfig,
} from '../media/media-mcp-runtime-config.js'
import { buildMediaGenerationSystemPrompt } from '../media/media-mcp-contract.js'
import { ensureWorkspaceManagedDirIgnored } from '../../tools/workspace-git-ignore.mjs'
import {
  buildImageGenerationSystemPrompt,
  resolveDebugMcpServerPath,
  resolveImageGenerationMcpServerPath,
  resolveMediaGenerationMcpServerPath,
  resolveMcpNodeRuntimeExecutable,
  resolvePlatformManagementMcpServerPath,
  resolveSparkCanvasMcpServerPath,
  resolveSparkMemoryMcpServerPath,
  resolveSubAppMcpServerPath,
  resolveWebSearchMcpServerPath,
} from '../session-mcp-tooling-helpers.js'

const log = createLogger('session.mcp-tooling')

export type ImageGenerationRuntimeContext = {
  mcpServer: SDKMcpServerConfig
  systemPrompt: string
}
export type MediaGenerationRuntimeContext = {
  mcpServer: SDKMcpServerConfig
  systemPrompt: string
}

/** MCP 装配模块对 SessionService 的窄依赖面。 */
export interface SessionMcpToolingHost {
  getMcpService(): McpService
  getMcpOAuthProvider(): McpOAuthTokenProvider | undefined
  getPlatformBridge(): PlatformBridgeService
  getPluginManager(): PluginManager | null
  getCustomToolService(): CustomToolService | null
  getToolPackageService(): ToolPackageService
  getUserSkillsDir(): string | null
  getPlatformConfigChangedHandler(): PlatformConfigChangedHandler | undefined
  /** Platform Bridge deps 需回调会话服务公共方法（引用/运行时切换/记忆桥等）。 */
  getSessionService(): SessionService
}

export class SessionMcpTooling {
  constructor(
    private readonly db: SparkDatabase,
    private readonly host: SessionMcpToolingHost,
  ) {}

  async buildMcpServersForSDK(): Promise<Record<string, SDKMcpServerConfig>> {
    const result: Record<string, SDKMcpServerConfig> = {}
    const servers = this.host.getMcpService().listServers()

    for (const server of servers) {
      if (!server.enabled) continue
      try {
        const cfg = JSON.parse(server.configJson) as Record<string, unknown>
        // 归一化：兼容 `transport`/`type` 字段名，支持 http(Streamable HTTP)/sse/stdio。
        // 无法解析出有效传输的（如 http 缺 url）直接跳过，而不是降级成坏的 stdio。
        const resolved = resolveMcpConfig(cfg)
        if (resolved == null) {
          log.warn(`Skipping MCP server "${server.name}": no valid transport in config`)
          continue
        }
        if (resolved.type === 'stdio') {
          result[server.name] = {
            type: 'stdio',
            command: resolved.command,
            args: resolved.args,
            ...(resolved.env != null ? { env: resolved.env } : {}),
            ...(resolved.cwd != null ? { cwd: resolved.cwd } : {}),
          }
        } else {
          const auth = cfg.auth as { type?: string } | undefined
          let headers = resolved.headers
          if (auth?.type === 'oauth2') {
            const token = await this.host.getMcpOAuthProvider()?.getAccessToken(server.id)
            if (token == null) {
              log.warn(`Skipping OAuth MCP server "${server.name}": authorization required`)
              continue
            }
            headers = { ...(headers ?? {}), Authorization: `Bearer ${token}` }
          }
          result[server.name] = {
            type: resolved.type,
            url: resolved.url,
            ...(headers != null ? { headers } : {}),
          }
        }
      } catch {
        // Skip servers with invalid config
      }
    }
    return result
  }

  /**
   * Ensure the Platform Bridge HTTP server is running.
   * The bridge is long-lived (shared across all sessions) and lazily started.
   */
  async ensurePlatformBridge(): Promise<number> {
    if (this.host.getPlatformBridge().isRunning()) {
      return this.host.getPlatformBridge().getPort()
    }

    const { SkillService } = await import('../skill.service.js')
    const { SkillLoader } = await import('../../skills/skill-loader.js')
    const { SkillRegistryService } = await import('../skill-registry/index.js')
    const { GitHubConnectorService } = await import('../github-connector.service.js')
    const { PluginManager } = await import('../plugins/plugin-manager.service.js')
    const { CustomToolService } = await import('../custom-tools/custom-tool.service.js')
    const { SkillRepository, SettingsRepository, TeamDefinitionRepository } =
      await import('@spark/storage')

    const skillRepo = new SkillRepository(this.db)
    const settingsRepo = new SettingsRepository(this.db)
    const pluginManager =
      this.host.getPluginManager() ??
      new PluginManager({
        db: this.db,
        pluginRoot: path.join(this.host.getUserSkillsDir() ?? homedir(), '.spark-agent', 'plugins'),
      })
    await pluginManager.initialize()
    const skillLoader = new SkillLoader(skillRepo)
    const skillRegistryService = new SkillRegistryService(
      this.db,
      this.host.getUserSkillsDir() ?? undefined,
    )

    // Initialize skill registry adapters (loads marketplace sources)
    try {
      skillRegistryService.initialize()
    } catch {
      /* non-critical */
    }

    const deps = {
      skillService: new SkillService(skillRepo),
      skillLoader,
      skillRegistryService,
      mcpService: this.host.getMcpService(),
      mcpRepo: new McpServerRepository(this.db),
      // Desktop production injects the same singleton used by renderer IPC and
      // CustomToolsRuntimeService. The fallback is limited to standalone tests
      // and non-desktop embeddings that do not own those listeners.
      customToolService: this.host.getCustomToolService() ?? new CustomToolService(this.db),
      toolPackageService: this.host.getToolPackageService(),
      providerRepo: new ProviderProfileRepository(this.db),
      workflowRepo: new WorkflowRepository(this.db),
      agentRepo: new AgentRepository(this.db),
      teamRepo: new TeamDefinitionRepository(this.db),
      settingsRepo,
      // spark_app MCP 桥（subapp.* RPC）直访子应用仓库
      subAppRepo: new SubAppRepository(this.db),
      pluginManager,
      sessionScheduleTools: new SessionScheduleAgentTools(
        new ScheduledTaskService(
          new ScheduledTaskRepository(this.db),
          new TaskExecutionRepository(this.db),
        ),
        (action, id) => this.host.getPlatformConfigChangedHandler()?.('scheduled-task', action, id),
      ),
      githubConnectorService: new GitHubConnectorService(
        new ConnectorConnectionRepository(this.db),
        () => pluginManager.isRuntimeEnabled('github'),
      ),
      sessionService: this.host.getSessionService(),
      onConfigChanged: ((scope, action, id) => {
        this.host.getPlatformConfigChangedHandler()?.(scope, action, id)
      }) as PlatformConfigChangedHandler,
    }

    return this.host.getPlatformBridge().start(deps)
  }

  /**
   * Resolve the Platform Management MCP server config.
   * Returns null if the MCP server script cannot be found or the bridge fails to start.
   */
  async resolvePlatformManagementMcpServer(sessionId: string): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolvePlatformManagementMcpServerPath()
    if (serverPath == null) {
      log.warn('Platform management MCP server script not found')
      return null
    }

    try {
      const port = await this.ensurePlatformBridge()
      return {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        env: {
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_SESSION_ID: sessionId,
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start platform bridge: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * 解析自定义子应用 MCP server（spark_app），对所有 session 默认挂载。
   *
   * agent 通过它创建/管理/发布自定义子应用（草稿 CAS、发布版本、应用数据）。
   * stdio 子进程经 PlatformBridgeService 的 subapp.* RPC 回到主进程直访
   * SubAppRepository，与桌面端 subAppBackend IPC 路径共享同一套语义；
   * bridge 端口与会话 id 通过环境变量注入（照抄 platform-management 模式）。
   */
  async resolveSubAppMcpServer(
    sessionId: string,
    workspaceRootPath: string,
  ): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolveSubAppMcpServerPath()
    if (serverPath == null) {
      log.warn('Sub app MCP server script not found')
      return null
    }

    try {
      const port = await this.ensurePlatformBridge()
      return {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        cwd: workspaceRootPath,
        env: {
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_SESSION_ID: sessionId,
          SPARK_WORKSPACE_ROOT: workspaceRootPath,
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start spark_app MCP server: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * 解析画布 MCP server（spark_canvas）—— codex CLI / claude CLI 路径专用。
   *
   * 画布的真实状态和 IPC pending call 都活在 Electron 主进程里；CLI/Codex 子进程消费不了
   * Claude SDK 的 in-process server。因此这里挂一个 stdio 瘦桥接，把工具调用经
   * PlatformBridgeService 的 canvas.call_tool RPC 转回主进程 CanvasHostBridge。
   */
  async resolveSparkCanvasMcpServer(
    sessionId: string,
    canvas: NonNullable<Awaited<ReturnType<CanvasMcpProvider>>>,
  ): Promise<SDKMcpServerConfig | null> {
    if (canvas.toolSchemas == null || canvas.toolSchemas.length === 0) return null
    const serverPath = resolveSparkCanvasMcpServerPath()
    if (serverPath == null) {
      log.warn('Spark canvas MCP server script not found')
      return null
    }

    try {
      const port = await this.ensurePlatformBridge()
      return {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        env: {
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_CANVAS_SID: sessionId,
          SPARK_CANVAS_TOOL_SCHEMAS_JSON: JSON.stringify(canvas.toolSchemas),
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start spark_canvas MCP server: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * 解析长期记忆 MCP server（spark_memory）—— codex CLI / claude CLI 路径专用。
   *
   * claude SDK 路径用 in-process SDK MCP（createSdkMcpServer，闭包直访 this.db），
   * 但 codex CLI / claude CLI 是独立子进程，消费不了 type='sdk' 的 server。这里给它们
   * 挂一个 stdio 子进程，通过 PlatformBridgeService HTTP RPC 回到主进程的
   * bridgeMemorySearch / bridgeMemoryRecall —— 与 claude SDK 路径复用同一套
   * MemorySearchService / MemoryReaderService，agent 看到的记忆范围/排序/降级语义一致。
   *
   * 仅在长期记忆开启时挂载；否则返回 null（agent 看不到 search_memory/recall_memory 工具）。
   */
  async resolveSparkMemoryMcpServer(
    sessionId: string,
    _workspaceRootPath: string,
    agentId?: string,
  ): Promise<SDKMcpServerConfig | null> {
    let memoryEnabled: unknown = true
    try {
      memoryEnabled = new SettingsRepository(this.db).get('memory', 'enabled')
    } catch {
      // settings 不可用时按默认（启用）处理
    }
    if (memoryEnabled === false || memoryEnabled === 0) return null

    const serverPath = resolveSparkMemoryMcpServerPath()
    if (serverPath == null) {
      log.warn('Spark memory MCP server script not found')
      return null
    }

    try {
      const port = await this.ensurePlatformBridge()
      return {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        env: {
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_MEMORY_SID: sessionId,
          ...(agentId != null && agentId.trim().length > 0
            ? { SPARK_MEMORY_AGENT_ID: agentId.trim() }
            : {}),
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start spark_memory MCP server: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * 解析内置联网搜索 MCP server（spark_search），对所有 session 默认挂载。
   *
   * 免密默认链（Bing → DuckDuckGo → 百度）零配置可用；若 app_settings 的
   * `webSearch` 分类配置了 keyed provider（bocha/tavily/serper）+ apiKey，则
   * 自动优先走它。key 仅注入子进程环境变量，不外泄。
   */
  async resolveWebSearchMcpServer(workspaceRootPath: string): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolveWebSearchMcpServerPath()
    if (serverPath == null) {
      log.warn('Web search MCP server script not found')
      return null
    }
    let provider = ''
    let apiKey = ''
    let baseUrl = ''
    try {
      const settings = new SettingsRepository(this.db).getByCategory('webSearch')
      if (typeof settings.provider === 'string') provider = settings.provider.trim()
      if (typeof settings.apiKey === 'string') apiKey = settings.apiKey.trim()
      if (typeof settings.baseUrl === 'string') baseUrl = settings.baseUrl.trim()
    } catch {
      // settings 不可用时静默走免密默认链
    }
    return {
      type: 'stdio',
      command: resolveMcpNodeRuntimeExecutable(),
      args: [serverPath],
      cwd: workspaceRootPath,
      env: {
        ...(provider ? { SPARK_SEARCH_PROVIDER: provider } : {}),
        ...(apiKey ? { SPARK_SEARCH_API_KEY: apiKey } : {}),
        ...(baseUrl ? { SPARK_SEARCH_BASE_URL: baseUrl } : {}),
      },
    }
  }

  /**
   * 解析调试模式 MCP server（spark_debug）。仅当 session 开启 debugMode 时调用。
   *
   * 长驻的 DebugLogServer 在主进程内懒启动（跨 turn 存活，承接浏览器侧 bug 日志，
   * CORS 已处理）。本 MCP 子进程只是瘦桥接：把 begin/read/next_round/status/finish
   * 代理到 `http://127.0.0.1:<port>`。注入 SPARK_DEBUG_SID = sessionId，保证同一
   * 对话跨 turn / 跨子进程重启都映射到同一 debug session 的 buffer。
   */
  async resolveDebugMcpServer(
    sessionId: string,
    workspaceRootPath: string,
  ): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolveDebugMcpServerPath()
    if (serverPath == null) {
      log.warn('Debug mode MCP server script not found')
      return null
    }
    let port: number
    try {
      port = await getDebugLogServer().start()
    } catch (err) {
      log.warn(
        `Failed to start debug log server: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
    return {
      type: 'stdio',
      command: resolveMcpNodeRuntimeExecutable(),
      args: [serverPath],
      cwd: workspaceRootPath,
      env: {
        SPARK_DEBUG_LOG_PORT: String(port),
        SPARK_DEBUG_SID: sessionId,
      },
    }
  }

  async resolveImageGenerationContext(
    workspaceRootPath: string,
  ): Promise<ImageGenerationRuntimeContext | null> {
    const providerRepo = new ProviderProfileRepository(this.db)
    if (typeof providerRepo.listAll !== 'function') return null
    const imageProvider = providerRepo.listAll().find((row) => {
      if (row.enabled !== 1) return false
      try {
        const config = JSON.parse(row.config_json) as { modelType?: string }
        return config.modelType === 'image'
      } catch {
        return false
      }
    })
    if (imageProvider == null || imageProvider.keystore_ref == null) return null

    const apiKey = await resolveProviderApiKey(imageProvider)
    if (apiKey.trim().length === 0) return null

    const config = JSON.parse(imageProvider.config_json) as {
      defaultModel?: string
      model?: string
      apiEndpoint?: string
      imageProvider?: string | null
      imageApiType?: 'sync' | 'async' | 'auto' | null
    }
    const model = (config.defaultModel ?? config.model ?? '').trim()
    if (!model) return null

    const serverPath = resolveImageGenerationMcpServerPath()
    if (serverPath == null) {
      log.warn('Image generation provider configured but MCP server script was not found')
      return null
    }

    const outputDir = path.join(workspaceRootPath, '.spark-artifacts', 'images')
    // 多媒体产物目录可再生且体积大，best-effort 写入仓库本地忽略，避免被连带提交。
    ensureWorkspaceManagedDirIgnored(workspaceRootPath, ['.spark-artifacts'])
    const providerName = config.imageProvider?.trim() || 'openai'
    const apiType = config.imageApiType ?? 'sync'
    return {
      mcpServer: {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        cwd: workspaceRootPath,
        env: {
          SPARK_IMAGE_API_KEY: apiKey,
          SPARK_IMAGE_MODEL: model,
          SPARK_IMAGE_PROVIDER: providerName,
          SPARK_IMAGE_API_TYPE: apiType,
          SPARK_IMAGE_OUTPUT_DIR: outputDir,
          ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
            ? { SPARK_IMAGE_BASE_URL: config.apiEndpoint.trim() }
            : {}),
        },
      },
      systemPrompt: buildImageGenerationSystemPrompt({
        name: imageProvider.name,
        model,
        provider: providerName,
        apiType,
        outputDir,
        ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
      }),
    }
  }

  /**
   * 解析 spark_media MCP server 配置。
   *
   * 聚合所有 enabled 且凭据可用的图片/语音/视频 Provider。每个模型保留所属
   * profile 的 API key、endpoint、adapter 与 manifest，spark_media 子进程按显式
   * model 参数切换路由。只要统一服务可用，就不再同时注入旧 spark_image。
   */
  async resolveMediaGenerationContext(
    workspaceRootPath: string,
  ): Promise<MediaGenerationRuntimeContext | null> {
    const serverPath = resolveMediaGenerationMcpServerPath()
    if (serverPath == null) {
      log.warn('Media provider configured but spark_media MCP server script was not found')
      return null
    }
    const providers = await resolveMediaMcpProviderRoutes(this.db)
    const [primary] = providers
    if (primary == null) return null
    const outputDir = path.join(workspaceRootPath, '.spark-artifacts', 'media')
    // 同上：spark_media 统一媒体产物的落盘根目录，进入用户仓库前先确保被本地忽略。
    ensureWorkspaceManagedDirIgnored(workspaceRootPath, ['.spark-artifacts'])
    const runtimeProviders = providers.map(({ apiKey: _apiKey, ...provider }, index) => ({
      ...provider,
      apiKeyEnv: `SPARK_MEDIA_API_KEY_${index}`,
    }))
    const runtimeConfigFile = writeMediaMcpRuntimeConfig({
      apiKeyEnv: 'SPARK_MEDIA_API_KEY_0',
      provider: primary.provider,
      model: primary.model,
      mode: primary.mode,
      ...(primary.baseUrl != null ? { baseUrl: primary.baseUrl } : {}),
      outputDir,
      mediaDefaults: primary.mediaDefaults,
      manifests: primary.manifests,
      providers: runtimeProviders,
    })
    return {
      mcpServer: {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        cwd: workspaceRootPath,
        env: {
          SPARK_MEDIA_CONFIG_FILE: runtimeConfigFile,
          ...Object.fromEntries(
            providers.map((provider, index) => [`SPARK_MEDIA_API_KEY_${index}`, provider.apiKey]),
          ),
        },
      },
      systemPrompt: buildMediaGenerationSystemPrompt({
        name: primary.name,
        model: primary.model,
        provider: primary.provider,
        apiType: primary.mode,
        outputDir,
        capabilities: [...new Set(providers.flatMap((provider) => provider.capabilities))],
        providerConfigurations: providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          model: provider.model,
          provider: provider.provider,
          modelManifests: provider.manifests.map((manifest) => ({
            id: manifest.id,
            modelId: manifest.modelId,
            capabilities: manifest.capabilities.map((capability) => capability.id),
          })),
        })),
        ...(primary.baseUrl !== undefined ? { apiEndpoint: primary.baseUrl } : {}),
      }),
    }
  }
}
