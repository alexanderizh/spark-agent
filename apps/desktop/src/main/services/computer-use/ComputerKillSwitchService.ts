export interface ComputerGlobalShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export class ComputerKillSwitchService {
  private accelerator: string | null = null
  private activeKill: Promise<void> | null = null

  constructor(
    private readonly registrar: ComputerGlobalShortcutRegistrar,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  arm(accelerator: string, onTrigger: () => Promise<void> | void): boolean {
    this.disarm()
    const normalized = accelerator.trim()
    if (normalized.length === 0) return false
    try {
      const registered = this.registrar.register(normalized, () => {
        if (this.activeKill != null) return
        try {
          this.activeKill = Promise.resolve(onTrigger())
            .catch((error: unknown) => this.onError(error))
            .finally(() => {
              this.activeKill = null
            })
        } catch (error) {
          this.activeKill = null
          this.onError(error)
        }
      })
      if (!registered) return false
      this.accelerator = normalized
      return true
    } catch (error) {
      this.onError(error)
      return false
    }
  }

  isArmed(): boolean {
    return this.accelerator != null
  }

  disarm(): void {
    if (this.accelerator == null) return
    this.registrar.unregister(this.accelerator)
    this.accelerator = null
  }

  dispose(): void {
    this.disarm()
  }
}
