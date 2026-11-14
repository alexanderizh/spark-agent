import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

/**
 * 远程输入区页脚的配置下拉（助手 / 权限 / 推理）。
 *
 * 历史 bug：`.rc-footer-chips` 上的 `overflow: hidden` 把 absolute 的
 * `.rc-config-menu` 整块裁掉——菜单是从 chip 往上弹出页脚的，全部面积都在
 * 页脚盒子之外，于是「chip 点得动、aria-expanded 也变了，但浮层看不见」。
 * z-index 救不了被 overflow 裁的内容，所以这里守住的是裁切方向：
 * 横向仍然裁（chip 再多也不溢出压到「发送到 xxx」），纵向必须放行。
 */
describe('remote composer footer menu clipping', () => {
  const styles = readSource('./remote-control.less')

  it('never clips the footer chips vertically', () => {
    const block = styles.match(/\.rc-footer-chips\s*\{[^}]*\}/)
    expect(block).not.toBeNull()
    const body = block?.[0] ?? ''

    expect(body).not.toMatch(/overflow(-y)?:\s*hidden\s*;/)
    expect(body).not.toMatch(/overflow(-y)?:\s*auto\s*;/)
    expect(body).not.toMatch(/overflow(-y)?:\s*scroll\s*;/)
    expect(body).toMatch(/overflow-x:\s*clip\s*;/)
    expect(body).toMatch(/overflow-y:\s*visible\s*;/)
  })

  it('keeps the config menu anchored above its chip', () => {
    const block = styles.match(/\.rc-config-menu\s*\{[^}]*\}/)
    expect(block).not.toBeNull()
    const body = block?.[0] ?? ''

    expect(body).toMatch(/position:\s*absolute\s*;/)
    expect(body).toMatch(/bottom:\s*calc\(100%\s*\+\s*6px\)\s*;/)
    // 浮层要能盖住消息列：层级必须高于页内普通内容
    expect(body).toMatch(/z-index:\s*40\s*;/)
  })

  it('keeps the slash-command popover above the composer body', () => {
    const block = styles.match(/\.rc-command-popover\s*\{[^}]*\}/)
    expect(block).not.toBeNull()
    const body = block?.[0] ?? ''

    expect(body).toMatch(/position:\s*absolute\s*;/)
    expect(body).toMatch(/z-index:\s*30\s*;/)
  })
})
