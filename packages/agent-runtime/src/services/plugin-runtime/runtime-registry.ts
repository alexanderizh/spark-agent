import type { ConnectorRuntimeDescriptor } from '@spark/protocol'
import type { ConnectorRuntimeAdapter } from './runtime-types.js'

export class RuntimeRegistry {
  private readonly adapters = new Map<string, ConnectorRuntimeAdapter>()

  register(adapter: ConnectorRuntimeAdapter): void {
    const id = adapter.descriptor.id
    if (this.adapters.has(id)) throw new Error(`Runtime already registered: ${id}`)
    this.adapters.set(id, adapter)
  }

  replace(adapter: ConnectorRuntimeAdapter): void {
    this.adapters.set(adapter.descriptor.id, adapter)
  }

  get(runtimeId: string): ConnectorRuntimeAdapter | undefined {
    return this.adapters.get(runtimeId)
  }

  require(runtimeId: string): ConnectorRuntimeAdapter {
    const adapter = this.get(runtimeId)
    if (adapter == null) throw new Error(`Runtime adapter is not registered: ${runtimeId}`)
    return adapter
  }

  list(): ConnectorRuntimeDescriptor[] {
    return Array.from(this.adapters.values())
      .map((adapter) => adapter.descriptor)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
  }
}
