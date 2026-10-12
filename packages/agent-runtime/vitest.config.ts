import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // @modelcontextprotocol/sdk 的 stdio.js 以裸名导入 node 内建 string_decoder。
      // vitest root 在本包时，vite 的 SSR 解析只查 packages/agent-runtime/node_modules
      // （不向上走仓库根 node_modules），会把裸名误解析成包内不存在的路径导致整个
      // 导入 session.service 的测试族无法收集。指回 node: 内建恢复正确语义。
      string_decoder: 'node:string_decoder',
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
