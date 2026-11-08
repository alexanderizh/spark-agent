import { constants } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createLogger } from '@spark/shared'
import type { SDKExecutorConfig } from './types.js'

const log = createLogger('codex-home')
type CodexHomeConfig = Pick<SDKExecutorConfig, 'customEnv' | 'codexCliProvider' | 'useLocalConfig'>

const THREAD_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

function explicitCodexHome(config: CodexHomeConfig): string | undefined {
  return [config.customEnv?.CODEX_HOME, config.codexCliProvider?.env?.CODEX_HOME]
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim()
}

/** Host configuration is used only by the explicitly selected local CLI channel. */
export function resolveCodexHome(config: CodexHomeConfig): string {
  const configured = explicitCodexHome(config)
  if (configured != null) return resolve(configured)
  if (config.useLocalConfig === true && config.codexCliProvider == null) {
    return resolve(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
  }
  return resolve(
    process.env.SPARK_CODEX_HOME?.trim() || join(homedir(), '.spark-agent', 'codex-home'),
  )
}

/** Set only the child configuration; never change the host environment or share auth.json. */
export async function withCodexHome(config: SDKExecutorConfig): Promise<SDKExecutorConfig> {
  const codexHome = resolveCodexHome(config)
  const created = await mkdir(codexHome, { recursive: true, mode: 0o700 })
  if (created != null && config.useLocalConfig !== true) {
    log.info('Initialized isolated Codex runtime home', { codexHome })
  }
  if (config.continueSession === true && explicitCodexHome(config) == null) {
    const sourceHome = resolve(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
    const threadId = config.sdkSessionId
    if (sourceHome !== codexHome && threadId != null && THREAD_ID.test(threadId)) {
      await copyLegacyRollout(sourceHome, codexHome, threadId)
    }
  }
  return { ...config, customEnv: { ...config.customEnv, CODEX_HOME: codexHome } }
}

/** Copy a single requested rollout, without importing the user's auth, config or state database. */
async function copyLegacyRollout(
  sourceHome: string,
  targetHome: string,
  threadId: string,
): Promise<void> {
  const suffix = `-${threadId}.jsonl`
  // Codex rollouts live under sessions/YYYY/MM/DD; archived rollouts may be flat.
  for (const folder of ['sessions', 'archived_sessions']) {
    if ((await findRollout(join(targetHome, folder), suffix)) != null) return
  }
  for (const folder of ['sessions', 'archived_sessions']) {
    const source = await findRollout(join(sourceHome, folder), suffix)
    if (source == null) continue
    // Preserve the date hierarchy used by Codex's rollout discovery.
    const target = join(targetHome, 'sessions', relative(join(sourceHome, folder), source.path))
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    try {
      await copyFile(source.path, target, constants.COPYFILE_EXCL)
      log.info('Copied requested legacy Codex rollout into Spark home', { threadId })
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }
    return
  }
}

async function findRollout(
  directory: string,
  suffix: string,
  depth = 0,
): Promise<{ path: string; name: string } | null> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(suffix)) {
      return { path: join(directory, entry.name), name: entry.name }
    }
    // Do not follow symlinks or walk unrelated directories in the user's Codex home.
    if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) {
      const found = await findRollout(join(directory, entry.name), suffix, depth + 1)
      if (found != null) return found
    }
  }
  return null
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error != null && typeof error === 'object' && 'code' in error && error.code === code
}
