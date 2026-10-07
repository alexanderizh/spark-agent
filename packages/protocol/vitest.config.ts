import { defineConfig } from 'vitest/config'

/**
 * 本包测试用默认配置即可跑通（纯 TS 单测，无 alias / deps.inline 需求），
 * 此文件的作用是**终止 vitest 的向上配置搜索**：没有它时从本包目录运行
 * `vitest run` 会命中仓库根的 vitest.config.ts 并按其 projects 路由，
 * 本包自己的测试反而不会被收集（静默漏收集，假绿）。
 */
export default defineConfig({
  test: {},
})
