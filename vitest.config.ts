/**
 * Vitest 根级配置 — 仓库根目录调用兜底
 *
 * 背景：各包（apps/desktop、packages/agent-runtime、spark-engine）都有自己的
 * vitest.config.ts，但 vitest 只按「当前工作目录」查找配置。从仓库根目录直接
 * 调用 vitest（如 `pnpm vitest run apps/desktop/src/...` 或
 * `node node_modules/vitest/vitest.mjs run <path>`）时，根目录没有配置文件，
 * vitest 会以「无配置默认值」运行：无 alias、无 server.deps.inline、无 setupFiles。
 *
 * 实际症状（2026-10-07 复现）：apps/desktop 的
 * VoiceAssistantSettingsCard / VoiceAssistantButton 两个测试文件在 collect 阶段报
 * `TypeError: Module ".../@emoji-mart/data/sets/15/native.json" needs an import
 * attribute of "type: json"`。链路：测试 → VoiceAssistantSettingsCard/Button.tsx →
 * `@lobehub/ui`（es/index.mjs barrel 静态引入 EmojiPicker.mjs）→ 静态
 * `import data from "@emoji-mart/data"`。该包 main 字段指向裸 JSON
 * （sets/15/native.json）；无配置时 @lobehub/ui 被 externalize，静态 import 落到
 * Node 原生 ESM 解析，Node v22 对裸 JSON 导入强制要求 `with { type: 'json' }`，
 * collect 即失败。apps/desktop/vitest.config.ts 里的 alias shim 与 deps.inline
 * 两层防护只有在 cwd=apps/desktop 时才会加载。
 *
 * 修复：声明 projects 把根目录调用路由到各包自己的配置。对 cwd 在各包内的
 * 正规调用（pnpm --filter ... run test / vitest run）零影响——vitest 从 cwd
 * 向上找到的仍是各包自己的配置文件。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['apps/desktop', 'packages/agent-runtime', 'spark-engine'],
  },
})
