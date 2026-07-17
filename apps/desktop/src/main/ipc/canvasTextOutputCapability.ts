const CACHE_CATEGORY = 'canvas-text-output-capability'
const CACHE_KEY = 'learned-caps-v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const EVIDENCE_MAX_CHARS = 500

const OUTPUT_TOKEN_PARAMETER =
  /(?:max_tokens|max_output_tokens|max_completion_tokens|maxTokens|maxOutputTokens|maxCompletionTokens)/i
const OUTPUT_LIMIT_SEMANTIC =
  /(?:above\s+(?:the\s+)?maximum|maximum|too\s+large|exceeds?|cannot\s+exceed|greater\s+than|less\s+than\s+or\s+equal|<=|上限|最大|超过)/i

export const CANVAS_TEXT_OUTPUT_RETRY_LEVELS = [
  131_072,
  65_536,
  32_768,
  16_384,
  8_192,
  4_096,
] as const

export type CanvasTextOutputCapabilityKey = {
  providerProfileId: string
  endpoint?: string | undefined
  model: string
  apiKind: 'chat' | 'responses'
}

export type CanvasTextOutputLimitError =
  | { kind: 'output_limit'; exactLimit?: number; evidence: string }
  | { kind: 'other' }

type LearnedFrom = 'exact_error_limit' | 'successful_downgrade'

type LearnedOutputCapability = CanvasTextOutputCapabilityKey & {
  safeMaxOutputTokens: number
  learnedFrom: LearnedFrom
  learnedAt: string
  expiresAt: string
}

type SettingsStore = {
  get(category: string, key: string): unknown | null
  set(category: string, key: string, value: unknown): void
}

export class CanvasTextOutputCapabilityCache {
  constructor(
    private readonly settings: SettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: CanvasTextOutputCapabilityKey): number | undefined {
    const entries = this.readEntries(true)
    return entries.find((entry) => sameCapabilityKey(entry, key))?.safeMaxOutputTokens
  }

  record(
    key: CanvasTextOutputCapabilityKey,
    safeMaxOutputTokens: number,
    learnedFrom: LearnedFrom,
  ): void {
    const safeValue = sanitizePositiveInteger(safeMaxOutputTokens)
    if (safeValue == null) return
    const entries = this.readEntries(false)
    const normalizedKey = normalizeCapabilityKey(key)
    const existing = entries.find((entry) => sameCapabilityKey(entry, normalizedKey))
    const now = this.now()
    const nextValue = existing == null
      ? safeValue
      : Math.min(existing.safeMaxOutputTokens, safeValue)
    const next: LearnedOutputCapability = {
      ...normalizedKey,
      safeMaxOutputTokens: nextValue,
      learnedFrom:
        existing != null && existing.safeMaxOutputTokens < safeValue
          ? existing.learnedFrom
          : learnedFrom,
      learnedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CACHE_TTL_MS).toISOString(),
    }
    this.writeEntries([
      ...entries.filter((entry) => !sameCapabilityKey(entry, normalizedKey)),
      next,
    ])
  }

  clearProvider(providerProfileId: string): void {
    const normalizedProviderId = providerProfileId.trim()
    const entries = this.readEntries(false)
    const retained = entries.filter(
      (entry) => entry.providerProfileId !== normalizedProviderId,
    )
    if (retained.length !== entries.length) this.writeEntries(retained)
  }

  private readEntries(persistCleanup: boolean): LearnedOutputCapability[] {
    const raw = this.settings.get(CACHE_CATEGORY, CACHE_KEY)
    const rows = isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : []
    const now = this.now()
    const entries = rows.flatMap((row) => {
      const parsed = parseCapabilityEntry(row)
      if (parsed == null || Date.parse(parsed.expiresAt) <= now) return []
      return [parsed]
    })
    if (persistCleanup && entries.length !== rows.length) this.writeEntries(entries)
    return entries
  }

  private writeEntries(entries: LearnedOutputCapability[]): void {
    this.settings.set(CACHE_CATEGORY, CACHE_KEY, { version: 1, entries })
  }
}

export function classifyCanvasTextOutputLimitError(error: unknown): CanvasTextOutputLimitError {
  const candidates = collectErrorText(error)
  const evidence = candidates.find(
    (value) => OUTPUT_TOKEN_PARAMETER.test(value) && OUTPUT_LIMIT_SEMANTIC.test(value),
  )
  if (evidence == null) return { kind: 'other' }
  const exactLimit = extractExactOutputLimit(evidence)
  return {
    kind: 'output_limit',
    ...(exactLimit != null ? { exactLimit } : {}),
    evidence: evidence.slice(0, EVIDENCE_MAX_CHARS),
  }
}

export function nextCanvasTextOutputRetryMax(current: number): number | undefined {
  const value = sanitizePositiveInteger(current)
  if (value == null) return undefined
  return CANVAS_TEXT_OUTPUT_RETRY_LEVELS.find((candidate) => candidate < value)
}

function collectErrorText(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return []
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try {
      return [text, ...collectErrorText(JSON.parse(text), depth + 1)]
    } catch {
      return [text]
    }
  }
  if (value instanceof Error) {
    return [value.message, ...collectErrorText(toErrorRecord(value), depth + 1)]
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectErrorText(item, depth + 1))
  if (!isRecord(value)) return []
  const structuredSummary = ['param', 'code', 'type', 'message']
    .flatMap((key) => (typeof value[key] === 'string' ? [value[key]] : []))
    .join(' ')
  return [
    ...(structuredSummary ? [structuredSummary] : []),
    ...Object.values(value).flatMap((item) => collectErrorText(item, depth + 1)),
  ]
}

function toErrorRecord(error: Error): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'message' || key === 'stack') continue
    record[key] = (error as unknown as Record<string, unknown>)[key]
  }
  return record
}

function extractExactOutputLimit(text: string): number | undefined {
  const patterns = [
    /(?:<=|≤)\s*([\d,_]+)/i,
    /(?:cannot\s+exceed|maximum(?:\s+(?:value|output|tokens?))?\s*(?:is|of|:)?|limit\s*(?:is|of|:)?)\s*([\d,_]+)/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    const parsed = match?.[1] == null
      ? undefined
      : Number.parseInt(match[1].replace(/[,_]/g, ''), 10)
    const sanitized = sanitizePositiveInteger(parsed)
    if (sanitized != null) return sanitized
  }
  return undefined
}

function parseCapabilityEntry(value: unknown): LearnedOutputCapability | null {
  if (!isRecord(value)) return null
  const apiKind = value.apiKind
  const learnedFrom = value.learnedFrom
  if (
    typeof value.providerProfileId !== 'string'
    || typeof value.model !== 'string'
    || (value.endpoint !== undefined && typeof value.endpoint !== 'string')
    || (apiKind !== 'chat' && apiKind !== 'responses')
    || (learnedFrom !== 'exact_error_limit' && learnedFrom !== 'successful_downgrade')
    || typeof value.learnedAt !== 'string'
    || typeof value.expiresAt !== 'string'
  ) return null
  const safeMaxOutputTokens = sanitizePositiveInteger(Number(value.safeMaxOutputTokens))
  if (safeMaxOutputTokens == null || !Number.isFinite(Date.parse(value.expiresAt))) return null
  return {
    ...normalizeCapabilityKey({
      providerProfileId: value.providerProfileId,
      ...(typeof value.endpoint === 'string' ? { endpoint: value.endpoint } : {}),
      model: value.model,
      apiKind,
    }),
    safeMaxOutputTokens,
    learnedFrom,
    learnedAt: value.learnedAt,
    expiresAt: value.expiresAt,
  }
}

function normalizeCapabilityKey(
  key: CanvasTextOutputCapabilityKey,
): CanvasTextOutputCapabilityKey {
  const endpoint = key.endpoint?.trim().replace(/\/+$/, '')
  return {
    providerProfileId: key.providerProfileId.trim(),
    ...(endpoint ? { endpoint } : {}),
    model: key.model.trim(),
    apiKind: key.apiKind,
  }
}

function sameCapabilityKey(
  left: CanvasTextOutputCapabilityKey,
  right: CanvasTextOutputCapabilityKey,
): boolean {
  const a = normalizeCapabilityKey(left)
  const b = normalizeCapabilityKey(right)
  return a.providerProfileId === b.providerProfileId
    && a.endpoint === b.endpoint
    && a.model === b.model
    && a.apiKind === b.apiKind
}

function sanitizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
