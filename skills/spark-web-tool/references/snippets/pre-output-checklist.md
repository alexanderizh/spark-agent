## 输出前检查清单 — 输出前必须验证

🔴 P0 — 关键（任一项失败则输出无效）：

1. `narration` 是实际的内容叙述（≥100字），包含至少2个具体概念名称及其机制/原因
2. `narration` 不包含任何元语言：禁止短语包括"本场景将"、"我们来学习"、"接下来我们"、"首先让我们"、"本节课"、"今天我们"、"在这里我们"、"我将介绍"
3. `examples` — 每个示例包含完整的解题过程：数学题要展示每步计算和实际数字；科学题要展示真实测量数据
4. `key_points` — 每条都是完整的知识句子（主语+谓语+宾语）。单个词语或短名词短语为禁止项
5. `interactions` 中 `quiz` 类型必须在 `content` 字段中包含恰好4个具体选项（A/B/C/D）
6. **HTML 幻灯片翻页功能验证**（仅 HTML 输出格式需验证；非 HTML 格式如 JSON/Markdown 可跳过此项）— 翻页器数字更新时，页面内容必须同步切换：
   - `go(n)` 函数必须同时执行：①移除当前 slide 的 active 类 ②给目标 slide 添加 active 类 ③更新翻页器文字
   - 禁止只更新页码文字而不切换 slide 的 display 状态
   - CSS 中 `.slide.active { display: flex }` 必须能覆盖 `.slide { display: none }`
   - 翻页动画必须在 `display:flex` 生效后触发（使用 requestAnimationFrame）
7. **HTML 内容可见性验证**（仅 HTML 输出格式需验证）— 元素在初始状态下可以设置 opacity:0 等隐藏属性用于入场动画，但**必须**在动画或交互流程完成后正确恢复为可见：
   - 如果元素初始设为 `opacity: 0`，必须确认存在对应的恢复逻辑（CSS animation/transition 的结束状态、JS 定时回调、或 slide 切换时的显式重置），使元素在动画结束后恢复到 `opacity: 1`
   - 逐页检查每个 `.slide`：当该 slide 处于 active 状态且入场动画执行完毕后，其内部所有内容元素（标题、段落、列表、图片等）的 opacity 必须为 1，不允许出现"设了 opacity:0 但从未恢复"的情况
   - 同理检查 `visibility: hidden` → `visibility: visible` 的恢复是否完整
   - 首页（第一个 slide）的入场动画结束后，内容必须全部可见，不能出现首页内容始终透明
   - 常见错误模式：CSS 中写了 `opacity: 0; animation: fadeIn 0.5s forwards` 但动画名称拼写错误或 keyframes 缺失，导致元素永远停留在 opacity:0

🟡 P1 — 重要（强烈建议）：

7. `visual_description` 包含：(a) 具体元素类型（diagram/flowchart/chart/illustration），(b) 精确的文字标签，(c) 配色方案
8. `slide_body` 包含适合直接显示在幻灯片上的完整知识句子 — 不是主题词列表
9. `math_expressions` 包含 narration 或 key_points 中提到的所有 LaTeX 公式
10. `visual_elements` 中 `chart` 类型的条目包含 `data_hint` 及示例数据（如 "x: [2020,2021,2022], y: [1.2,1.5,2.1]"）
