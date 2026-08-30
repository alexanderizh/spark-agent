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
  | 'tool_packages.install_directory'
  | 'tool_packages.environment_status'
  | 'tool_packages.configure_environment'
  | 'tool_packages.request_secret'
  | 'tool_packages.set_permission'
  | 'tool_packages.set_enabled'
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
    case 'tool_packages.install_directory':
      return toolPackageInstallDirectory(service, params)
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
      '安装只复制不可变版本且保持禁用；安装、构建和首次启动是不同操作。',
      '普通环境变量可由 Agent 配置；secret 只能发起安全输入，禁止把明文传给 Agent。',
      '用户确认 OS 行为与 Spark Capability 授权后才能启用。',
      '启用后下一次 Agent loop 动态获得包内工具并像内置工具一样自主调用。',
    ],
    boundaries: {
      toolObject: '完整 Tool Project / immutable Package Version / Installation',
      mcp: '仅外部导入或引擎末端兼容，不是工具本体和执行内核',
      trustedLocal: '进程具有当前用户权限；declaredOsEffects 是告知与启用确认，不是细粒度 OS 沙箱',
      secrets: 'Agent 只能读取是否已配置；明文必须经应用内安全输入进入 Keychain',
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
