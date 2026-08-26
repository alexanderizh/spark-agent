import { describe, expect, it, vi } from 'vitest'
import {
  PASTED_TEXT_RESOURCE_THRESHOLD,
  buildPastedTextAttachment,
  formatCharCount,
  pasteClipboardTextAsPlainText,
  sanitizeTextFileBaseName,
  shouldConvertPastedTextToResource,
  summarizePastedText,
} from './composer-pasted-text'

describe('pasteClipboardTextAsPlainText', () => {
  it('Clipboard API 可用时直接替换选区，不触发默认 paste 阈值', async () => {
    const target = { focus: vi.fn(), replaceSelection: vi.fn() }
    const pasteNativelyWithThresholdBypass = vi.fn()

    await pasteClipboardTextAsPlainText(target, {
      readClipboardText: async () => 'x'.repeat(PASTED_TEXT_RESOURCE_THRESHOLD + 1),
      pasteNativelyWithThresholdBypass,
    })

    expect(target.focus).toHaveBeenCalledOnce()
    expect(target.replaceSelection).toHaveBeenCalledWith(
      'x'.repeat(PASTED_TEXT_RESOURCE_THRESHOLD + 1),
    )
    expect(pasteNativelyWithThresholdBypass).not.toHaveBeenCalled()
  })

  it('Clipboard API 失败时只走带阈值旁路的原生 paste', async () => {
    const target = { focus: vi.fn(), replaceSelection: vi.fn() }
    const pasteNativelyWithThresholdBypass = vi.fn()

    await pasteClipboardTextAsPlainText(target, {
      readClipboardText: async () => Promise.reject(new Error('permission denied')),
      pasteNativelyWithThresholdBypass,
    })

    expect(target.replaceSelection).not.toHaveBeenCalled()
    expect(pasteNativelyWithThresholdBypass).toHaveBeenCalledOnce()
  })
})

describe('shouldConvertPastedTextToResource', () => {
  it('阈值边界：等于阈值不转，超过阈值才转', () => {
    expect(shouldConvertPastedTextToResource('a'.repeat(PASTED_TEXT_RESOURCE_THRESHOLD))).toBe(
      false,
    )
    expect(shouldConvertPastedTextToResource('a'.repeat(PASTED_TEXT_RESOURCE_THRESHOLD + 1))).toBe(
      true,
    )
  })

  it('空字符串与短文本不转', () => {
    expect(shouldConvertPastedTextToResource('')).toBe(false)
    expect(shouldConvertPastedTextToResource('hello')).toBe(false)
  })
})

describe('summarizePastedText', () => {
  it('取首个非空白行，跳过开头的空行', () => {
    expect(summarizePastedText('\n\n  \n第一行内容\n第二行')).toBe('第一行内容')
  })

  it('超长摘要截断并加省略号', () => {
    const summary = summarizePastedText('x'.repeat(25))
    expect(summary).toBe(`${'x'.repeat(20)}…`)
  })

  it('整段空白返回空字符串', () => {
    expect(summarizePastedText(' \n\t \n')).toBe('')
  })

  it('支持自定义最大长度（文件名摘要更短）', () => {
    expect(summarizePastedText('x'.repeat(25), 16)).toBe(`${'x'.repeat(16)}…`)
  })
})

describe('formatCharCount', () => {
  it('千分位分组', () => {
    expect(formatCharCount(8214)).toBe('8,214')
    expect(formatCharCount(999)).toBe('999')
    expect(formatCharCount(1000000)).toBe('1,000,000')
  })
})

describe('sanitizeTextFileBaseName', () => {
  it('保留中日文与字母数字，其余折叠为连字符', () => {
    expect(sanitizeTextFileBaseName('收到。已将你的确认')).toBe('收到-已将你的确认')
    expect(sanitizeTextFileBaseName('a/b\\c:d*e')).toBe('a-b-c-d-e')
  })

  it('去除首尾连字符；全不安全字符返回空串', () => {
    expect(sanitizeTextFileBaseName('-abc-')).toBe('abc')
    expect(sanitizeTextFileBaseName('？？？')).toBe('')
  })
})

describe('buildPastedTextAttachment', () => {
  it('落盘请求带可读文件名前缀，chip name 带摘要与字符数', async () => {
    const text = `收到。这是第一行摘要\n${'正文'.repeat(2000)}`
    const requests: Array<{ text: string; suggestedBaseName?: string }> = []
    const attachment = await buildPastedTextAttachment(text, {
      savePastedText: async (req) => {
        requests.push(req)
        return {
          filePath: '/tmp/spark-agent-pasted-texts/pasted-text-x-1.txt',
          fileName: 'pasted-text-x-1.txt',
        }
      },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.text).toBe(text)
    expect(requests[0]?.suggestedBaseName).toMatch(/^pasted-text-收到-这是第一行摘要/)
    expect(attachment.type).toBe('file')
    expect(attachment.path).toBe('/tmp/spark-agent-pasted-texts/pasted-text-x-1.txt')
    expect(attachment.name).toContain('「收到。这是第一行摘要」')
    expect(attachment.name).toContain(`${formatCharCount(text.length)} 字符`)
  })

  it('空白文本回退默认前缀与展示名', async () => {
    const text = '\n \n'.repeat(1000)
    const attachment = await buildPastedTextAttachment(text, {
      savePastedText: async () => ({
        filePath: '/tmp/t/pasted-text-1.txt',
        fileName: 'pasted-text-1.txt',
      }),
    })
    expect(attachment.name).toContain('「粘贴文本」')
  })
})
