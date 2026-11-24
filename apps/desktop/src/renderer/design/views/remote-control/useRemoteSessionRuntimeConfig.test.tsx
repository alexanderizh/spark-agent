// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileBridgeSessionRuntimeConfigResponse } from '@spark/protocol'
import { useRemoteSessionRuntimeConfig } from './useRemoteSessionRuntimeConfig'

/**
 * useRemoteSessionRuntimeConfig 直接单测（2026-11-25 审查补强）：
 * 覆盖 载入成功 / 404 降级（旧版目标端）/ savePrompt 请求体与自动 reload /
 * saveEnv 键清洗与 silent 语义（成功不 reload、不打断其它字段草稿输入）。
 */

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
}))

vi.mock('./useRemoteBridge', () => ({
  useRemoteCall: () => mocks.call,
}))

function makeConfig(): MobileBridgeSessionRuntimeConfigResponse {
  return {
    workspaceId: 'workspace-1',
    prompt: {
      system: { enabled: true, content: 'sys' },
      agent: { enabled: false, content: '' },
      project: { enabled: true, content: 'project prompt' },
      session: { enabled: false, content: '' },
      effectivePrompt: 'sys',
    },
    env: {
      project: { enabled: true, vars: [] },
      session: { enabled: false, vars: [] },
      effectiveEnv: {},
    },
    filter: {
      project: { configured: false, disabledSources: [] },
      session: { configured: false, disabledSources: [] },
      effectiveDisabledSources: [],
    },
  }
}

let latest: ReturnType<typeof useRemoteSessionRuntimeConfig> | null = null

function Probe({ deviceId, sessionId }: { deviceId: string; sessionId: string | null }) {
  latest = useRemoteSessionRuntimeConfig(deviceId, sessionId)
  return null
}

describe('useRemoteSessionRuntimeConfig', () => {
  let root: Root
  let container: HTMLElement

  beforeEach(() => {
    mocks.call.mockReset()
    // 默认全链路成功响应：载入 GET / 保存 PUT / 保存后自动 reload 的 GET
    // （reload 的第二次 GET 若无兜底实现会在 .then 处炸出假失败）
    mocks.call.mockResolvedValue(makeConfig())
    latest = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  async function renderProbe(deviceId = 'device-1', sessionId = 'session-1') {
    await act(async () => {
      root.render(<Probe deviceId={deviceId} sessionId={sessionId} />)
      // flush effect 内异步 GET promise 链（then → setState → finally）
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
  }

  it('loads runtime config and reports supported', async () => {
    mocks.call.mockResolvedValueOnce(makeConfig())
    await renderProbe()

    expect(mocks.call).toHaveBeenCalledWith(
      'device-1',
      'GET',
      '/v1/sessions/session-1/runtime-config',
    )
    expect(latest?.config?.workspaceId).toBe('workspace-1')
    expect(latest?.supported).toBe(true)
    expect(latest?.loading).toBe(false)
    expect(latest?.error).toBeNull()
  })

  it('marks target as unsupported when GET returns 404 (legacy device)', async () => {
    mocks.call.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
    await renderProbe()

    expect(latest?.supported).toBe(false)
    expect(latest?.config).toBeNull()
    expect(latest?.error).toBe('not found')
  })

  it('reports error but keeps supported on non-404 failures', async () => {
    mocks.call.mockRejectedValueOnce(new Error('device offline'))
    await renderProbe()

    expect(latest?.supported).toBe(true)
    expect(latest?.error).toBe('device offline')
  })

  it('savePrompt derives enabled from content and reloads after save', async () => {
    mocks.call.mockResolvedValueOnce(makeConfig())
    await renderProbe()
    const initialCalls = mocks.call.mock.calls.length

    mocks.call.mockResolvedValueOnce({})
    let saved = false
    await act(async () => {
      saved = (await latest?.savePrompt('session', 'new prompt')) ?? false
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })

    expect(saved).toBe(true)
    expect(mocks.call).toHaveBeenNthCalledWith(initialCalls + 1, 'device-1', 'PUT', '/v1/runtime-config/prompt', {
      scope: 'session',
      scopeRef: 'session-1',
      value: { enabled: true, content: 'new prompt' },
    })
    // 保存成功后自动重拉全量配置（本地面板同款语义）
    expect(mocks.call.mock.calls.length).toBe(initialCalls + 2)
    expect(mocks.call).toHaveBeenLastCalledWith(
      'device-1',
      'GET',
      '/v1/sessions/session-1/runtime-config',
    )
  })

  it('saveEnv trims keys, drops empty entries; silent success skips reload', async () => {
    mocks.call.mockResolvedValueOnce(makeConfig())
    await renderProbe()
    const initialCalls = mocks.call.mock.calls.length

    mocks.call.mockResolvedValueOnce({})
    let saved = false
    await act(async () => {
      saved =
        (await latest?.saveEnv(
          'project',
          [
            { key: ' A_KEY ', value: '1', description: ' desc ' },
            { key: '   ', value: 'dropped' },
          ],
          { silent: true },
        )) ?? false
    })

    expect(saved).toBe(true)
    expect(mocks.call).toHaveBeenNthCalledWith(initialCalls + 1, 'device-1', 'PUT', '/v1/runtime-config/env', {
      scope: 'project',
      // project 层 scopeRef 取载入时的 workspaceId
      scopeRef: 'workspace-1',
      value: {
        enabled: true,
        vars: [{ key: 'A_KEY', value: '1', description: 'desc' }],
      },
    })
    // silent 成功不触发 reload（避免打断其它字段草稿输入）
    expect(mocks.call.mock.calls.length).toBe(initialCalls + 1)
  })
})
