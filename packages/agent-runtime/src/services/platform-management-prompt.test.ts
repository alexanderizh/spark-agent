/**
 * @module platform-management-prompt.test
 *
 * 行为契约测试（P1-6 提示词瘦身护栏）：PLATFORM_MANAGEMENT_SYSTEM_PROMPT 被
 * 压缩后，以下行为红线必须逐条保留——本文件锁定语义行，不锁定枚举清单
 * （工具动词枚举与工具 schema 重复，允许删除）。
 */

import { describe, expect, it } from 'vitest'
import { PLATFORM_MANAGEMENT_SYSTEM_PROMPT } from './session-mcp-tooling-helpers.js'

describe('PLATFORM_MANAGEMENT_SYSTEM_PROMPT 行为契约', () => {
  const prompt = PLATFORM_MANAGEMENT_SYSTEM_PROMPT

  it('能力入口与渐进披露指引保留', () => {
    // 能力域一句话 + 工具族入口
    expect(prompt).toContain('mcp__spark_platform__*')
    // 完整工作流的渐进披露兜底：指向 platform-manager skill
    expect(prompt).toContain('platform-manager')
  })

  it('会话引用红线保留：只访问显式挂载的引用，不得索要/臆造 session id', () => {
    expect(prompt).toContain('session ID')
    expect(prompt).toMatch(/never ask for or invent/i)
  })

  it('密钥红线保留：不回显、不重复、不接受入参、只走安全通道', () => {
    // 不回显/不重复完整 key
    expect(prompt).toMatch(/never (echo|reveal)/i)
    // 工具参数永不接受 secret 值
    expect(prompt).toMatch(/never accepts secret values/i)
    // 用户自愿提供时只传给 configure/discovery 工具（Keychain 存储）
    expect(prompt).toMatch(/keychain/i)
  })

  it('破坏性操作红线保留：删除/卸载前必须向用户确认', () => {
    expect(prompt).toMatch(/destructive operations/i)
    expect(prompt).toMatch(/confirm with the user first/i)
  })

  it('自定义多媒体渠道红线保留：读真实文档、先 validate 后 configure、真实调用需显式同意', () => {
    expect(prompt).toMatch(/never invent/i)
    expect(prompt).toMatch(/providers_media_validate/)
    expect(prompt).toMatch(/providers_media_configure/)
    expect(prompt).toMatch(/confirmExecute/)
  })

  it('环境安装偏好保留：Spark 自建源优先、网络/系统变更先征得同意', () => {
    expect(prompt).toContain('artifacts_list')
    expect(prompt).toContain('artifacts_resolve')
    expect(prompt).toMatch(/consent/i)
    // 不得用 ELECTRON_RUN_AS_NODE 启动 Electron
    expect(prompt).toContain('ELECTRON_RUN_AS_NODE')
  })
})
