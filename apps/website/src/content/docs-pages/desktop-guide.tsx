import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      本文按真实目录与真实模块名讲清 SparkWork 桌面端的结构：5 类进程、3 个执行内核、
      主进程本地服务清单、SQLite/文件/凭据三处存储、459 个类型化 IPC 通道与 41 个 stream 推送通道，
      以及一次画布文生图的完整链路。文中出现的服务名与文件名都可以在仓库里直接搜到；
      旧版本页面里写过的 <code>agent.service</code>、<code>workflow.service</code>、
      <code>audit.service</code>、<code>rules-engine</code>、<code>SQLCipher</code> 在当前代码里
      <strong>不存在</strong>，已按实际实现改写。
    </p>

    <h2 id="process-model">1. 进程模型与代码位置</h2>
    <table>
      <thead>
        <tr>
          <th>进程/角色</th>
          <th>代码位置</th>
          <th>职责</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Main 进程</td>
          <td>
            <code>apps/desktop/src/main/</code>（入口 <code>index.ts</code>）
          </td>
          <td>
            窗口管理、IPC handler、数据库、本地服务、更新、远程连接、媒体任务路由；构建产物还有两个
            worker 入口（<code>workers/background-maintenance.worker.ts</code>、
            <code>workers/depth-inference.worker.ts</code>）
          </td>
        </tr>
        <tr>
          <td>Preload</td>
          <td>
            <code>apps/desktop/src/preload/index.ts</code>
          </td>
          <td>
            用 <code>contextBridge</code> 暴露受限的 <code>window.spark</code>：<code>invoke</code>
            、<code>on</code>、平台信息、文件拖放路径等；不暴露任何原始 Node/Electron API
          </td>
        </tr>
        <tr>
          <td>Renderer</td>
          <td>
            <code>apps/desktop/src/renderer/</code>（单入口 <code>index.html</code>）
          </td>
          <td>
            React 19 + electron-vite 构建；主窗口、画布窗口（<code>CanvasWindowApp.tsx</code>
            ）与内置浏览器窗口（<code>BrowserWindowApp.tsx</code>）共用同一份 bundle，靠 URL
            参数区分，例如画布窗口是 <code>?window=canvas&amp;projectId=...</code>
          </td>
        </tr>
        <tr>
          <td>Agent 子进程/运行时</td>
          <td>见第 6 节</td>
          <td>
            Claude Code CLI 子进程（每次 SDK query 一个）、Codex 载具进程（可选常驻 App Server，空闲
            2 分钟回收）、spark-engine 进程内 SDK
          </td>
        </tr>
        <tr>
          <td>受管 MCP 子进程</td>
          <td>
            <code>apps/desktop/src/main/services/PlaywrightMcpRegistration.ts</code>、
            <code>BrowserAutomationMcpRuntime.ts</code>
          </td>
          <td>
            例如 <code>@playwright/mcp</code> 通过独立 standalone Node
            执行（打包时复制到真实文件系统，因为外部 Node 读不到 app.asar）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      窗口安全基线写死在主窗口创建处：<code>contextIsolation: true</code>、
      <code>nodeIntegration: false</code>、<code>sandbox: true</code>，preload 指向{' '}
      <code>out/preload/index.js</code>。
    </p>
    <p>
      仓库是 pnpm monorepo（<code>nodeLinker: hoisted</code>，为了 electron-builder
      能完整收集生产依赖闭包）：
    </p>
    <ul>
      <li>
        <code>apps/desktop</code>：桌面端本体；<code>apps/website</code>：官网（含本文所在文档站）。
      </li>
      <li>
        <code>packages/</code>：<code>protocol</code>（IPC 契约与枚举的唯一来源）、
        <code>agent-runtime</code>
        （服务层与执行器）、<code>storage</code>（SQLite 与 migration SQL）、<code>shared</code>
        （keystore、 日志、工具函数）、<code>tool-sdk</code>、<code>plugin-sdk</code>、
        <code>ui-kit</code>。
      </li>
      <li>
        <code>spark-engine</code>：自研引擎（进程内 <code>@spark/agent</code> SDK），独立于{' '}
        <code>packages/*</code> 命名空间，作为第三个执行器被主进程 bundle 打包进去。
      </li>
    </ul>

    <h2 id="runtime">2. Agent Runtime 服务层（真实模块）</h2>
    <p>
      核心服务在 <code>packages/agent-runtime/src/services/</code>。会话相关的大文件已拆成{' '}
      <code>services/session/</code> 子目录（executor 选择、用量增量、检查点、事件定序等）。
      下表是最常被问到的模块，路径均为真实文件：
    </p>
    <table>
      <thead>
        <tr>
          <th>模块</th>
          <th>真实文件</th>
          <th>职责</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>SessionService</td>
          <td>
            <code>session.service.ts</code> + <code>session/*</code>
          </td>
          <td>
            会话生命周期、turn 调度、系统提示词组装（项目上下文 + Runtime Rules + Skill + MCP）
          </td>
        </tr>
        <tr>
          <td>引擎注册表</td>
          <td>
            <code>session/engine-registry.ts</code>
          </td>
          <td>
            按 adapter 选择执行器并声明能力（原生 resume / 权限热切换 / checkpoint 回滚 /
            子代理工具）
          </td>
        </tr>
        <tr>
          <td>ProviderService</td>
          <td>
            <code>provider.service.ts</code>
          </td>
          <td>Provider CRUD、API Key 经 keystore 解析、健康检查</td>
        </tr>
        <tr>
          <td>ModelService</td>
          <td>
            <code>model.service.ts</code>、<code>model-router.service.ts</code>
          </td>
          <td>模型清单与路由</td>
        </tr>
        <tr>
          <td>PermissionService</td>
          <td>
            <code>permission.service.ts</code>
          </td>
          <td>动作类目映射、Profile 规则判定、审批等待（超时 30 分钟）</td>
        </tr>
        <tr>
          <td>RulesService / RuleCompositionEngine</td>
          <td>
            <code>rules.service.ts</code>、<code>rule-composition.engine.ts</code>
          </td>
          <td>
            规则 CRUD（system 规则只读）与 compose（仅经 <code>rules:compose</code> IPC 暴露）
          </td>
        </tr>
        <tr>
          <td>Hook 服务</td>
          <td>
            <code>hook.service.ts</code>、<code>services/hooks/*</code>
          </td>
          <td>Hooks V2：事件发射、绑定解析、派发、worker、补偿、旧配置迁移</td>
        </tr>
        <tr>
          <td>Skill 服务</td>
          <td>
            <code>skill.service.ts</code>、<code>skill-registry/*</code>、
            <code>local-skill-importer.ts</code>
          </td>
          <td>技能元信息、安装、加载与本地导入</td>
        </tr>
        <tr>
          <td>MCP 服务</td>
          <td>
            <code>mcp-server.service.ts</code>
          </td>
          <td>MCP Server 注册表（managed / user）</td>
        </tr>
        <tr>
          <td>项目上下文</td>
          <td>
            <code>project-context.service.ts</code>
          </td>
          <td>
            读取工作区 <code>AGENTS.md</code>/<code>CLAUDE.md</code> 与上下文预算
          </td>
        </tr>
        <tr>
          <td>运行时上下文组装</td>
          <td>
            <code>runtime-composition.service.ts</code>
          </td>
          <td>Skill / 环境变量 / 工具等运行时上下文合成</td>
        </tr>
        <tr>
          <td>用量账本</td>
          <td>
            <code>usage-ledger.service.ts</code>、<code>session/session-usage-ledger.ts</code>
          </td>
          <td>per-turn token 增量入账与查询</td>
        </tr>
        <tr>
          <td>Team 分派</td>
          <td>
            <code>team-dispatch.service.ts</code>、<code>team-*.ts</code>
          </td>
          <td>Team Mode 分派、成员执行生命周期、ledger / task graph / replay playbook 适配器</td>
        </tr>
        <tr>
          <td>定时任务</td>
          <td>
            <code>scheduled-task.service.ts</code>
          </td>
          <td>任务调度与执行器对接</td>
        </tr>
        <tr>
          <td>媒体</td>
          <td>
            <code>media/media-router.service.ts</code>、
            <code>media/media-task-runtime.service.ts</code>
          </td>
          <td>按 manifest 选适配器、异步媒体任务生命周期与恢复</td>
        </tr>
        <tr>
          <td>记忆</td>
          <td>
            <code>memory/*</code>
          </td>
          <td>长期记忆抽取、写入与检索</td>
        </tr>
        <tr>
          <td>工具与包</td>
          <td>
            <code>unified-tools.ts</code>、<code>tool-packages/*</code>、<code>custom-tools/*</code>
            、<code>plugins/*</code>、<code>plugin-runtime/*</code>
          </td>
          <td>统一工具目录、工具包与插件运行时</td>
        </tr>
        <tr>
          <td>Git / 工作区</td>
          <td>
            <code>git-command.service.ts</code>、<code>git-worktree.service.ts</code>、
            <code>workspace.service.ts</code>、<code>checkpoint-git.service.ts</code>
          </td>
          <td>Git 状态、worktree、checkpoint 回滚</td>
        </tr>
        <tr>
          <td>SettingsService</td>
          <td>
            <code>settings.service.ts</code>
          </td>
          <td>
            <code>app_settings</code> 分类键值读写
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      没有独立的 <code>agent.service</code> / <code>workflow.service</code> /{' '}
      <code>mcp-registry</code> /<code>usage.service</code> / <code>audit.service</code> /{' '}
      <code>hooks-engine</code> 这些文件；Agent、Workflow、Team 定义由 <code>packages/storage</code>{' '}
      的仓库类直接读写， 审计类数据分散在各模块自己的表里。
    </p>

    <h2 id="main-services">3. 主进程本地服务清单</h2>
    <p>
      <code>apps/desktop/src/main/services/</code> 下是「只有桌面端才需要」的能力（约 120
      个文件，含测试）。 常用的真实文件名：
    </p>
    <ul>
      <li>
        <strong>窗口与浏览器</strong>：<code>CanvasWindowService.ts</code>、
        <code>BrowserPanelWindowService.ts</code>、<code>BrowserPanelDevtoolsService.ts</code>、
        <code>InternalBrowserService.ts</code>、<code>SystemBrowserService.ts</code>、
        <code>HtmlViewerService.ts</code>、<code>BrowserBridgeServer.ts</code>、
        <code>PlaywrightMcpRegistration.ts</code>、<code>PlaywrightEnvironment.ts</code>。
      </li>
      <li>
        <strong>协议与资源</strong>：<code>SafeFileProtocol.ts</code>（<code>safe-file://</code>）、
        <code>CapabilityAssetProtocol.ts</code>、<code>PrivilegedProtocolSchemes.ts</code>、
        <code>ExternalUrlPolicy.ts</code>、<code>FontAssetService.ts</code>。
      </li>
      <li>
        <strong>文件与工作区</strong>：<code>FilePatchService.ts</code>、
        <code>FileWatcherService.ts</code>、<code>WorkspaceSearchService.ts</code>、
        <code>WorkspaceSearchGitignore.ts</code>、<code>GitRuntimeService.ts</code>、
        <code>TerminalService.ts</code>（node-pty）。
      </li>
      <li>
        <strong>凭据与完整性</strong>：<code>CredentialVaultPersistence.ts</code>、
        <code>SdkIntegrityService.ts</code>、<code>CodexRuntimeIntegrityService.ts</code>、
        <code>PlaywrightIntegrityService.ts</code>、<code>FfmpegIntegrityService.ts</code>、
        <code>VoiceIntegrityService.ts</code>、<code>DepthModelIntegrityService.ts</code>。
      </li>
      <li>
        <strong>远程连接</strong>：<code>RemoteConnectionService.ts</code>（桥接运行时与命令目录）、
        <code>QqBotGateway.ts</code>（QQ 官方 WebSocket 网关）、<code>qqProtocol.ts</code>、
        <code>telegramInboundMedia.ts</code> / <code>telegramOutboundMedia.ts</code> /
        <code>telegramTextFormatting.ts</code> / <code>telegramTurnFeedback.ts</code>、
        <code>feishuImageMedia.ts</code>、<code>qqImageMedia.ts</code>、
        <code>remoteImageMedia.ts</code>、<code>remoteSessionIsolation.ts</code>、
        <code>remoteTurnReply.ts</code>。
      </li>
      <li>
        <strong>数据与维护</strong>：<code>DatabaseBackupService.ts</code>（迁移前恢复点）、
        <code>ProductionDbInheritService.ts</code>（开发实例继承安装版数据）、
        <code>TempMediaFilesMaintenance.ts</code>、<code>background-maintenance-worker.ts</code>、
        <code>AccountSync/</code>（账号同步适配器与本地仓库）。
      </li>
      <li>
        <strong>更新</strong>：<code>UpdateService.ts</code> + <code>updaterCache.ts</code>。
      </li>
      <li>
        <strong>可选能力与子应用</strong>：<code>optional-capabilities/</code>、
        <code>SubApp*.ts</code>（<code>SubAppServiceManager</code>、<code>SubAppJobManager</code>、
        <code>SubAppNetworkGateway</code>、<code>SubAppFileStore</code>、
        <code>SubAppPackageRuntime</code>、<code>SubAppShareService</code>、
        <code>SubAppBrowserService</code>）、<code>PlatformModel/</code>（平台托管模型与凭据）、
        <code>computer-use/</code>、<code>depth-video/</code>、<code>media/</code>。
      </li>
    </ul>

    <h2 id="storage">4. 本地存储：SQLite、文件、凭据</h2>
    <p>
      <strong>① SQLite（业务数据）</strong>
    </p>
    <ul>
      <li>
        文件路径：<code>{'{userData}'}/spark.db</code>，开发与安装版共用同一路径策略；打开时启用{' '}
        <code>journal_mode = WAL</code>、<code>synchronous = NORMAL</code>、
        <code>foreign_keys = ON</code>、<code>temp_store = MEMORY</code>、
        <code>mmap_size = 256MB</code>。
      </li>
      <li>
        schema 由 <code>packages/storage/migrations/*.sql</code> 顺序执行（当前 101 个文件， 由{' '}
        <code>schema_migrations</code> 表跟踪），迁移前会自动做恢复点备份。
      </li>
      <li>
        表覆盖 78 个（<code>CREATE TABLE IF NOT EXISTS</code> 去重计数），代表性的有：
        <code>sessions</code>、<code>agent_events</code>（会话时间线）、<code>app_settings</code>、
        <code>agents</code>、<code>agent_teams</code>、<code>workflows</code>、
        <code>workflow_runs</code>、<code>skills</code>、<code>skill_registries</code>、
        <code>mcp_servers</code>、<code>provider_profiles</code>、<code>usage_ledger</code>、
        <code>rules</code>、<code>permission_profiles</code>/<code>permission_rules</code>/
        <code>permission_decisions</code>、<code>hook_definitions</code>/<code>hook_bindings</code>/
        <code>hook_events</code>/<code>hook_runs</code>、<code>media_generation_tasks</code>、
        <code>canvas_projects</code>/<code>canvas_snapshots</code>、<code>scheduled_tasks</code>、
        <code>plugin_runtime_audit</code>。
      </li>
    </ul>
    <p>
      <strong>② 文件系统</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>路径</th>
          <th>内容</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>{'{userData}'}/projects/</code>
          </td>
          <td>项目工作目录（存储用量页单列）</td>
        </tr>
        <tr>
          <td>
            <code>{'{userData}'}/attachments/</code>
          </td>
          <td>
            会话附件；<code>attachments/remote/telegram/</code> 存 Telegram 入站图片
          </td>
        </tr>
        <tr>
          <td>
            <code>{'{userData}'}/.spark-artifacts/media/</code>
          </td>
          <td>
            媒体产物默认根目录，按类型落 <code>images/</code>、<code>audio/</code>、
            <code>videos/</code>、<code>text/</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>{'{userData}'}/logs/</code>
          </td>
          <td>运行时日志（设置 → 本地日志可读、导出、清空）</td>
        </tr>
        <tr>
          <td>
            <code>{'{userData}'}/spark-agent-updater/&lt;version&gt;/</code>
          </td>
          <td>更新包缓存，启动时只保留最近 2 个版本目录</td>
        </tr>
        <tr>
          <td>
            <code>~/.spark-agent/board-attachments/</code>
          </td>
          <td>
            看板任务附件（<code>safe-file://</code> 白名单内，其余 <code>~/.spark-agent</code>{' '}
            不放行）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>③ 凭据</strong>
    </p>
    <ul>
      <li>
        Provider API Key 走 <code>packages/shared/src/keystore</code>：唯一合法的 keytar 入口，
        service 名固定为 <code>spark-agent</code>，引用形如{' '}
        <code>&lt;provider&gt;-&lt;profileId&gt;</code>。
      </li>
      <li>
        macOS 上不再是「一个 Provider 一条 Keychain 项」：敏感凭据集中进一个 vault， 由 Electron{' '}
        <code>safeStorage</code> 加密后存到 <code>{'{userData}'}/credential-vault-v1.enc</code>
        （权限 0600）；macOS Keychain 只作为首次导入来源。 Windows/Linux 仍走 keytar 的对应后端。
      </li>
      <li>
        <strong>注意</strong>：远程连接（Telegram/飞书/QQ）的 bot token 等凭据不在 vault 里，
        而是以明文 JSON 存在 <code>app_settings</code> 的 <code>remote-connections</code> 分类下。
      </li>
    </ul>

    <h2 id="ipc">5. IPC 桥：类型化通道与事件流</h2>
    <ul>
      <li>
        契约只有一处真源：<code>packages/protocol/src/ipc/index.ts</code> 的{' '}
        <code>IpcChannelMap</code>（459 个请求/响应通道）与 <code>IpcStreamChannelMap</code>
        （41 个 main → renderer 推送通道）。<code>IpcChannel</code> 就是前者的 key 联合类型，
        preload 只能按这些名字调用。
      </li>
      <li>
        主进程一律用 <code>typedIpcHandle</code>（
        <code>apps/desktop/src/main/ipc/typed-ipc.ts</code>）注册， 返回值统一包成{' '}
        <code>IpcResult</code>（<code>ok/data</code> 或 <code>ok/error</code>）； preload
        解包后成功返回 data、失败抛 <code>SparkIpcError</code>，所以渲染端可以直接 try/catch。
      </li>
      <li>
        命名约定：<code>session:*</code>、<code>agent:*</code>、<code>workflow:*</code>、
        <code>provider:*</code>、<code>mcp:*</code>、<code>skill:*</code>、<code>canvas:*</code>、
        <code>remote:*</code>、<code>update:*</code>、<code>permission:*</code>、
        <code>rules:*</code>、<code>hook:*</code>（经典）与 <code>hookV2:*</code>、
        <code>usage:*</code>、<code>log:*</code>、<code>app:*</code>、<code>env:*</code>。
      </li>
      <li>
        主进程的 IPC 注册被拆成 <code>apps/desktop/src/main/ipc/register*.ts</code> 一系列文件 （如{' '}
        <code>registerHooksV2Ipc.ts</code>、<code>registerSubAppIpc.ts</code>、
        <code>registerToolPackagesIpc.ts</code>、<code>registerComputerUseIpc.ts</code>），
        剩下的集中注册在 <code>ipc/index.ts</code>。
      </li>
      <li>
        常用 stream 通道：<code>stream:session:agent-event</code>（会话事件流，含 assistant
        增量与工具事件）、
        <code>stream:permission:approval-request</code> /{' '}
        <code>stream:permission:approval-resolved</code>、<code>stream:update:status</code>（及{' '}
        <code>available</code>/<code>progress</code>/<code>downloaded</code>）、
        <code>stream:canvas:media-task</code>、<code>stream:skill:install-progress</code>、
        <code>stream:remote:changed</code>、<code>stream:sdk:integrity</code>。
      </li>
    </ul>

    <h2 id="execution">6. 执行内核与载具</h2>
    <p>
      适配器（<code>SessionAgentAdapter</code>）有四个取值：<code>claude</code>、
      <code>claude-sdk</code>、<code>codex</code>、<code>spark</code>；统一抽象为三个引擎{' '}
      <code>EngineKind</code>：<code>claude-sdk</code>（<code>claude</code> 与{' '}
      <code>claude-sdk</code> 都归它）、<code>codex</code>、<code>spark</code>。契约是{' '}
      <code>EngineExecutor</code>： 每个 turn 新建实例、终态只经事件流表达、实例身份即闸门。
    </p>
    <table>
      <thead>
        <tr>
          <th>引擎</th>
          <th>真实实现</th>
          <th>进程形态</th>
          <th>能力声明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>claude-sdk</td>
          <td>
            <code>sdk/claude-sdk-executor.ts</code>
          </td>
          <td>
            每个 turn 一次 <code>query()</code>，底层是 Claude Code CLI 子进程（可指定{' '}
            <code>pathToClaudeCodeExecutable</code>）；取消时 close query + abort
          </td>
          <td>原生 resume、权限热切换、checkpoint 回滚、子代理工具</td>
        </tr>
        <tr>
          <td>codex</td>
          <td>
            <code>sdk/codex-app-server/*</code>、<code>codex-cli-executor.ts</code>、
            <code>codex-openai-executor.ts</code>、<code>codex-sdk-executor.ts</code>
          </td>
          <td>
            三种载具：本地 CLI（<code>useLocalConfig</code>）、OpenAI 兼容 chat 载具、App Server
            常驻进程（可在执行器间复用，空闲 120 秒回收；握手失败或图片附件场景回退 SDK 载具）
          </td>
          <td>有 supervisor 时原生 resume；不支持权限热切换/回滚/子代理</td>
        </tr>
        <tr>
          <td>spark</td>
          <td>
            <code>sdk/spark-engine/*</code> + <code>spark-engine/</code>（<code>@spark/agent</code>{' '}
            SDK）
          </td>
          <td>进程内 SDK，无子进程</td>
          <td>原生 resume（事件重放续跑）、权限热切换</td>
        </tr>
      </tbody>
    </table>
    <p>
      流式事件统一为 <code>AgentEvent</code>，主进程通过 <code>stream:session:agent-event</code>{' '}
      推给渲染端（assistant 增量/完成、<code>tool_use</code>、<code>tool_result</code>、
      <code>agent_status</code>、<code>agent_error</code>、<code>presented_files</code> 等）。
    </p>
    <p>
      原生模块（<code>better-sqlite3</code>、<code>keytar</code>、<code>node-pty</code>）必须编译到
      Electron ABI： 打包脚本会先跑 <code>pnpm run rebuild:native -- &lt;arch&gt;</code>
      ；该脚本内部在宿主架构与目标架构一致时，会用 Electron 真实加载一次（<code>native:verify</code>
      ），不一致时跳过校验并给出警告。
    </p>

    <h2 id="mcp-media">7. 内置 MCP 与媒体运行时</h2>
    <p>
      内置 MCP server 的实现在 <code>packages/agent-runtime/src/tools/*.mjs</code>
      ，注册名（也就是工具前缀）如下：
    </p>
    <table>
      <thead>
        <tr>
          <th>注册名</th>
          <th>实现文件</th>
          <th>用途</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark_image</code>
          </td>
          <td>
            <code>image-generation-mcp-server.mjs</code>
          </td>
          <td>旧图片生成链路（兼容保留）</td>
        </tr>
        <tr>
          <td>
            <code>spark_media</code>
          </td>
          <td>
            <code>media-generation-mcp-server.mjs</code>
          </td>
          <td>
            统一多媒体：模型清单/描述、图片生成与编辑、语音合成、转写、视频生成与编辑、文件上传与任务查询
          </td>
        </tr>
        <tr>
          <td>
            <code>spark_search</code>
          </td>
          <td>
            <code>web-search-mcp-server.mjs</code>
          </td>
          <td>联网搜索</td>
        </tr>
        <tr>
          <td>
            <code>spark_browser</code>
          </td>
          <td>
            <code>browser-automation-mcp-server.mjs</code>
          </td>
          <td>内置浏览器自动化</td>
        </tr>
        <tr>
          <td>
            <code>spark_files</code>
          </td>
          <td>
            <code>present-files-mcp-server.mjs</code>
          </td>
          <td>把生成的文件作为卡片呈现给用户</td>
        </tr>
        <tr>
          <td>
            <code>spark_ui</code>
          </td>
          <td>
            <code>quick-replies-mcp-server.mjs</code>
          </td>
          <td>快捷回复按钮</td>
        </tr>
        <tr>
          <td>
            <code>spark_memory</code> / <code>spark_session</code>
          </td>
          <td>
            <code>spark-memory-mcp-server.mjs</code> / <code>spark-session-mcp-server.mjs</code>
          </td>
          <td>长期记忆与会话自省</td>
        </tr>
        <tr>
          <td>
            <code>spark_canvas</code>
          </td>
          <td>
            <code>spark-canvas-mcp-server.mjs</code>
          </td>
          <td>画布节点读写</td>
        </tr>
        <tr>
          <td>
            <code>spark_platform</code> / <code>spark_team</code> / <code>spark_plugins</code> /{' '}
            <code>spark_app</code>
          </td>
          <td>
            <code>platform-management-mcp-server.mjs</code> 等
          </td>
          <td>平台管理、团队分派、插件运行时、子应用</td>
        </tr>
        <tr>
          <td>
            <code>spark_debug</code> / <code>spark_computer</code> / <code>spark_verify</code> /{' '}
            <code>spark_tool_results</code>
          </td>
          <td>
            <code>debug-mode-mcp-server.mjs</code> 等
          </td>
          <td>调试、电脑操作、校验、超长工具结果回读</td>
        </tr>
      </tbody>
    </table>
    <p>
      多媒体走 <code>MediaRouterService</code>：按 manifest 选择适配器，适配器 id 取自{' '}
      <code>MediaProviderKind</code>（<code>apimart</code>、<code>agnes</code>、<code>xai</code>、
      <code>openai-compatible</code>、<code>openai-images</code>、<code>google-generative-ai</code>
      、<code>bailian</code>、<code>volcengine-ark</code>、<code>volcengine-speech</code>、
      <code>kling</code>、<code>pixverse</code>、<code>minimax-hailuo</code>、<code>wan</code>、
      <code>happyhorse</code>、<code>omni</code>），实现在{' '}
      <code>packages/agent-runtime/src/services/media/adapters/</code>。 异步任务由{' '}
      <code>MediaTaskRuntimeService</code> 持久化到 <code>media_generation_tasks</code> 表
      （migration <code>029_media_generation_tasks.sql</code>，另有{' '}
      <code>066_media_task_recovery.sql</code> 支持恢复），产物写入{' '}
      <code>.spark-artifacts/media/&lt;kind&gt;</code>。
    </p>
    <p>
      渲染端要显示本地媒体/文档时走自定义协议 <code>safe-file://</code>（
      <code>SafeFileProtocol.ts</code>）：绝对路径经 base64 编码进 URL，
      主进程只放行白名单根目录——userData、系统临时目录、
      <code>~/.spark-agent/board-attachments</code>、已登记的 workspace 根目录、画布项目目录；
      白名单外一律 403。
    </p>

    <h2 id="data-flow">8. 一次画布文生图的真实链路</h2>
    <ol>
      <li>
        渲染端调用 <code>canvas:task:create-media</code>，带 <code>operation</code>、
        <code>prompt</code>、<code>waitForCompletion: false</code>、可选的{' '}
        <code>providerProfileId</code> / <code>manifestId</code> / <code>modelId</code> /{' '}
        <code>modelParams</code> / <code>outputDir</code>。
      </li>
      <li>
        主进程写入 <code>media_generation_tasks</code> 一行并立即返回 <code>running</code> 响应（
        <code>runtimeTaskId</code>、<code>providerProfileId</code>、<code>model</code>）。
      </li>
      <li>渲染端在画布上先画出「任务节点」，用户可继续平移/缩放/拖拽。</li>
      <li>
        主进程经 <code>MediaRouterService</code> 按 capability 选适配器与 manifest，走{' '}
        <code>MediaRequestCompiler</code> 组装请求并调用 Provider API；长任务进入轮询。
      </li>
      <li>
        产物下载/解码后落盘到 <code>.spark-artifacts/media/images</code>（或对应 kind 子目录），
        并按需生成预览 data URL 或 <code>safe-file://</code> 链接。
      </li>
      <li>
        完成、失败或取消时，主进程通过 <code>stream:canvas:media-task</code> 推送任务状态， 载荷里的{' '}
        <code>projectId</code>/<code>clientTaskId</code> 用于路由回对应画布。
      </li>
      <li>渲染端写回画布（新增 image 节点与 lineage 边）。</li>
    </ol>

    <h2 id="security">9. 安全边界（可验证的部分）</h2>
    <ul>
      <li>
        <strong>渲染进程沙箱</strong>：主窗口 <code>contextIsolation: true</code>、
        <code>nodeIntegration: false</code>、<code>sandbox: true</code>；能力只经{' '}
        <code>window.spark</code> 暴露。
      </li>
      <li>
        <strong>
          CSP 写在 renderer 的 <code>index.html</code> meta 里
        </strong>
        （<code>default-src 'self'</code>、<code>script-src 'self' capability-asset:</code>、
        <code>img-src ... safe-file: spark-snapshot: https: http: blob:</code>、
        <code>media-src ...</code>、<code>frame-src 'self' safe-file: capability-asset:</code>），
        不是由主进程动态下发。
      </li>
      <li>
        <strong>内置浏览器窗口与主 UI 隔离</strong>：创建浏览器面板窗口时会删掉{' '}
        <code>webPreferences.preload</code>/<code>preloadURL</code>，并强制{' '}
        <code>nodeIntegration: false</code>（含 subframe/worker）、
        <code>contextIsolation: true</code>， 远程页面拿不到 IPC bridge。
      </li>
      <li>
        <strong>本地文件读取白名单</strong>：<code>safe-file://</code> 只放行上文列出的根目录，
        越界返回 403；工作区路径边界另有 <code>isWithinWorkspace</code> 检查。
      </li>
      <li>
        <strong>凭据</strong>：Provider Key 走 keystore（macOS 为 safeStorage 加密的 vault 文件）；
        远程连接凭据是 <code>app_settings</code> 里的明文
        JSON，界面用的是普通文本输入框，已保存的值会明文显示，不做掩码。
      </li>
      <li>
        <strong>高风险操作走审批</strong>：由 <code>PermissionService</code> 按动作类目与 Profile
        规则判定， 详见「权限与治理」主题。
      </li>
      <li>
        <strong>数据库不做透明加密</strong>：代码里没有 SQLCipher 或等价实现；
        需要长期保密请依赖操作系统磁盘加密，或使用设置 → 存储与备份的迁移前恢复点做归档。
      </li>
    </ul>

    <h2 id="pitfalls">10. 排查与常见坑</h2>
    <ul>
      <li>
        <strong>想知道某个功能走哪条 IPC</strong>：先在{' '}
        <code>packages/protocol/src/ipc/index.ts</code> 搜通道名，再到{' '}
        <code>apps/desktop/src/main/ipc/</code> 搜 <code>typedIpcHandle('通道名'</code>，
        最后看渲染端的 <code>window.spark.invoke</code>。这条路径比全局搜字符串快得多。
      </li>
      <li>
        <strong>「设置页改了没用」</strong>：很多设置分两层持久化——localStorage（即时渲染）+
        <code>app_settings</code>（权威值）。只看 localStorage 会误判；例如更新相关的值在{' '}
        <code>updates/data</code> 与 <code>updates/lastChecked</code>。
      </li>
      <li>
        <strong>媒体任务卡住</strong>：先看 <code>media_generation_tasks</code> 的行状态， 再看设置
        → 本地日志里 <code>canvas</code> 范围的日志（画布任务日志有独立的 scope）。
      </li>
      <li>
        <strong>
          原生模块报 <code>Cannot find module</code> 或加载失败
        </strong>
        ：几乎都是 ABI 不匹配， 跑 <code>pnpm --filter @spark/desktop rebuild:native</code>{' '}
        后重试；打包相关请确认走的是
        <code>build-mac-release.sh</code> / <code>build-win-release.sh</code>
        （它们会在打包前重建原生模块）。
      </li>
      <li>
        <strong>换机器后要重新下模型/运行时</strong>：Codex native runtime、Playwright、
        ffmpeg、depth 推理与 voice pack 都是可选能力包，基础安装包不带，入口在设置 → 完整性 /
        浏览器自动化 / 电脑操作等相关页面。
      </li>
      <li>
        <strong>多窗口共用一个 bundle</strong>：画布窗口与浏览器窗口不是独立前端工程， 改{' '}
        <code>CanvasWindowApp.tsx</code> 就等于改主 bundle，注意别把主窗口逻辑耦合进去。
      </li>
    </ul>
  </>
)

export const desktopGuide: DocsPageContent = {
  slug: 'desktop-guide',
  toc: [
    { id: 'process-model', title: '1. 进程模型与代码位置', level: 2 },
    { id: 'runtime', title: '2. Agent Runtime 服务层（真实模块）', level: 2 },
    { id: 'main-services', title: '3. 主进程本地服务清单', level: 2 },
    { id: 'storage', title: '4. 本地存储：SQLite、文件、凭据', level: 2 },
    { id: 'ipc', title: '5. IPC 桥：类型化通道与事件流', level: 2 },
    { id: 'execution', title: '6. 执行内核与载具', level: 2 },
    { id: 'mcp-media', title: '7. 内置 MCP 与媒体运行时', level: 2 },
    { id: 'data-flow', title: '8. 一次画布文生图的真实链路', level: 2 },
    { id: 'security', title: '9. 安全边界（可验证的部分）', level: 2 },
    { id: 'pitfalls', title: '10. 排查与常见坑', level: 2 },
  ],
  faq: [
    {
      question: 'Renderer 能直接访问 Node 吗？',
      answer:
        '不能。主窗口以 contextIsolation: true、nodeIntegration: false、sandbox: true 创建，只有 preload 用 contextBridge 暴露的 window.spark（invoke / on / 平台信息）可用。',
    },
    {
      question: '每个 turn 都会新起一个子进程吗？',
      answer:
        'Claude 路径是——每个 turn 一次 SDK query，底层就是 Claude Code CLI 子进程。Codex 不一定：App Server 载具是常驻进程，可在执行器之间复用，空闲 120 秒回收；本地 CLI / OpenAI chat 载具则是单次调用。Spark 引擎完全进程内。',
    },
    {
      question: '状态放在哪里跨 turn 共享？',
      answer:
        'SQLite（{userData}/spark.db，WAL 模式）存会话、事件、设置、用量、Hook 等业务数据；文件系统存项目、附件、媒体产物与日志；两者才是跨 turn 的共享状态，执行器实例本身不共享。',
    },
    {
      question: '数据库加密了吗？',
      answer:
        '没有做透明加密，代码里不存在 SQLCipher 集成。{userData}/spark.db 是普通 SQLite 文件，依赖操作系统磁盘加密；应用只保证迁移前自动创建恢复点。',
    },
    {
      question: '画布里的产物是怎么显示出来的？',
      answer:
        'media 产物默认落在 {userData}/.spark-artifacts/media/<kind>，渲染端用 safe-file://（绝对路径 base64 编码）加载，只放行白名单根目录（userData、临时目录、board-attachments、已登记 workspace、画布项目目录），白名单外返回 403。',
    },
    {
      question: '内置 MCP 服务有哪些？',
      answer:
        'spark_image、spark_media、spark_search、spark_browser、spark_files、spark_ui、spark_memory、spark_session、spark_canvas、spark_platform、spark_team、spark_plugins、spark_app、spark_debug、spark_computer、spark_verify、spark_tool_results，实现都在 packages/agent-runtime/src/tools/*.mjs。',
    },
  ],
  quickReference: [
    {
      key: '进程',
      value: 'Main / Preload / Renderer（单 bundle 多窗口）/ 受管 MCP 子进程 / 执行引擎进程',
    },
    {
      key: '执行内核',
      value: 'claude-sdk / codex（cli、openai-chat、app-server 三种载具）/ spark（进程内）',
    },
    { key: '应用配置', value: 'app_settings（分类 + key 的 JSON 值）' },
    { key: '数据库', value: '{userData}/spark.db（WAL，101 个 migration SQL）' },
    {
      key: '凭据',
      value:
        'keystore（keytar service=spark-agent）；macOS 为 safeStorage 加密的 credential-vault-v1.enc',
    },
    {
      key: 'IPC 规模',
      value: '459 个请求/响应通道 + 41 个 stream 推送通道（packages/protocol/src/ipc/index.ts）',
    },
    { key: '媒体产物', value: '{userData}/.spark-artifacts/media/{images,audio,videos,text}' },
    { key: '本地媒体协议', value: 'safe-file://（白名单根目录，越界 403）' },
    { key: '更新缓存', value: '{userData}/spark-agent-updater/<version>/，保留最近 2 个版本' },
  ],
  howTo: {
    name: '从源码读懂一次会话的完整链路',
    description: '用「协议 → 主进程 → 渲染端」三段式定位任意功能',
    totalTime: 'PT30M',
    steps: [
      '在 packages/protocol/src/ipc/index.ts 找到目标功能的通道名（IpcChannelMap）与请求/响应类型',
      "在 apps/desktop/src/main/ipc/ 搜索 typedIpcHandle('通道名'，看清楚权限、参数校验与调用的服务",
      '顺着服务进入 packages/agent-runtime/src/services/，需要时再看 services/session/ 与 sdk/ 下的执行器',
      "回到渲染端，在 apps/desktop/src/renderer 搜 window.spark.invoke('通道名') 找到界面入口与状态更新",
      '如果是流式能力，再搜 stream:* 通道在渲染端的订阅位置，确认增量如何写回界面',
      '需要看持久化时，打开 packages/storage/migrations/*.sql 与对应 repository，核对表结构与字段',
    ],
  },
  aiSummary:
    'SparkWork 桌面端是 pnpm monorepo 下的 Electron 应用：apps/desktop 分 main（入口 index.ts，另有 background-maintenance 与 depth-inference 两个 worker）、preload（contextBridge 暴露 window.spark）、renderer（React 19，单 bundle 供主窗口/画布窗口/浏览器窗口复用）。' +
    '执行层有三个引擎：claude-sdk（每次 SDK query 一个 Claude Code CLI 子进程，支持权限热切换与 checkpoint）、codex（cli / openai-chat / app-server 三种载具，app-server 常驻且空闲 120 秒回收）、spark（spark-engine 进程内 SDK）。' +
    '数据面：packages/protocol 定义 459 个 IPC 通道与 41 个 stream 通道；packages/agent-runtime 提供服务层与内置 MCP（spark_search、spark_media、spark_browser 等）；packages/storage 提供 spark.db（WAL，101 个 migration）与仓库类。' +
    '存储：SQLite 存业务数据，文件系统存 projects/attachments/.spark-artifacts/logs，Provider 凭据走 keystore（macOS 为 safeStorage 加密 vault），远程连接凭据则是 app_settings 里的明文 JSON；渲染端读本地文件走 safe-file:// 白名单协议。',
  Body,
}

export default desktopGuide
