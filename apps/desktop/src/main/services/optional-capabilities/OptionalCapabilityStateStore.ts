import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OptionalCapabilityId } from '@spark/protocol'

export interface ActiveCapabilityState {
  schemaVersion: 1
  capabilityId: OptionalCapabilityId
  version: string
  autoUpdate: boolean
  activatedAt: string
  artifacts: Record<
    string,
    { version: string; sha256: string; directory: string; size: number }
  >
}

export class OptionalCapabilityStateStore {
  constructor(private readonly root: string) {}

  capabilityRoot(id: OptionalCapabilityId): string {
    return join(this.root, id)
  }

  async read(id: OptionalCapabilityId): Promise<ActiveCapabilityState | null> {
    try {
      const parsed = JSON.parse(
        await readFile(join(this.capabilityRoot(id), 'active.json'), 'utf8'),
      ) as Partial<ActiveCapabilityState>
      if (
        parsed.schemaVersion !== 1 ||
        parsed.capabilityId !== id ||
        typeof parsed.version !== 'string' ||
        typeof parsed.autoUpdate !== 'boolean' ||
        !parsed.artifacts ||
        typeof parsed.artifacts !== 'object'
      ) {
        throw new Error(`Invalid active state for ${id}`)
      }
      return parsed as ActiveCapabilityState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(state: ActiveCapabilityState): Promise<void> {
    const target = join(this.capabilityRoot(state.capabilityId), 'active.json')
    const temporary = `${target}.new`
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, target)
  }

  async remove(id: OptionalCapabilityId): Promise<void> {
    await rm(this.capabilityRoot(id), { recursive: true, force: true })
  }
}
