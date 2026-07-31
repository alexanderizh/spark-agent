import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const serverPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'quick-replies-mcp-server.mjs',
)

class RpcClient {
  private nextId = 1
  private readonly pending = new Map<number, (value: any) => void>()
  private readonly rl: readline.Interface

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.rl = readline.createInterface({ input: child.stdout })
    this.rl.on('line', (line) => {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown }
      if (message.id == null) return
      this.pending.get(message.id)?.(message.result ?? { error: message.error })
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

describe('quick-replies MCP server', () => {
  let child: ChildProcessWithoutNullStreams
  let rpc: RpcClient

  beforeAll(async () => {
    child = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    rpc = new RpcClient(child)
    await rpc.call('initialize', {})
  })

  afterAll(() => {
    rpc?.dispose()
    child?.kill()
  })

  it('exposes one optional quick-reply tool with a four-item limit', async () => {
    const response = await rpc.call('tools/list')
    expect(response.tools).toMatchObject([
      {
        name: 'suggest_replies',
        inputSchema: {
          properties: { replies: { minItems: 1, maxItems: 4 } },
        },
      },
    ])
  })

  it('trims, deduplicates, limits, and length-bounds replies', async () => {
    const longReply =
      '这是一个明显超过四十个字符限制因此必须由工具在返回之前进行截断处理的快捷回复文本'
    const response = await rpc.call('tools/call', {
      name: 'suggest_replies',
      arguments: {
        replies: [' 确认无误 ', '确认无误', longReply, '需要调整', '先暂停', '继续讨论'],
      },
    })
    const payload = JSON.parse(response.content[0].text)

    expect(payload.replies).toEqual(['确认无误', longReply.slice(0, 40), '需要调整', '先暂停'])
  })
})
