/**
 * 「JSON 模板」语言（自定义 Monarch 着色，无语言服务）。
 *
 * 专供 HTTP 工具的 JSON Body 模板字段，为什么不直接用 Monaco 内置 `json`：
 * 模板允许在**值位置直接写占位符**（协议层 `assertJsonTemplateStructure` 会先把 `{{name}}`
 * 换成哨兵字符串再按 JSON 解析，见 packages/protocol/src/custom-tools.ts）。也就是说
 * `"title": {{title}}` 是合法模板——本项目 OpenAPI 导入生成的模板正是这个形状。
 * 用内置 `json` 会把它判成非法 JSON，在自家生成的草稿上打红色波浪线。
 *
 * 所以这里注册一个只着色、不带语言服务的语言：
 *  - 键 / 字符串 / 数字 / true|false|null / 标点沿用内置 json 的 token 名，浅色与暗色主题的
 *    配色和代码视图里的 JSON 完全一致，不需要自带主题；
 *  - `{{占位符}}` 用 variable.predefined 单独着色（值位置和字符串内部都生效），
 *    模板里最需要被一眼看到的部分由此区分出来。
 *
 * 无 worker、无校验 ⇒ 不会产生任何诊断摘要（codeEditorDiagnostics 对该语言返回 null）。
 */

import * as monaco from 'monaco-editor'

export const JSON_TEMPLATE_LANGUAGE_ID = 'spark-json-template'

/** 可读性优先的占位符配色 token（vs / vs-dark 均已在基础主题里定义） */
const PLACEHOLDER_TOKEN = 'variable.predefined'

let registered = false

/** 幂等注册（多个 CodeEditor 实例重复调用是安全的）。 */
export function ensureTemplateJsonLanguage(): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: JSON_TEMPLATE_LANGUAGE_ID })

  monaco.languages.setMonarchTokensProvider(JSON_TEMPLATE_LANGUAGE_ID, {
    defaultToken: '',
    tokenizer: {
      root: [
        // 值位置的 {{参数}}（在字符串规则之前匹配）
        [/\{\{/, { token: PLACEHOLDER_TOKEN, next: '@placeholder' }],
        // 属性名：后接冒号的字符串
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key.json'],
        // 字符串值（内部可能嵌占位符，交给 @string 状态继续处理）
        [/"/, { token: 'string.value.json', next: '@string' }],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number.json'],
        [/\b(?:true|false|null)\b/, 'keyword.json'],
        [/\{/, 'delimiter.bracket.json'],
        [/\}/, 'delimiter.bracket.json'],
        [/\[/, 'delimiter.array.json'],
        [/\]/, 'delimiter.array.json'],
        [/,/, 'delimiter.comma.json'],
        [/:/, 'delimiter.colon.json'],
      ],
      string: [
        [/[^"\\{]+/, 'string.value.json'],
        [/\{\{/, { token: PLACEHOLDER_TOKEN, next: '@stringPlaceholder' }],
        [/\\[\s\S]/, 'string.value.json'],
        [/"/, { token: 'string.value.json', next: '@pop' }],
        [/[{]/, 'string.value.json'],
      ],
      placeholder: [
        [/\}\}/, { token: PLACEHOLDER_TOKEN, next: '@pop' }],
        [/./, PLACEHOLDER_TOKEN],
      ],
      stringPlaceholder: [
        [/\}\}/, { token: PLACEHOLDER_TOKEN, next: '@pop' }],
        [/./, PLACEHOLDER_TOKEN],
      ],
    },
  })
}
