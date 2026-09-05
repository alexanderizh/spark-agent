import {
  registerToolPackageBuiltInCapabilities,
  type ToolPackageBuiltInCapabilityDeps,
  type ToolPackageService,
} from '@spark/agent-runtime'
import { EventRepository } from '@spark/storage'
import { createHash, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { clipboard, dialog, Notification, shell } from 'electron'
import { getDatabase } from '../db.js'
import { getAuthService } from '../services/Auth/AuthService.js'
import { openExternalUrlSafely } from '../services/ExternalUrlPolicy.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { getInternalBrowserService } from '../services/InternalBrowserService.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

type ExtendedCapabilityDeps = Omit<
  Partial<ToolPackageBuiltInCapabilityDeps>,
  | 'db'
  | 'uploadFile'
  | 'presentFiles'
  | 'trashFile'
  | 'readClipboardText'
  | 'writeClipboardText'
  | 'showNotification'
  | 'openExternal'
  | 'openDialog'
  | 'saveDialog'
>

export function registerToolPackagesIpc(
  service: ToolPackageService,
  extendedCapabilities: ExtendedCapabilityDeps = {},
): void {
  const browserWindowsByPackageVersion = new Map<string, Set<string>>()
  const packageVersionScope = (context: { packageId: string; packageVersion: string }): string =>
    `${context.packageId}@${context.packageVersion}`
  const browserProfile = (context: { packageId: string; packageVersion: string }): string =>
    `toolpkg-${createHash('sha256')
      .update(packageVersionScope(context))
      .digest('hex')
      .slice(0, 24)}`
  const ownedBrowserWindow = (
    context: { packageId: string; packageVersion: string },
    windowId: string,
  ): string => {
    if (!browserWindowsByPackageVersion.get(packageVersionScope(context))?.has(windowId)) {
      throw new Error('Tool Package cannot access a browser window it did not open')
    }
    return windowId
  }
  service.capabilities.setInvocationAuthorizer(async ({ definition, context, input }) => {
    const result = await dialog.showMessageBox({
      type: definition.risk === 'destructive' ? 'warning' : 'question',
      title: '确认工具宿主能力调用',
      message: `${context.packageId}/${context.toolName} 请求调用 ${definition.name}`,
      detail: buildCapabilityConfirmationDetail(definition, input),
      buttons: ['允许本次调用', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  })
  registerToolPackageBuiltInCapabilities(service.capabilities, {
    ...extendedCapabilities,
    db: getDatabase(),
    browserListWindows: async (context) => {
      const scope = packageVersionScope(context)
      const owned = browserWindowsByPackageVersion.get(scope) ?? new Set<string>()
      const windows = getInternalBrowserService()
        .listWindows()
        .filter((window) => owned.has(window.windowId))
      browserWindowsByPackageVersion.set(scope, new Set(windows.map((window) => window.windowId)))
      return { windows }
    },
    browserOpen: async (context, input) => {
      const opened = await getInternalBrowserService().openWindow({
        url: input.url,
        show: input.show,
        reuse: input.reuse,
        profileId: browserProfile(context),
      })
      const scope = packageVersionScope(context)
      const owned = browserWindowsByPackageVersion.get(scope) ?? new Set<string>()
      owned.add(opened.windowId)
      browserWindowsByPackageVersion.set(scope, owned)
      return opened
    },
    browserNavigate: async (context, input) =>
      getInternalBrowserService().navigate(ownedBrowserWindow(context, input.windowId), input.url),
    browserScreenshot: async (context, input) =>
      getInternalBrowserService().screenshot(ownedBrowserWindow(context, input.windowId)),
    browserInspect: async (context, input) => ({
      ...getInternalBrowserService().getUrl(ownedBrowserWindow(context, input.windowId)),
      ...getInternalBrowserService().getTitle(ownedBrowserWindow(context, input.windowId)),
    }),
    browserEvaluate: async (context, input) => ({
      result: await getInternalBrowserService().evalJs(
        ownedBrowserWindow(context, input.windowId),
        input.code,
      ),
    }),
    browserClose: async (context, input) => {
      const windowId = ownedBrowserWindow(context, input.windowId)
      const closed = getInternalBrowserService().closeWindow(windowId)
      browserWindowsByPackageVersion.get(packageVersionScope(context))?.delete(windowId)
      return closed
    },
    uploadFile: async (_context, input) => {
      await assertPresentableFile(input.path)
      return getAuthService().uploadFile({
        filePath: input.path,
        ...(input.fileName != null ? { fileName: input.fileName } : {}),
        ...(input.mimeType != null ? { mimeType: input.mimeType } : {}),
        ...(input.purpose != null ? { purpose: input.purpose } : {}),
      })
    },
    presentFiles: async (context, input) => {
      if (!context.sessionId || !context.turnId) {
        throw new Error('files.present requires an active Spark session turn')
      }
      await Promise.all(input.files.map((file) => assertPresentableFile(file.path)))
      const eventRepository = new EventRepository(getDatabase())
      const event = {
        id: randomUUID(),
        type: 'presented_files' as const,
        sessionId: context.sessionId,
        turnId: context.turnId,
        timestamp: new Date().toISOString(),
        seq: eventRepository.nextSeqBySession(context.sessionId),
        files: input.files,
      }
      eventRepository.insert({
        id: event.id,
        sessionId: context.sessionId,
        turnId: context.turnId,
        eventType: event.type,
        eventJson: JSON.stringify(event),
      })
      pushStreamEvent('stream:session:agent-event', event)
      return { files: input.files }
    },
    trashFile: async (_context, input) => {
      await shell.trashItem(input.path)
      return { trashed: true, path: input.path }
    },
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (_context, input) => {
      clipboard.writeText(input.text)
      return { written: true, characters: input.text.length }
    },
    showNotification: (_context, input) => {
      if (!Notification.isSupported()) throw new Error('System notifications are unavailable')
      new Notification({ title: input.title, body: input.body ?? '', silent: true }).show()
      return { shown: true }
    },
    openExternal: async (_context, input) => {
      const opened = await openExternalUrlSafely(input.url, (url) => shell.openExternal(url))
      if (!opened) throw new Error('External URL was rejected or could not be opened')
      return { opened: true, url: input.url }
    },
    openDialog: async (_context, input) => {
      const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = []
      if (input.mode === 'file' || input.mode === 'any') properties.push('openFile')
      if (input.mode === 'directory' || input.mode === 'any') properties.push('openDirectory')
      if (input.allowMultiple === true) properties.push('multiSelections')
      return dialog.showOpenDialog({
        properties,
        ...(input.title != null ? { title: input.title } : {}),
        ...(input.defaultPath != null ? { defaultPath: input.defaultPath } : {}),
        ...(input.filters != null ? { filters: input.filters } : {}),
      })
    },
    saveDialog: async (_context, input) =>
      dialog.showSaveDialog({
        ...(input.title != null ? { title: input.title } : {}),
        ...(input.defaultPath != null ? { defaultPath: input.defaultPath } : {}),
        ...(input.filters != null ? { filters: input.filters } : {}),
      }),
  })

  service.onChange((event) => {
    pushStreamEvent('stream:tool-packages:changed', event)
  })
  service.onRuntimeEvent((event) => {
    pushStreamEvent('stream:tool-packages:runtime', event)
  })

  typedIpcHandle('tool-packages:list', async () => ({
    packages: service.listSummaries(),
  }))

  typedIpcHandle('tool-packages:get', async (request) => ({
    detail: await service.getDetail(request.packageId, request.version),
  }))

  typedIpcHandle('tool-packages:install-directory', async (request) => {
    const installed = await service.installLocalDirectory({ sourcePath: request.sourcePath })
    return { package: toPackageSummary(service, installed.package), version: installed.version }
  })

  typedIpcHandle('tool-packages:install-archive', async (request) => {
    const installed = await service.installArchive({ archivePath: request.archivePath })
    return { package: toPackageSummary(service, installed.package), version: installed.version }
  })

  typedIpcHandle('tool-packages:install-git', async (request) => {
    const installed = await service.installGitRepository({
      url: request.url,
      ...(request.ref != null ? { ref: request.ref } : {}),
      ...(request.subdirectory != null ? { subdirectory: request.subdirectory } : {}),
    })
    return { package: toPackageSummary(service, installed.package), version: installed.version }
  })

  typedIpcHandle('tool-packages:install-mcp-import', async (request) => {
    const installed = await service.installMcpImport({
      serverId: request.serverId,
      ...(request.name != null ? { name: request.name } : {}),
      ...(request.tools != null ? { tools: request.tools } : {}),
    })
    return {
      package: toPackageSummary(service, installed.package),
      version: installed.version,
      importedTools: installed.importedTools,
      skippedTools: installed.skippedTools,
    }
  })

  typedIpcHandle('tool-packages:run-project-step', async (request) => ({
    result: await service.runManagedProjectStep({
      packageId: request.packageId,
      step: request.step,
      ...(request.operationId != null ? { operationId: request.operationId } : {}),
    }),
  }))

  typedIpcHandle('tool-packages:run-project-step:cancel', async (request) => ({
    cancelled: service.cancelManagedProjectStep(request.operationId),
  }))

  typedIpcHandle('tool-packages:project-files:list', async (request) =>
    service.listManagedProjectFiles(request.packageId),
  )

  typedIpcHandle('tool-packages:project-file:read', async (request) =>
    service.readManagedProjectFile(request),
  )

  typedIpcHandle('tool-packages:project-file:write', async (request) =>
    service.writeManagedProjectFile(request),
  )

  typedIpcHandle('tool-packages:project:install', async (request) => {
    const installed = await service.installManagedProject(request.packageId)
    return { package: toPackageSummary(service, installed.package), version: installed.version }
  })

  typedIpcHandle('tool-packages:test', async (request) => ({
    test: await service.testInstalledVersion(request),
  }))

  typedIpcHandle('tool-packages:test:cancel', async (request) => ({
    cancelled: service.cancelTest(request.correlationId),
  }))

  typedIpcHandle('tool-packages:invocations:list', async (request) => {
    const result = service.listInvocations({
      sourceKind: request.sourceKind ?? 'tool-package',
      ...(request.packageId != null ? { packageId: request.packageId } : {}),
      ...(request.toolName != null ? { toolName: request.toolName } : {}),
      ...(request.status != null ? { status: request.status } : {}),
      ...(request.correlationId != null ? { correlationId: request.correlationId } : {}),
      ...(request.from != null ? { from: request.from } : {}),
      ...(request.to != null ? { to: request.to } : {}),
      ...(request.limit != null ? { limit: request.limit } : {}),
      ...(request.offset != null ? { offset: request.offset } : {}),
    })
    return {
      invocations: result.items.map((row) => ({
        id: row.id,
        correlationId: row.correlation_id,
        sourceKind: row.source_kind,
        sourceId: row.source_id,
        packageId: row.package_id,
        toolId: row.tool_id,
        toolName: row.tool_name,
        version: row.version,
        adapter: row.adapter,
        sessionId: row.session_id,
        turnId: row.turn_id,
        projectId: row.project_id,
        agentId: row.agent_id,
        workflowId: row.workflow_id,
        invocationSource: row.invocation_source,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs: row.duration_ms,
        errorCode: row.error_code,
        outputBytes: row.output_bytes,
        resultArchived: row.result_archived === 1,
        resultTruncated: row.result_truncated === 1,
        retryCount: row.retry_count,
      })),
      total: result.total,
    }
  })

  typedIpcHandle('tool-packages:configure-environment', async (request) => {
    service.configureValue({
      ...request,
      actor: 'user',
    })
    return { ok: true }
  })

  typedIpcHandle('tool-packages:request-secret', async (request) => ({
    request: service.requestSecretInput({
      ...request,
      actor: 'user',
    }),
  }))

  typedIpcHandle('tool-packages:set-permission', async (request) => {
    service.setPermission(request)
    return { ok: true }
  })

  typedIpcHandle('tool-packages:set-enabled', async (request) => ({
    package: toPackageSummary(
      service,
      await service.setEnabled(request.packageId, request.version),
    ),
  }))

  typedIpcHandle('tool-packages:uninstall', async (request) => ({
    result: await service.uninstallPackage(request),
  }))

  typedIpcHandle('tool-packages:delete-version', async (request) => ({
    ...(await service.deleteVersion(request)),
  }))

  typedIpcHandle('tool-packages:secure-requests:list', async () => ({
    requests: service.listPendingSecureRequests(),
  }))

  typedIpcHandle('tool-packages:secure-request:fulfill', async (request) => {
    await service.fulfillSecureRequest(request.requestId, request.value)
    return { ok: true }
  })

  typedIpcHandle('tool-packages:secure-request:cancel', async (request) => {
    service.cancelSecureRequest(request.requestId)
    return { ok: true }
  })
}

function toPackageSummary(
  service: ToolPackageService,
  row: ReturnType<ToolPackageService['list']>[number],
) {
  const summary = service.listSummaries().find((item) => item.id === row.id)
  if (summary == null) throw new Error(`Tool Package summary not found: ${row.id}`)
  return summary
}

async function assertPresentableFile(filePath: string): Promise<void> {
  if (!isAbsolute(filePath) || !isSafeFilePathAllowed(filePath)) {
    throw new Error('Tool Package file is outside Spark allowed file roots')
  }
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('Tool Package file path is not a regular file')
}

/** Confirmation dialogs must show what will actually run, not just capability names. */
function buildCapabilityConfirmationDetail(
  definition: { description?: string; name: string },
  input: unknown,
): string {
  const description = definition.description ?? '该能力会由 SparkWork 桌面宿主执行。'
  const preview = previewCapabilityInput(definition.name, input)
  return preview == null ? description : `${description}\n\n${preview}`
}

function previewCapabilityInput(capability: string, input: unknown): string | undefined {
  if (input == null || typeof input !== 'object') return undefined
  if (capability === 'process.exec') {
    const record = input as { command?: unknown; cwd?: unknown; env?: unknown }
    const command = Array.isArray(record.command)
      ? record.command.map((part) => String(part)).join(' ')
      : undefined
    if (command == null) return undefined
    const lines = [`将执行命令: ${boundText(command, 2_000)}`]
    if (typeof record.cwd === 'string' && record.cwd.length > 0) {
      lines.push(`工作目录: ${boundText(record.cwd, 1_000)}`)
    }
    if (record.env != null && typeof record.env === 'object') {
      const keys = Object.keys(record.env as Record<string, unknown>)
      if (keys.length > 0) lines.push(`附加环境变量: ${keys.join(', ')}`)
    }
    return lines.join('\n')
  }
  try {
    const json = JSON.stringify(input)
    return json == null ? undefined : `调用参数: ${boundText(json, 2_000)}`
  } catch {
    return undefined
  }
}

function boundText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
