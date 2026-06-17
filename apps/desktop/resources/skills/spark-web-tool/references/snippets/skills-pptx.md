## 📊 PPTX 生成技能指引

### 注意事项

1. 控制文本内容的行间距。
2. 控制每页内的纯文本段落不要太多，文字内容不要超长，一般情况下一句话不要超过 100 字。
3. 不要将主讲人的旁白内容添加到页面中去，要注意内容面向的身份；
4. 主讲人的旁白，放到幻灯片备注中去；

### ━━━ 必须执行的技能应用流程 ━━━

以下不是"可选推荐"，而是 PPTX 生成前的强制设计输入。即使无法直接调用 slash skill，也必须把对应技能的原则落实到 `build.py` 的结构和版式中：

1. 先用 **/mck-ppt-design** 获取布局方法选择建议、定位规范、避坑规则。**只能借鉴其布局结构和防溢出逻辑，严禁使用其默认主题、默认配色、默认字体或咨询风模板**。
2. 再用 **/pptx-generator** 的思路实现安全区常量 + y 坐标追踪 + 拆页辅助函数（适配 Python 语境）。
3. 用 **/ui-ux-pro-max** 确定主题 token：主色、辅助色、强调色、背景色、字体层级、间距系统。如果用户指定了 designSystem，则以对应 DESIGN.md 规范为准，ui-ux-pro-max 的设计原则作为底线约束。
4. 有图表/流程/概念结构时，必须生成实际图表 PNG（matplotlib）或调用 MckEngine 内置图表方法，不得留白或用纯文字替代。
5. 生成后进行"反空心盒审查"：大量描边空盒包文字视为不合格，必须改版。


### ━━━ 布局定位与防溢出（核心，必须遵守）━━━

**/mck-ppt-design** ⭐⭐⭐ — Python PPTX 布局方法库
- 用于：72 种预置布局方法（定位、分区、层级已计算好），防溢出拆页逻辑参考，避坑经验（CJK、图表、溢出）
- **使用方式**：只借鉴其坐标规范和布局结构；颜色、字体、背景、卡片和装饰必须由本任务视觉 token 自行定义
- **禁止**：不得使用 MckEngine 默认海军蓝/咨询风主题，不得从 mck-ppt-design 的主题矩阵中选择主题
- 画布规范：13.33 × 7.5 英寸；内容安全区 x ∈ [0.4, 12.93]，y ∈ [1.1, 7.1]

**/pptx-generator** ⭐⭐⭐ — PPTX 布局防溢出专项
- 用于：精确 y 坐标追踪思路（每添加一个元素后累加高度）、字体自适应缩放原则
- 防溢出规则（适配 Python）：`y += element_h + gap`；若 `y + next_h > 7.1` 则新建页，重置 `y = 1.2`，标题加"（续）"
- 大型图表防溢出：当图表宽度 ≥ 8.5 英寸或高度 ≥ 4.2 英寸时，该页只放图表主体和极少说明；图表讲解、CAGR 对比、趋势原因、指标卡、表格和长脚注必须拆到后续页，不得压缩字号或让内容越界

**/pptx** ⭐⭐ — PPTX 最佳实践
- 用于：封面/目录/内容/章节/结尾页的标准结构规范
- 字号规范：标题 24-36pt，正文 12-18pt，注释 10-12pt
- 对齐：元素左对齐或居中，不使用右对齐

**/document-skills:pptx** — PPTX 格式规范
- 用于：元素间距（≥ 0.2 英寸安全边距）、字体一致性、颜色体系补充细节

### ━━━ 反低质卡片布局（核心，必须遵守）━━━

**禁止**：
- 一页堆 3 个以上白底/透明底描边文字框
- 每条 bullet/key point 单独套一个空心矩形
- 连续 3 页使用同一种布局方法（`bullet_list` 或同类）
- 用边框容器冒充视觉元素
- 全文字无图连续超过 3 页

**优先替代**：
- split visual：半屏图表/示意图 + 2-3 条短要点（`content_right_image()`）
- metric strip：横向关键数字条（`metric_cards()` / `two_stat()` / `three_stat()`）
- process rail：流程步骤（`process_chevron()` / `vertical_steps()`）
- comparison table：表格/矩阵对比（`data_table()` / `matrix_2x2()`）
- editorial band：实心色块分区，不依赖描边（`executive_summary()`）
- full-bleed chart：复杂图表独占一页（matplotlib PNG + `content_right_image()` 或自定义贴图）

### ━━━ 图表与概念图（必须有实际视觉产出）━━━

**/mck-ppt-design** ⭐⭐⭐ — 内置图表方法
- 用于：`grouped_bar()` `stacked_bar()` `horizontal_bar()` `donut()` `waterfall()`
- 直接调用，无需外部依赖，CJK 已处理

**matplotlib → PNG → 贴图** ⭐⭐⭐ — 数据复杂时
- 用于：自定义图表样式、多子图、散点图、热力图等 MckEngine 未覆盖的图表类型
- 必须：`matplotlib.use('Agg')` 放在 `import matplotlib.pyplot` 之前；背景 `facecolor='white'`；`dpi=150`；注册中文字体

**/vchart-development-assistant** ⭐⭐ — 图表配置生成
- 用于：生成图表的数据结构和配置建议，再转为 matplotlib 实现

**/excalidraw-diagram-generator** ⭐ — 流程图与概念图
- 用于：复杂流程图/知识结构图的构图建议，导出 PNG 后通过 `slide.shapes.add_picture()` 嵌入

**Pillow 生成概念示意图** — 纯示意/无数据场景
- 用于：流程框图、关系图、自定义装饰元素

### ━━━ 视觉美化（设计系统驱动）━━━

**/ui-ux-pro-max** ⭐⭐⭐ — 顶级 UI/UX 设计引擎（**强制使用**）
- PPTX 配色方案、字体搭配、视觉层次必须由 ui-ux-pro-max 的设计知识库驱动
- 核心原则：色彩 ≤ 3 主色、字体 ≤ 2 种、留白充足、禁止 AI 感渐变堆叠
- 如果用户指定了 designSystem，则直接使用对应的 DESIGN.md 规范
