import type { ModelProfileRepository, ModelProfileRow } from '@spark/storage'
import type { ModelProfile } from '@spark/protocol'

const DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3.1', 'codellama'],
  'openai-compatible': [],
}

export class ModelService {
  constructor(private readonly repo: ModelProfileRepository) {
    this.repo.ensureSchema()
  }

  list(filters?: { providerId?: string }): ModelProfile[] {
    return this.repo.list(filters).map(toModelProfile)
  }

  create(params: { providerId: string; name: string; configJson?: string }): ModelProfile {
    const row = this.repo.create(params)
    return toModelProfile(row)
  }

  update(id: string, fields: { name?: string; configJson?: string; enabled?: boolean }): ModelProfile {
    const row = this.repo.update(id, fields)
    if (!row) throw new Error(`Model not found: ${id}`)
    return toModelProfile(row)
  }

  delete(id: string): boolean {
    return this.repo.deleteById(id)
  }

  seedDefaultModels(providers: Array<{ id: string; provider: string }>): ModelProfile[] {
    const seeded: ModelProfile[] = []
    for (const p of providers) {
      const names = DEFAULT_MODELS[p.provider] ?? []
      for (const name of names) {
        const existing = this.repo.findByProviderAndName(p.id, name)
        if (!existing) {
          seeded.push(this.create({ providerId: p.id, name }))
        }
      }
    }
    return seeded
  }
}

function toModelProfile(row: ModelProfileRow): ModelProfile {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    configJson: row.config_json,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
