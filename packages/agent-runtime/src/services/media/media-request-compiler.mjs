/**
 * media-request-compiler.mjs — Contract V2 参数裁剪纯 JS 实现。
 *
 * 与 media-request-compiler.ts 共享语义，但只暴露 MCP 子进程需要的裁剪入口：
 *   - 跳过 canonical 归一与 aliases 映射（已在 buildManifestVariables 处理）。
 *   - 跳过 coerceParamValue/validateAgainstParamSchema 类型强转（MCP 工具 inputSchema
 *     已对入参做 JSON Schema 类型化，agent 不会经 extraJson 传错类型标量）。
 *   - 保留 transforms / conflicts / forbidden / passthrough / strict 全部策略维度，
 *     否则 MCP 路径会比 canvas/adapter 路径更宽松，导致 provider 400。
 *
 * 与 TS 版本的语义对齐由 packages/agent-runtime/src/__tests__/services/media/
 * media-request-compiler-mjs.test.ts 保证（同名策略下 TS 与 JS 裁剪结果一致）。
 */

const LOCAL_ONLY_FIELDS = new Set(['filename'])

// Provider 写法 → canonical camelCase 的固定映射表（与 TS 编译器 CANONICAL_ALIASES_FALLBACK 同源）。
// 仅在 paramPolicy 没显式声明 aliases 时作为兜底；不强行覆盖 provider 原生命。
const CANONICAL_ALIASES_FALLBACK = {
  aspect_ratio: 'aspectRatio',
  ratio: 'aspectRatio',
  duration: 'durationSeconds',
  output_format: 'outputFormat',
  response_format: 'responseFormat',
  generate_audio: 'generateAudio',
  return_last_frame: 'returnLastFrame',
  search_enabled: 'searchEnabled',
  enable_search: 'searchEnabled',
  negative_prompt: 'negativePrompt',
  edit_strength: 'editStrength',
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function previewValue(value) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const json = JSON.stringify(value)
    return json && json.length > 80 ? `${json.slice(0, 77)}...` : (json ?? undefined)
  } catch {
    return undefined
  }
}

function removeBlankParams(params) {
  const next = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    next[key] = value
  }
  return next
}

function normalizeCanonicalParams(params) {
  const next = {}
  for (const [key, value] of Object.entries(params)) {
    next[CANONICAL_ALIASES_FALLBACK[key] ?? key] = value
  }
  return next
}

function resolveParamPolicy(capability) {
  if (capability?.paramPolicy) return capability.paramPolicy
  const schema = capability?.paramSchema
  if (isPlainRecord(schema) && schema.additionalProperties === false) {
    return { strict: true, passthrough: { enabled: false } }
  }
  return { strict: false, passthrough: { enabled: true } }
}

function applyPolicyTransforms(params, transforms, inputFiles) {
  if (!Array.isArray(transforms) || transforms.length === 0) return { params, dropped: [] }
  const next = { ...params }
  const dropped = []
  for (const rule of transforms) {
    if (!rule || typeof rule !== 'object') continue
    if (rule.kind === 'rename') {
      if (rule.from in next) {
        const value = next[rule.from]
        delete next[rule.from]
        next[rule.to] = value
      }
      continue
    }
    if (rule.kind === 'map_value') {
      const current = next[rule.field]
      if (typeof current === 'string' && current in (rule.values || {})) {
        next[rule.field] = rule.values[current]
      }
      continue
    }
    if (rule.kind === 'ratio_size_to_aspect') {
      const size = next[rule.from]
      if (typeof size === 'string' && /^\d+:\d+$/.test(size) && !(rule.to in next)) {
        next[rule.to] = size
        delete next[rule.from]
      }
      continue
    }
    if (rule.kind === 'drop_when_input_kind') {
      const kinds = Array.isArray(rule.inputKinds) ? rule.inputKinds : []
      const matched = (inputFiles || []).some((file) =>
        kinds.includes(file?.type) || kinds.includes(file?.role),
      )
      if (matched && rule.field in next) {
        const value = next[rule.field]
        delete next[rule.field]
        dropped.push({
          name: rule.field,
          valuePreview: previewValue(value),
          reason: 'forbidden_by_contract',
        })
      }
      continue
    }
  }
  return { params: next, dropped }
}

function resolveConflicts(params, conflicts, capabilityId) {
  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    return { params, dropped: [], issues: [] }
  }
  const next = { ...params }
  const dropped = []
  const issues = []
  for (const rule of conflicts) {
    const present = (rule.fields || []).filter((field) => field in next)
    if (present.length < 2) continue
    if (rule.strategy === 'error') {
      issues.push({
        severity: 'error',
        code: 'conflicting_params',
        message: `Invalid parameters for ${capabilityId}: ${present.join(', ')} 互斥`,
        path: present,
      })
      continue
    }
    const keep = rule.strategy === 'prefer_first' ? present[0] : present[present.length - 1]
    if (!keep) continue
    for (const field of present) {
      if (field === keep) continue
      const value = next[field]
      delete next[field]
      dropped.push({
        name: field,
        valuePreview: previewValue(value),
        reason: 'conflict_removed',
      })
    }
  }
  return { params: next, dropped, issues }
}

function filterParams(params, policy, schema, mode, capabilityId) {
  const properties = isPlainRecord(schema?.properties) ? schema.properties : {}
  const declared = new Set(Object.keys(properties))
  const allowSet = new Set(policy.passthrough?.allow || [])
  const denySet = new Set(policy.passthrough?.deny || [])
  const strict = policy.strict === true
  const passthroughEnabled = !strict || (policy.passthrough?.enabled ?? false)
  const forbiddenByName = new Map((policy.forbidden || []).map((entry) => [entry.name, entry]))

  const next = {}
  const dropped = []
  const issues = []
  const warnings = []

  for (const [name, value] of Object.entries(params)) {
    if (LOCAL_ONLY_FIELDS.has(name)) {
      dropped.push({ name, valuePreview: previewValue(value), reason: 'local_only' })
      continue
    }

    const forbidden = forbiddenByName.get(name)
    if (forbidden) {
      if (mode === 'adapter' || mode === 'mcp') {
        issues.push({
          severity: 'error',
          code: 'forbidden_param',
          message: `Invalid parameter "${name}" for ${capabilityId}: ${forbidden.reason}`,
          path: [name],
        })
      }
      dropped.push({ name, valuePreview: previewValue(value), reason: 'forbidden_by_contract' })
      continue
    }

    if (denySet.has(name)) {
      dropped.push({ name, valuePreview: previewValue(value), reason: 'unsafe_passthrough' })
      continue
    }

    if (declared.has(name)) {
      next[name] = value
      continue
    }

    if (allowSet.has(name)) {
      if (policy.passthrough?.allowScalarsOnly !== false && !isScalar(value)) {
        dropped.push({ name, valuePreview: previewValue(value), reason: 'unsafe_passthrough' })
        continue
      }
      next[name] = value
      warnings.push({
        code: 'compat_passthrough',
        message: `参数 ${name} 不在 schema 中，按 passthrough.allow 透传`,
        path: [name],
      })
      continue
    }

    if (passthroughEnabled && !strict) {
      if (policy.passthrough?.allowScalarsOnly !== false && !isScalar(value)) {
        dropped.push({ name, valuePreview: previewValue(value), reason: 'unsafe_passthrough' })
        continue
      }
      next[name] = value
      warnings.push({
        code: 'compat_passthrough',
        message: `参数 ${name} 不在 schema 中，按兼容透传放行（contract 未收紧）`,
        path: [name],
      })
      continue
    }

    dropped.push({ name, valuePreview: previewValue(value), reason: 'unsupported_by_model' })
  }

  return { params: next, dropped, issues, warnings }
}

function dedupeDropped(dropped) {
  const seen = new Set()
  const next = []
  for (const entry of dropped) {
    const key = `${entry.name}::${entry.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(entry)
  }
  return next
}

/**
 * 按 manifest.capability.paramPolicy 裁剪 modelParams，返回进入 provider 请求的最终字段集。
 *
 * @param {object} input
 * @param {object} input.manifest MediaModelManifest
 * @param {object} input.capability MediaModelCapabilityManifest
 * @param {string} input.modelId 模型 id（用于错误信息）
 * @param {Record<string, unknown>} input.params 已经经过 aliases 映射的 provider-native 参数
 * @param {Array<{ type?: string, role?: string }>} [input.inputFiles] 输入文件类型，用于 drop_when_input_kind
 * @param {Record<string, unknown>} [input.providerDefaults] provider 默认值（低优先级）
 * @param {'canvas'|'mcp'|'adapter'} [input.mode] 调用场景；mcp/adapter 模式下 forbidden 参数会产 issue
 * @returns {{
 *   prunedParams: Record<string, unknown>,
 *   droppedParams: Array<{ name: string, providerName?: string, valuePreview?: string, reason: string }>,
 *   warnings: Array<{ code: string, message: string, path?: Array<string|number> }>,
 *   validationIssues: Array<{ severity: 'error'|'warning', code: string, message: string, path: Array<string|number> }>,
 * }}
 */
export function pruneModelParamsByManifest(input) {
  const mode = input.mode ?? 'mcp'
  const issues = []
  const warnings = []
  const dropped = []

  const rawParams = removeBlankParams(input.params || {})
  const canonicalFromRaw = normalizeCanonicalParams(rawParams)
  const defaults = {
    ...(input.providerDefaults || {}),
    ...(input.capability?.defaults || {}),
  }
  const merged = { ...defaults, ...canonicalFromRaw }

  const policy = resolveParamPolicy(input.capability)
  if (!input.capability?.paramPolicy && policy.strict === false) {
    warnings.push({
      code: 'missing_param_policy',
      message: '当前模型未声明 paramPolicy，自动按 additionalProperties 进入兼容透传，可能被 provider 拒绝未知字段',
    })
  }

  const transformed = applyPolicyTransforms(
    merged,
    policy.transforms,
    input.inputFiles || [],
  )
  dropped.push(...transformed.dropped)

  const resolved = resolveConflicts(
    transformed.params,
    policy.conflicts,
    input.capability?.id || input.modelId || 'capability',
  )
  dropped.push(...resolved.dropped)
  issues.push(...resolved.issues)

  const filtered = filterParams(
    resolved.params,
    policy,
    input.capability?.paramSchema || {},
    mode,
    input.capability?.id || input.modelId || 'capability',
  )
  dropped.push(...filtered.dropped)
  issues.push(...filtered.issues)
  for (const w of filtered.warnings) warnings.push(w)

  return {
    prunedParams: filtered.params,
    droppedParams: dedupeDropped(dropped),
    warnings,
    validationIssues: issues,
  }
}
