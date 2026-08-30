/**
 * 任务面板历史附件自愈逻辑单测。
 *
 * 覆盖 healBoardTaskAttachments / healBoardTasks / isStaleTempPath /
 * getDefaultSystemTempRoots。通过注入 exists 与 tempRoots，无需 mock electron / fs。
 *
 * 背景见 ../board-tasks-heal.ts 顶部注释：早期 board-tasks.json 里部分 attachment.path
 * 指向已被 macOS 清理的系统临时目录，读取时需剔除以避免渲染端刷 404。
 */
import { describe, it, expect } from 'vitest'
import {
  healBoardTaskAttachments,
  healBoardTasks,
  isStaleTempPath,
  getDefaultSystemTempRoots,
  type BoardTaskHealRecord,
} from '../board-tasks-heal'

// 与生产历史数据同构的临时路径：macOS $TMPDIR/spark-agent-pasted-images/*.png
const TEMP_IMG_1 =
  '/var/folders/9t/tj4rq9x56xb34yjt0d8k5yc00000gn/T/spark-agent-pasted-images/pasted-image-1.png'
const TEMP_IMG_2 =
  '/var/folders/9t/tj4rq9x56xb34yjt0d8k5yc00000gn/T/spark-agent-pasted-images/pasted-image-2.png'
// 持久化目录路径：不在系统临时目录下，缺失时也应保守保留
const PERSIST_IMG = '/Users/tester/.spark-agent/board-attachments/task-1/img.png'

interface LikeAttachment {
  path?: string
  previewPath?: string
  name?: string
}

function makeRecord(attachments: LikeAttachment[]): BoardTaskHealRecord {
  return { attachmentsJson: JSON.stringify(attachments) }
}

/** 仅由若干 path 组成的便捷构造（自动补 name）。 */
function pathsRecord(paths: string[]): BoardTaskHealRecord {
  return makeRecord(paths.map((p) => ({ path: p, name: p.split('/').pop() ?? 'img' })))
}

const neverExists = (): boolean => false

describe('healBoardTaskAttachments', () => {
  it('临时目录且文件不存在 → 剔除该条目，changed=true', () => {
    const { record, changed } = healBoardTaskAttachments(pathsRecord([TEMP_IMG_1]), {
      exists: neverExists,
    })
    expect(changed).toBe(true)
    expect(JSON.parse(record.attachmentsJson)).toEqual([])
  })

  it('临时目录但文件仍存在 → 保留，changed=false（防误删）', () => {
    const rec = pathsRecord([TEMP_IMG_1])
    const { record, changed } = healBoardTaskAttachments(rec, {
      exists: (p) => p === TEMP_IMG_1,
    })
    expect(changed).toBe(false)
    expect(record).toBe(rec)
    expect(JSON.parse(record.attachmentsJson)).toHaveLength(1)
  })

  it('非临时目录且不存在 → 保守保留，changed=false', () => {
    const rec = pathsRecord([PERSIST_IMG])
    const { record, changed } = healBoardTaskAttachments(rec, { exists: neverExists })
    expect(changed).toBe(false)
    expect(record).toBe(rec)
  })

  it('同一任务多条附件、部分坏部分好 → 只剔坏链接', () => {
    const { record, changed } = healBoardTaskAttachments(pathsRecord([TEMP_IMG_1, PERSIST_IMG]), {
      exists: (p) => p === PERSIST_IMG,
    })
    expect(changed).toBe(true)
    const kept = JSON.parse(record.attachmentsJson) as Array<{ path: string }>
    expect(kept).toHaveLength(1)
    expect(kept[0]?.path).toBe(PERSIST_IMG)
  })

  it('全部为失效临时链接 → 清空为 []，changed=true', () => {
    const { record, changed } = healBoardTaskAttachments(pathsRecord([TEMP_IMG_1, TEMP_IMG_2]), {
      exists: neverExists,
    })
    expect(changed).toBe(true)
    expect(JSON.parse(record.attachmentsJson)).toEqual([])
  })

  it('空附件数组 → changed=false（幂等）', () => {
    const rec = makeRecord([])
    const { record, changed } = healBoardTaskAttachments(rec, { exists: neverExists })
    expect(changed).toBe(false)
    expect(record).toBe(rec)
  })

  it('attachmentsJson 非法 → 按 [] 兜底，changed=false', () => {
    const rec: BoardTaskHealRecord = { attachmentsJson: 'not-a-json' }
    const { record, changed } = healBoardTaskAttachments(rec, { exists: neverExists })
    expect(changed).toBe(false)
    expect(record).toBe(rec)
  })

  it('path 失效但 previewPath 存在 → 任一存在即保留', () => {
    const rec = makeRecord([{ path: TEMP_IMG_1, previewPath: PERSIST_IMG }])
    const { record, changed } = healBoardTaskAttachments(rec, {
      exists: (p) => p === PERSIST_IMG,
    })
    expect(changed).toBe(false)
    expect(JSON.parse(record.attachmentsJson)).toHaveLength(1)
  })

  it('path/previewPath 均为空白 → 视为无可判路径，保留', () => {
    const rec = makeRecord([{ name: 'no-path', path: '  ', previewPath: '' }])
    const { record, changed } = healBoardTaskAttachments(rec, { exists: neverExists })
    expect(changed).toBe(false)
    expect(record).toBe(rec)
  })

  it('自定义 tempRoots：把持久目录临时纳入临时根 → 命中剔除', () => {
    // 验证 tempRoots 注入可改变判定（用于跨平台/未来迁移场景）
    const { changed } = healBoardTaskAttachments(pathsRecord([PERSIST_IMG]), {
      exists: neverExists,
      tempRoots: ['/Users/tester/.spark-agent'],
    })
    expect(changed).toBe(true)
  })
})

describe('healBoardTasks', () => {
  it('批量：存在变更时 changed=true，未变更任务保持原引用', () => {
    const tasks = [pathsRecord([TEMP_IMG_1]), pathsRecord([PERSIST_IMG])]
    const { tasks: healed, changed } = healBoardTasks(tasks, { exists: neverExists })
    expect(changed).toBe(true)
    expect(healed[0]?.attachmentsJson).toBe('[]')
    expect(healed[1]).toBe(tasks[1])
  })

  it('批量：全部无需变更 → changed=false，全部保持原引用', () => {
    const tasks = [pathsRecord([PERSIST_IMG]), makeRecord([])]
    const { tasks: healed, changed } = healBoardTasks(tasks, { exists: neverExists })
    expect(changed).toBe(false)
    expect(healed[0]).toBe(tasks[0])
    expect(healed[1]).toBe(tasks[1])
  })

  it('批量：空列表 → changed=false', () => {
    const { tasks, changed } = healBoardTasks([], { exists: neverExists })
    expect(changed).toBe(false)
    expect(tasks).toEqual([])
  })
})

describe('temp-root helpers', () => {
  const roots = getDefaultSystemTempRoots()

  it('isStaleTempPath 识别 macOS 系统临时目录', () => {
    expect(isStaleTempPath(TEMP_IMG_1, roots)).toBe(true)
    expect(isStaleTempPath('/private/var/folders/xx/T/y.png', roots)).toBe(true)
  })

  it('isStaleTempPath 不误判用户持久目录', () => {
    expect(isStaleTempPath(PERSIST_IMG, roots)).toBe(false)
  })

  it('getDefaultSystemTempRoots 至少包含一个硬编码前缀', () => {
    expect(roots.length).toBeGreaterThan(0)
    expect(
      roots.some((r) => r === '/var/folders' || r === '/tmp' || r === '/private/var/folders'),
    ).toBe(true)
  })
})
