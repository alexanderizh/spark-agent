/**
 * 内容区代码块的语言归一化与分类（shiki 着色 / 富渲染共用）。
 *
 * 背景：shiki 的 `bundledLanguages` 里没有 svg，xml 也不带别名（实测把
 * 'svg' / 'xsl' / 'xsd' / 'plist' 直接交给 codeToHtml 会抛 `Language not found`）。
 * 于是 ```svg 代码块只能落进 MarkdownCodeBlock 的 highlightFailed 分支，
 * 渲染成整段无着色纯文本。这里统一在进 shiki 之前把语言标签归一到主语言，
 * 并把「是否直接渲染 SVG 图形」的判定也建在同一份归一结果上，避免着色与富渲染
 * 两处判定漂移。
 */

/** shiki 预加载语言集合（不在集合内的语言标签会回落成无着色纯文本） */
export const COMMON_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'css',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'python',
  'rust',
  'sql',
  'tsx',
  'typescript',
  'xml',
  'yaml',
] as const

/**
 * 语言标签别名 → shiki 主语言 id。
 * 标注 `xml` 家族的部分是本次补的：shiki 只收录 `xml`，`svg` 等标签不归一就整段无色。
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  cplusplus: 'cpp',
  cxx: 'cpp',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  golang: 'go',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  yml: 'yaml',
  // SVG / XML 家族
  svg: 'xml',
  svgz: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  xsd: 'xml',
  xhtml: 'xml',
  rss: 'xml',
  atom: 'xml',
  plist: 'xml',
  wsdl: 'xml',
}

/** 直接渲染成图形（而不是只看源码）的代码块语言标签 */
const SVG_GRAPHIC_LANGUAGES = new Set(['svg'])

/** 语言标签归一：去空白、小写、别名映射；未知标签原样返回（着色阶段回落纯文本） */
export function normalizeCodeLanguage(lang: string): string {
  const normalized = lang.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

/** 该代码块语言是否应直接渲染 SVG 图形（判定用原始标签，不受别名影响） */
export function isSvgCodeLanguage(lang: string): boolean {
  return SVG_GRAPHIC_LANGUAGES.has(lang.trim().toLowerCase())
}
