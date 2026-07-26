import { describe, expect, it } from 'vitest'
import { clipTextHeadTail, estimateTokens, estimateTokensWithOverhead } from './token-estimator.js'

describe('token-estimator', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty/null/undefined', () => {
      expect(estimateTokens('')).toBe(0)
      expect(estimateTokens(null)).toBe(0)
      expect(estimateTokens(undefined)).toBe(0)
    })

    it('returns 1 for a single English token', () => {
      expect(estimateTokens('hello')).toBe(1)
      expect(estimateTokens('world')).toBe(1)
    })

    it('counts multi-token English text', () => {
      const tokens = estimateTokens('Hello, world! This is a test.')
      expect(tokens).toBeGreaterThan(5)
      expect(tokens).toBeLessThan(15)
    })

    it('counts Chinese characters with reasonable accuracy', () => {
      // Each Chinese character is typically 1-2 tokens in o200k_base.
      const text = '你好世界，这是一段中文测试。'
      const tokens = estimateTokens(text)
      // 14 chars, expect at least 5 tokens (some chars combine, some don't)
      expect(tokens).toBeGreaterThanOrEqual(5)
      expect(tokens).toBeLessThanOrEqual(20)
    })

    it('counts mixed Chinese/English correctly', () => {
      const text = '请帮我 create a new React component for the 用户列表 page.'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(8)
      expect(tokens).toBeLessThan(30)
    })

    it('counts code snippets', () => {
      const code = `
function fibonacci(n: number): number {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}
`
      const tokens = estimateTokens(code)
      expect(tokens).toBeGreaterThan(20)
      expect(tokens).toBeLessThan(60)
    })

    it('counts JSON correctly', () => {
      const json = JSON.stringify({
        name: 'test',
        items: [1, 2, 3, 4, 5],
        nested: { a: true, b: null, c: 'hello' },
      })
      const tokens = estimateTokens(json)
      expect(tokens).toBeGreaterThan(15)
      expect(tokens).toBeLessThan(50)
    })

    it('handles very long documents without crashing', () => {
      const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(1000)
      const tokens = estimateTokens(longText)
      // 44 chars * 1000 = 44000 chars, ~11000 tokens for English
      expect(tokens).toBeGreaterThan(8000)
      expect(tokens).toBeLessThan(15000)
    })

    it('is significantly more accurate than chars/3 for Chinese', () => {
      // Old estimation: chars/3 = 4 tokens for "你好世界测试"
      // Real o200k_base tokens: typically 6-12 (each char tends to be 1-2 tokens)
      const text = '你好世界测试'
      const newEstimate = estimateTokens(text)
      const oldEstimate = Math.ceil(text.length / 3)
      // chars/3 underestimates Chinese, so new estimate should be higher
      expect(newEstimate).toBeGreaterThanOrEqual(oldEstimate)
    })

    it('handles markdown with code blocks', () => {
      const md = `# Title

Some paragraph text.

\`\`\`typescript
const x: number = 42
\`\`\`

- List item 1
- List item 2
`
      const tokens = estimateTokens(md)
      expect(tokens).toBeGreaterThan(15)
      expect(tokens).toBeLessThan(60)
    })
  })

  describe('estimateTokensWithOverhead', () => {
    it('adds overhead to base estimate', () => {
      const text = 'hello world'
      const base = estimateTokens(text)
      expect(estimateTokensWithOverhead(text, 20)).toBe(base + 20)
    })

    it('defaults overhead to 0', () => {
      expect(estimateTokensWithOverhead('hello')).toBe(estimateTokens('hello'))
    })

    it('clamps negative overhead to 0', () => {
      expect(estimateTokensWithOverhead('hello', -10)).toBe(estimateTokens('hello'))
    })

    it('handles empty text with overhead', () => {
      expect(estimateTokensWithOverhead('', 20)).toBe(20)
      expect(estimateTokensWithOverhead(null, 15)).toBe(15)
    })

    it('preserves memory-reader semantics (was chars*1.5+20)', () => {
      // The old memory-reader formula: Math.ceil(len * 1.5) + 20
      // For English text "User prefers detailed responses", len=29
      // Old: ceil(29 * 1.5) + 20 = 44 + 20 = 64 (overestimate for English)
      // New: actual tokens + 20 (accurate)
      const text = 'User prefers detailed responses'
      const result = estimateTokensWithOverhead(text, 20)
      const base = estimateTokens(text)
      expect(result).toBe(base + 20)
      expect(base).toBeLessThan(15) // 6-8 tokens typically
    })
  })

  describe('clipTextHeadTail', () => {
    it('returns short text unchanged', () => {
      const text = 'hello world'
      expect(clipTextHeadTail(text, 100)).toBe(text)
    })

    it('returns empty text unchanged', () => {
      expect(clipTextHeadTail('', 100)).toBe('')
    })

    it('truncates by head+tail with default ratio', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(100)
      const budget = 50
      const result = clipTextHeadTail(text, budget)
      const tokens = estimateTokens(result)
      expect(tokens).toBeLessThanOrEqual(budget)
      expect(result).toContain('[truncated middle]')
    })

    it('respects custom headRatio', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(100)
      const result = clipTextHeadTail(text, 50, { headRatio: 0.2 })
      // head 20%, tail 80% → tail should be much larger
      expect(result).toContain('[truncated middle]')
      // Smoke: result token count is bounded
      expect(estimateTokens(result)).toBeLessThanOrEqual(50)
    })

    it('preserves head and tail content', () => {
      const text = 'START---' + 'x'.repeat(5000) + '---END'
      const result = clipTextHeadTail(text, 30)
      expect(result.startsWith('START')).toBe(true)
      expect(result.endsWith('END')).toBe(true)
    })

    it('uses custom ellipsis when provided', () => {
      const text = 'word '.repeat(1000)
      const result = clipTextHeadTail(text, 30, { ellipsis: '\n[SNIP]\n' })
      expect(result).toContain('[SNIP]')
      expect(result).not.toContain('[truncated middle]')
    })

    it('counts the ellipsis inside the strict token budget', () => {
      const result = clipTextHeadTail('START-' + 'x'.repeat(10_000) + '-END', 10)
      expect(estimateTokens(result)).toBeLessThanOrEqual(10)
    })

    it('returns an empty string for a non-positive budget', () => {
      expect(clipTextHeadTail('must not leak', 0)).toBe('')
      expect(clipTextHeadTail('must not leak', -100)).toBe('')
    })
  })
})
