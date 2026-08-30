import { composePose, type Vec3 } from './mannequin'

/**
 * 自定义姿势库（应用级，跨画布/节点复用）。
 *
 * 存储：localStorage key `spark.stage3d.savedPoses`，上限 60 条。
 * 保存时把「预设 + 逐关节覆盖」合成为完整快照（见 composePose），
 * 套用到全屏姿势编辑器时需先转换为 stand 覆盖；直接写回 actor 时应同步使用
 * `pose: 'stand'` 且避免再次把 stand 基准叠加到快照上。
 *
 * 核心逻辑与 localStorage 解耦：对外暴露的函数都接受可选 `storage` 参数
 * （默认 `window.localStorage`），单测环境无 DOM/localStorage 时可注入内存 mock。
 */

export type SavedPose = {
  id: string
  name: string
  joints: Record<string, Vec3>
  createdAt: number
}

/** 与 window.localStorage 同形状的最小接口，供单测注入内存实现。 */
export type PoseStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SAVED_POSES_KEY = 'spark.stage3d.savedPoses'
export const SAVED_POSES_LIMIT = 60

function defaultStorage(): PoseStorage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

/** 校验单条脏数据是否为合法 SavedPose 结构，宽容修正字段类型。 */
function sanitizeOne(raw: unknown): SavedPose | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.name !== 'string' || !r.name) return null
  if (!r.joints || typeof r.joints !== 'object') return null
  const joints: Record<string, Vec3> = {}
  for (const [jointId, euler] of Object.entries(r.joints as Record<string, unknown>)) {
    if (
      Array.isArray(euler) &&
      euler.length === 3 &&
      euler.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      joints[jointId] = [euler[0], euler[1], euler[2]] as Vec3
    }
  }
  const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now()
  return { id: r.id, name: r.name, joints, createdAt }
}

/** 从 localStorage 读取全部已保存姿势，脏数据宽容解析（丢弃非法项，不炸）。 */
export function loadSavedPoses(storage?: PoseStorage | null): SavedPose[] {
  const s = storage === undefined ? defaultStorage() : storage
  if (!s) return []
  try {
    const raw = s.getItem(SAVED_POSES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: SavedPose[] = []
    for (const item of parsed) {
      const one = sanitizeOne(item)
      if (one) out.push(one)
    }
    return out
  } catch {
    return []
  }
}

function persist(storage: PoseStorage | null, list: SavedPose[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(SAVED_POSES_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/**
 * 保存当前姿势（预设 + 覆盖）为新的自定义姿势快照。
 * @returns 成功返回 { ok: true, pose }；超出上限或写入失败返回 { ok: false, reason }。
 */
export function savePose(
  name: string,
  poseId: string,
  overrides: Record<string, Vec3> | undefined,
  storage?: PoseStorage | null,
): { ok: true; pose: SavedPose } | { ok: false; reason: string } {
  const s = storage === undefined ? defaultStorage() : storage
  const list = loadSavedPoses(s)
  if (list.length >= SAVED_POSES_LIMIT) {
    return { ok: false, reason: `已保存 ${SAVED_POSES_LIMIT} 个姿势，达到上限，请先删除一些再保存` }
  }
  const trimmedName = name.trim()
  if (!trimmedName) {
    return { ok: false, reason: '姿势名称不能为空' }
  }
  const joints = composePose(poseId, overrides)
  const pose: SavedPose = {
    id: `pose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    joints,
    createdAt: Date.now(),
  }
  const next = [...list, pose]
  if (!persist(s, next)) {
    return { ok: false, reason: '保存失败，无法写入本地存储' }
  }
  return { ok: true, pose }
}

/** 删除一条自定义姿势，返回是否实际删除了（id 不存在则返回 false）。 */
export function deleteSavedPose(id: string, storage?: PoseStorage | null): boolean {
  const s = storage === undefined ? defaultStorage() : storage
  const list = loadSavedPoses(s)
  const next = list.filter((p) => p.id !== id)
  if (next.length === list.length) return false
  return persist(s, next)
}

/** 重命名一条自定义姿势，返回是否成功（id 不存在或新名为空返回 false）。 */
export function renameSavedPose(id: string, name: string, storage?: PoseStorage | null): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  const s = storage === undefined ? defaultStorage() : storage
  const list = loadSavedPoses(s)
  const idx = list.findIndex((p) => p.id === id)
  if (idx === -1) return false
  const next = list.slice()
  next[idx] = { ...next[idx]!, name: trimmed }
  return persist(s, next)
}
