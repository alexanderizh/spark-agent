## 🎨 HTML 产物技能指引

### ━━━ 主设计技能（视觉设计的唯一权威）━━━

视觉设计（主题、配色、字体、版式、装饰、动效风格）由以下两个技能**二选一全权负责**（不混用），系统不附加额外风格限制：

**/ui-ux-pro-max** ⭐⭐⭐ — UI/UX 设计引擎（主设计技能候选 A）
- 内置完整设计知识库：50+ 风格、161 色板、57 字体搭配、99 条 UX 准则
- 适合：数据图表、专业演示、标准信息架构、组件状态与可访问性
- 对幻灯片：为每一页输出布局意图、视觉层级、组件样式、交互状态，再落成 HTML/CSS

**/design-taste-frontend / taste-skill** ⭐⭐⭐ — Anti-slop 前端品味技能（主设计技能候选 B）
- 反 AI 套路：阻止 AI 紫渐变、千篇一律配色、模板化三等分卡片等套路
- 提供品牌读解、设计方向推断、三档旋钮（VARIANCE/MOTION/DENSITY）
- 适合：品牌感、编辑感、强视觉差异化、发布会/作品集/营销型幻灯片

选定后整个产物保持一致设计语言。视觉来源优先级：用户参考模板 > designSystem > 主题方向指令 > 设计技能自由创作。

### ━━━ 图标 ━━━

**/better-icons** ⭐⭐⭐ — 图标选型与使用指南
- 功能性 UI 图标（翻页/全屏/状态指示等）使用专业图标库（Font Awesome、Bootstrap Icons、Lucide 等），不用 emoji 充当 UI 图标
- 提供图标库 CDN 引入方式（国内可用）与常用场景图标清单

### ━━━ 动画 ━━━

> 入场动画必须遵守系统提示中的"渐进增强"铁律：CSS 默认可见，JS 失败不致内容不可见。

**/gsap-core** ⭐⭐⭐ — GSAP 核心（幻灯片动画首选；CDN: `https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/gsap.min.js`）
**/gsap-timeline** ⭐⭐ — 多步骤动画序列编排（position parameter 避免拼接生硬）
**/gsap-performance** ⭐⭐ — 性能优化（transform 优先、避免 layout thrashing）
**/gsap-plugins** — SplitText / Flip / Draggable 等高阶效果（插件 CDN 按需引入并守门）
**/scroll-storyteller** — 滚动驱动叙事（自定义网页场景，配合 /gsap-scrolltrigger）

### ━━━ 图表与可视化 ━━━

**/vchart-development-assistant** ⭐⭐ — VChart（CDN: `https://cdn.jsdelivr.net/npm/@visactor/vchart@1.13.4/build/index.min.js`）柱/折/饼/雷达/散点/词云
**/echarts** ⭐ — ECharts（CDN: `https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js`）复杂交互图表
**/excalidraw-diagram-generator** ⭐⭐ — 流程图/概念图/思维导图，SVG 内嵌，手绘风格
**/d3js** — D3.js 高度自定义可视化（CDN: `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`）

### ━━━ 辅助设计与参考图生成（按需选用，不参与"二选一"主流程）━━━

> 下列技能作为**主设计技能（/ui-ux-pro-max 或 /design-taste-frontend）的补充**，仅在主技能已确定整体设计语言后、需要专项强化时按需调用。不要让它们接管整页设计。

**/redesign-existing-projects** — 改造既有产物（不重做）
- 先审计当前 HTML/PPT 的视觉与结构问题（AI 套路、模板化布局、配色错乱），再针对性修复版式、留白、层级
- 适用：二次编辑/整体版本修复场景，避免推倒重来

**/image-to-code** — 图片转代码（端到端流水线）
- 先生成站点参考设计图，再深入分析其版式/配色/层级，最后落地为对应 HTML/CSS
- 适用：需要"按图施工"的高还原度新建场景

**/gpt-taste** — taste-skill 的 GPT/Codex 严格变体（备用）
- 与 /design-taste-frontend 同源，但更强调 Python 驱动的版式随机化、严格 AIDA 结构、严格 GSAP 编排
- Claude 环境下作为 /design-taste-frontend 的备用方案，不主动启用

**/imagegen-frontend-web** — 网页设计参考图的艺术指导（每 section 一张横图）
**/imagegen-frontend-mobile** — 移动端屏幕/流程图的艺术指导（含手机外壳 mockup）
**/brandkit** — 品牌识别板（logo 方向、配色、字体、应用场景）的艺术指导

> ⚠️ **以上三个 imagegen 技能本身不直接产出图片**——本项目环境（claude CLI）没有原生图像生成工具。它们的价值是**艺术指导与 prompt 工程**：告诉你如何写一份高质量英文图片 prompt（构图、配色、风格、尺寸）。**实际生图必须走系统提示词中的「AI 图片生成能力」HTTP 接口**（`POST /api/v1/internal/image-gen`，详见系统提示词的 image-gen-instructions 段落）。

### ━━━ 项目内生图能力桥接（重要：taste-skill 与 imagegen 系列共用）━━━

taste-skill 的 §4.8「Image & Visual Asset Strategy」会指引你"如果有图像生成工具可用就先用它"。在本项目环境下，**唯一的生图通道是系统提示词里 documented 的 HTTP 接口**，没有 `generate_image` / MCP image tool 等其他渠道。

**统一执行路径**：
1. 当 taste-skill 或 imagegen 系列要求生成图片时，**先按其艺术指导产出一份完整英文 prompt**（含构图、配色、风格、目标尺寸）
2. **再调用系统提示词中的 `POST /api/v1/internal/image-gen` HTTP 接口**完成实际生成（接口已自动管理配额、自动汇总到「图片创作」任务、支持 defer 占位与 wait 收敛）
3. 收到 429（配额耗尽）立即停止再发请求，按 taste-skill §4.8 的"失败兜底"改用文字/SVG/纯色块占位

**禁止尝试**：直接调用 OpenAI / Anthropic / Google 的图像 API、用 SVG 模拟照片、用 `<div>` 拼假截图、跳过图片生成步骤。

### ━━━ 其他 ━━━

**/doc-coauthoring** — 结构化内容组织（章节层级、要点逻辑流）
**/frontend-code-review** — HTML/CSS/JS 规范检查
**/code-review-and-quality** — 前端性能检查（布局抖动、渲染阻塞、内存泄漏）
