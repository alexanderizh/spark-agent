/**
 * canvas:project:delete 路径安全测试
 *
 * 删除项目时清掉磁盘上的项目文件夹，最大的风险是「路径校验不严导致误删用户其他目录」。
 * 这里只测纯函数 `isPathStrictlyInsideRoot` —— 它是删除前的唯一守卫，
 * 必须覆盖：根目录自身拒绝、根外路径拒绝、跨卷拒绝、合法子目录放行。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { isPathStrictlyInsideRoot } from '../../services/CanvasProjectPath.js'

const ROOT_WIN = 'C:\\Users\\test\\AppData\\Roaming\\@spark\\desktop\\canvas-projects'
const ROOT_POSIX = '/Users/test/.spark/desktop/canvas-projects'

describe('isPathStrictlyInsideRoot', () => {
  it('rejects empty / whitespace-only input', () => {
    expect(isPathStrictlyInsideRoot('', ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot('   ', ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot(null, ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot(undefined, ROOT_WIN)).toBe(false)
  })

  it('rejects the root directory itself (would delete all projects)', () => {
    expect(isPathStrictlyInsideRoot(ROOT_WIN, ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot(`${ROOT_WIN}/`, ROOT_POSIX)).toBe(false)
  })

  it('rejects paths outside the root (parent traversal)', () => {
    expect(isPathStrictlyInsideRoot('C:\\Users\\test', ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot('C:\\Users\\test\\AppData', ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot(
      'C:\\Users\\test\\AppData\\Roaming\\@spark\\desktop',
      ROOT_WIN,
    )).toBe(false)
  })

  it('rejects paths on a different drive / volume (Windows)', () => {
    expect(isPathStrictlyInsideRoot('D:\\evil\\canvas-projects\\p1', ROOT_WIN)).toBe(false)
    expect(isPathStrictlyInsideRoot('D:\\', ROOT_WIN)).toBe(false)
  })

  it('accepts legitimate project subdirectories', () => {
    expect(
      isPathStrictlyInsideRoot(
        path.join(ROOT_WIN, 'proj-canvas_project_abc'),
        ROOT_WIN,
      ),
    ).toBe(true)
    expect(
      isPathStrictlyInsideRoot(
        `${ROOT_WIN}\\my-proj-canvas_project_xyz`,
        ROOT_WIN,
      ),
    ).toBe(true)
  })

  it('rejects sibling directories that share a prefix but are not children', () => {
    // canvas-projects-backup 与 canvas-projects 同级，名字前缀相同但不是子目录
    expect(
      isPathStrictlyInsideRoot(`${ROOT_WIN}-backup\\evil`, ROOT_WIN),
    ).toBe(false)
    expect(
      isPathStrictlyInsideRoot(`${ROOT_WIN}.bak\\evil`, ROOT_WIN),
    ).toBe(false)
  })

  it('normalizes relative segments inside the root correctly', () => {
    // 子目录里夹杂 '..' 但仍在根下：path.resolve 会归一化，应当放行
    expect(
      isPathStrictlyInsideRoot(
        `${ROOT_WIN}\\a\\..\\b-canvas_project_x`,
        ROOT_WIN,
      ),
    ).toBe(true)
  })

  it('works for posix-style roots', () => {
    expect(
      isPathStrictlyInsideRoot(`${ROOT_POSIX}/proj-canvas_project_1`, ROOT_POSIX),
    ).toBe(true)
    expect(isPathStrictlyInsideRoot('/etc', ROOT_POSIX)).toBe(false)
    expect(isPathStrictlyInsideRoot(ROOT_POSIX, ROOT_POSIX)).toBe(false)
  })
})
