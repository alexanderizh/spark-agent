/**
 * 审计载荷管道回归：真机实测发现脱敏摘要边界（512 字符/串）误伤工具输出正文——
 * 超长输出被截断进归档且 result_truncated 不置位，「结果查看」名存实亡。
 * 载荷路径必须走 FULL_CONTENT_BOUNDS（正文完整 + 凭据掩码全文扫描）。
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, redactToolPayload } from './tool-audit-payload.js'

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest('hex')
}

describe('redactToolPayload', () => {
  it('keeps long tool output intact (512-char summary clip must not apply to payloads)', () => {
    const lines = Array.from(
      { length: 120 },
      (_, i) => `第 ${i + 1} 行：滚动测试数据abcdefghijklmnopqrst0123456789`,
    )
    const output = lines.join('\n') // ≈ 6KB，摘要管道会在 512 字符处截断
    const redacted = redactToolPayload(output)
    expect(typeof redacted).toBe('string')
    expect(redacted).toBe(output) // 无凭据 → 原文完整保留
    expect(redacted).not.toContain('…[truncated]')
  })

  it('masks credentials beyond the summary scrub window in long payloads', () => {
    const prefix = 'log line\n'.repeat(300) // 凭据位于旧 1024 字符窗口之外
    const output = `${prefix}token=sk-abcdef0123456789abcdef\ndone`
    const redacted = redactToolPayload(output)
    expect(typeof redacted).toBe('string')
    expect(redacted).not.toContain('sk-abcdef0123456789abcdef')
    expect(redacted).toContain('***')
    expect((redacted as string).startsWith(prefix)).toBe(true)
  })

  it('hash recomputes over the full payload representation', () => {
    const payload = { output: 'y'.repeat(5000), nested: { list: ['z'.repeat(700)] } }
    const redacted = redactToolPayload(payload)
    // 脱敏不改变无凭据内容 → 哈希与原始载荷一致（链校验可复算的前提）
    expect(sha256(redacted)).toBe(sha256(payload))
    // 嵌套长串同样完整（旧管道 700 > 512 会被截断）
    const nestedList = (redacted as { nested: { list: string[] } }).nested.list
    expect(nestedList[0]).toBe('z'.repeat(700))
  })
})
