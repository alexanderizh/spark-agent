/**
 * @module segment-cjk
 *
 * CJK 逐字预分词工具 — 记忆系统 FTS5 中文检索方案（已验证，2026-07-03）
 *
 * 背景：FTS5 的 unicode61 tokenizer 把连续中文当成一个整词（"迁移到vite"
 * 查不到"迁移"），trigram tokenizer 对二字词直接失效。
 *
 * 方案：写入与查询两侧都过同一个 segmentCjk()，把每个 CJK 字符两侧插空格
 * 使 unicode61 将其切成单字 token；查询侧再包成 FTS 短语（双引号）保证
 * 多字词按连续单字序列匹配。
 *
 * 硬约束：memory_fts 的写入与查询必须走同一个函数，两侧分词不一致会导致
 * 查不到或误命中。
 */

/**
 * 对文本中的 CJK 字符做逐字切分（两侧插入空格），并压缩多余空白。
 *
 * 覆盖范围：CJK 统一表意文字（U+4E00–U+9FFF）与扩展 A 区（U+3400–U+4DBF）。
 * 英文、数字等非 CJK 内容保持原样，因此中英混合文本两部分都可被正常索引。
 *
 * @example segmentCjk('迁移到 vite') === '迁 移 到 vite'
 */
export function segmentCjk(s: string): string {
  return s
    .replace(/[一-鿿㐀-䶿]/g, (c) => ' ' + c + ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把用户查询转换成 FTS5 MATCH 表达式：先 segmentCjk，再整体包成短语。
 *
 * 短语（双引号）保证逐字切分后的多字词仍按相邻顺序匹配，
 * 避免"迁 移"被解释成两个独立 token 的 AND 查询而误命中离散单字。
 * 内部双引号按 FTS5 规则转义为两个双引号。
 *
 * @returns MATCH 表达式；查询为空（或全是标点空白）时返回 null，调用方应跳过检索。
 */
export function buildFtsMatchQuery(query: string): string | null {
  const segmented = segmentCjk(query)
  if (segmented.length === 0) return null
  return `"${segmented.replace(/"/g, '""')}"`
}
