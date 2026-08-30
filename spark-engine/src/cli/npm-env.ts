import { execFile } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { satisfiesNodeEngines } from './install.js'

const execute = promisify(execFile)

export class NpmEnvError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'NpmEnvError'
  }
}

/**
 * Runs npm through the npm-cli.js that ships with the running node
 * installation when available, so the update flow never depends on PATH having
 * npm and never spawns a shell. Both official layouts are probed: a POSIX
 * (nvm/apt) install keeps it at `<node>/../lib/node_modules/npm`, Windows at
 * `<node>\node_modules\npm`. Falls back to the `npm` command otherwise; on
 * Windows a .cmd shim can only be spawned through a shell.
 */
async function npmInvocation(): Promise<{
  command: string
  prefixArgs: readonly string[]
  shell: boolean
}> {
  const nodeDir = dirname(process.execPath)
  const candidates =
    process.platform === 'win32'
      ? [join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : [
          join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        ]
  for (const bundled of candidates) {
    if (
      await readFile(bundled).then(
        () => true,
        () => false,
      )
    ) {
      return { command: process.execPath, prefixArgs: [bundled], shell: false }
    }
  }
  return process.platform === 'win32'
    ? { command: 'npm', prefixArgs: [], shell: true }
    : { command: 'npm', prefixArgs: [], shell: false }
}

export async function runNpm(
  args: readonly string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { command, prefixArgs, shell } = await npmInvocation()
  try {
    const { stdout, stderr } = await execute(command, [...prefixArgs, ...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(shell ? { shell: true } : {}),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    return { stdout, stderr }
  } catch (error) {
    const detail =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: string }).stderr)
        : ''
    throw new NpmEnvError(
      `npm ${args.join(' ')} failed${detail ? `:\n${detail.trim()}` : ''}`,
      error === undefined ? {} : { cause: error },
    )
  }
}

export async function npmGlobalRoot(): Promise<string> {
  const { stdout } = await runNpm(['root', '-g'])
  const root = stdout.trim()
  if (!root) throw new NpmEnvError('npm root -g returned an empty path')
  return root
}

export async function npmGlobalBin(): Promise<string> {
  const { stdout } = await runNpm(['prefix', '-g'])
  const prefix = stdout.trim()
  if (!prefix) throw new NpmEnvError('npm prefix -g returned an empty path')
  return process.platform === 'win32' ? prefix : join(prefix, 'bin')
}

export function globalPackageDir(npmRoot: string): string {
  return join(npmRoot, '@spark', 'agent')
}

export function npmRootForPrefix(
  prefix: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
}

export interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly nodeEngines?: string
}

export async function readPackageManifestAt(root: string): Promise<PackageManifest | undefined> {
  let raw: string
  try {
    raw = await readFile(join(root, 'package.json'), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    const engines = record.engines
    return {
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.version === 'string' ? { version: record.version } : {}),
      ...(typeof engines === 'object' &&
      engines !== null &&
      typeof (engines as { node?: unknown }).node === 'string'
        ? { nodeEngines: (engines as { node: string }).node }
        : {}),
    }
  } catch {
    return undefined
  }
}

const TARBALL_HARD_CAP = 512 * 1024 * 1024
const ARCHIVE_HARD_CAP = 768 * 1024 * 1024
const BLOCK_SIZE = 512

/**
 * Reads `package/package.json` out of an npm tarball without extracting it and
 * without any third-party tar dependency: gunzip (Node standard library) plus
 * a minimal ustar header walk. Only used for pre-install verification.
 */
export async function readTarballPackageManifest(
  tarballPath: string,
): Promise<{ manifest: PackageManifest; actualSha256: string }> {
  const { createHash } = await import('node:crypto')
  const bytes = await readFile(tarballPath)
  if (bytes.length > TARBALL_HARD_CAP) {
    throw new NpmEnvError(`tarball exceeds the ${TARBALL_HARD_CAP} byte limit`)
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')

  let archive: Buffer
  try {
    archive = gunzipSync(bytes, { maxOutputLength: ARCHIVE_HARD_CAP })
  } catch (error) {
    throw new NpmEnvError(
      `tarball is not valid gzip data: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  for (let offset = 0; offset + BLOCK_SIZE <= archive.length; ) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE)
    if (header.every((byte) => byte === 0)) break
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const sizeText = readTarString(header, 124, 12).trim()
    const size = parseInt(sizeText || '0', 8)
    if (!Number.isFinite(size) || size < 0) {
      throw new NpmEnvError(`tarball contains an unreadable entry header for ${fullName}`)
    }
    const typeFlag = String.fromCharCode(header[156] ?? 0)
    const dataStart = offset + BLOCK_SIZE
    if ((typeFlag === '0' || typeFlag === '\0') && fullName === 'package/package.json') {
      const body = archive.subarray(dataStart, dataStart + size)
      try {
        const parsed: unknown = JSON.parse(body.toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null) break
        const record = parsed as Record<string, unknown>
        const engines = record.engines
        return {
          manifest: {
            ...(typeof record.name === 'string' ? { name: record.name } : {}),
            ...(typeof record.version === 'string' ? { version: record.version } : {}),
            ...(typeof engines === 'object' &&
            engines !== null &&
            typeof (engines as { node?: unknown }).node === 'string'
              ? { nodeEngines: (engines as { node: string }).node }
              : {}),
          },
          actualSha256,
        }
      } catch (error) {
        throw new NpmEnvError(
          `tarball package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE
  }
  throw new NpmEnvError('tarball does not contain package/package.json')
}

function readTarString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length)
  const nul = slice.indexOf(0)
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8')
}

export function checkNodeCompatibility(nodeEngines: string | undefined): {
  ok: boolean
  detail?: string
} {
  const status = satisfiesNodeEngines(process.versions.node, nodeEngines)
  if (status.status === 'ok') return { ok: true }
  if (status.status === 'unmanaged') {
    return {
      ok: false,
      detail: `unable to verify the Node engine range "${nodeEngines ?? 'none'}" (only ">=x.y.z <a.b.c" bounds are supported)`,
    }
  }
  return { ok: false, ...(status.detail === undefined ? {} : { detail: status.detail }) }
}
