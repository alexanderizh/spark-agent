import { ToolPackageConfigScopeSchema } from '@spark/protocol'
import type { ToolPackageService } from './tool-packages/tool-package.service.js'

export type ToolPackageBridgeMethod =
  | 'tool_packages.guide'
  | 'tool_packages.list'
  | 'tool_packages.get'
  | 'tool_packages.inspect'
  | 'tool_packages.create_project'
  | 'tool_packages.list_project_files'
  | 'tool_packages.read_project_file'
  | 'tool_packages.write_project_file'
  | 'tool_packages.run_project_step'
  | 'tool_packages.install_directory'
  | 'tool_packages.install_archive'
  | 'tool_packages.install_git'
  | 'tool_packages.install_remote'
  | 'tool_packages.install_mcp_import'
  | 'tool_packages.environment_status'
  | 'tool_packages.configure_environment'
  | 'tool_packages.request_secret'
  | 'tool_packages.set_permission'
  | 'tool_packages.set_enabled'
  | 'tool_packages.uninstall'
  | 'tool_packages.delete_version'
  | 'tool_packages.test'

export async function handleToolPackageBridgeMethod(
  service: ToolPackageService,
  method: ToolPackageBridgeMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'tool_packages.guide':
      return toolPackageGuide()
    case 'tool_packages.list':
      return { packages: service.listSummaries() }
    case 'tool_packages.get':
      return {
        detail: await service.getDetail(
          requireText(params, 'packageId', 96),
          optionalText(params, 'version', 160),
        ),
      }
    case 'tool_packages.inspect':
      return {
        inspection: await service.inspectDirectory(requireText(params, 'sourcePath', 2_000)),
      }
    case 'tool_packages.create_project':
      return toolPackageCreateProject(service, params)
    case 'tool_packages.list_project_files':
      return service.listManagedProjectFiles(requireText(params, 'packageId', 96))
    case 'tool_packages.read_project_file':
      return service.readManagedProjectFile({
        packageId: requireText(params, 'packageId', 96),
        path: requireText(params, 'path', 500),
      })
    case 'tool_packages.write_project_file':
      return toolPackageWriteProjectFile(service, params)
    case 'tool_packages.run_project_step':
      return toolPackageRunProjectStep(service, params)
    case 'tool_packages.install_directory':
      return toolPackageInstallDirectory(service, params)
    case 'tool_packages.install_archive':
      return toolPackageInstallArchive(service, params)
    case 'tool_packages.install_git':
      return toolPackageInstallGitRepository(service, params)
    case 'tool_packages.install_remote':
      return toolPackageInstallRemoteManifest(service, params)
    case 'tool_packages.install_mcp_import':
      return toolPackageInstallMcpImport(service, params)
    case 'tool_packages.environment_status':
      return toolPackageEnvironmentStatus(service, params)
    case 'tool_packages.configure_environment':
      return toolPackageConfigureEnvironment(service, params)
    case 'tool_packages.request_secret':
      return toolPackageRequestSecret(service, params)
    case 'tool_packages.set_permission':
      return toolPackageSetPermission(service, params)
    case 'tool_packages.set_enabled':
      return toolPackageSetEnabled(service, params)
    case 'tool_packages.uninstall':
      return toolPackageUninstall(service, params)
    case 'tool_packages.delete_version':
      return toolPackageDeleteVersion(service, params)
    case 'tool_packages.test':
      return toolPackageTest(service, params)
  }
}

function toolPackageGuide() {
  return {
    schemaVersion: 1,
    manifest: 'spark-tool.json',
    protocol: 'spark-tool-process-v1',
    workflow: [
      '先创建受管工程或只读检查外部目录；inspection 不执行包代码。',
      '读取已安装包详情，核对准确版本的 manifest、配置声明、脱敏状态和权限。',
      '先列出并读取现有受管工程文件，再补齐多文件工程、manifest、环境变量声明与 Spark Capabilities。',
      '安装只复制不可变版本且保持禁用；安装、构建和首次启动是不同操作。导入来源支持本地目录、.zip 压缩包、Git 仓库（浅克隆）、remote-http 远端 manifest 与导入既有 MCP 服务器的工具。',
      '普通环境变量可由 Agent 配置；secret 只能发起安全输入，禁止把明文传给 Agent。',
      '用户确认 OS 行为与 Spark Capability 授权后才能启用。',
      '启用后下一次 Agent loop 动态获得包内工具并像内置工具一样自主调用。',
      '卸载会删除全部不可变版本与 Keychain 密钥，必须先停用且由用户确认；删除单个版本同样需要确认，最后一个版本只能整体卸载。',
    ],
    boundaries: {
      toolObject: '完整 Tool Project / immutable Package Version / Installation',
      mcp: '仅外部导入或引擎末端兼容，不是工具本体和执行内核',
      trustedLocal: '进程具有当前用户权限；declaredOsEffects 是告知与启用确认，不是细粒度 OS 沙箱',
      secrets: 'Agent 只能读取是否已配置；明文必须经应用内安全输入进入 Keychain',
    },
    processRuntime: {
      spawn: 'command 必须是单个可执行文件（PATH 查找，或包内 "./相对路径"），参数一律放 runtime.args；进程不经 shell 拉起，"node index.js" 这类写法会在启动时 ENOENT。',
      cwd: '包安装目录（可加 runtime.workingDirectory 相对子目录）。',
      environment:
        'manifest.environment 声明的变量（含 Keychain 密钥）+ PATH/TEMP 等基础变量 + SPARK_TOOL_PACKAGE_ID / SPARK_TOOL_PACKAGE_VERSION / SPARK_TOOL_PROCESS_PROTOCOL。',
      lifecycle:
        'per-call（默认）：每次调用起一个新进程，initialize→invoke→shutdown 后退出；persistent：按 包+版本+环境 复用进程，配置或权限变更后失效重建。',
    },
    processProtocol: {
      transport:
        'stdin/stdout 上换行分隔的 JSON 帧（每行一帧，UTF-8，单帧上限 4 MB）。stdout 只允许输出协议帧，任何杂散输出都会破坏帧解析；日志写 stderr（宿主仅记录，上限 1 MB，不参与协议）。',
      frameBase:
        '所有帧都带 protocolVersion:"spark-tool-process-v1"、requestId（必须原样回传主机帧的 requestId）、sequence（非负递增整数）。result 帧还须回带对应 invoke 的 invocationId。',
      hostFrames: {
        initialize:
          '{type:"initialize", packageId, packageVersion, capabilityProtocolVersion:1} → 子进程须回 ready 帧。',
        invoke:
          '{type:"invoke", invocationId, toolName, input, context} → 子进程回 result 或 error 帧；input 已按 manifest 的 inputSchema 校验过。',
        cancel: '{type:"cancel", invocationId}：宿主放弃该次调用，子进程应尽快停止并回 error。',
        'capability.result':
          '{type:"capability.result", invocationId, result}：宿主对 capability.request 的成功应答。',
        'capability.error': '{type:"capability.error", invocationId, code, message}：宿主能力调用失败的应答。',
        shutdown: '{type:"shutdown"}：要求子进程退出；1 秒内未退出会被强杀进程树。',
      },
      childFrames: {
        ready: '{type:"ready"}：initialize 的应答；15 秒超时。',
        result: '{type:"result", invocationId, result}：invoke 的成功应答，result 为任意 JSON；默认 120 秒超时。',
        error: '{type:"error", invocationId?, code, message}：invoke 或 initialize 的失败应答。',
        log: '{type:"log", level:"debug|info|warn|error", message}：可选，替代写 stdout 的调试输出。',
        progress: '{type:"progress", invocationId, progress?, message?}：可选进度上报。',
        'capability.request':
          '{type:"capability.request", invocationId, capability, input}：子进程请求宿主 Spark Capability（须在 manifest.permissions 声明），宿主回 capability.result / capability.error。',
      },
      reference:
        '帧的权威 schema 在 @spark/protocol 的 tool-process-protocol.ts（ToolProcessHostFrameSchema / ToolProcessChildFrameSchema）；Node.js 入口按 readline 逐行解析 stdin、异步处理 invoke 并等待在途调用完成后再退出即可。',
    },
  }
}

async function toolPackageCreateProject(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  const rawFiles = params.files
  if (rawFiles !== undefined && !Array.isArray(rawFiles)) throw new Error('files must be an array')
  const files = (rawFiles ?? []).map((raw, index) => {
    const file = asRecord(raw)
    if (typeof file.path !== 'string' || file.path.trim().length === 0) {
      throw new Error(`files[${index}].path is required`)
    }
    if (typeof file.content !== 'string') {
      throw new Error(`files[${index}].content must be a string`)
    }
    return { path: file.path, content: file.content }
  })
  return service.createManagedProject({ manifest: params.manifest, files })
}

function toolPackageWriteProjectFile(service: ToolPackageService, params: Record<string, unknown>) {
  if (typeof params.content !== 'string') throw new Error('content must be a string')
  return service.writeManagedProjectFile({
    packageId: requireText(params, 'packageId', 96),
    path: requireText(params, 'path', 500),
    content: params.content,
  })
}

async function toolPackageRunProjectStep(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmExecute !== true) {
    throw new Error(
      'Running an install/build step executes trusted code and requires confirmExecute=true',
    )
  }
  if (params.step !== 'install' && params.step !== 'build') {
    throw new Error('step must be install or build')
  }
  return {
    result: await service.runManagedProjectStep({
      packageId: requireText(params, 'packageId', 96),
      step: params.step,
      ...(typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
        ? { timeoutMs: params.timeoutMs }
        : {}),
    }),
  }
}

async function toolPackageInstallDirectory(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmInstall !== true) {
    throw new Error('Installing a Tool Package requires confirmInstall=true')
  }
  if (params.source !== 'managed-project' && params.source !== 'local-directory') {
    throw new Error('source must be managed-project or local-directory')
  }
  const installed = await service.installDirectory({
    sourcePath: requireText(params, 'sourcePath', 2_000),
    source: params.source,
  })
  return { package: requirePackageSummary(service, installed.id) }
}

async function toolPackageInstallArchive(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmInstall !== true) {
    throw new Error('Installing a Tool Package archive requires confirmInstall=true')
  }
  const installed = await service.installArchive({
    archivePath: requireText(params, 'archivePath', 2_000),
  })
  return {
    package: requirePackageSummary(service, installed.package.id),
    version: installed.version,
  }
}

async function toolPackageInstallGitRepository(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmInstall !== true) {
    throw new Error('Installing a Tool Package from git requires confirmInstall=true')
  }
  const ref = optionalText(params, 'ref', 200)
  const subdirectory = optionalText(params, 'subdirectory', 300)
  const installed = await service.installGitRepository({
    url: requireText(params, 'url', 2_000),
    ...(ref != null ? { ref } : {}),
    ...(subdirectory != null ? { subdirectory } : {}),
  })
  return {
    package: requirePackageSummary(service, installed.package.id),
    version: installed.version,
  }
}

async function toolPackageInstallRemoteManifest(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmInstall !== true) {
    throw new Error('Installing a remote Tool Package manifest requires confirmInstall=true')
  }
  if (typeof params.manifest !== 'object' || params.manifest == null) {
    throw new Error('manifest must be the remote-http tool package manifest object')
  }
  const installed = await service.installRemoteManifest({ manifest: params.manifest })
  return {
    package: requirePackageSummary(service, installed.package.id),
    version: installed.version,
  }
}

async function toolPackageInstallMcpImport(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmInstall !== true) {
    throw new Error('Importing an MCP server as a Tool Package requires confirmInstall=true')
  }
  if (Array.isArray(params.tools)) {
    for (const name of params.tools) {
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        throw new Error('tools must be an array of MCP tool name strings')
      }
    }
  } else if (params.tools !== undefined) {
    throw new Error('tools must be an array of MCP tool name strings when provided')
  }
  const packageId = optionalText(params, 'packageId', 96)
  const version = optionalText(params, 'version', 160)
  const name = optionalText(params, 'name', 200)
  const installed = await service.installMcpImport({
    serverId: requireText(params, 'serverId', 160),
    ...(packageId != null ? { packageId } : {}),
    ...(version != null ? { version } : {}),
    ...(name != null ? { name } : {}),
    ...(Array.isArray(params.tools) ? { tools: params.tools as string[] } : {}),
  })
  return {
    package: requirePackageSummary(service, installed.package.id),
    version: installed.version,
    importedTools: installed.importedTools,
    ...(installed.skippedTools.length > 0 ? { skippedTools: installed.skippedTools } : {}),
  }
}

async function toolPackageEnvironmentStatus(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  const detail = await service.getDetail(
    requireText(params, 'packageId', 96),
    optionalText(params, 'version', 160),
  )
  return {
    packageId: detail.package.id,
    version: detail.version,
    environment: detail.manifest.environment.map((definition) => ({
      ...definition,
      ...detail.environment.find((status) => status.name === definition.name),
    })),
  }
}

function toolPackageConfigureEnvironment(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  const scope =
    params.scope === undefined ? undefined : ToolPackageConfigScopeSchema.parse(params.scope)
  service.configureValue({
    packageId: requireText(params, 'packageId', 96),
    ...(typeof params.version === 'string' ? { version: params.version } : {}),
    name: requireText(params, 'name', 128),
    value: params.value,
    ...(scope !== undefined ? { scope } : {}),
    ...(typeof params.scopeId === 'string' ? { scopeId: params.scopeId } : {}),
    ...(typeof params.toolName === 'string' ? { toolName: params.toolName } : {}),
    actor: 'agent',
  })
  return { ok: true }
}

function toolPackageRequestSecret(service: ToolPackageService, params: Record<string, unknown>) {
  const scope =
    params.scope === undefined ? undefined : ToolPackageConfigScopeSchema.parse(params.scope)
  return {
    request: service.requestSecretInput({
      packageId: requireText(params, 'packageId', 96),
      ...(typeof params.version === 'string' ? { version: params.version } : {}),
      name: requireText(params, 'name', 128),
      ...(scope !== undefined ? { scope } : {}),
      ...(typeof params.scopeId === 'string' ? { scopeId: params.scopeId } : {}),
      ...(typeof params.toolName === 'string' ? { toolName: params.toolName } : {}),
      actor: 'agent',
    }),
  }
}

function toolPackageSetPermission(service: ToolPackageService, params: Record<string, unknown>) {
  if (params.confirmPermission !== true) {
    throw new Error('Changing Tool Package permissions requires confirmPermission=true')
  }
  const kind =
    params.kind === 'os-effect' || params.kind === 'spark-capability' ? params.kind : null
  if (kind == null) throw new Error('kind must be os-effect or spark-capability')
  const state =
    params.state === 'granted' || params.state === 'denied' || params.state === 'pending'
      ? params.state
      : null
  if (state == null) throw new Error('state must be pending, granted or denied')
  service.setPermission({
    packageId: requireText(params, 'packageId', 96),
    version: requireText(params, 'version', 160),
    kind,
    permission: requireText(params, 'permission', 160),
    state,
  })
  return { ok: true }
}

async function toolPackageSetEnabled(service: ToolPackageService, params: Record<string, unknown>) {
  if (typeof params.enabled !== 'boolean') throw new Error('enabled must be a boolean')
  const enabled = params.enabled
  if (enabled && params.confirmEnable !== true) {
    throw new Error('Enabling a Tool Package requires confirmEnable=true')
  }
  const packageId = requireText(params, 'packageId', 96)
  const updated = await service.setEnabled(
    packageId,
    enabled ? requireText(params, 'version', 160) : null,
  )
  return { package: requirePackageSummary(service, updated.id) }
}

async function toolPackageUninstall(service: ToolPackageService, params: Record<string, unknown>) {
  if (params.confirmUninstall !== true) {
    throw new Error(
      'Uninstalling a Tool Package permanently deletes every installed version and its Keychain secrets; it requires confirmUninstall=true',
    )
  }
  return {
    result: await service.uninstallPackage({
      packageId: requireText(params, 'packageId', 96),
      ...(params.removeManagedProject === true ? { removeManagedProject: true } : {}),
    }),
  }
}

async function toolPackageDeleteVersion(
  service: ToolPackageService,
  params: Record<string, unknown>,
) {
  if (params.confirmUninstall !== true) {
    throw new Error(
      'Deleting a Tool Package version permanently removes its immutable snapshot; it requires confirmUninstall=true',
    )
  }
  return service.deleteVersion({
    packageId: requireText(params, 'packageId', 96),
    version: requireText(params, 'version', 160),
  })
}

async function toolPackageTest(service: ToolPackageService, params: Record<string, unknown>) {
  if (params.confirmExecute !== true) {
    throw new Error('Testing a Tool Package executes trusted code and requires confirmExecute=true')
  }
  return {
    result: await service.invokeInstalledVersion({
      packageId: requireText(params, 'packageId', 96),
      version: requireText(params, 'version', 160),
      toolName: requireText(params, 'toolName', 96),
      input: params.input,
    }),
  }
}

function requireText(params: Record<string, unknown>, key: string, maxLength: number): string {
  const value = params[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`)
  }
  if (value.length > maxLength) throw new Error(`${key} exceeds ${maxLength} characters`)
  return value
}

function optionalText(
  params: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  return params[key] === undefined ? undefined : requireText(params, key, maxLength)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requirePackageSummary(service: ToolPackageService, packageId: string) {
  const summary = service.listSummaries().find((item) => item.id === packageId)
  if (summary == null) throw new Error(`Tool Package summary not found: ${packageId}`)
  return summary
}
