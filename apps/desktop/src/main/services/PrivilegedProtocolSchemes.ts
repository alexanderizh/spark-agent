import { protocol } from 'electron'
import { SAFE_FILE_PRIVILEGED_SCHEME } from './SafeFileProtocol.js'
import { SNAPSHOT_PRIVILEGED_SCHEME } from './computer-use/SnapshotProtocol.js'

/**
 * Electron only accepts one privileged-scheme registration call before app readiness.
 * Keep every application protocol in this single registry so later additions cannot
 * silently remove fetch/CORS/security privileges from protocols registered earlier.
 */
export function registerPrivilegedProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    SAFE_FILE_PRIVILEGED_SCHEME,
    SNAPSHOT_PRIVILEGED_SCHEME,
  ])
}
