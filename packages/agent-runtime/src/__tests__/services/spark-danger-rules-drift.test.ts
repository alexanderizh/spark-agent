import { DANGEROUS_COMMAND_PATTERNS } from '@spark/agent'
import { describe, expect, it } from 'vitest'

import { HOST_DANGEROUS_COMMAND_PATTERNS } from '../../services/permission.service.js'

/**
 * 危险命令正则「漂移守卫」：spark-engine 不能依赖 workspace 包，引擎侧自持
 * 一份镜像（spark-engine/src/permission/danger-rules.ts）。本测试断言两侧
 * 逐条 `.source` 相等——修改任一侧正则都必须同步另一侧，否则此测试失败。
 */
describe('danger rules drift guard (engine mirror vs host rule engine)', () => {
  it('engine mirror matches the host patterns one by one', () => {
    expect(DANGEROUS_COMMAND_PATTERNS).toHaveLength(HOST_DANGEROUS_COMMAND_PATTERNS.length)
    for (const [index, enginePattern] of DANGEROUS_COMMAND_PATTERNS.entries()) {
      const hostPattern = HOST_DANGEROUS_COMMAND_PATTERNS[index]
      expect(hostPattern).toBeDefined()
      expect(enginePattern.source).toBe(hostPattern?.source)
    }
  })

  it('host patterns still cover the canonical danger catalog', () => {
    // 宿主权威表的语义红线：重构正则时若删除以下任一类目即失败。
    const joined = HOST_DANGEROUS_COMMAND_PATTERNS.map((pattern) => pattern.source).join('\n')
    for (const keyword of ['rm\\s', 'git\\s+clean', 'git\\s+reset\\s+--hard', 'sudo', 'chmod\\s+-r', 'chown\\s+-r', 'dd\\s+if=', 'mkfs', ':\\|:&']) {
      expect(joined).toContain(keyword)
    }
  })
})
