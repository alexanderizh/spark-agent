#!/usr/bin/env node
/**
 * Verify homepage computer icon centering and the reasoning value text edge
 * against the real WeChat Developer Tools simulator layout.
 */
import automator from 'miniprogram-automator'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []

function check(name, passed, detail = '') {
  console.log(`  ${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(name)
}

async function getRect(element) {
  const [offset, size] = await Promise.all([element.offset(), element.size()])
  const left = Number(offset.left)
  const top = Number(offset.top)
  const width = Number(size.width)
  const height = Number(size.height)
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })

  try {
    await miniProgram.reLaunch('/pages/home/index')
    await sleep(2200)
    let page = await miniProgram.currentPage()
    const deviceIcons = await page.$$('.home-device-icon')
    check('首页已加载授信电脑', deviceIcons.length > 0, `${deviceIcons.length} 台`)

    let maxIconOffset = 0
    for (const container of deviceIcons) {
      const glyph = await container.$('.icon-monitor')
      if (!glyph) {
        maxIconOffset = Number.POSITIVE_INFINITY
        break
      }
      const [containerRect, glyphRect] = await Promise.all([getRect(container), getRect(glyph)])
      maxIconOffset = Math.max(
        maxIconOffset,
        Math.abs(containerRect.centerX - glyphRect.centerX),
        Math.abs(containerRect.centerY - glyphRect.centerY),
      )
    }
    check(
      '电脑图标在圆角底板内居中',
      deviceIcons.length > 0 && maxIconOffset <= 1,
      `最大中心偏差 ${Number.isFinite(maxIconOffset) ? maxIconOffset.toFixed(2) : '无图标'}px`,
    )

    const configTrigger = await page.$('.home-config-trigger')
    if (configTrigger) await configTrigger.tap()
    await sleep(800)
    page = await miniProgram.currentPage()

    const rows = await page.$$('.home-config-row')
    const pickerRightEdges = []
    for (let index = 0; index < Math.min(rows.length, 3); index += 1) {
      const valueText = await rows[index].$('.home-config-picker-value > text')
      if (valueText) pickerRightEdges.push((await getRect(valueText)).right)
    }

    const reasoningRow = rows[3]
    const reasoningText = reasoningRow ? await reasoningRow.$('.home-reasoning-value > text') : null
    const reasoningLabel = reasoningRow ? await reasoningRow.$('.home-config-label') : null
    const reasoningRect = reasoningText ? await getRect(reasoningText) : null
    const referenceRight = pickerRightEdges.length
      ? pickerRightEdges.reduce((sum, value) => sum + value, 0) / pickerRightEdges.length
      : Number.NaN

    check(
      '推理档位值与其他选择值右边缘对齐',
      reasoningRect != null &&
        Number.isFinite(referenceRight) &&
        Math.abs(reasoningRect.right - referenceRight) <= 1,
      `参考 ${referenceRight.toFixed(2)}px，档位 ${reasoningRect?.right.toFixed(2) ?? '缺失'}px`,
    )

    if (reasoningRect && reasoningLabel) {
      const labelRect = await getRect(reasoningLabel)
      const centerOffset = Math.abs(reasoningRect.centerY - labelRect.centerY)
      check(
        '推理档位值与本行标签垂直居中',
        centerOffset <= 1,
        `中心偏差 ${centerOffset.toFixed(2)}px`,
      )
    } else {
      check('推理强度行和档位值存在', false)
    }

    const screenshotPath = '/tmp/spark-mobile-home-alignment-e2e.png'
    await miniProgram.screenshot({ path: screenshotPath })
    console.log(`  [i] 实机模拟器截图: ${screenshotPath}`)
  } finally {
    miniProgram.disconnect()
  }

  console.log(`\n结果: ${failures.length === 0 ? '全部通过' : `失败 ${failures.length} 项`}`)
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('首页对齐 E2E 失败:', error)
  process.exitCode = 1
})
