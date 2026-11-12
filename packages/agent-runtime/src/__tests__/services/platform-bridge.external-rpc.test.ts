import { describe, expect, it } from 'vitest'
import { PlatformBridgeService } from '../../services/platform-bridge.service.js'
import {
  dispatchPlatformBridgeExternalRpc,
  registerPlatformBridgeRpcHandler,
} from '../../services/platform-bridge-external-rpc.js'

describe('PlatformBridgeService external RPC handlers', () => {
  it('routes only registered methods and removes a handler on dispose', async () => {
    const bridge = new PlatformBridgeService()
    const internal = bridge as unknown as {
      dispatch(method: string, params: Record<string, unknown>): Promise<unknown>
    }
    const handler = (params: Record<string, unknown>) => ({ received: params.sessionId })
    const dispose = registerPlatformBridgeRpcHandler(bridge, 'remote.devices_list', handler)

    await expect(
      internal.dispatch('remote.devices_list', { sessionId: 'session-a' }),
    ).resolves.toEqual({
      received: 'session-a',
    })
    await expect(dispatchPlatformBridgeExternalRpc(bridge, 'remote.unknown', {})).resolves.toEqual({
      handled: false,
    })

    dispose()
    await expect(
      dispatchPlatformBridgeExternalRpc(bridge, 'remote.devices_list', {}),
    ).resolves.toEqual({ handled: false })
  })

  it('rejects malformed external RPC method names', () => {
    const bridge = new PlatformBridgeService()
    expect(() => registerPlatformBridgeRpcHandler(bridge, '../remote', () => null)).toThrow(
      'Platform bridge RPC method name is invalid',
    )
  })
})
