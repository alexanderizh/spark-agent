import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.resolve(here, 'present-files-mcp-server.mjs')

class RpcClient {
  private nextId = 1
  private readonly pending = new Map<number, (value: any) => void>()
  private readonly rl: readline.Interface

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.rl = readline.createInterface({ input: child.stdout })
    this.rl.on('line', (line) => {
      const message = JSON.parse(line) as { id?: number; result?: unknown }
      if (message.id == null) return
      this.pending.get(message.id)?.(message.result)
      this.pending.delete(message.id)
    })
  }

  call(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  dispose(): void {
    this.rl.close()
  }
}

describe('present-files MCP server', () => {
  let workspace: string
  let outsideFile: string
  let child: ChildProcessWithoutNullStreams
  let rpc: RpcClient

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'spark-present-files-'))
    await mkdir(path.join(workspace, 'output'))
    await writeFile(path.join(workspace, 'output', 'report.pdf'), 'report')
    await writeFile(path.join(workspace, '..notes.txt'), 'notes')
    outsideFile = path.join(os.tmpdir(), `spark-outside-${Date.now()}.txt`)
    await writeFile(outsideFile, 'outside')
    if (process.platform !== 'win32') {
      await symlink(outsideFile, path.join(workspace, 'output', 'outside-link.txt'))
    }
    child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, SPARK_WORKSPACE_ROOT: workspace },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    rpc = new RpcClient(child)
    await rpc.call('initialize', {})
  })

  afterAll(() => {
    rpc?.dispose()
    child?.kill()
  })

  it('lists the explicit presentation tool', async () => {
    const response = await rpc.call('tools/list')
    expect(response.tools).toMatchObject([{ name: 'present_files' }])
  })

  it('accepts workspace files and rejects paths outside the workspace', async () => {
    const requestedFiles = [
      { path: 'output/report.pdf', title: 'Report' },
      { path: '..notes.txt' },
      { path: outsideFile },
      { path: 'output' },
      ...(process.platform !== 'win32' ? [{ path: 'output/outside-link.txt' }] : []),
    ]
    const response = await rpc.call('tools/call', {
      name: 'present_files',
      arguments: {
        files: requestedFiles,
      },
    })
    const payload = JSON.parse(response.content[0].text)

    expect(payload.files).toEqual([
      { path: await realpath(path.join(workspace, 'output', 'report.pdf')), title: 'Report' },
      { path: await realpath(path.join(workspace, '..notes.txt')) },
    ])
    expect(payload.rejected).toHaveLength(requestedFiles.length - 2)
  })
})
