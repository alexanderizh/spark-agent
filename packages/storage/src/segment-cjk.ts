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
 * 同时去掉双引号字符：用户查询里的引号在 FTS5 无语义价值，留着会让 buildFtsMatchQuery
 * 的"包短语"转义产生丑陋的 """hi"""，去掉后更干净。
 *
 * @example segmentCjk('迁移到 vite') === '迁 移 到 vite'
 */
export function segmentCjk(s: string): string {
  return s
    .replace(/"/g, '')
    .replace(/[一-鿿㐀-䶿]/g, (c) => ' ' + c + ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把用户查询转换成 FTS5 MATCH 表达式。
 *
 * 策略（CJK phrase + 英文 AND 拆词）：
 *   - 连续的 CJK 单字序列合并成一个 FTS5 短语（双引号），保证多字词按相邻顺序匹配。
 *   - 非CJK token（英文词、数字）保留为独立 token，FTS5 空格 = 隐式 AND（不要求相邻）。
 *   - 例："迁移到 react hooks" → segmentCjk → "迁 移 到 react hooks"
 *         → MATCH `"迁 移 到" react hooks`（CJK 三字短语 AND react AND hooks）。
 *
 * 为何不整体包短语：整体短语要求全部 token 连续出现，长查询/多词查询（尤其会话注入的
 * seedQuery，数十~数百字自然语言拼接）几乎零命中，FTS 臂被旁路。拆分后英文词仅需共现、
 * CJK 仍按短语保序，召回率与精确度兼顾。
 *
 * @returns MATCH 表达式；查询为空（或全标点空白）时返回 null，调用方应跳过检索。
 */
export function buildFtsMatchQuery(query: string): string | null {
  const segmented = segmentCjk(query)
  if (segmented.length === 0) return null

  const tokens = segmented.split(/\s+/).filter(Boolean)
  const parts: string[] = []
  let cjkRun: string[] = []
  const flushCjk = (): void => {
    if (cjkRun.length > 0) {
      // CJK 单字序列 → FTS5 短语（内部双引号转义为两个）
      const phrase = cjkRun.join(' ').replace(/"/g, '""')
      parts.push(`"${phrase}"`)
      cjkRun = []
    }
  }
  for (const tok of tokens) {
    if (/^[一-鿿㐀-䶿]$/.test(tok)) {
      cjkRun.push(tok)
    } else {
      flushCjk()
      // 英文/数字 token：包成 FTS5 短语字面量（双引号），避免 `:` `*` `^` `(` 等
      // 特殊字符被 FTS5 语法解析。典型坑：含 `agent:` `https:` 的 query 会被
      // 当成"在 Agent/https 列搜"，触发 'no such column: Agent'（memory_fts
      // 只有 name/description/body 三列）。双引号内是字面量短语，安全。
      // 末尾 `*` 保留在引号外做前缀匹配（"agen"* → 前缀 agen*）。
      const trailingStar = tok.endsWith('*') ? '*' : ''
      const literal = (trailingStar !== '' ? tok.slice(0, -1) : tok).replace(/"/g, '""')
      parts.push(`"${literal}"${trailingStar}`)
    }
  }
  flushCjk()

  const match = parts.join(' ').trim()
  return match.length === 0 ? null : match
}
