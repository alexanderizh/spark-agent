/**
 * 技能目录文件树 / 路径守卫（纯函数，零 Electron 依赖，便于单测覆盖）。
 *
 * 技能详情页需要浏览、预览、编辑技能目录内的文件。安全模型与工作区文件操作
 * （registerFileOperationsIpc）不同：技能根目录本身可能是「用户安装目录之外」的
 * 路径（宿主软链 → ~/.claude/skills/xxx、内置技能 → 应用 resources/），因此不能
 * 复用全局白名单 isSafeFilePathAllowed。这里改为**以技能根目录为唯一边界**：
 *
 *   1. 词法守卫：resolveInsideRoot —— 拒绝 `../` 越界、绝对路径、根目录本身
 *   2. canonical 守卫：目标（或已存在文件的父目录）realpath 后必须仍落在
 *      realpath(技能根) 内 —— 防技能目录内的软链逃逸到敏感目录
 *
 * realpath(技能根) 会跟随「技能目录本身是软链」的情况，于是软链导入的技能依旧可读写
 * 其真实目录；而技能目录内**指向外部的软链文件**会被第 2 层拦下。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SkillFileNode } from '@spark/protocol'
import { isPathNestedIn, resolveInsideRoot } from './pathGuard.js'

/** 目录遍历最大深度（技能目录一般很浅，防御异常深的结构） */
export const SKILL_TREE_MAX_DEPTH = 6
/** 目录遍历最多收集的条目数（防御超大目录把文件树撑爆） */
export const SKILL_TREE_MAX_ENTRIES = 500
/** 单文件读取上限（字节），超过则截断返回 */
export const SKILL_FILE_MAX_BYTES = 2 * 1024 * 1024
/** 单文件写入上限（字节） */
export const SKILL_FILE_MAX_WRITE_BYTES = 4 * 1024 * 1024

/** 技能目录内按约定忽略的条目（版本控制 / 依赖 / 系统文件） */
const IGNORED_SKILL_ENTRIES = new Set(['node_modules', '.git', '.DS_Store'])

export function isIgnoredSkillEntry(name: string): boolean {
  return name.startsWith('.') || IGNORED_SKILL_ENTRIES.has(name)
}

/**
 * 词法守卫：把相对技能根的 posix 路径解析为绝对路径，并确认落在技能根内。
 * 越界（`../`、绝对路径、等于技能根）时抛错，由 handler 转成 response.error。
 */
export function resolveSkillFilePath(skillRoot: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.trim().length === 0) {
    throw new Error('文件路径不能为空')
  }
  // 统一分隔符：反斜杠写法也按 posix 处理，避免 Windows 风格路径绕过校验
  const normalized = relPath.replace(/\\/g, '/')
  return resolveInsideRoot(skillRoot, normalized)
}

/** 逐级向上找到最近一个真实存在的祖先目录的 canonical 路径（都不存在时返回 null） */
async function nearestExistingAncestor(targetPath: string): Promise<string | null> {
  let current = targetPath
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      return await fs.realpath(current)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * canonical 守卫：真实路径必须仍落在 realpath(技能根) 内。
 *
 * - `realRoot` 由调用方通过 realpath(skillRoot) 得到（技能根本身可为软链）
 * - 目标尚未创建（新建文件）时改用「最近一个存在的祖先目录」校验
 * - 目标已存在时额外校验自身真实路径（防目标文件本身是逃逸软链）
 */
export async function assertInsideRealRoot(realRoot: string, targetAbs: string): Promise<void> {
  const ancestorReal = await nearestExistingAncestor(path.dirname(targetAbs))
  if (ancestorReal == null || !isPathNestedIn(realRoot, ancestorReal)) {
    throw new Error('路径超出技能目录范围')
  }
  try {
    const targetReal = await fs.realpath(targetAbs)
    if (!isPathNestedIn(realRoot, targetReal)) {
      throw new Error('路径超出技能目录范围')
    }
  } catch (err) {
    // 目标尚不存在（新建）→ 祖先目录校验已足够
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * 递归构建技能目录文件树。
 *
 * 排序规则：目录在前、同类按名称升序（与代码查看器文件树一致，SKILL.md 由前端置顶）。
 * 超过 SKILL_TREE_MAX_ENTRIES 时停止遍历并置 truncated。
 */
export async function buildSkillFileTree(
  skillRoot: string,
): Promise<{ files: SkillFileNode[]; truncated: boolean }> {
  let collected = 0
  let truncated = false

  const walk = async (absDir: string, relDir: string, depth: number): Promise<SkillFileNode[]> => {
    if (depth > SKILL_TREE_MAX_DEPTH) return []
    let entries: Array<import('node:fs').Dirent>
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }

    const dirs: SkillFileNode[] = []
    const files: SkillFileNode[] = []

    for (const entry of entries) {
      if (collected >= SKILL_TREE_MAX_ENTRIES) {
        truncated = true
        break
      }
      if (isIgnoredSkillEntry(entry.name)) continue
      const rel = relDir.length > 0 ? `${relDir}/${entry.name}` : entry.name
      const abs = path.join(absDir, entry.name)

      // 技能目录内可能混入软链（目录导入会原样复制）。跟随软链判断真实类型：
      // Dirent 对软链恒为 isSymbolicLink()，不跟随会漏掉软链目录里的内容。
      let isDirectory = entry.isDirectory()
      let size: number | undefined
      if (entry.isSymbolicLink()) {
        try {
          const st = await fs.stat(abs)
          isDirectory = st.isDirectory()
          if (!isDirectory) size = st.size
        } catch {
          continue // 断链跳过
        }
      }

      collected += 1
      if (isDirectory) {
        dirs.push({
          path: rel,
          name: entry.name,
          type: 'directory',
          children: await walk(abs, rel, depth + 1),
        })
      } else {
        if (size === undefined) {
          try {
            size = (await fs.stat(abs)).size
          } catch {
            size = undefined
          }
        }
        files.push({
          path: rel,
          name: entry.name,
          type: 'file',
          ...(size !== undefined ? { size } : {}),
        })
      }
    }

    const byName = (a: SkillFileNode, b: SkillFileNode): number => a.name.localeCompare(b.name)
    dirs.sort(byName)
    files.sort(byName)
    return [...dirs, ...files]
  }

  const files = await walk(skillRoot, '', 0)
  return { files, truncated }
}

/** 常见文本扩展名（其余按二进制处理，返回不可预览提示） */
const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.json',
  '.json5',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.less',
  '.scss',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.proto',
  '.lua',
  '.r',
  '.m',
  '.vue',
  '.svelte',
  '.svg',
  '.gitignore',
])

/** 是否按文本读取（无扩展名的小文件也按文本尝试，便于 README / LICENSE） */
export function isLikelyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (ext.length === 0) return true
  return TEXT_FILE_EXTENSIONS.has(ext)
}

/** 内容里是否含 NUL 字节（二进制嗅探） */
export function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192)
  return sample.includes(0)
}
