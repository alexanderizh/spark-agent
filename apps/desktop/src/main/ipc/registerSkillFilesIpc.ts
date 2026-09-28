/**
 * Skill 文件 IPC —— 技能详情页的「文件树 / 预览 / 编辑」
 *
 * 三个通道：
 *   skill:files      → 技能目录文件树（含只读标记）
 *   skill:read-file  → 读取技能目录内单个文本文件（含大小上限）
 *   skill:write-file → 写回技能目录内单个文件（Ctrl+S 保存）
 *
 * 安全模型见 skillFilesUtils.ts：**以技能根目录为唯一边界**（词法 + canonical 双层），
 * 因为技能根目录可能位于全局白名单之外（宿主软链 ~/.claude/skills、内置 resources/）。
 *
 * 只读策略：内置技能（builtin:* 或位于 bundledDir 内）不允许写 —— 它们是应用产物，
 * 升级时会被覆盖。UI 侧据 readOnly 禁用编辑入口并给出原因。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  SkillFilesResponse,
  SkillReadFileResponse,
  SkillWriteFileResponse,
} from '@spark/protocol'
import type { SkillItem } from '@spark/protocol'
import type { SkillService } from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import { getAppSkillsManager } from '../services/AppSkillsManager.js'
import { typedIpcHandle } from './typed-ipc.js'
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_MAX_WRITE_BYTES,
  assertInsideRealRoot,
  buildSkillFileTree,
  isLikelyTextFile,
  looksBinary,
  resolveSkillFilePath,
} from './skillFilesUtils.js'

const log = createLogger('skill-files-ipc')

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 技能是否无磁盘目录（表单创建 / 纯代码内置的虚拟记录） */
function isVirtualSkill(skill: SkillItem): boolean {
  return skill.rootPath.includes('://')
}

/**
 * 解析技能的真实磁盘根目录：
 *   - 虚拟技能 → null
 *   - 目录不存在 → null（附带 error 提示）
 */
async function resolveSkillRoot(skill: SkillItem): Promise<string | null> {
  if (isVirtualSkill(skill)) return null
  const root = path.resolve(skill.rootPath)
  try {
    const st = await fs.stat(root)
    if (!st.isDirectory()) return null
  } catch {
    return null
  }
  return root
}

function isReadOnlySkill(skill: SkillItem, root: string | null): { readOnly: boolean; reason?: string } {
  if (skill.id.startsWith('builtin:')) {
    return { readOnly: true, reason: '内置技能为只读，应用升级时会被覆盖' }
  }
  if (root != null) {
    try {
      const bundledDir = path.resolve(getAppSkillsManager().bundledDir)
      const rel = path.relative(bundledDir, root)
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        return { readOnly: true, reason: '内置技能为只读，应用升级时会被覆盖' }
      }
    } catch {
      // bundledDir 不可用（极早期启动）→ 退化为按 id 判定
    }
  }
  return { readOnly: false }
}

export function registerSkillFilesIpc(deps: { getSkillService: () => SkillService }): void {
  const findSkill = (id: string): SkillItem | null =>
    deps.getSkillService().listSkills().find((s) => s.id === id) ?? null

  typedIpcHandle('skill:files', async (req): Promise<SkillFilesResponse> => {
    const skill = findSkill(req.id)
    if (skill == null) {
      return { rootPath: null, files: [], readOnly: true, error: '未找到该 Skill' }
    }

    const root = await resolveSkillRoot(skill)
    const { readOnly, reason } = isReadOnlySkill(skill, root)
    if (root == null) {
      // 虚拟技能：无文件树，但不算错误（前端回退到技能定义视图）
      return {
        rootPath: null,
        files: [],
        readOnly,
        ...(reason != null ? { readOnlyReason: reason } : {}),
      }
    }

    try {
      const { files, truncated } = await buildSkillFileTree(root)
      return {
        rootPath: root,
        files,
        readOnly,
        ...(reason != null ? { readOnlyReason: reason } : {}),
        ...(truncated ? { truncated: true } : {}),
      }
    } catch (err) {
      log.warn(`skill:files failed for ${req.id}: ${errMsg(err)}`)
      return {
        rootPath: root,
        files: [],
        readOnly,
        ...(reason != null ? { readOnlyReason: reason } : {}),
        error: `读取技能目录失败：${errMsg(err)}`,
      }
    }
  })

  typedIpcHandle('skill:read-file', async (req): Promise<SkillReadFileResponse> => {
    const skill = findSkill(req.id)
    if (skill == null) return { content: '', size: 0, error: '未找到该 Skill' }

    const root = await resolveSkillRoot(skill)
    if (root == null) return { content: '', size: 0, error: '该 Skill 没有磁盘文件' }

    let target: string
    try {
      target = resolveSkillFilePath(root, req.path)
      const realRoot = await fs.realpath(root)
      await assertInsideRealRoot(realRoot, target)
    } catch (err) {
      log.warn(`skill:read-file rejected ${req.id}/${req.path}: ${errMsg(err)}`)
      return { content: '', size: 0, error: errMsg(err) }
    }

    try {
      const buf = await fs.readFile(target)
      if (buf.byteLength > SKILL_FILE_MAX_BYTES) {
        const slice = buf.subarray(0, SKILL_FILE_MAX_BYTES)
        return {
          content: slice.toString('utf-8'),
          size: buf.byteLength,
          truncated: true,
        }
      }
      if (!isLikelyTextFile(target) || looksBinary(buf)) {
        return { content: '', size: buf.byteLength, error: '该文件为二进制内容，暂不支持预览' }
      }
      return { content: buf.toString('utf-8'), size: buf.byteLength }
    } catch (err) {
      return { content: '', size: 0, error: `读取文件失败：${errMsg(err)}` }
    }
  })

  typedIpcHandle('skill:write-file', async (req): Promise<SkillWriteFileResponse> => {
    const skill = findSkill(req.id)
    if (skill == null) return { success: false, size: 0, error: '未找到该 Skill' }

    const root = await resolveSkillRoot(skill)
    if (root == null) return { success: false, size: 0, error: '该 Skill 没有磁盘文件' }

    const { readOnly, reason } = isReadOnlySkill(skill, root)
    if (readOnly) {
      return { success: false, size: 0, error: reason ?? '该 Skill 为只读' }
    }

    let target: string
    try {
      target = resolveSkillFilePath(root, req.path)
      const realRoot = await fs.realpath(root)
      await assertInsideRealRoot(realRoot, target)
    } catch (err) {
      log.warn(`skill:write-file rejected ${req.id}/${req.path}: ${errMsg(err)}`)
      return { success: false, size: 0, error: errMsg(err) }
    }

    const size = Buffer.byteLength(req.content, 'utf-8')
    if (size > SKILL_FILE_MAX_WRITE_BYTES) {
      return { success: false, size: 0, error: '内容过大，单文件上限 4 MB' }
    }

    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, req.content, 'utf-8')
      log.info(`Skill file saved: ${req.id}/${req.path} (${size} bytes)`)
      return { success: true, size }
    } catch (err) {
      log.warn(`skill:write-file failed for ${req.id}/${req.path}: ${errMsg(err)}`)
      return { success: false, size: 0, error: `保存失败：${errMsg(err)}` }
    }
  })
}
