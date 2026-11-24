import { randomUUID } from 'node:crypto'
import { realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'

export interface MacInstallerReceipt {
  imagePath: string
  targetVersion: string
  fingerprint: string
}

const RECEIPT_NAME = 'mac-installer-receipt.json'

/** Binds the receipt to the cached file, including replacement or modification in place. */
export function fingerprintInstallerImage(imagePath: string): string | null {
  try {
    const stat = statSync(imagePath, { bigint: true })
    if (!stat.isFile()) return null
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  } catch {
    return null
  }
}

/** Write before handing the installer to macOS. The receipt lives outside the pruned cache. */
export function recordMacInstaller(
  userData: string,
  imagePath: string,
  targetVersion: string,
): string {
  const resolvedImagePath = realpathSync(imagePath)
  const fingerprint = fingerprintInstallerImage(resolvedImagePath)
  if (fingerprint == null || extname(resolvedImagePath).toLowerCase() !== '.dmg') {
    throw new Error('Expected a local DMG file')
  }
  const receipt: MacInstallerReceipt = { imagePath: resolvedImagePath, targetVersion, fingerprint }
  const destination = join(userData, RECEIPT_NAME)
  const temporaryPath = `${destination}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, destination)
    return resolvedImagePath
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export async function readMacInstallerReceipt(
  userData: string,
): Promise<MacInstallerReceipt | null> {
  let raw: string
  try {
    raw = await readFile(join(userData, RECEIPT_NAME), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const receipt = JSON.parse(raw) as Partial<MacInstallerReceipt> | null
  if (
    typeof receipt?.imagePath !== 'string' ||
    !isAbsolute(receipt.imagePath) ||
    extname(receipt.imagePath).toLowerCase() !== '.dmg' ||
    typeof receipt.targetVersion !== 'string' ||
    receipt.targetVersion.length === 0 ||
    typeof receipt.fingerprint !== 'string'
  ) {
    throw new Error('Invalid macOS installer receipt')
  }
  return {
    imagePath: receipt.imagePath,
    targetVersion: receipt.targetVersion,
    fingerprint: receipt.fingerprint,
  }
}
