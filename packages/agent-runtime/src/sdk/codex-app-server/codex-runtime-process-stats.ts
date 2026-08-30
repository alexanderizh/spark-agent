import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'

export interface CodexRuntimeProcessStats {
  pid: number
  rssBytes: number | null
  handleCount: number | null
}

/** Best-effort, low-frequency process diagnostics. Never reads argv, env or open-file names. */
export async function readCodexRuntimeProcessStats(
  pid: number | undefined,
): Promise<CodexRuntimeProcessStats | null> {
  if (pid == null || !Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === 'linux') return readLinuxStats(pid)
  if (process.platform === 'darwin') return readDarwinStats(pid)
  if (process.platform === 'win32') return readWindowsStats(pid)
  return { pid, rssBytes: null, handleCount: null }
}

async function readLinuxStats(pid: number): Promise<CodexRuntimeProcessStats | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    const rssKb = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? Number.NaN)
    const handles = await readdir(`/proc/${pid}/fd`)
      .then((entries) => entries.length)
      .catch(() => null)
    return {
      pid,
      rssBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
      handleCount: handles,
    }
  } catch {
    return null
  }
}

async function readDarwinStats(pid: number): Promise<CodexRuntimeProcessStats | null> {
  const rss = await execFileText('ps', ['-o', 'rss=', '-p', String(pid)])
  if (rss == null || rss.trim().length === 0) return null
  const rssKb = Number(rss.trim())
  const lsof = await execFileText('lsof', ['-n', '-P', '-p', String(pid)])
  const handleCount =
    lsof == null ? null : Math.max(0, lsof.split('\n').filter((line) => line.length > 0).length - 1)
  return {
    pid,
    rssBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
    handleCount,
  }
}

async function readWindowsStats(pid: number): Promise<CodexRuntimeProcessStats | null> {
  const output = await execFileText('wmic', [
    'process',
    'where',
    `processid=${pid}`,
    'get',
    'WorkingSetSize,HandleCount',
    '/format:list',
  ])
  if (output == null) return null
  const rssBytes = Number(/^WorkingSetSize=(\d+)$/m.exec(output)?.[1] ?? Number.NaN)
  const handles = Number(/^HandleCount=(\d+)$/m.exec(output)?.[1] ?? Number.NaN)
  return {
    pid,
    rssBytes: Number.isFinite(rssBytes) ? rssBytes : null,
    handleCount: Number.isFinite(handles) ? handles : null,
  }
}

function execFileText(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: 2_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error == null ? stdout : null)
      },
    )
  })
}
