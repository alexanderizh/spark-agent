import { existsSync } from 'node:fs'
import { delimiter, posix, win32 } from 'node:path'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'

interface ResolveStandaloneNodeInput {
  packaged: boolean
  resourcesPath: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  processExecutable: string
  exists: (candidate: string) => boolean
  systemNodePath?: string | null
}

export function resolveStandaloneNodeRuntimePath(input?: ResolveStandaloneNodeInput): string {
  const runtime =
    input ??
    ({
      packaged: app?.isPackaged === true,
      resourcesPath: process.resourcesPath ?? '',
      platform: process.platform,
      env: process.env,
      processExecutable: process.execPath,
      exists: existsSync,
      systemNodePath:
        process.versions.electron == null ? process.execPath : findSystemNodeExecutable(),
    } satisfies ResolveStandaloneNodeInput)
  const pathApi = runtime.platform === 'win32' ? win32 : posix
  const explicit = runtime.env.SPARK_STANDALONE_NODE?.trim()
  const packaged =
    runtime.resourcesPath === '' || runtime.resourcesPath == null
      ? null
      : pathApi.join(
          runtime.resourcesPath,
          'runtime',
          'node',
          runtime.platform === 'win32' ? 'node.exe' : 'node',
        )
  const candidates = runtime.packaged
    ? [packaged]
    : [explicit, runtime.systemNodePath]
  for (const candidate of candidates) {
    if (
      candidate != null &&
      candidate !== '' &&
      candidate !== runtime.processExecutable &&
      runtime.exists(candidate)
    ) {
      return candidate
    }
  }
  if (!runtime.packaged && process.versions.electron == null && runtime.exists(runtime.processExecutable)) {
    return runtime.processExecutable
  }
  throw new Error(
    'A separately packaged standalone Node runtime is required; the Electron executable cannot be used as Node',
  )
}

function findSystemNodeExecutable(): string | null {
  const command = process.platform === 'win32' ? 'where.exe' : '/usr/bin/which'
  const result = spawnSync(command, ['node'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: process.env.PATH?.split(delimiter).join(delimiter) },
    windowsHide: true,
    timeout: 3_000,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return null
  return result.stdout.split(/\r?\n/u).map((value) => value.trim()).find(Boolean) ?? null
}
