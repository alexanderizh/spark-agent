/**
 * 扩展名 → Monaco language id 映射，以及「是否代码类文件」判定。
 *
 * - getMonacoLanguage: 给 Monaco Editor / DiffEditor 的 language prop 用。
 *   返回的是 Monaco 内置 language id（字符串），不 import monaco-editor 类型，避免把
 *   数 MB 的 monaco 拉进只做语言判定的模块。
 * - isCodeLikeFile: ChatView.handleFilePreview 用它决定「点这个文件 → 进代码 tab」
 *   还是「走 FilePreviewPanel（md/html/image/office）」。代码/配置/文本类返回 true。
 */

/** 扩展名（小写、无点）→ Monaco language id */
const EXT_LANG_MAP: Record<string, string> = {
  // TS / JS
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // 数据/配置
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  // 样式
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  // 标记
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  xml: 'xml',
  svg: 'xml',
  vue: 'html',
  svelte: 'html',
  // 后端
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  scala: 'scala',
  clj: 'clojure',
  cljs: 'clojure',
  ex: 'elixir',
  exs: 'elixir',
  lua: 'lua',
  dart: 'dart',
  r: 'r',
  // shell / 脚本
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  // 数据库
  sql: 'sql',
  // 文档
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  // 配置
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  properties: 'ini',
  // 其他
  graphql: 'graphql',
  proto: 'proto',
  dockerfile: 'dockerfile',
}

/** 无扩展名但按代码文件处理的文件名（小写） */
const CODE_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'gemfile',
  'rakefile',
  'brewfile',
  'procfile',
  '.editorconfig',
  '.gitignore',
  '.npmrc',
  '.prettierrc',
  '.eslintrc',
  '.bashrc',
  '.zshrc',
])

/** 纯文本类（无高亮但当作可编辑文本打开） */
const TEXT_LIKE_EXTENSIONS = new Set(['txt', 'text', 'log', 'env', 'csv', 'tsv'])

function extractExt(filePath: string): string | null {
  const clean = filePath.replace(/^.*[\\/]/, '')
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return null
  return clean.slice(dot + 1).toLowerCase()
}

function extractBasename(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, '').toLowerCase()
}

/** 返回 Monaco language id；未知扩展返回 'plaintext' */
export function getMonacoLanguage(filePath: string): string {
  const ext = extractExt(filePath)
  if (ext == null) {
    const base = extractBasename(filePath)
    if (base === 'dockerfile') return 'dockerfile'
    if (base === 'makefile') return 'makefile'
    return 'plaintext'
  }
  return EXT_LANG_MAP[ext] ?? 'plaintext'
}

/**
 * 是否「代码/配置/文本类」文件 —— 应路由到「代码」tab 而非 FilePreviewPanel。
 * markdown 也算（代码 tab 的 markdown 用 Monaco 看 raw 比纯预览更利于编辑）。
 */
export function isCodeLikeFile(filePath: string): boolean {
  const ext = extractExt(filePath)
  if (ext == null) {
    return CODE_BASENAMES.has(extractBasename(filePath))
  }
  return ext in EXT_LANG_MAP || TEXT_LIKE_EXTENSIONS.has(ext)
}
