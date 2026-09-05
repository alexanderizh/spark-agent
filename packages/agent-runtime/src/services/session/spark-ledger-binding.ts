/**
 * Spark 引擎 ledger 会话绑定（session metadata 持久化）。
 *
 * spark-engine 的会话 id 由引擎 newSession 生成（host 无法像 claude/codex 那样预置
 * 稳定 hash 作为 SDK session id），因此续跑需要在 host 侧持久化
 * 「host 身份 key → 引擎 ledger session id」的映射：
 * - bindingKey 复用 resume gate 的 stableSdkSessionId（含 provider/model/adapter 与
 *   mention 身份），模型或渠道切换自然开新 ledger 会话；
 * - 首轮创建 / 续轮重放后由执行器 sparkSessionIdObserver 回写（对照 codex native
 *   thread binding 的 onBinding → patchMetadata 先例）；
 * - ledger 账本缺失（数据根被清）时执行器 openSession 失败自动降级新会话并回写
 *   新 binding，自愈无需 host 干预。
 */

const SPARK_LEDGER_METADATA_KEY = 'sparkLedger'
const MAX_LEDGER_BINDINGS = 12
const MAX_SESSION_ID_LENGTH = 128

export interface SparkLedgerBindingInput {
  bindingKey: string
  sparkSessionId: string
}

type StoredSparkLedgerBinding = SparkLedgerBindingInput & {
  updatedAt: string
}

/** 读取当前 host 身份 key 绑定的引擎 ledger session id；无绑定 / 坏数据返回 null。 */
export function readSparkLedgerSessionId(
  metadataJson: string | null | undefined,
  bindingKey: string,
): string | null {
  if (metadataJson == null || metadataJson.length === 0 || bindingKey.length === 0) return null
  try {
    const metadata = JSON.parse(metadataJson) as unknown
    const ledger = readRecord(readRecord(metadata)?.[SPARK_LEDGER_METADATA_KEY])
    const bindings = Array.isArray(ledger?.sessionBindings) ? ledger.sessionBindings : []
    for (const candidate of bindings) {
      const binding = parseStoredBinding(candidate)
      if (binding != null && binding.bindingKey === bindingKey) return binding.sparkSessionId
    }
  } catch {
    // 历史坏数据忽略：续跑失败时执行器会新建 ledger 会话并回写修复 binding。
  }
  return null
}

/** 为 SessionRepository.patchMetadata 生成浅合并 patch：同 key 去重、保最近 12 条。 */
export function createSparkLedgerBindingPatch(
  currentMetadata: Readonly<Record<string, unknown>>,
  binding: SparkLedgerBindingInput,
  updatedAt = new Date().toISOString(),
): Record<string, unknown> {
  const bindingKey = binding.bindingKey.trim()
  const sparkSessionId = binding.sparkSessionId.trim()
  if (bindingKey.length === 0 || sparkSessionId.length === 0) {
    throw new Error('spark ledger binding requires non-empty bindingKey and sparkSessionId')
  }
  if (sparkSessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error(`spark ledger session id exceeds ${MAX_SESSION_ID_LENGTH} chars`)
  }
  const currentLedger = readRecord(currentMetadata[SPARK_LEDGER_METADATA_KEY]) ?? {}
  const currentBindings = Array.isArray(currentLedger.sessionBindings)
    ? currentLedger.sessionBindings
        .map((candidate) => parseStoredBinding(candidate))
        .filter((candidate): candidate is StoredSparkLedgerBinding => candidate != null)
    : []
  const nextBindings = [
    { bindingKey, sparkSessionId, updatedAt },
    ...currentBindings.filter((candidate) => candidate.bindingKey !== bindingKey),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_LEDGER_BINDINGS)

  return {
    [SPARK_LEDGER_METADATA_KEY]: {
      ...currentLedger,
      version: 1,
      sessionBindings: nextBindings,
    },
  }
}

/**
 * `/clear` 清空 ledger 绑定：下一轮 spark turn 将创建全新引擎会话。
 * （codex native thread 用 generation 轮换，spark 直接清空即可——bindingKey 稳定，
 * 读取端按 key 过滤，绑定消失即等价断链，新轮回写自然接上。）
 */
export function createSparkLedgerClearPatch(
  currentMetadata: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const currentLedger = readRecord(currentMetadata[SPARK_LEDGER_METADATA_KEY]) ?? {}
  return {
    [SPARK_LEDGER_METADATA_KEY]: {
      ...currentLedger,
      version: 1,
      sessionBindings: [],
    },
  }
}

function parseStoredBinding(value: unknown): StoredSparkLedgerBinding | null {
  const record = readRecord(value)
  if (record == null) return null
  const bindingKey = readNonEmptyString(record.bindingKey)
  const sparkSessionId = readNonEmptyString(record.sparkSessionId)
  const updatedAt = readNonEmptyString(record.updatedAt)
  if (bindingKey == null || sparkSessionId == null || updatedAt == null) return null
  if (sparkSessionId.length > MAX_SESSION_ID_LENGTH) return null
  return { bindingKey, sparkSessionId, updatedAt }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
