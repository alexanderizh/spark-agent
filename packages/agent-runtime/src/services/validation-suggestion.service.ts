import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ValidationCommandSuggestion } from '@spark/protocol'

export type ValidationSuggestion = {
  summary: string
  changedFiles: string[]
  commands: ValidationCommandSuggestion[]
}

const SCRIPT_PRIORITY = [
  'typecheck',
  'check-types',
  'tsc',
  'test:unit',
  'test',
  'vitest',
  'lint',
  'format:check',
]

const VALIDATION_SCRIPT_PATTERN = /(typecheck|check|tsc|test|vitest|lint|format:check|eslint)/i

// 仅这些源码扩展名的工作区内改动才触发「建议验证」。文档/表格/演示/图片等产物
// （docx/pdf/xlsx/pptx/png…）以及工作区外的临时脚本都不应触发 typecheck/lint。
const SOURCE_CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp',
  'cs', 'php', 'swift', 'm', 'mm', 'scala', 'sh', 'bash', 'zsh',
  'css', 'less', 'scss', 'sass', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml',
  'sql', 'graphql', 'gql', 'proto', 'astro',
])

export class ValidationSuggestionService {
  suggest(params: {
    workspaceRootPath: string
    changedFiles: string[]
  }): ValidationSuggestion | null {
    const changedFiles = uniqueChangedFiles(params.changedFiles).filter(
      (file) =>
        isInsideWorkspace(file, params.workspaceRootPath) && isSourceCodeFile(file),
    )
    if (changedFiles.length === 0) return null

    const packageJson = readPackageJson(params.workspaceRootPath)
    const scripts = packageJson?.scripts ?? {}
    const scriptNames = Object.keys(scripts).filter((name) => VALIDATION_SCRIPT_PATTERN.test(name))
    if (scriptNames.length === 0) return null

    const packageManager = detectPackageManager(params.workspaceRootPath)
    const selectedScripts = selectValidationScripts(scriptNames, changedFiles)
    if (selectedScripts.length === 0) return null

    return {
      summary: buildSummary(changedFiles),
      changedFiles,
      commands: selectedScripts.map((scriptName) => ({
        id: `script:${scriptName}`,
        label: labelForScript(scriptName),
        command: `${packageManager} run ${scriptName}`,
        reason: reasonForScript(scriptName, changedFiles),
      })),
    }
  }
}

function readPackageJson(workspaceRootPath: string): { scripts?: Record<string, string> } | null {
  try {
    const filePath = path.join(workspaceRootPath, 'package.json')
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const scripts = parsed.scripts
    if (!isRecord(scripts)) return { scripts: {} }
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(scripts)) {
      if (typeof value === 'string') normalized[key] = value
    }
    return { scripts: normalized }
  } catch {
    return null
  }
}

function detectPackageManager(workspaceRootPath: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(workspaceRootPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(workspaceRootPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function selectValidationScripts(scriptNames: string[], changedFiles: string[]): string[] {
  const scriptSet = new Set(scriptNames)
  const ranked = SCRIPT_PRIORITY.filter((name) => scriptSet.has(name))
  const fallback = scriptNames
    .filter((name) => !ranked.includes(name))
    .sort((a, b) => a.localeCompare(b))

  const candidates = [...ranked, ...fallback]
  const wantsTest = changedFiles.some((file) => /(\.test\.|\.spec\.|__tests__|tests?\/)/i.test(file))
  const wantsTypecheck = changedFiles.some((file) => /\.(ts|tsx|js|jsx|mts|cts)$/i.test(file))

  const selected: string[] = []
  for (const scriptName of candidates) {
    const lower = scriptName.toLowerCase()
    if (selected.length >= 3) break
    if (lower.includes('type') || lower.includes('tsc') || lower === 'check-types') {
      if (wantsTypecheck || selected.length === 0) selected.push(scriptName)
      continue
    }
    if (lower.includes('test') || lower.includes('vitest')) {
      if (wantsTest || wantsTypecheck || selected.length === 0) selected.push(scriptName)
      continue
    }
    if (lower.includes('lint') || lower.includes('eslint') || lower.includes('format:check')) {
      selected.push(scriptName)
    }
  }

  return selected.slice(0, 3)
}

function isInsideWorkspace(file: string, workspaceRootPath: string): boolean {
  if (!workspaceRootPath) return false
  const root = path.resolve(workspaceRootPath)
  const rel = path.relative(root, path.resolve(root, file))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function isSourceCodeFile(file: string): boolean {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  return SOURCE_CODE_EXTENSIONS.has(ext)
}

function uniqueChangedFiles(files: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const file of files) {
    const normalized = file.trim().replace(/\\/g, '/')
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result.slice(0, 50)
}

function buildSummary(changedFiles: string[]): string {
  if (changedFiles.length === 1) return `检测到 1 个文件变更，建议先运行项目验证。`
  return `检测到 ${changedFiles.length} 个文件变更，建议先运行项目验证。`
}

function labelForScript(scriptName: string): string {
  const lower = scriptName.toLowerCase()
  if (lower.includes('type') || lower.includes('tsc')) return '类型检查'
  if (lower.includes('test') || lower.includes('vitest')) return '单元测试'
  if (lower.includes('lint') || lower.includes('eslint')) return 'Lint'
  if (lower.includes('format')) return '格式检查'
  return scriptName
}

function reasonForScript(scriptName: string, changedFiles: string[]): string {
  const lower = scriptName.toLowerCase()
  if (lower.includes('type') || lower.includes('tsc')) return '本轮修改包含代码文件，先确认类型契约没有漂移。'
  if (lower.includes('test') || lower.includes('vitest')) {
    return changedFiles.some((file) => /(\.test\.|\.spec\.|__tests__|tests?\/)/i.test(file))
      ? '本轮触及测试相关文件，建议运行对应测试。'
      : '代码变更后建议跑一轮单测，尽早暴露回归。'
  }
  if (lower.includes('lint') || lower.includes('eslint')) return '检查静态规则和常见可维护性问题。'
  return '项目脚本匹配验证类任务。'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
