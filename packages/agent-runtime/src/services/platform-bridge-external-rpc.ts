export type PlatformBridgeRpcHandler = (
  params: Record<string, unknown>,
) => unknown | Promise<unknown>

const handlersByBridge = new WeakMap<object, Map<string, PlatformBridgeRpcHandler>>()

export function registerPlatformBridgeRpcHandler(
  bridge: object,
  method: string,
  handler: PlatformBridgeRpcHandler,
): () => void {
  if (!/^[a-z][a-z0-9_.]{1,95}$/u.test(method)) {
    throw new Error('Platform bridge RPC method name is invalid')
  }
  let handlers = handlersByBridge.get(bridge)
  if (handlers == null) {
    handlers = new Map()
    handlersByBridge.set(bridge, handlers)
  }
  handlers.set(method, handler)
  return () => {
    if (handlers?.get(method) === handler) handlers.delete(method)
  }
}

export async function dispatchPlatformBridgeExternalRpc(
  bridge: object,
  method: string,
  params: Record<string, unknown>,
): Promise<{ handled: false } | { handled: true; value: unknown }> {
  const handler = handlersByBridge.get(bridge)?.get(method)
  if (handler == null) return { handled: false }
  return { handled: true, value: await handler(params) }
}
