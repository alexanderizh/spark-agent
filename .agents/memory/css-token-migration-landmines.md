# CSS token 迁移两大地雷（2026-10-15 事故复盘）

色值残留清理批次曾引发全站样式塌掉 + 暗色混色反转两类事故，后续任何 token/样式批量迁移前先读本文件。

## 地雷一：styles.css 的 @import 前不得插入任何样式规则

- CSS 规范要求 `@import` 位于所有规则之前（仅 @charset/@layer 例外），违规后**其后所有 import 静默失效**——tokens.css/motion.css/canvas-tokens.css/components.css 整包不加载，全站 var(--*) 变 undefined，表现为「有主色有字号（JS 注入链路）但无背景无间距」的半残形态。
- 事故根因：token 收编脚本按「跳过文件头注释块」找插入位，把新增 `:root` 块插在了 styles.css 头部注释与 @import 之间。
- 规则：**向 styles.css 新增 token 定义一律写进 tokens.css（它没有 @import，位置无关）；styles.css 头部注释区到 import 区之间是禁区。**
- .less 文件不受此限（less 的 @import 是构建期内联，不遵循运行时规范）。

## 地雷二：color-mix() 内的 white/black 是方向常量，禁止换成主题翻转 token

- `color-mix(in srgb, X N%, white)` 的 white 是「向白提亮」的方向常量。换成 `var(--panel)`/`var(--text-inverse)` 后：浅色恰好等值（两者浅色都是 #fff）不露馅；暗色 panel=#303030、text-inverse=#09090b，提亮反转成压暗，产生背景变深、投影消失等暗色回归。
- 事故共 12 处，已全部回退为恒值 `var(--white)`（等值且保 token 纪律）。
- 防复发：`scripts/token-migration/migrate.mjs` 已加 FLIP_TOKENS 守卫——值处于 `color-mix()` 上下文时只放行恒值 token。**已有 mix 目标位本来就是 var(--panel) 的属于有意的主题自适应设计，不要"顺手统一"。**

## 验证纪律

- 批量迁移后必须跑：token 运行时探测（--bg/--panel/--pad-sm 非空）+ 浅/暗双主题截图 + stylelint 0 errors。
- `pnpm lint:style` 的 error 层（color 系）抓到漏网硬编码是正常拦截，补收编而不是放松规则；就近吸附阈值 ΔE<2.3。
