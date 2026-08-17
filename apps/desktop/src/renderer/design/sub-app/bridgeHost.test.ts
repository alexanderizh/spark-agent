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

function createHarness(
  permissions: string[] = ['data'],
  extra?: Partial<ConstructorParameters<typeof SubAppBridgeHost>[0]>,
): Harness {
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
    ...extra,
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

  it('data/list 转发 prefix、分页参数', async () => {
    harness.invoke.mockResolvedValue({ items: [], total: 0 })
    const message = requestMessage({
      operation: 'list',
      payload: { namespace: 'user', prefix: 'todo:', limit: 20, offset: 40 },
    })
    harness.send(message)
    await harness.flush()
    expect(harness.invoke).toHaveBeenCalledWith('sub-app:data:list', {
      appId,
      namespace: 'user',
      prefix: 'todo:',
      limit: 20,
      offset: 40,
    })
    expect(outboundAt(harness.frame).response?.ok).toBe(true)
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

  it('data/delete 转发到 sub-app:data:delete 通道', async () => {
    harness.invoke.mockResolvedValue({ deleted: true, appId, namespace: 'user', key: 'name' })
    const message = requestMessage()
    message.request = {
      ...(message.request as object),
      operation: 'delete',
      payload: { namespace: 'user', key: 'name', expectedRevision: 2 },
    } as never
    harness.send(message)
    await harness.flush()
    expect(harness.invoke).toHaveBeenCalledWith('sub-app:data:delete', {
      appId,
      namespace: 'user',
      key: 'name',
      expectedRevision: 2,
    })
    const outbound = outboundAt(harness.frame)
    expect(outbound.response?.ok).toBe(true)
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
    // clipboard 域协议已预留、宿主尚未路由——用它验证未实现分支
    const extended = createHarness(['data', 'clipboard'])
    try {
      const message = requestMessage()
      message.request = {
        ...(message.request as object),
        capability: 'clipboard',
        operation: 'write',
        payload: { text: 'x' },
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

describe('SubAppBridgeHost ui / navigation / 限流', () => {
  it('ui/toast 需要 ui 权限并在宿主展示 toast', async () => {
    const notify = vi.fn()
    const local = createHarness(['ui', 'data'], { notify })
    local.send(
      requestMessage({
        capability: 'ui',
        operation: 'toast',
        payload: { content: '保存成功', type: 'success' },
      }),
    )
    await local.flush()
    expect(notify).toHaveBeenCalledWith({ type: 'success', content: '保存成功' })
    expect(outboundAt(local.frame).response?.ok).toBe(true)
    local.host.detach(window)
  })

  it('ui/toast 未声明 ui 权限时拒绝且不触发宿主 toast', async () => {
    const notify = vi.fn()
    const local = createHarness(['data'], { notify })
    local.send(requestMessage({ capability: 'ui', operation: 'toast', payload: { content: 'x' } }))
    await local.flush()
    expect(notify).not.toHaveBeenCalled()
    expect(outboundAt(local.frame).response?.error?.code).toBe('PERMISSION_DENIED')
    local.host.detach(window)
  })

  it('ui/toast 非法 type 返回 INVALID_PAYLOAD', async () => {
    const local = createHarness(['ui'], { notify: vi.fn() })
    local.send(
      requestMessage({
        capability: 'ui',
        operation: 'toast',
        payload: { content: 'x', type: 'loud' },
      }),
    )
    await local.flush()
    expect(outboundAt(local.frame).response?.error?.code).toContain('INVALID_PAYLOAD')
    local.host.detach(window)
  })

  it('navigation/openApp 转发宿主导航并要求合法 uuid', async () => {
    const navigate = vi.fn(() => true)
    const local = createHarness(['navigation'], { navigate })
    local.send(
      requestMessage({ capability: 'navigation', operation: 'openApp', payload: { appId } }),
    )
    await local.flush()
    expect(navigate).toHaveBeenCalledWith({ kind: 'app', id: appId })
    expect(outboundAt(local.frame).response?.ok).toBe(true)

    local.send(
      requestMessage({
        capability: 'navigation',
        operation: 'openApp',
        payload: { appId: 'not-a-uuid' },
      }),
    )
    await local.flush()
    expect(outboundAt(local.frame, 1).response?.error?.code).toContain('INVALID_PAYLOAD')
    local.host.detach(window)
  })

  it('navigation/openView 被宿主拒绝时返回 NAVIGATION_REJECTED', async () => {
    const navigate = vi.fn(() => false)
    const local = createHarness(['navigation'], { navigate })
    local.send(
      requestMessage({
        capability: 'navigation',
        operation: 'openView',
        payload: { view: 'chat' },
      }),
    )
    await local.flush()
    expect(outboundAt(local.frame).response?.error?.code).toBe('NAVIGATION_REJECTED')
    local.host.detach(window)
  })

  it('宿主未提供回调时 ui/navigation 返回 CAPABILITY_NOT_IMPLEMENTED', async () => {
    const local = createHarness(['ui', 'navigation'])
    local.send(requestMessage({ capability: 'ui', operation: 'toast', payload: { content: 'x' } }))
    await local.flush()
    expect(outboundAt(local.frame).response?.error?.code).toBe('CAPABILITY_NOT_IMPLEMENTED')
    local.send(
      requestMessage({
        capability: 'navigation',
        operation: 'openView',
        payload: { view: 'board' },
      }),
    )
    await local.flush()
    expect(outboundAt(local.frame, 1).response?.error?.code).toBe('CAPABILITY_NOT_IMPLEMENTED')
    local.host.detach(window)
  })

  it('并发超过上限返回可重试的 RATE_LIMITED', async () => {
    let releaseInvoke: (() => void) | null = null
    const invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseInvoke = () => resolve(null)
        }),
    )
    const local = createHarness(['data'], { invoke: invoke as never })
    // 占满 8 条在途
    for (let i = 0; i < 8; i += 1) {
      local.send(requestMessage({ requestId: `hold-${i}` }))
    }
    await local.flush()
    // 第 9 条应被限流——前 8 条 invoke 未决、宿主尚未回发，所以这是第一条出站消息
    local.send(requestMessage({ requestId: 'over' }))
    await local.flush()
    const limited = outboundAt(local.frame, 0).response
    expect(limited?.ok).toBe(false)
    expect(limited?.error?.code).toBe('RATE_LIMITED')
    // failure 响应带 retryable=true
    expect(
      (local.frame.postMessage.mock.calls[0]?.[0] as { response?: { retryable?: boolean } })
        .response?.retryable,
    ).toBe(true)
    // TS 看不到 mock 回调内的赋值，收窄回可空调用
    ;(releaseInvoke as (() => void) | null)?.()
    local.host.detach(window)
  })
})

describe('SubAppBridgeHost files / agent / media / canvas / browser 域', () => {
  it('files/write 转发到 sub-app:file:write 并回传结果', async () => {
    const local = createHarness(['files'])
    try {
      local.invoke.mockResolvedValueOnce({ byteLength: 11, updatedAt: '2026-08-17T00:00:00Z' })
      local.send(
        requestMessage({
          capability: 'files',
          operation: 'write',
          payload: { path: 'notes/a.md', content: '# 你好' },
        }),
      )
      await local.flush()
      expect(local.invoke).toHaveBeenCalledWith('sub-app:file:write', {
        appId,
        path: 'notes/a.md',
        content: '# 你好',
      })
      expect(outboundAt(local.frame).response?.data).toEqual({
        byteLength: 11,
        updatedAt: '2026-08-17T00:00:00Z',
      })
    } finally {
      local.host.detach(window)
    }
  })

  it('files/write 缺 content 返回 INVALID_PAYLOAD:content', async () => {
    const local = createHarness(['files'])
    try {
      local.send(
        requestMessage({ capability: 'files', operation: 'write', payload: { path: 'a.md' } }),
      )
      await local.flush()
      expect(outboundAt(local.frame).response?.error?.code).toBe('INVALID_PAYLOAD:content')
      expect(local.invoke).not.toHaveBeenCalled()
    } finally {
      local.host.detach(window)
    }
  })

  it('files/list 带前缀转发，prefix 缺省不传字段', async () => {
    const local = createHarness(['files'])
    try {
      local.invoke.mockResolvedValueOnce({ files: [] })
      local.send(
        requestMessage({ capability: 'files', operation: 'list', payload: { prefix: 'notes/' } }),
      )
      await local.flush()
      expect(local.invoke).toHaveBeenCalledWith('sub-app:file:list', {
        appId,
        prefix: 'notes/',
      })
      local.invoke.mockClear()
      local.send(requestMessage({ capability: 'files', operation: 'list', payload: {} }))
      await local.flush()
      expect(local.invoke).toHaveBeenCalledWith('sub-app:file:list', { appId })
    } finally {
      local.host.detach(window)
    }
  })

  it('agent/send 需要 agent 权限并把 prompt 交给宿主回调', async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ sessionId: 'sess-1', delivered: true })
    const local = createHarness(['agent'], { sendToAgent })
    try {
      local.send(
        requestMessage({ capability: 'agent', operation: 'send', payload: { prompt: '总结一下' } }),
      )
      await local.flush()
      expect(sendToAgent).toHaveBeenCalledWith({ prompt: '总结一下' })
      expect(outboundAt(local.frame).response?.data).toEqual({
        sessionId: 'sess-1',
        delivered: true,
      })
    } finally {
      local.host.detach(window)
    }
  })

  it('media/generate 拒绝白名单外的操作', async () => {
    const local = createHarness(['media'])
    try {
      local.send(
        requestMessage({
          capability: 'media',
          operation: 'generate',
          payload: { operation: 'image_edit', prompt: 'x' },
        }),
      )
      await local.flush()
      expect(outboundAt(local.frame).response?.error?.code).toBe('INVALID_PAYLOAD:operation')
    } finally {
      local.host.detach(window)
    }
  })

  it('media/generate 放行 text_to_image 并透传可选参数', async () => {
    const createMediaTask = vi.fn().mockResolvedValue({ taskId: 't-1', status: 'running' })
    const local = createHarness(['media'], { createMediaTask })
    try {
      local.send(
        requestMessage({
          capability: 'media',
          operation: 'generate',
          payload: {
            operation: 'text_to_image',
            prompt: '一只猫',
            negativePrompt: '模糊',
            modelId: 'doubao-seedream-4-5',
          },
        }),
      )
      await local.flush()
      expect(createMediaTask).toHaveBeenCalledWith({
        operation: 'text_to_image',
        prompt: '一只猫',
        negativePrompt: '模糊',
        modelId: 'doubao-seedream-4-5',
      })
      expect(outboundAt(local.frame).response?.data).toEqual({ taskId: 't-1', status: 'running' })
    } finally {
      local.host.detach(window)
    }
  })

  it('canvas/appendText 校验必填字段并转发宿主回调', async () => {
    const canvasRequest = vi.fn().mockResolvedValue({ nodeId: 'n1', boardId: 'b1' })
    const local = createHarness(['canvas'], { canvasRequest })
    try {
      local.send(
        requestMessage({
          capability: 'canvas',
          operation: 'appendText',
          payload: { projectId: 'canvas_project_1', text: '画布速记' },
        }),
      )
      await local.flush()
      expect(canvasRequest).toHaveBeenCalledWith('appendText', {
        projectId: 'canvas_project_1',
        text: '画布速记',
      })
      local.send(
        requestMessage({ capability: 'canvas', operation: 'appendText', payload: { text: 'x' } }),
      )
      await local.flush()
      expect(outboundAt(local.frame, 1).response?.error?.code).toBe('INVALID_PAYLOAD:projectId')
    } finally {
      local.host.detach(window)
    }
  })

  it('browser/openUrl 打开 http 链接，非 http(s) 协议被拒绝', async () => {
    const openExternal = vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    })
    const local = createHarness(['browser'], { openExternal })
    try {
      local.send(
        requestMessage({
          capability: 'browser',
          operation: 'openUrl',
          payload: { url: 'https://example.com/docs' },
        }),
      )
      await local.flush()
      expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
      expect(outboundAt(local.frame).response?.data).toEqual({ opened: true })
      local.send(
        requestMessage({
          capability: 'browser',
          operation: 'openUrl',
          payload: { url: 'file:///etc/passwd' },
        }),
      )
      await local.flush()
      expect(outboundAt(local.frame, 1).response?.error?.code).toBe('NAVIGATION_REJECTED')
    } finally {
      local.host.detach(window)
    }
  })

  it('未声明对应权限时五域均返回 PERMISSION_DENIED', async () => {
    for (const capability of ['files', 'agent', 'media', 'canvas', 'browser']) {
      harness.frame.postMessage.mockClear()
      harness.send(requestMessage({ capability, operation: 'list', payload: {} }))
      await harness.flush()
      expect(outboundAt(harness.frame).response?.error?.code).toBe('PERMISSION_DENIED')
    }
    expect(harness.invoke).not.toHaveBeenCalled()
  })
})
