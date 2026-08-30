import { createHash } from 'node:crypto'
import type { AccountSyncCategory, AccountSyncItem, AccountSyncSkippedItem } from '@spark/protocol'

const FORBIDDEN_KEY_PATTERN =
  /(?:api.?key|access.?token|refresh.?token|token|password|passwd|secret|credential|authorization|cookie|headers?|env(?:ironment)?|keystore|provider.?profile|model.?id|reasoning.?effort|agent.?adapter|mcp|hooks?)/i

const TEXT_SECRET_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'SECRET_PEM_PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { code: 'SECRET_BEARER_TOKEN', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { code: 'SECRET_JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  {
    code: 'SECRET_COMMON_API_KEY',
    pattern: /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/i,
  },
  { code: 'SECRET_CREDENTIAL_URL', pattern: /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/i },
  {
    code: 'LOCAL_ABSOLUTE_PATH',
    pattern:
      /(?:^|[\s"'(])(?:[A-Za-z]:\\(?:[^\\\s"'<>]+\\)+|\\\\[^\\\s"'<>]+\\[^\\\s"'<>]+\\|\/(?:Users|home|root|tmp|private\/tmp|var\/tmp|Volumes|opt)\/)[^\s"'<>]+/i,
  },
]

const TOP_LEVEL_FIELDS: Record<AccountSyncCategory, ReadonlySet<string>> = {
  customCommands: new Set([
    'id',
    'name',
    'description',
    'prompt',
    'script',
    'scriptLanguage',
    'enabled',
    'updatedAt',
  ]),
  prompts: new Set([
    'id',
    'scope',
    'scopeRef',
    'kind',
    'name',
    'content',
    'priority',
    'enabled',
    'fingerprint',
    'updatedAt',
  ]),
  memory: new Set([
    'id',
    'scope',
    'scopeRef',
    'type',
    'name',
    'description',
    'body',
    'confidence',
    'isArchived',
    'createdAt',
    'updatedAt',
  ]),
  assistants: new Set([
    'id',
    'kind',
    'name',
    'description',
    'enabled',
    'isDefault',
    'prompt',
    'permissionMode',
    'skillIds',
    'ruleIds',
    'workflowIds',
    'memberIds',
    'leaderId',
    'coordinationMode',
    'discussionRounds',
    'metadata',
    'createdAt',
    'updatedAt',
  ]),
  workflows: new Set([
    'id',
    'scope',
    'name',
    'version',
    'description',
    'status',
    'tags',
    'enabled',
    'graph',
    'createdAt',
    'updatedAt',
  ]),
  promptLibrary: new Set([
    'id',
    'title',
    'text',
    'category',
    'tags',
    'coverUrl',
    'coverMimeType',
    'createdAt',
    'updatedAt',
  ]),
  appearance: new Set([
    'id',
    'theme',
    'emptyHeroTheme',
    'primary',
    'density',
    'font',
    'fontSize',
    'uiZoom',
    'codeLigature',
    'windowCorners',
    'backdropBlur',
    'autoCollapseTools',
    'inlineTokenCount',
    'syntaxHighlight',
    'timestampFormat',
    'updatedAt',
  ]),
}

type SyncFieldType = 'string' | 'nullable-string' | 'boolean' | 'number' | 'string-array' | 'object'

const FIELD_TYPES: Record<AccountSyncCategory, Readonly<Record<string, SyncFieldType>>> = {
  customCommands: {
    id: 'string',
    name: 'string',
    description: 'string',
    prompt: 'string',
    script: 'string',
    scriptLanguage: 'string',
    enabled: 'boolean',
    updatedAt: 'string',
  },
  prompts: {
    id: 'string',
    scope: 'string',
    scopeRef: 'nullable-string',
    kind: 'string',
    name: 'string',
    content: 'string',
    priority: 'number',
    enabled: 'boolean',
    fingerprint: 'string',
    updatedAt: 'string',
  },
  memory: {
    id: 'string',
    scope: 'string',
    scopeRef: 'nullable-string',
    type: 'string',
    name: 'string',
    description: 'string',
    body: 'string',
    confidence: 'number',
    isArchived: 'boolean',
    createdAt: 'string',
    updatedAt: 'string',
  },
  assistants: {
    id: 'string',
    kind: 'string',
    name: 'string',
    description: 'string',
    enabled: 'boolean',
    isDefault: 'boolean',
    prompt: 'string',
    permissionMode: 'string',
    skillIds: 'string-array',
    ruleIds: 'string-array',
    workflowIds: 'string-array',
    memberIds: 'string-array',
    leaderId: 'string',
    coordinationMode: 'object',
    discussionRounds: 'number',
    metadata: 'object',
    createdAt: 'string',
    updatedAt: 'string',
  },
  workflows: {
    id: 'string',
    scope: 'string',
    name: 'string',
    version: 'string',
    description: 'string',
    status: 'string',
    tags: 'string-array',
    enabled: 'boolean',
    graph: 'object',
    createdAt: 'string',
    updatedAt: 'string',
  },
  promptLibrary: {
    id: 'string',
    title: 'string',
    text: 'string',
    category: 'string',
    tags: 'string-array',
    coverUrl: 'nullable-string',
    coverMimeType: 'nullable-string',
    createdAt: 'string',
    updatedAt: 'string',
  },
  appearance: {
    id: 'string',
    theme: 'string',
    emptyHeroTheme: 'string',
    primary: 'string',
    density: 'string',
    font: 'string',
    fontSize: 'number',
    uiZoom: 'number',
    codeLigature: 'boolean',
    windowCorners: 'string',
    backdropBlur: 'boolean',
    autoCollapseTools: 'boolean',
    inlineTokenCount: 'boolean',
    syntaxHighlight: 'boolean',
    timestampFormat: 'string',
    updatedAt: 'string',
  },
}

export interface AccountSyncCollectResult {
  records: AccountSyncItem[]
  skippedItems: AccountSyncSkippedItem[]
  seenIds: Set<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function findUnsafeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(findUnsafeKey)
  if (!isRecord(value)) return false
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_KEY_PATTERN.test(key) || findUnsafeKey(child),
  )
}

/**
 * 图片 dataUrl（封面/头像）是二进制内容的内嵌编码，按文本扫描会产生
 * base64 子串撞上密钥/路径模式的误报，且接收端只会把它解码为图片使用；
 * 因此这类字段豁免文本扫描。仅豁免 data:image/ 前缀，其他 data: 类型照常扫描。
 */
const EMBEDDED_IMAGE_DATA_URL = /^data:image\//i

function findUnsafeText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    if (EMBEDDED_IMAGE_DATA_URL.test(value)) return undefined
    return TEXT_SECRET_PATTERNS.find((candidate) => candidate.pattern.test(value))?.code
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const reason = findUnsafeText(item)
      if (reason != null) return reason
    }
    return undefined
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const reason = findUnsafeText(child)
      if (reason != null) return reason
    }
  }
  return undefined
}

function hasExpectedType(value: unknown, expected: SyncFieldType): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string'
    case 'nullable-string':
      return value === null || typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'string-array':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
    case 'object':
      return isRecord(value)
  }
}

/** assistants.metadata 只允许携带头像配置，其他键（hook 等敏感项）一律拒绝。 */
const ASSISTANT_METADATA_ALLOWED_KEYS = new Set(['avatar'])

function hasUnsafeNestedKeys(
  value: Record<string, unknown>,
  category: AccountSyncCategory,
): boolean {
  if (category !== 'assistants') return false
  const metadata = value['metadata']
  if (metadata == null) return false
  if (!isRecord(metadata)) return true
  return Object.keys(metadata).some((key) => !ASSISTANT_METADATA_ALLOWED_KEYS.has(key))
}

export function createSafeSyncItem(
  category: AccountSyncCategory,
  input: {
    id: string
    updatedAt: string | number
    value: Record<string, unknown>
  },
): { item?: AccountSyncItem; skipped?: AccountSyncSkippedItem } {
  const id = input.id.trim()
  const date = new Date(input.updatedAt)
  if (!id || !Number.isFinite(date.getTime())) {
    return { skipped: { id: id || '(invalid)', reasonCode: 'SYNC_INVALID_LOCAL_ITEM' } }
  }
  if (Object.keys(input.value).some((key) => !TOP_LEVEL_FIELDS[category].has(key))) {
    return { skipped: { id, reasonCode: 'SYNC_FIELD_NOT_ALLOWLISTED' } }
  }
  if (
    Object.entries(input.value).some(([key, value]) => {
      const expected = FIELD_TYPES[category][key]
      return expected == null || !hasExpectedType(value, expected)
    })
  ) {
    return { skipped: { id, reasonCode: 'SYNC_FIELD_TYPE_INVALID' } }
  }
  if (hasUnsafeNestedKeys(input.value, category)) {
    return { skipped: { id, reasonCode: 'SYNC_FIELD_NOT_ALLOWLISTED' } }
  }
  if (findUnsafeKey(input.value)) {
    return { skipped: { id, reasonCode: 'SYNC_FORBIDDEN_FIELD' } }
  }
  const unsafeText = findUnsafeText(input.value)
  if (unsafeText != null) return { skipped: { id, reasonCode: unsafeText } }
  return {
    item: {
      id,
      updatedAt: date.toISOString(),
      deleted: false,
      value: input.value,
    },
  }
}

export function finalizeCollectedItems(
  category: AccountSyncCategory,
  candidates: Array<{ id: string; updatedAt: string | number; value: Record<string, unknown> }>,
): AccountSyncCollectResult {
  const records: AccountSyncItem[] = []
  const skippedItems: AccountSyncSkippedItem[] = []
  const seenIds = new Set<string>()
  for (const candidate of candidates) {
    seenIds.add(candidate.id)
    const result = createSafeSyncItem(category, candidate)
    if (result.item != null) records.push(result.item)
    if (result.skipped != null) skippedItems.push(result.skipped)
  }
  return { records, skippedItems, seenIds }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export function hashSyncRuleFingerprint(value: {
  name: string
  content: string
  priority: number
}): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function hashSyncItem(item: AccountSyncItem): string {
  return createHash('sha256').update(stableStringify(item)).digest('hex')
}

export function hashSyncItems(items: AccountSyncItem[]): Record<string, string> {
  return items.reduce<Record<string, string>>((hashes, item) => {
    hashes[item.id] = hashSyncItem(item)
    return hashes
  }, {})
}
