/**
 * TextFileEncoding —— 文本文件编码的识别与按原编码写回。
 *
 * 背景：代码编辑器 / 文件预览此前一律按 utf-8 读取，中文环境下常见的 GBK/GB18030
 * Java 源文件会被解码成 U+FFFD 乱码（不可逆）。本模块在读端自动识别编码，
 * 并让写端按读到的编码原样写回，保证 round-trip 不改变文件编码。
 *
 * 识别顺序：
 *  1. BOM（UTF-8 / UTF-16 LE / UTF-16 BE）—— 最可靠的信号，优先命中；
 *  2. 严格 UTF-8 校验（TextDecoder fatal）—— 合法 UTF-8 一定是 UTF-8；
 *  3. GB18030（GBK/GB2312 超集）兜底 —— 中文 Windows 编辑器产出的常见编码；
 *  4. 以上都失败（真正的二进制/损坏文件）退回宽松 utf-8，维持旧行为。
 *
 * 注：Electron 自带 full-ICU，主进程 TextDecoder 支持 gb18030 / utf-16be。
 * GB18030 编码（写回方向）Node 原生无能力（TextEncoder 仅 utf-8），用 iconv-lite。
 */

import iconv from 'iconv-lite'

/** 文本文件可识别/可写回的编码集合（协议层以 string 传输，此处收敛合法值） */
export type TextFileEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gb18030'

export interface DecodedTextFile {
  /** 解码后的文本内容（BOM 已剥离，可直接进编辑器） */
  content: string
  /** 识别出的源编码；保存时应原样传回 encodeTextFileContent */
  encoding: TextFileEncoding
}

const TEXT_FILE_ENCODINGS: readonly TextFileEncoding[] = [
  'utf-8',
  'utf-8-bom',
  'utf-16le',
  'utf-16be',
  'gb18030',
]

/** 将协议传来的 encoding 字符串收敛为合法值；未知/缺省返回 'utf-8' */
export function parseTextFileEncoding(value: unknown): TextFileEncoding {
  return typeof value === 'string' && (TEXT_FILE_ENCODINGS as readonly string[]).includes(value)
    ? (value as TextFileEncoding)
    : 'utf-8'
}

function decodeWith(label: string, buf: Buffer): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

/**
 * 轻量二进制探测：有 BOM 的 UTF-16 明确视为文本；其余样本若含 NUL，或不可打印
 * 控制字节占比明显过高，则视为二进制。该判断只用于编辑器预览前置拦截，编码识别仍由
 * decodeTextFileBuffer 负责。
 */
export function looksLikeBinaryTextBuffer(buf: Buffer): boolean {
  if (buf.length === 0) return false
  if (buf.subarray(0, 2).equals(UTF16LE_BOM) || buf.subarray(0, 2).equals(UTF16BE_BOM)) {
    return false
  }

  let suspiciousControls = 0
  for (const byte of buf) {
    if (byte === 0) return true
    const allowedWhitespace = byte === 9 || byte === 10 || byte === 12 || byte === 13
    if (!allowedWhitespace && (byte < 32 || byte === 127)) suspiciousControls += 1
  }
  return suspiciousControls > Math.max(4, Math.floor(buf.length * 0.1))
}

/** 识别 Buffer 的文本编码并解码；解码失败（二进制等）退回宽松 utf-8（含 U+FFFD），与旧行为一致 */
export function decodeTextFileBuffer(buf: Buffer): DecodedTextFile {
  if (buf.length === 0) return { content: '', encoding: 'utf-8' }

  // 1. BOM 检测（BOM 之后的内容按对应编码严格解码，失败则继续走后面的探测）
  if (buf.subarray(0, 3).equals(UTF8_BOM)) {
    const content =
      decodeWith('utf-8', buf.subarray(3)) ?? new TextDecoder('utf-8').decode(buf.subarray(3))
    return { content, encoding: 'utf-8-bom' }
  }
  if (buf.subarray(0, 2).equals(UTF16LE_BOM)) {
    const content =
      decodeWith('utf-16le', buf.subarray(2)) ?? new TextDecoder('utf-16le').decode(buf.subarray(2))
    return { content, encoding: 'utf-16le' }
  }
  if (buf.subarray(0, 2).equals(UTF16BE_BOM)) {
    const content =
      decodeWith('utf-16be', buf.subarray(2)) ?? new TextDecoder('utf-16be').decode(buf.subarray(2))
    return { content, encoding: 'utf-16be' }
  }

  // 2. 合法 UTF-8 一定是 UTF-8（无 BOM 场景下的最优先判定）
  const utf8 = decodeWith('utf-8', buf)
  if (utf8 != null) return { content: utf8, encoding: 'utf-8' }

  // 3. GB18030 兜底（GBK/GB2312 超集，覆盖中文 Windows 产出的源码文件）
  const gb = decodeWith('gb18030', buf)
  if (gb != null) return { content: gb, encoding: 'gb18030' }

  // 4. 二进制/损坏文件：退回宽松 utf-8，维持旧版行为
  return { content: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8' }
}

/** 按指定编码把文本编码回 Buffer（写端）；encoding 非法时按 utf-8 处理 */
export function encodeTextFileContent(
  content: string,
  encoding: TextFileEncoding | undefined,
): Buffer {
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([UTF8_BOM, Buffer.from(content, 'utf-8')])
    case 'utf-16le':
      return Buffer.concat([UTF16LE_BOM, Buffer.from(content, 'utf16le')])
    case 'utf-16be': {
      // Node 原生只支持 utf16le，BE 通过字节交换得到
      const le = Buffer.from(content, 'utf16le')
      const be = Buffer.allocUnsafe(le.length)
      for (let i = 0; i + 1 < le.length; i += 2) {
        be.writeUInt16BE(le.readUInt16LE(i), i)
      }
      return Buffer.concat([UTF16BE_BOM, be])
    }
    case 'gb18030':
      // GBK/GB2312 是 GB18030 子集，写回统一按 gb18030 编码
      return iconv.encode(content, 'gb18030')
    case 'utf-8':
    default:
      return Buffer.from(content, 'utf-8')
  }
}
