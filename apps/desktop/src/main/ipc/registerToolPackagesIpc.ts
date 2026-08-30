import {
  registerToolPackageBuiltInCapabilities,
  type ToolPackageService,
} from '@spark/agent-runtime'
import { EventRepository } from '@spark/storage'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { getDatabase } from '../db.js'
import { getAuthService } from '../services/Auth/AuthService.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

export function registerToolPackagesIpc(service: ToolPackageService): void {
  registerToolPackageBuiltInCapabilities(service.capabilities, {
    db: getDatabase(),
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
  })

  service.onChange((event) => {
    pushStreamEvent('stream:tool-packages:changed', event)
  })

  typedIpcHandle('tool-packages:list', async () => ({
    packages: service.listSummaries(),
  }))

  typedIpcHandle('tool-packages:get', async (request) => ({
    detail: await service.getDetail(request.packageId, request.version),
  }))

  typedIpcHandle('tool-packages:run-project-step', async (request) => ({
    result: await service.runManagedProjectStep({
      packageId: request.packageId,
      step: request.step,
    }),
  }))

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
