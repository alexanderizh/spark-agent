/**
 * 富文档（docx / xlsx / pptx / odt / rtf）文字提取。
 *
 * 与 canvasFileDrop.ts（纯分类）解耦：本文件是唯一引入解析依赖的地方，
 * 且用动态 import 懒加载，避免把 mammoth / exceljs 打进画布初始 bundle。
 *
 * 设计原则：
 * - 解析失败绝不抛到调用方——富文档格式复杂、版本众多，任何解析异常都回退为
 *   「留档提示」文本节点（带原文件名），保证拖入体验稳定，不中断批量导入。
 * - 纯 renderer 实现（File.arrayBuffer() → 内存解析），不依赖主进程 IPC，
 *   避免与主进程 IPC 改动冲突。
 */

/** 提取结果：放进文本节点的文字 + 渲染格式。 */
export type ExtractedDocument = {
  text: string
  /** plain=纯文本；markdown=含 Markdown 结构（如 Excel 各 sheet 的 `# sheet名` 标题） */
  format: 'plain' | 'markdown'
  /** 是否为解析失败的兜底结果（true 时 text 只是留档提示）。 */
  fallback: boolean
}

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/**
 * 把 docx / odt / rtf / 旧版 doc 提取为纯文本。
 * mammoth 原生支持 docx；odt / rtf / doc 可能不支持，交由上层兜底。
 */
async function extractWordLike(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer })
  return (result?.value ?? '').trim()
}

/** 把单个 ExcelJS 单元格值归一化为纯文本（cell.value 可能是 richText/formula/Date 等对象）。 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const v = value as {
      richText?: Array<{ text?: string }>
      result?: unknown
      hyperlink?: string
      text?: string
      error?: string
    }
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? '').join('')
    // 公式单元格：优先取计算结果
    if ('result' in v) return cellToString(v.result)
    if (typeof v.hyperlink === 'string') return v.hyperlink
    if (typeof v.text === 'string') return v.text
    if (typeof v.error === 'string') return v.error
  }
  return String(value)
}

/** CSV 单元格转义：含逗号 / 引号 / 换行时用双引号包裹并转义内部引号。 */
function toCsvCell(text: string): string {
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * 把 xlsx / xls 的所有 sheet 拼成 Markdown：每个 sheet 以 `# sheet名` 为标题，
 * 下方是该 sheet 的 CSV 文本。ExcelJS 浏览器构建需 vite optimizeDeps 预打包
 * （见 electron.vite.config.ts 的 renderer.optimizeDeps.include）。
 */
async function extractSpreadsheet(arrayBuffer: ArrayBuffer): Promise<string> {
  type ExcelJsModule = typeof import('exceljs')
  const exceljsModule: ExcelJsModule = await import('exceljs')
  // 兼容 CJS/ESM 双形态：vite 预构建后命名空间可能挂在 .default
  const ExcelJS = (exceljsModule as ExcelJsModule & { default?: ExcelJsModule }).default ?? exceljsModule
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer)
  const blocks: string[] = []
  workbook.eachSheet((sheet) => {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: true }, (row) => {
      // row.values 是稀疏数组（1-based，空单元格为 undefined）
      const cells = row.values as unknown[]
      const parts: string[] = []
      for (let i = 1; i < cells.length; i += 1) {
        parts.push(toCsvCell(cellToString(cells[i])))
      }
      rows.push(parts.join(','))
    })
    if (rows.length > 0) blocks.push(`# ${sheet.name}\n${rows.join('\n')}`)
  })
  return blocks.join('\n\n').trim()
}

/**
 * 从富文档 File 提取文字。
 *
 * 按扩展名分派到对应解析器；任何异常（含 pptx 这类暂不支持的格式）都走兜底，
 * 返回带原文件名的留档提示，调用方据此仍可创建一个文本节点。
 */
export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  const ext = getExtension(file.name)
  const baseName = file.name.replace(/\.[^.]+$/, '')
  try {
    const arrayBuffer = await file.arrayBuffer()
    let text = ''
    let format: 'plain' | 'markdown' = 'plain'
    if (ext === 'xlsx' || ext === 'xls') {
      text = await extractSpreadsheet(arrayBuffer)
      format = 'markdown' // sheet 名作 Markdown 标题
    } else if (ext === 'docx' || ext === 'odt' || ext === 'rtf' || ext === 'doc') {
      text = await extractWordLike(arrayBuffer)
    } else {
      // pptx 等暂无专用解析器：交由兜底
      throw new Error(`unsupported document type: .${ext}`)
    }
    const trimmed = text.trim()
    if (!trimmed) {
      return {
        text: `【${file.name}】文档内容为空或未能解析出文字。`,
        format: 'plain',
        fallback: true,
      }
    }
    return { text: trimmed, format, fallback: false }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      text: `【${baseName}】（.${ext || '文档'}）解析失败：${reason}。已保留文件名留档，可双击节点手动处理。`,
      format: 'plain',
      fallback: true,
    }
  }
}
