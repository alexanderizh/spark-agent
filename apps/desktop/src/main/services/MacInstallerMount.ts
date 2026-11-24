import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { dirname, normalize } from 'node:path'
import { promisify } from 'node:util'
import { fingerprintInstallerImage, type MacInstallerReceipt } from './MacInstallerReceipt.js'

export interface MacInstallerMount {
  mountPath: string
  deviceNode: string
}

const execFileAsync = promisify(execFile)
const HDIUTIL = '/usr/bin/hdiutil'

export function runMacInstallerCommand(file: string, args: string[], input?: string) {
  const command = execFileAsync(file, args, { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 })
  // plutil accepts the plist on stdin. Ignore EPIPE if the child exits before consuming it.
  if (input != null) {
    command.child.stdin?.on('error', () => {})
    command.child.stdin?.end(input)
  }
  return command
}

export async function readPlistAsJson(file: string, input?: string): Promise<unknown> {
  const { stdout } = await runMacInstallerCommand(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', file],
    input,
  )
  return JSON.parse(stdout) as unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function findReadOnlyInstallerMount(
  info: unknown,
  imagePath: string,
): MacInstallerMount | null {
  const images = record(info)?.images
  if (!Array.isArray(images)) return null
  const matches = images.map(record).filter((image) => image?.['image-path'] === imagePath)
  const image = matches[0]
  if (matches.length !== 1 || image?.writeable !== false) return null
  // An image with a shadow file can have writes even if its original file is read-only.
  if (image['shadow-path'] != null) return null
  const entities = image['system-entities']
  if (!Array.isArray(entities)) return null
  const mounted = entities.map(record).filter((entity) => entity?.['mount-point'] != null)
  if (mounted.length !== 1) return null
  const mountPath = mounted[0]?.['mount-point']
  const deviceNode = mounted[0]?.['dev-entry']
  if (
    typeof mountPath !== 'string' ||
    normalize(mountPath) !== mountPath ||
    dirname(mountPath) !== '/Volumes' ||
    typeof deviceNode !== 'string' ||
    !/^\/dev\/disk\d+(?:s\d+)*$/.test(deviceNode)
  )
    return null
  return { mountPath, deviceNode }
}

export async function getReadOnlyInstallerMount(
  receipt: MacInstallerReceipt,
): Promise<MacInstallerMount | null> {
  if (fingerprintInstallerImage(receipt.imagePath) !== receipt.fingerprint) return null
  const { stdout } = await runMacInstallerCommand(HDIUTIL, ['info', '-plist'])
  const mount = findReadOnlyInstallerMount(await readPlistAsJson('-', stdout), receipt.imagePath)
  if (mount == null || (await realpath(mount.mountPath)) !== mount.mountPath) return null

  const { stdout: diskInfo } = await runMacInstallerCommand('/usr/sbin/diskutil', [
    'info',
    '-plist',
    mount.deviceNode,
  ])
  const disk = record(await readPlistAsJson('-', diskInfo))
  if (
    disk?.DeviceNode !== mount.deviceNode ||
    disk.MountPoint !== mount.mountPath ||
    disk.WritableVolume !== false
  )
    return null
  return mount
}

export async function detachMacInstaller(mount: MacInstallerMount): Promise<void> {
  // Busy volumes must remain attached for a later attempt. Address the checked device.
  await runMacInstallerCommand(HDIUTIL, ['detach', mount.deviceNode])
}
