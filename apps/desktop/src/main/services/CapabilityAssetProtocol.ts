import { protocol, type CustomScheme } from 'electron'
import { lstat, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { getOptionalCapabilityManager } from '../ipc/registerOptionalCapabilityIpc.js'
import { createSafeFileResponse } from './SafeFileProtocol.js'

export const CAPABILITY_ASSET_SCHEME = 'capability-asset'

export const CAPABILITY_ASSET_PRIVILEGED_SCHEME: CustomScheme = {
  scheme: CAPABILITY_ASSET_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}

type ResolveAssetRoot = (capabilityId: 'office-viewer') => Promise<string | null>

export async function resolveCapabilityAssetPath(
  requestUrl: string,
  resolveRoot: ResolveAssetRoot,
): Promise<string> {
  const url = new URL(requestUrl)
  if (url.protocol !== `${CAPABILITY_ASSET_SCHEME}:` || url.hostname !== 'office-viewer') {
    throw new Error('Unsupported capability asset URL')
  }
  const encodedSegments = rawPathSegments(requestUrl)
  const segments = encodedSegments.map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new Error('Capability asset path traversal is forbidden')
    }
    return decoded
  })
  if (segments.length === 0) throw new Error('Capability asset path is empty')

  const root = await resolveRoot('office-viewer')
  if (!root) throw new Error('Office Viewer capability is not installed')
  const target = resolve(root, ...segments)
  const lexicalRoot = resolve(root)
  if (!target.startsWith(lexicalRoot + sep)) {
    throw new Error('Capability asset path traversal is forbidden')
  }
  const stats = await lstat(target)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Capability asset symlink escape is forbidden')
  }
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)])
  if (!canonicalTarget.startsWith(canonicalRoot + sep)) {
    throw new Error('Capability asset symlink escape is forbidden')
  }
  return target
}

export function registerCapabilityAssetProtocol(): void {
  protocol.handle(CAPABILITY_ASSET_SCHEME, async (request) => {
    try {
      const filePath = await resolveCapabilityAssetPath(request.url, async () =>
        getOptionalCapabilityManager().getArtifactDirectory(
          'office-viewer',
          'archive.optional-office-viewer-',
        ),
      )
      return createSafeFileResponse(filePath, request)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const missing = message.includes('not installed') || (error as NodeJS.ErrnoException).code === 'ENOENT'
      return new Response(missing ? 'Not Found' : 'Forbidden', { status: missing ? 404 : 403 })
    }
  })
}

function rawPathSegments(requestUrl: string): string[] {
  const withoutScheme = requestUrl.slice(`${CAPABILITY_ASSET_SCHEME}://`.length)
  const slash = withoutScheme.indexOf('/')
  if (slash < 0) return []
  const rawPath = withoutScheme.slice(slash + 1).split(/[?#]/, 1)[0] ?? ''
  return rawPath.split('/').filter(Boolean)
}
