// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { SUB_APP_PROTOCOL_VERSION } from '@spark/protocol'
import { SubAppBridgeHost } from './bridgeHost'
import type { SparkAppThemeState } from '@spark/protocol'

const appId = '0b6f6c46-63f5-4a1e-8f74-9a92d68e6a11'
const versionId = 'draft-0b6f6c46'
const instanceId = 'inst-0001'

const themeState: SparkAppThemeState = {
  theme: 'dark',
  tokens: { colorPrimary: '#6366f1' },
  primaryColor: '#6366f1',
  fontSize: 14,
  reducedMotion: false,
}

interface Harness {
  host: SubAppBridgeHost
  frame: { postMessage: Mock }
  invoke: Mock
  send: (data: unknown, source?: unknown) => void
  flush: () => Promise<void>
}

function createHarness(permissions: string[] = ['data']): Harness {
  const frame = { postMessage: vi.fn() }
  const invoke = vi.fn()
  const host = new SubAppBridgeHost({
    runtimeInfo: {
      appId,
      name: '测试应用',
      description: '',
      surface: 'content',
      entry: 'index.html',
      versionId,
      instanceId,
      mode: 'draft',
      permissions,
    },
    getFrameWindow: () => frame as unknown as Window,
    invoke: invoke as never,
    getThemeState: () => themeState,
  })
  host.attach(window)
  const send = (data: unknown, source: unknown = frame): void => {
    window.dispatchEvent(
      new MessageEvent('message', { data: data as object, source: source as Window }),
    )
  }
  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { host, frame, invoke, send, flush }
}

function requestMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'app/request',
    instanceId,
    request: {
      protocolVersion: SUB_APP_PROTOCOL_VERSION,
      appId,
      versionId,
      instanceId,
      requestId: 'req-1',
      capability: 'data',
      operation: 'get',
      payload: { namespace: 'user', key: 'name' },
      ...overrides,
    },
  }
}

interface OutboundMessage {
  type: string
  instanceId: string
  theme?: SparkAppThemeState
  response?: {
    ok: boolean
    error?: { code: string; message?: string }
    data?: unknown
  }
}

/** 取第 index 条宿主回发消息（noUncheckedIndexedAccess 收窄）。 */
function outboundAt(frame: { postMessage: Mock }, index = 0): OutboundMessage {
  const call = frame.postMessage.mock.calls[index]
  if (call == null) throw new Error(`expected outbound message #${index}`)
  return call[0] as OutboundMessage
}

let harness: Harness

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.host.detach(window)
})

describe('SubAppBridgeHost 消息安全', () => {
  it('非本 iframe 的消息直接丢弃', async () => {
    const stranger = { postMessage: vi.fn() }
    harness.send(requestMessage(), stranger)
    await harness.flush()
    expect(harness.frame.postMessage).not.toHaveBeenCalled()
    expect(harness.invoke).not.toHaveBeenCalled()
  })

  it('不符合 schema 的消息丢弃且不回发', async () => {
    harness.send({ type: 'app/request', instanceId: 'other' })
    harness.send('not-an-object')
    harness.send({ type: 'app/ready', instanceId, protocolVersion: 99, extra: 1 })
    await harness.flush()
    expect(harness.frame.postMessage).not.toHaveBeenCalled()
  })

  it('instanceId 不匹配当前实例的消息丢弃', async () => {
    const message = requestMessage()
    ;(message as { instanceId: string }).instanceId = 'inst-other'
    message.request = { ...(message.request as object), instanceId: 'inst-other' } as never
    harness.send(message)
    await harness.flush()
    expect(harness.frame.postMessage).not.toHaveBeenCalled()
  })

  it('应用自报 appId 与宿主裁决不一致时返回 IDENTITY_MISMATCH', async () => {
    const message = requestMessage()
    message.request = {
      ...(message.request as object),
      appId: '11111111-2222-3333-4444-555555555555',
    } as never
    harness.send(message)
    await harness.flush()
    expect(harness.frame.postMessage).toHaveBeenCalledTimes(1)
    const outbound = outboundAt(harness.frame)
    expect(outbound.type).toBe('host/response')
    expect(outbound.response?.ok).toBe(false)
    expect(outbound.response?.error?.code).toBe('IDENTITY_MISMATCH')
  })
})

describe('SubAppBridgeHost 权限与路由', () => {
  it('未声明 data 权限的应用调用 data 域返回 PERMISSION_DENIED', async () => {
    const restricted = createHarness([])
    try {
      restricted.send(requestMessage())
      await restricted.flush()
      expect(restricted.invoke).not.toHaveBeenCalled()
      const outbound = outboundAt(restricted.frame)
      expect(outbound.response?.error?.code).toBe('PERMISSION_DENIED')
    } finally {
      restricted.host.detach(window)
    }
  })

  it('runtime/theme 只读能力无需权限声明即可访问', async () => {
    const restricted = createHarness([])
    try {
      const infoMessage = requestMessage()
      infoMessage.request = {
        ...(infoMessage.request as object),
        capability: 'runtime',
        operation: 'getInfo',
        payload: null,
      } as never
      restricted.send(infoMessage)
      const themeMessage = requestMessage()
      themeMessage.request = {
        ...(themeMessage.request as object),
        capability: 'theme',
        operation: 'get',
        payload: null,
        requestId: 'req-2',
      } as never
      restricted.send(themeMessage)
      await restricted.flush()
      expect(restricted.frame.postMessage.mock.calls).toHaveLength(2)
      expect(outboundAt(restricted.frame, 0).response?.ok).toBe(true)
      expect(outboundAt(restricted.frame, 1).response?.ok).toBe(true)
    } finally {
      restricted.host.detach(window)
    }
  })

  it('data/get 用宿主裁决的 appId 转发并回传数据', async () => {
    harness.invoke.mockResolvedValue({ namespace: 'user', key: 'name', value: 'spark' })
    harness.send(requestMessage())
    await harness.flush()
    expect(harness.invoke).toHaveBeenCalledWith('sub-app:data:get', {
      appId,
      namespace: 'user',
      key: 'name',
    })
    const outbound = outboundAt(harness.frame)
    expect(outbound.response?.ok).toBe(true)
    expect(outbound.response?.data).toEqual({ namespace: 'user', key: 'name', value: 'spark' })
  })

  it('data/upsert 冲突时透传 IPC 错误码 CONFLICT', async () => {
    const conflict = Object.assign(new Error('子应用数据已被其他操作更新'), { code: 'CONFLICT' })
    harness.invoke.mockRejectedValue(conflict)
    const message = requestMessage()
    message.request = {
      ...(message.request as object),
      operation: 'upsert',
      payload: { namespace: 'user', key: 'name', value: 'x', expectedRevision: 3 },
    } as never
    harness.send(message)
    await harness.flush()
    expect(harness.invoke).toHaveBeenCalledWith('sub-app:data:upsert', {
      appId,
      namespace: 'user',
      key: 'name',
      value: 'x',
      expectedRevision: 3,
    })
    const outbound = outboundAt(harness.frame)
    expect(outbound.response?.ok).toBe(false)
    expect(outbound.response?.error?.code).toBe('CONFLICT')
  })

  it('未知操作返回 UNSUPPORTED_OPERATION', async () => {
    const message = requestMessage()
    message.request = { ...(message.request as object), operation: 'drop' } as never
    harness.send(message)
    await harness.flush()
    const outbound = outboundAt(harness.frame)
    expect(outbound.response?.error?.code).toBe('UNSUPPORTED_OPERATION')
  })

  it('已声明但未实现的能力域返回 CAPABILITY_NOT_IMPLEMENTED', async () => {
    const extended = createHarness(['data', 'files'])
    try {
      const message = requestMessage()
      message.request = {
        ...(message.request as object),
        capability: 'files',
        operation: 'read',
        payload: null,
      } as never
      extended.send(message)
      await extended.flush()
      const outbound = outboundAt(extended.frame)
      expect(outbound.response?.error?.code).toBe('CAPABILITY_NOT_IMPLEMENTED')
    } finally {
      extended.host.detach(window)
    }
  })
})

describe('SubAppBridgeHost 生命周期', () => {
  it('app/ready 后标记就绪并立即推送主题', async () => {
    harness.send({ type: 'app/ready', instanceId, protocolVersion: SUB_APP_PROTOCOL_VERSION })
    await harness.flush()
    expect(harness.host.isReady()).toBe(true)
    const themeCalls = harness.frame.postMessage.mock.calls as unknown as Array<
      [OutboundMessage, string]
    >
    const themePush = themeCalls.find((call) => call[0].type === 'host/theme')
    expect(themePush).toBeTruthy()
    expect(themePush?.[0].theme).toEqual(themeState)
  })

  it('协议版本不一致的 app/ready 收到 PROTOCOL_VERSION_MISMATCH', async () => {
    harness.send({ type: 'app/ready', instanceId, protocolVersion: 99 })
    await harness.flush()
    const outbound = outboundAt(harness.frame)
    expect(outbound.type).toBe('host/response')
    expect(outbound.response?.error?.code).toBe('PROTOCOL_VERSION_MISMATCH')
    expect(harness.host.isReady()).toBe(false)
  })

  it('detach 后不再处理任何消息', async () => {
    harness.host.detach(window)
    harness.send({ type: 'app/ready', instanceId, protocolVersion: SUB_APP_PROTOCOL_VERSION })
    await harness.flush()
    expect(harness.host.isReady()).toBe(false)
    expect(harness.frame.postMessage).not.toHaveBeenCalled()
  })

  it('审计记录包含能力、操作与错误码', async () => {
    const message = requestMessage()
    message.request = { ...(message.request as object), operation: 'drop' } as never
    harness.send(message)
    await harness.flush()
    const entries = harness.host.getAuditEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      capability: 'data',
      operation: 'drop',
      ok: false,
      errorCode: 'UNSUPPORTED_OPERATION',
    })
  })
})
