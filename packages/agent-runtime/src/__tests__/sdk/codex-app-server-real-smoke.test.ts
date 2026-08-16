import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { CodexAppServerExecutor } from '../../sdk/codex-app-server/codex-app-server-executor.js'
import { resolveManagedCodexCli } from '../../sdk/codex-runtime.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

/**
 * 真实 codex 二进制 + 本地 mock Responses SSE 服务器的端到端冒烟。
 *
 * 默认跳过；满足以下条件时运行（升级 codex 受管运行时后的手动验收工具）：
 *   SPARK_CODEX_APPSERVER_SMOKE=1 且受管 codex 运行时（SPARK_CODEX_RUNTIME_ROOT）可用。
 *
 * 验证的是「exec 载具丢流式」的修复落点：mock 逐 token 推流（10 delta × 300ms），
 * 断言 executor 收到 ≥8 条 delta 且时间跨度 ≥1.5s——即真流式而非完成后一次性全文。
 */

const RUN_SMOKE = process.env.SPARK_CODEX_APPSERVER_SMOKE === '1'
const MANAGED = resolveManagedCodexCli()

const DELTAS = [
  'Hello ',
  'from ',
  'the ',
  'mock ',
  'streaming ',
  'server. ',
  'Token ',
  'by ',
  'token ',
  'output.',
]
const DELAY_MS = 300

function startMockResponsesServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !(req.url ?? '').includes('/responses')) {
      res.writeHead(404)
      res.end()
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      void body
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      const msgId = 'msg_1'
      send('response.created', {
        type: 'response.created',
        response: {
          id: 'resp_1',
          object: 'response',
          status: 'in_progress',
          model: 'mock-gpt',
          output: [],
        },
      })
      send('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: msgId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      })
      let full = ''
      let index = 0
      const tick = (): void => {
        if (index < DELTAS.length) {
          const delta = DELTAS[index]
          index += 1
          full += delta
          send('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: msgId,
            output_index: 0,
            content_index: 0,
            delta,
          })
          setTimeout(tick, DELAY_MS)
          return
        }
        send('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: full, annotations: [] }],
          },
        })
        send('response.completed', {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            object: 'response',
            status: 'completed',
            model: 'mock-gpt',
            output: [
              {
                id: msgId,
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: full, annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: DELTAS.length,
              total_tokens: 10 + DELTAS.length,
            },
          },
        })
        res.end()
      }
      setTimeout(tick, DELAY_MS)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address != null ? address.port : 0
      resolve({ server, port })
    })
  })
}

describe.skipIf(!RUN_SMOKE || MANAGED == null)('CodexAppServerExecutor 真实二进制冒烟', () => {
  let mock: { server: Server; port: number }
  let codexHome: string
  let previousCodexHome: string | undefined
  let previousApiKey: string | undefined

  beforeAll(async () => {
    mock = await startMockResponsesServer()
    codexHome = await mkdtemp(join(tmpdir(), 'codex-as-smoke-home-'))
    previousCodexHome = process.env.CODEX_HOME
    previousApiKey = process.env.MOCK_API_KEY
    process.env.CODEX_HOME = codexHome
    process.env.MOCK_API_KEY = 'smoke-test-key'
  })

  afterAll(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodexHome
    if (previousApiKey === undefined) delete process.env.MOCK_API_KEY
    else process.env.MOCK_API_KEY = previousApiKey
    await new Promise<void>((resolve) => mock.server.close(() => resolve()))
    await rm(codexHome, { recursive: true, force: true }).catch(() => undefined)
  })

  afterEach(() => {
    // 进程内无共享状态需要清理；占位保持对称。
  })

  it('端到端：mock 逐 token 推流 → executor 逐 delta 事件（时间跨度证明真流式）', async () => {
    const executablePath = MANAGED?.executablePath
    expect(executablePath).toBeTruthy()
    const config: SDKExecutorConfig = {
      apiKey: 'smoke-test-key',
      model: 'mock-gpt',
      permissionMode: 'codex-default',
      workspaceRootPath: tmpdir(),
      codexCliProvider: {
        id: 'mocksmoke',
        name: 'Mock Smoke Provider',
        wireApi: 'responses',
        baseUrl: `http://127.0.0.1:${mock.port}/v1`,
        envKey: 'MOCK_API_KEY',
      },
    }
    const executor = new CodexAppServerExecutor({
      executablePath: executablePath ?? process.execPath,
      handshakeTimeoutMs: 20_000,
    })
    const events: AgentEvent[] = []
    const deltaTimestamps: number[] = []
    executor.onEvent((event) => {
      events.push(event)
      if (event.type === 'assistant_message' && event.mode === 'delta') {
        deltaTimestamps.push(Date.now())
      }
    })
    await executor.executeTurn('smoke-session-1', 'smoke-turn-1', 'say hi', config)

    const deltas = events.filter(
      (event): event is Extract<AgentEvent, { type: 'assistant_message' }> =>
        event.type === 'assistant_message' && event.mode === 'delta',
    )
    expect(deltas.length).toBeGreaterThanOrEqual(8)
    const firstDelta = deltaTimestamps[0]
    const lastDelta = deltaTimestamps.at(-1)
    expect(firstDelta).toBeDefined()
    expect(lastDelta).toBeDefined()
    const spread = (lastDelta ?? 0) - (firstDelta ?? 0)
    expect(spread).toBeGreaterThanOrEqual(1_500)

    const finalComplete = events.find(
      (event) =>
        event.type === 'assistant_message' &&
        event.mode === 'complete' &&
        (event as { isFinal?: boolean }).isFinal === true,
    )
    expect((finalComplete as { content?: string } | undefined)?.content).toContain('Token by token')
    const statuses = events.filter((event) => event.type === 'agent_status')
    expect(statuses.at(-1)).toMatchObject({ status: 'completed' })
  }, 90_000)
})
