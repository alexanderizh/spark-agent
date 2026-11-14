import { describe, expect, it } from 'vitest'
import type { SDKMcpServerConfig } from '../../../sdk/index.js'
import type { SdkMcpToolResult } from '../../../sdk/claude-sdk-executor.js'
import {
  NOTIFY_USER_MAX_PER_TURN,
  buildNotifyMcpServer,
  type NotifyUserResult,
  type RemotePushProvider,
  type SdkMcpServerFactory,
} from './notify-server.js'

type RecordedTool = {
  name: string
  description: string
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<SdkMcpToolResult>
}

/** 收集 tool 注册参数的假 SDK 工厂：不依赖 @anthropic-ai/claude-agent-sdk。 */
function createStubFactory(): { factory: SdkMcpServerFactory; tools: RecordedTool[] } {
  const tools: RecordedTool[] = []
  const factory: SdkMcpServerFactory = {
    createSdkMcpServer: (opts) =>
      ({ type: 'sdk', name: opts.name, version: opts.version }) as SDKMcpServerConfig,
    tool: (name, description, _inputSchema, handler) => {
      tools.push({ name, description, handler })
      return { name }
    },
  }
  return { factory, tools }
}

function stubProvider(
  result: NotifyUserResult,
  calls: Array<{ text: string; title?: string }> = [],
): RemotePushProvider {
  return {
    notifyUser: async (_sessionId, text, title) => {
      calls.push({ text, ...(title != null ? { title } : {}) })
      return result
    },
  }
}

async function invoke(handler: RecordedTool['handler'], args: Record<string, unknown>) {
  return handler(args, {})
}

describe('buildNotifyMcpServer', () => {
  it('registers spark_notify server with a single notify_user tool', () => {
    const { factory, tools } = createStubFactory()
    const server = buildNotifyMcpServer(
      factory,
      stubProvider({
        delivered: [{ label: 'TG', channel: 'telegram' }],
        failures: [],
        fallbackDesktop: false,
      }),
      { sessionId: 's1' },
    )
    expect((server as { name?: string }).name).toBe('spark_notify')
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('notify_user')
    expect(tools[0]?.description).toContain(String(NOTIFY_USER_MAX_PER_TURN))
  })

  it('forwards sessionId/text/title to the provider and reports delivered targets', async () => {
    const { factory, tools } = createStubFactory()
    const calls: Array<{ text: string; title?: string }> = []
    buildNotifyMcpServer(
      factory,
      stubProvider(
        {
          delivered: [{ label: 'TG Bot', channel: 'telegram' }],
          failures: [],
          fallbackDesktop: false,
        },
        calls,
      ),
      { sessionId: 'session-1' },
    )
    const result = await invoke(tools[0]!.handler, { text: '构建完成', title: '任务状态' })
    expect(calls).toEqual([{ text: '构建完成', title: '任务状态' }])
    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([
      { type: 'text', text: 'Notification delivered to: TG Bot (telegram).' },
    ])
  })

  it('falls back wording for desktop notification results', async () => {
    const { factory, tools } = createStubFactory()
    buildNotifyMcpServer(
      factory,
      stubProvider({ delivered: [], failures: [], fallbackDesktop: true }),
      { sessionId: 's1' },
    )
    const result = await invoke(tools[0]!.handler, { text: 'done' })
    expect(result.content).toEqual([
      { type: 'text', text: 'Delivered via desktop system notification (no remote route bound).' },
    ])
  })

  it('reports partial failures channel by channel without exposing external ids', async () => {
    const { factory, tools } = createStubFactory()
    buildNotifyMcpServer(
      factory,
      stubProvider({
        delivered: [{ label: 'TG Bot', channel: 'telegram' }],
        failures: [{ label: '飞书 Bot', channel: 'feishu', error: 'fetch failed' }],
        fallbackDesktop: false,
      }),
      { sessionId: 's1' },
    )
    const result = await invoke(tools[0]!.handler, { text: 'hello' })
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? ''
    expect(text).toContain('Partially delivered')
    expect(text).toContain('TG Bot (telegram)')
    expect(text).toContain('飞书 Bot (feishu): fetch failed')
  })

  it('rejects empty text with isError', async () => {
    const { factory, tools } = createStubFactory()
    buildNotifyMcpServer(
      factory,
      stubProvider({ delivered: [], failures: [], fallbackDesktop: false }),
      { sessionId: 's1' },
    )
    const result = await invoke(tools[0]!.handler, { text: '   ' })
    expect(result.isError).toBe(true)
  })

  it('rate-limits after the per-turn maximum and guides merging', async () => {
    const { factory, tools } = createStubFactory()
    const calls: Array<{ text: string }> = []
    buildNotifyMcpServer(
      factory,
      stubProvider(
        { delivered: [{ label: 'TG', channel: 'telegram' }], failures: [], fallbackDesktop: false },
        calls,
      ),
      { sessionId: 's1' },
    )
    for (let i = 0; i < NOTIFY_USER_MAX_PER_TURN; i += 1) {
      const ok = await invoke(tools[0]!.handler, { text: `msg ${i}` })
      expect(ok.isError).toBeUndefined()
    }
    const limited = await invoke(tools[0]!.handler, { text: 'one more' })
    expect(limited.isError).toBe(true)
    const text = (limited.content as Array<{ text: string }>)[0]?.text ?? ''
    expect(text).toContain('Rate limit reached')
    expect(text).toContain(String(NOTIFY_USER_MAX_PER_TURN))
    // 频控拒绝的调用不应再触达 provider。
    expect(calls).toHaveLength(NOTIFY_USER_MAX_PER_TURN)
  })

  it('keeps the counter per server instance so each turn restarts fresh', async () => {
    const provider = stubProvider({ delivered: [], failures: [], fallbackDesktop: true })
    const first = createStubFactory()
    buildNotifyMcpServer(first.factory, provider, { sessionId: 's1' })
    for (let i = 0; i < NOTIFY_USER_MAX_PER_TURN; i += 1) {
      const ok = await invoke(first.tools[0]!.handler, { text: `turn1 msg ${i}` })
      expect(ok.isError).toBeUndefined()
    }
    // 第二个实例（下一轮）计数独立，仍可发满上限。
    const second = createStubFactory()
    buildNotifyMcpServer(second.factory, provider, { sessionId: 's1' })
    const ok = await invoke(second.tools[0]!.handler, { text: 'turn2 msg' })
    expect(ok.isError).toBeUndefined()
  })
})
