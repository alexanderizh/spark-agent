/**
 * 结构化文本（JSON / YAML）的语言识别。
 *
 * OpenAPI 导入弹窗允许粘贴 JSON 或 YAML，控件需要据此选 Monaco 语言。判定只看首个非空白
 * 字符：`{` / `[` 视为 JSON，其余（含空内容）按 YAML 处理——YAML 是 JSON 的超集式写法，
 * 且 YAML 语言在 Monaco 里对纯文本输入也不会误报。
 */

export type StructuredTextLanguage = 'json' | 'yaml'

export function detectStructuredTextLanguage(text: string): StructuredTextLanguage {
  const first = text.trimStart().charAt(0)
  return first === '{' || first === '[' ? 'json' : 'yaml'
}
