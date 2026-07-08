import type { AgentEvent } from '@spark/protocol'

export type EventListener = (event: AgentEvent) => void

export class AgentEventEmitter {
  private listeners: EventListener[] = []

  on(listener: EventListener): void {
    this.listeners.push(listener)
  }

  off(listener: EventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event)
  }

  removeAllListeners(): void {
    this.listeners = []
  }
}
