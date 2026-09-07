import { SUB_APP_SURFACES, type SubAppJobStatus, type SubAppSurface } from '@spark/protocol'
import type { PlatformBridgeDeps } from './platform-bridge.service.js'

export type SubAppV2BridgeResult = { handled: false } | { handled: true; value: unknown }

const METHODS = new Set([
  'subapp.scaffold',
  'subapp.project_status',
  'subapp.project_read_file',
  'subapp.project_write_file',
  'subapp.project_delete_file',
  'subapp.project_publish',
  'subapp.migrate_v1',
  'subapp.connections_list',
  'subapp.connections_bind',
  'subapp.connections_unbind',
  'subapp.service_status',
  'subapp.service_logs',
  'subapp.service_restart',
  'subapp.jobs_create',
  'subapp.jobs_get',
  'subapp.jobs_list',
  'subapp.jobs_cancel',
  'subapp.diagnose',
])

export async function handleSubAppV2BridgeMethod(
  method: string,
  deps: PlatformBridgeDeps,
  params: Record<string, unknown>,
): Promise<SubAppV2BridgeResult> {
  if (!METHODS.has(method)) return { handled: false }
  if (method === 'subapp.scaffold') {
    const created = await deps.subAppPackageService.scaffold({
      name: requiredText(params, 'name', 120),
      ...(typeof params.description === 'string' ? { description: params.description } : {}),
      ...(typeof params.icon === 'string' || params.icon === null ? { icon: params.icon } : {}),
      ...(typeof params.surface === 'string' &&
      SUB_APP_SURFACES.includes(params.surface as SubAppSurface)
        ? { surface: params.surface as SubAppSurface }
        : {}),
      ...(params.template === 'fullstack' ? { template: 'fullstack' as const } : {}),
    })
    deps.onConfigChanged?.('sub-app', 'create', created.appId)
    return { handled: true, value: created }
  }
  const appId = requiredText(params, 'appId', 80)
  switch (method) {
    case 'subapp.project_status':
      return handled(await deps.subAppPackageService.status(appId))
    case 'subapp.project_read_file':
      return handled(
        await deps.subAppPackageService.readFile(
          appId,
          requiredText(params, 'path', 240),
          params.encoding === 'base64' ? 'base64' : 'utf8',
        ),
      )
    case 'subapp.project_write_file':
      return handled(
        await mutateProject(deps, appId, () =>
          deps.subAppPackageService.writeFile({
            appId,
            expectedDraftRevision: revision(params),
            filePath: requiredText(params, 'path', 240),
            content: typeof params.content === 'string' ? params.content : '',
            ...(params.encoding === 'base64' ? { encoding: 'base64' as const } : {}),
          }),
        ),
      )
    case 'subapp.project_delete_file':
      return handled(
        await mutateProject(deps, appId, () =>
          deps.subAppPackageService.deleteFile({
            appId,
            expectedDraftRevision: revision(params),
            filePath: requiredText(params, 'path', 240),
          }),
        ),
      )
    case 'subapp.project_publish': {
      await deps.subAppRuntime?.preflightProject({ appId })
      const value = await deps.subAppPackageService.publish(appId, revision(params))
      await deps.subAppRuntime?.releaseChanged({ appId })
      deps.onConfigChanged?.('sub-app', 'update', appId)
      return handled(value)
    }
    case 'subapp.migrate_v1':
      return handled(
        await mutateProject(deps, appId, () =>
          deps.subAppPackageService.migrateV1(appId, revision(params)),
        ),
      )
    case 'subapp.connections_list':
      return handled({ items: deps.subAppPlatformRepo.listBindings(appId) })
    case 'subapp.connections_bind':
      return handled(bindConnection(deps, appId, params))
    case 'subapp.connections_unbind':
      return handled({
        deleted: deps.subAppPlatformRepo.deleteBinding(appId, requiredText(params, 'slot', 80)),
      })
    case 'subapp.service_status':
      return handled(
        await (deps.subAppRuntime?.serviceStatus(params) ??
          deps.subAppPlatformRepo.getServiceState(appId)),
      )
    case 'subapp.service_logs':
      return handled(await requireRuntime(deps).serviceLogs(params))
    case 'subapp.service_restart':
      return handled(await requireRuntime(deps).serviceRestart(params))
    case 'subapp.jobs_create':
      return handled(await requireRuntime(deps).jobCreate(params))
    case 'subapp.jobs_get':
      return handled(await requireRuntime(deps).jobGet(params))
    case 'subapp.jobs_list':
      return handled(
        await (deps.subAppRuntime?.jobList(params) ??
          deps.subAppPlatformRepo.listJobs(appId, {
            ...(isJobStatus(params.status) ? { status: params.status } : {}),
            ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
            ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
          })),
      )
    case 'subapp.jobs_cancel':
      return handled(await requireRuntime(deps).jobCancel(params))
    case 'subapp.diagnose':
      return handled(await (deps.subAppRuntime?.diagnose(params) ?? diagnose(deps, appId, params)))
    default:
      return { handled: false }
  }
}

async function mutateProject(
  deps: PlatformBridgeDeps,
  appId: string,
  action: () => Promise<unknown>,
) {
  const value = await action()
  deps.onConfigChanged?.('sub-app', 'update', appId)
  return value
}

function bindConnection(deps: PlatformBridgeDeps, appId: string, params: Record<string, unknown>) {
  const slot = requiredText(params, 'slot', 80)
  const bindingKind = params.bindingKind
  if (bindingKind !== 'api-connection' && bindingKind !== 'provider-profile')
    throw new Error('Invalid bindingKind')
  const declaration =
    deps.subAppPlatformRepo.getPublishedPackage(appId)?.manifest.connections?.[slot]
  if (declaration == null) throw new Error('Connection slot is not declared by the active release')
  const expectedKind = declaration.kind === 'provider' ? 'provider-profile' : 'api-connection'
  if (bindingKind !== expectedKind) throw new Error(`Connection slot requires ${expectedKind}`)
  const declared = new Set(declaration.allowedOrigins.map((value) => new URL(value).origin))
  const requested = stringArray(params.grantedOrigins) ?? declaration.allowedOrigins
  const grantedOrigins = requested.map((value) => new URL(value).origin)
  if (grantedOrigins.some((value) => !declared.has(value)))
    throw new Error('Granted origin exceeds manifest')
  return deps.subAppPlatformRepo.upsertBinding({
    appId,
    slot,
    bindingKind,
    bindingId: requiredText(params, 'bindingId', 80),
    grantedOrigins: [...new Set(grantedOrigins)],
    allowPrivateNetwork:
      declaration.allowPrivateNetwork === true && params.allowPrivateNetwork === true,
  })
}

async function diagnose(deps: PlatformBridgeDeps, appId: string, params: Record<string, unknown>) {
  if (params.mode !== 'published') {
    const project = await deps.subAppPackageService.status(appId)
    return {
      appId,
      mode: 'draft',
      ready: project.validation.readyToPublish,
      package: project.validation,
      service: deps.subAppPlatformRepo.getServiceState(appId),
      diagnostics: project.validation.diagnostics,
    }
  }
  const published = deps.subAppPlatformRepo.getPublishedPackage(appId)
  return {
    appId,
    mode: 'published',
    ready: published != null,
    package: published,
    service: deps.subAppPlatformRepo.getServiceState(appId),
    diagnostics:
      published == null
        ? [{ level: 'error', code: 'RELEASE_MISSING', message: 'No active V2 release' }]
        : [],
  }
}

function requireRuntime(
  deps: PlatformBridgeDeps,
): NonNullable<PlatformBridgeDeps['subAppRuntime']> {
  if (deps.subAppRuntime == null) throw new Error('Sub-app runtime is unavailable')
  return deps.subAppRuntime
}
function handled(value: unknown): SubAppV2BridgeResult {
  return { handled: true, value }
}
function requiredText(params: Record<string, unknown>, key: string, max: number): string {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Invalid parameter: ${key}`)
  return value.trim()
}
function revision(params: Record<string, unknown>): number {
  const value = params.expectedDraftRevision
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new Error('Invalid expectedDraftRevision')
  return value
}
function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('Expected string array')
  return value
}
function isJobStatus(value: unknown): value is SubAppJobStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  )
}
