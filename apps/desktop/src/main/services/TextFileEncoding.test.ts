import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import {
  decodeTextFileBuffer,
  encodeTextFileContent,
  parseTextFileEncoding,
} from './TextFileEncoding.js'

describe('decodeTextFileBuffer', () => {
  it('纯 ASCII 解码为 utf-8', () => {
    const r = decodeTextFileBuffer(Buffer.from('public class A {}', 'utf-8'))
    expect(r.encoding).toBe('utf-8')
    expect(r.content).toBe('public class A {}')
  })

  it('合法 UTF-8 中文解回原文本', () => {
    const text = '// 中文注释\nString s = "你好";\n'
    const r = decodeTextFileBuffer(Buffer.from(text, 'utf-8'))
    expect(r.encoding).toBe('utf-8')
    expect(r.content).toBe(text)
  })

  it('GBK 编码的 Java 源文件识别为 gb18030 且无乱码（回归：预览乱码根因）', () => {
    const text = '// 用户名称\nprivate String userName = "张三";\n'
    const r = decodeTextFileBuffer(iconv.encode(text, 'gbk'))
    expect(r.encoding).toBe('gb18030')
    expect(r.content).toBe(text)
  })

  it('UTF-8 BOM：剥离 BOM 并标记 utf-8-bom', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好', 'utf-8')])
    const r = decodeTextFileBuffer(buf)
    expect(r.encoding).toBe('utf-8-bom')
    expect(r.content).toBe('你好')
  })

  it('UTF-16 LE/BE BOM 正确解码', () => {
    const le = decodeTextFileBuffer(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')]),
    )
    expect(le.encoding).toBe('utf-16le')
    expect(le.content).toBe('你好')

    const beBuf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')])
    beBuf.swap16()
    const be = decodeTextFileBuffer(beBuf)
    expect(be.encoding).toBe('utf-16be')
    expect(be.content).toBe('你好')
  })

  it('二进制/损坏内容退回宽松 utf-8（旧行为）', () => {
    const r = decodeTextFileBuffer(Buffer.from([0xd6, 0xd0, 0xff, 0xfe, 0x00]))
    expect(r.encoding).toBe('utf-8')
    expect(r.content).toContain('�')
  })

  it('空文件返回 utf-8 空串', () => {
    expect(decodeTextFileBuffer(Buffer.alloc(0))).toEqual({ content: '', encoding: 'utf-8' })
  })
})

describe('encodeTextFileContent', () => {
  it('gb18030 round-trip：编码后可被 GBK 解码器还原', () => {
    const text = '// 修改注释\nint 数量 = 42;\n'
    const buf = encodeTextFileContent(text, 'gb18030')
    expect(iconv.decode(buf, 'gbk')).toBe(text)
    // 写回后再走读端识别，编码保持不变
    expect(decodeTextFileBuffer(buf).encoding).toBe('gb18030')
  })

  it('utf-8-bom 写回时重建 BOM', () => {
    const buf = encodeTextFileContent('你好', 'utf-8-bom')
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(buf.subarray(3).toString('utf-8')).toBe('你好')
  })

  it('utf-16le/be 写回带 BOM 且 round-trip 一致', () => {
    const le = encodeTextFileContent('你好', 'utf-16le')
    expect(le.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))).toBe(true)
    expect(le.subarray(2).toString('utf16le')).toBe('你好')

    const be = encodeTextFileContent('你好', 'utf-16be')
    const round = decodeTextFileBuffer(be)
    expect(round.encoding).toBe('utf-16be')
    expect(round.content).toBe('你好')
  })

  it('缺省/未知编码按 utf-8', () => {
    expect(encodeTextFileContent('ok', undefined).toString('utf-8')).toBe('ok')
    expect(parseTextFileEncoding('latin1')).toBe('utf-8')
    expect(parseTextFileEncoding('gb18030')).toBe('gb18030')
    expect(parseTextFileEncoding(undefined)).toBe('utf-8')
  })
})
