/**
 * 内置 manifest 参数契约审计(只读)。
 *
 * 目的:把这次媒体参数治理中靠人工追查的几类错位(schema/defaults/aliases 的原生 key
 * 与 compiler canonical 归一不一致、重复 modelId 等)固化成系统化检查,后续改 manifest
 * 能被 CI 拦住,而不是等人手动 diff。
 *
 * 关键背景(见 docs/reviews/2026-08-04-media-schema-governance-audit.md):
 *   - compiler 的 normalizeCanonicalParams 始终用 CANONICAL_ALIASES_FALLBACK 把 provider
 *     原生 key 归一到 canonical(duration→durationSeconds、ratio→aspectRatio …)。
 *   - filterCanonicalParams(strict 过滤)与 validateAgainstParamSchema(类型/枚举/范围校验)
 *     都用 canonical key 去匹配 schema.properties 的 key。
 *   - 因此 schema/defaults 若用了原生 fallback key,在 strict 下会被丢、校验会静默失效。
 *
 * 注意:专门 adapter(bailian/minimax/volcengine 等)直接读 input.modelParams 自建 body、
 * 不经 compiler,所以原生 schema key 对它们不塑形真实请求体;但 canvas 预编译路径与未来
 * 开 strict 时仍受影响,故仍以 baseline 形式追踪,不允许新增。
 *
 * 本文件为只读审计,不改任何 manifest。
 */

import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS, type MediaModelManifest } from '@spark/protocol'
import {
  CANONICAL_ALIASES_FALLBACK,
  isSynthesizedCustomManifest,
} from '../../../services/media/media-request-compiler.js'

const NATIVE_FALLBACK_KEYS = new Set(Object.keys(CANONICAL_ALIASES_FALLBACK))

/** schema 属性中用了 compiler 兜底原生 key(会被归一,strict 下 schema 形同虚设)。 */
function schemaNativeFallbackKeys(manifest: MediaModelManifest): string[] {
  if (isSynthesizedCustomManifest(manifest)) return [] // 合成 custom 绕过 compiler,原生 key 合法
  const out: string[] = []
  for (const capability of manifest.capabilities) {
    const properties = capability.paramSchema.properties
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue
    for (const key of Object.keys(properties)) {
      if (NATIVE_FALLBACK_KEYS.has(key)) {
        out.push(`${manifest.id}/${capability.id}: schema.${key}`)
      }
    }
  }
  return out
}

/** defaults 中用了 compiler 兜底原生 key(应直接写 canonical)。 */
function defaultsNativeFallbackKeys(manifest: MediaModelManifest): string[] {
  if (isSynthesizedCustomManifest(manifest)) return []
  const out: string[] = []
  for (const capability of manifest.capabilities) {
    for (const key of Object.keys(capability.defaults ?? {})) {
      if (NATIVE_FALLBACK_KEYS.has(key)) {
        out.push(`${manifest.id}/${capability.id}: defaults.${key}`)
      }
    }
  }
  return out
}

/** aliases 方向错误:alias 的 key 本身是原生 fallback key(应是 canonical key)。 */
function reversedAliases(manifest: MediaModelManifest): string[] {
  if (isSynthesizedCustomManifest(manifest)) return []
  const out: string[] = []
  for (const capability of manifest.capabilities) {
    const aliases = (capability.aliases ?? {}) as Record<string, string>
    for (const [canonical, native] of Object.entries(aliases)) {
      if (NATIVE_FALLBACK_KEYS.has(canonical)) {
        out.push(
          `${manifest.id}/${capability.id}: alias key '${canonical}' is native fallback (should be canonical), maps to '${native}'`,
        )
      }
    }
  }
  return out
}

/** 重复 modelId(跨来源并存,易混淆参数契约)。 */
function duplicateModelIds(): { modelId: string; manifestIds: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
    const list = groups.get(manifest.modelId) ?? []
    list.push(manifest.id)
    groups.set(manifest.modelId, list)
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([modelId, manifestIds]) => ({ modelId, manifestIds }))
}

describe('builtin media manifest parameter-contract audit', () => {
  it('aliases point from canonical key to native value (not reversed)', () => {
    // 硬卡:alias 方向写反(canonical<-native 写成了 native->xxx)会让 compiler 归一后
    // 取不到值,属于确定性契约错误,必须为 0。
    const failures: string[] = []
    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      failures.push(...reversedAliases(manifest))
    }
    expect(failures).toEqual([])
  })

  it('defaults keys avoid compiler fallback native (debt ceiling)', () => {
    const violations: string[] = []
    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      violations.push(...defaultsNativeFallbackKeys(manifest))
    }
    if (violations.length > 0) {
      console.warn(
        `[media-audit] defaults native fallback keys (${violations.length}):\n` +
          violations.map((v) => `  - ${v}`).join('\n'),
      )
    }
    // 现存债务集中在 minimax/apimart 专门 adapter(response_format/output_format/generate_audio):
    // 专门 adapter 直读 modelParams,原生 defaults 与原生 schema 自洽,当前不破坏运行;
    // 但 canvas 预编译回写 canonical 后会与 adapter 读取的原生 key 错位(同 H3 一类隐患)。
    // 注意这些是有意义的业务默认值(非无用参数),保留正确,只是 key 形态待随 strict 统一。
    // 天花板不得增长;清理一处即下调此值,目标是收敛到 0 后改为硬卡。
    const BASELINE = 15
    expect(violations.length).toBeLessThanOrEqual(BASELINE)
  })

  it('schema properties avoid compiler fallback native keys (debt ceiling)', () => {
    const violations: string[] = []
    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      violations.push(...schemaNativeFallbackKeys(manifest))
    }
    if (violations.length > 0) {
      console.warn(
        `[media-audit] schema native fallback keys (${violations.length}):\n` +
          violations.map((v) => `  - ${v}`).join('\n'),
      )
    }
    // 现存债务:专门 adapter 路径下原生 schema key 不塑形请求体;strict 开启前需逐 provider
    // 配 aliases 后再改 canonical。天花板不得增长;每清理若干处手动下调此值。
    const BASELINE = 83
    expect(violations.length).toBeLessThanOrEqual(BASELINE)
  })

  it('modelId is unique across builtin manifests (debt ceiling)', () => {
    const duplicates = duplicateModelIds()
    if (duplicates.length > 0) {
      console.warn(
        `[media-audit] duplicate modelIds (${duplicates.length}):\n` +
          duplicates.map((d) => `  - ${d.modelId}: ${d.manifestIds.join(', ')}`).join('\n'),
      )
    }
    // 已知原厂与聚合平台(APIMart)并存导致重复;天花板不得增长。
    const BASELINE = 11
    expect(duplicates.length).toBeLessThanOrEqual(BASELINE)
  })
})
