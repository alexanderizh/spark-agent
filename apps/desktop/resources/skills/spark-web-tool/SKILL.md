---
name: Spark Web Tool
description: "根据题目/知识点，通过完整的 5 步流程（理解→研究→验证→脚本→输出）生成高质量专题讲解内容，支持 HTML 幻灯片、自定义网页、PPTX、DOCX 多格式输出"
version: 1.0.0
author: Spark AI
category: writing
tags: [education, explain, courseware, html, pptx, docx, slides, 专题, 讲解, 课件]
---

# 专题讲解生成系统

你需要按顺序完成以下全部步骤，将每步产物写入 output/ 目录，严格完成一步后再执行下一步。
**关键规则**：每步完成后必须将结果写入对应 JSON 文件；下一步必须先读取上一步的输出文件以获取上下文。

---

## Step 1：题目理解 → 写入 output/understanding.json

你是一位资深内容分析专家，擅长分析各类学科题目。请对以下题目进行深度分析。

### 任务

分析给定题目，返回 JSON 格式的分析结果。

### 输出格式

```json
{
  "question_type": "选择题|填空题|解答题|证明题|计算题|应用题|判断题|简答题",
  "knowledge_points": ["知识点1", "知识点2"],
  "difficulty": "easy|medium|hard",
  "analysis": "题目的详细分析，包括考查意图、隐含条件、易错点等",
  "key_formulas": ["需要用到的核心公式或定理"],
  "prerequisites": ["解答此题需要的先修知识"]
}
```

### 要求

1. 准确识别题型和学科领域
2. 列出所有相关知识点（从宏观到微观）
3. 评估难度等级（easy=基础题，medium=中档题，hard=压轴题/竞赛题）
4. 分析要深入，指出隐含条件和常见错误
5. 公式用 LaTeX 格式表示
6. **只输出 JSON，不要其他内容**

**完成后**：将 JSON 写入 output/understanding.json，然后继续 Step 2。

---

## Step 2：深度研究与解法制定 → 写入 output/solutions.json

**准备**：先读取 output/understanding.json 获取题目分析结果，将其作为上下文。

你是一位严谨的学科专家。你的任务不仅是给出解法，更要对题目涉及的知识进行深入研究和主动验证，确保每一步推导、每一个公式、每一个数据都准确无误。

### 阶段零：联网搜索与资料收集（建议执行）

在开始知识研究前，建议使用搜索工具收集权威参考资料。

**搜索策略（建议进行 5-8 次搜索，逐步深化）**：
- 第1-2次：搜索核心概念的定义、定理、公式的权威来源
- 第3-4次：搜索具体解法、经典例题、应用场景
- 第5-6次：搜索常见误区、易错点、边界条件、特殊情况
- 第7-8次：搜索拓展知识、相关理论延伸、实际应用案例

### 阶段一：深度知识研究

1. **核心概念挖掘**：列出解题所需的所有知识点，完整的定义、成立条件和适用范围
2. **公式/定理溯源**：每个用到的公式，明确其推导逻辑或证明思路
3. **常见误区识别**：这类题目学生最容易在哪些步骤出错？
4. **边界条件分析**：所选解法的使用前提是什么？

### 阶段二：解法制定与逐步验证

1. 提出 2 种以上解法
2. 对**推荐解法**，逐步写出完整推导过程
3. **主动验证**：涉及数值计算时用 Bash 运行代码验证，标注 `✓ 已验证` 或 `⚠ 注意`

**Bash 验证示例**：
```bash
python3 -c "
import math
result = math.sqrt(3)/2
print(f'sin(60°) = {result:.6f}')
"
```

### 阶段三：知识质量自检

- [ ] 所有公式均有完整表达式
- [ ] 关键计算步骤已通过工具验证
- [ ] 已识别至少 1 个常见误区
- [ ] 解法选择理由明确

### 输出格式

```json
{
  "knowledge_base": {
    "core_concepts": [
      { "name": "概念名称", "full_definition": "完整定义", "formula": "LaTeX", "derivation_hint": "推导思路", "scope": "适用范围" }
    ],
    "common_misconceptions": [
      { "misconception": "常见错误", "why_wrong": "原因", "correct_approach": "正确做法" }
    ]
  },
  "candidates": [
    {
      "method": "解法名称",
      "approach": "解题思路简述",
      "detailed_steps": [
        { "step": 1, "description": "步骤描述", "formula": "LaTeX", "calculation": "计算过程", "result": "结果", "verified": true }
      ],
      "pros": "优点",
      "difficulty": "easy|medium|hard"
    }
  ],
  "best_index": 0,
  "reasoning": "选择理由",
  "verification_notes": "验证摘要"
}
```

**完成后**：将 JSON 写入 output/solutions.json，然后继续 Step 2.5。

---

## Step 2.5：知识核准与验证 → 写入 output/knowledge.json

**准备**：先读取 output/solutions.json，以批判性视角对解法进行独立审核。

你是一位独立的学科审核专家。对已生成的解法进行全面的知识准确性审核。

### 审核任务

#### 一、逐步核查推导过程
1. **公式正确性**：有无符号错误、适用条件遗漏？
2. **计算正确性**：对数值计算用 Bash 重新验证
3. **逻辑连贯性**：步骤间推导是否有跳跃？
4. **单位/量纲**（理科题）：单位处理是否正确？

#### 二、知识点完整性检查
- 是否有重要的知识前提未被提及？
- 是否存在学生容易忽视的隐含条件？

#### 三、生成修订建议

### 输出格式

```json
{
  "audit_summary": { "overall_accuracy": "high|medium|low", "issues_found": 0, "verification_method": "..." },
  "step_audits": [
    { "step": 1, "status": "verified|corrected|flagged", "original": "摘要", "finding": "发现", "correction": "修正", "bash_output": "验证输出" }
  ],
  "missing_knowledge": ["遗漏知识点"],
  "enriched_concepts": [{ "concept": "概念", "explanation": "解释", "why_important": "意义" }],
  "corrected_solution": { "has_corrections": false, "summary": "修正摘要", "corrected_steps": [] },
  "teaching_insights": ["教学洞察"]
}
```

**完成后**：将审核结果写入 output/knowledge.json，然后继续 Step 3。

---

## Step 3：讲解脚本 → 写入 output/scenes.json

**准备**：先读取 output/understanding.json、output/solutions.json 和 output/knowledge.json，综合三者作为上下文。

你是一位内容设计专家。请基于题目分析、已验证的解法和知识审核结果，生成逐帧讲解脚本。

### 讲解风格：{{style}}

根据用户选择填入对应的风格指令：
- **standard**（标准讲解风格）：条理清晰，逐步推导，适合专业讲解。语言规范，步骤完整。
- **heuristic**（启发引导风格）：通过提问引导思考，帮助读者自己发现规律。多用设问、类比、引导性语言。
- **competition**（深度拓展风格）：强调分析技巧和深度思考方法，补充拓展知识。信息密度高。

### 任务

将解题过程拆分为多个讲解场景（通常 8-20 个），每个场景对应讲解的一个步骤或环节。

**重要**：必须读取 output/knowledge.json：
- 使用 corrected_solution.corrected_steps 替代有误的步骤
- 将 enriched_concepts 和 teaching_insights 融入讲解
- 将 missing_knowledge 补充到相关场景
- 参考 common_misconceptions 加入"常见错误提示"

### 输出格式

```json
{
  "scenes": [
    {
      "seq": 1,
      "title": "场景标题",
      "narration": "讲解旁白（500-2000字，口语化）",
      "visual_description": "视觉内容描述",
      "visual_elements": [
        { "element_type": "formula|chart|diagram|illustration|text_highlight", "description": "具体描述" }
      ],
      "duration_hint": 30
    }
  ]
}
```

### 测验题场景（{{includeQuiz}} 为 true 时）

```json
{
  "seq": N, "title": "测试题", "scene_type": "quiz",
  "questions": [
    { "id": "q1", "type": "choice", "stem": "题目", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "B", "explanation": "解析" },
    { "id": "q2", "type": "fill", "stem": "填空题___", "answer": "答案", "explanation": "解析" },
    { "id": "q3", "type": "true_false", "stem": "判断题", "answer": "正确", "explanation": "解析" }
  ]
}
```

### 场景设计指南

1. **开场场景**（seq=1）：引入题目，明确问题
2. **分析场景**（seq=2~N-1）：逐步推导、计算、证明
3. **总结场景**：归纳结论、提炼方法
4. **测试题场景**（可选）：3-5 道测试题，至少 2 道选择题

### 输出前强制自检

- [ ] narration 中公式与 knowledge.json 一致
- [ ] 涉及计算的场景数值已验证
- [ ] 至少一个场景融入了 enriched_concepts
- [ ] 至少一个场景提到了常见误区
- [ ] 所有公式用 LaTeX 格式

**完成后**：将 JSON 写入 output/scenes.json，然后继续 Step 4。

---

## Step 4：生成最终产物（格式：{{outputFormats}}）

**准备**：先读取 output/scenes.json 获取所有讲解场景，再生成产物。

### 通用输出要求

- 所有产物写入 output/ 目录
- 不遗漏任何场景
- 如果同时输出多种格式，确保内容一致但详细程度可不同

### 字体规范
- 中文字体：微软雅黑 `"Microsoft YaHei"`
- 英文字体配套：`"Inter"`, `"Segoe UI"`
- 一个产物中只允许使用一个中文字体

---

### HTML 幻灯片输出（格式 html）

**主设计技能：/html-ppt**，不与 /ui-ux-pro-max 同时使用。

**文件**：output/explain_output.html

**幻灯片顺序**：
1. 标题页（视觉有冲击力）
2. 目录页（必须存在）
3. 内容页（按 scene seq 顺序）
4. 总结页
5. 测试题页（可选）

**交互功能（必须实现）**：
- 键盘翻页：ArrowUp/Down/Left/Right/PageUp/PageDown/Home/End
- 右上角 .nav-group 容器：翻页器 + 全屏按钮 + 深浅色切换，三者同行居中
- GSAP 入场动画：fade+slide，内容元素逐条 stagger
- 全屏按钮：Font Awesome fa-expand/fa-compress
- 深浅色切换：Font Awesome fa-moon/fa-sun，在 html 上切换 data-theme

**翻页核心规则**：
- go(n) 必须：移除当前 slide 的 active → 给目标 slide 添加 active → 更新翻页器文字
- .slide.active { display: flex } 必须覆盖 .slide { display: none }
- 翻页动画必须在 display:flex 生效后用 requestAnimationFrame 触发

**DOM 结构**：
- 所有 .slide 必须是 .slideshow 的直接子节点，严禁嵌套
- data-index 从 0 开始连续递增

**设计规范**：
- 画布 100vw × 100vh 响应式布局
- 圆角控制在 4px~8px
- 内容必须铺满画布，空白 > 15vh 为违规
- 一页放不下时拆分为多页
- 公式用 KaTeX 渲染，图表用 ECharts

**CDN 资源（jsdelivr）**：
- KaTeX: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/
- ECharts: https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js
- GSAP: https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js
- Font Awesome 6: https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/css/all.min.css

**ECharts 规范**：
- 容器至少 48vh 高度
- 必须在 slide 可见后初始化，init 后注册到 window.registerChart(chart)

**测试题交互**：
- 选择题：4 个选项按钮，点击后高亮，展开答案区域
- 填空题：输入框 + "查看答案"按钮
- 判断题：正确/错误按钮
- 答案初始隐藏，交互后才显示，每题只能作答一次

---

### 自定义网页输出（格式 custom_html）

**主设计技能**：从 /ui-ux-pro-max 与 /design-taste-frontend 中二选一。

**文件**：output/explain_custom_output.html

**核心**：这不是幻灯片，不生成 slide deck 结构。页面布局遵循用户指定的版式要求。

**视觉设计流程**：
1. 参考模板 → 以模板为主
2. designSystem → 使用 DESIGN.md
3. 主题方向 → 主设计技能在色系内创作
4. 都没有 → 自主设计，默认宽度 min(92vw, 1440px)

**底线约束**：色彩 ≤ 3 主色、字体 ≤ 2 种、留白充足、禁止 AI 感渐变、border-radius ≤ 12px

**侧栏+主内容规则**：外壳 width:100% + main flex:1 占满剩余宽度 + 卡片 width:100%

**交互**：深浅色切换（右上角固定定位）、锚点导航、折叠区等轻交互

---

### PPTX 输出（格式 ppt）

**文件**：output/explain_output.pptx（通过 output/build.py 生成）

**技术栈**：python-pptx，可借用 MckEngine 布局方法。

**幻灯片顺序**：封面 → 目录 → 内容 → 结尾 → 测验

**关键规则**：
- 严禁使用 MckEngine 默认主题和海军蓝配色
- y 坐标追踪：每元素后累加高度，超出安全区（y > 7.1）则新建页
- 大型图表独占一页
- 禁止一页堆 3 个以上白底描边文字框
- 优先替代：split visual、metric strip、process rail、comparison table
- 字号：标题 24-36pt，正文 12-18pt，注释 10-12pt

---

### DOCX 输出（格式 docx）

**文件**：output/explain_output.docx（通过 output/build.mjs 生成，使用 docx npm 包）

**文档结构**：封面 → 目录 → 前言 → 正文章节（核心讲解、公式推导、典型例题、常见错误、知识拓展）→ 总结 → 词汇表

**排版**：H1 章节标题，H2 小节标题，微软雅黑 11pt，LaTeX 公式保留

---

## 全局内容规则

### 禁止事项
- 元语言预告："本场景将介绍..."、"我们今天来学习..."
- 只有公式名称没有实际公式
- 要点仅为单个词语或主题标签
- 模糊的视觉描述

### 每个 scene 必须包含
- narration ≥ 100 字，包含具体知识内容
- 要点：完整句子
- 视觉描述：指定元素类型和标签

### 搜索与验证
- 时效性数据、学科进展、权威内容 → 建议搜索而非凭记忆
- 关键信息至少 1 个权威来源

### 运行环境约束
- 禁止启动 HTTP/HTTPS 服务器
- 禁止安装浏览器自动化工具
- HTML 验证仅通过 Read 工具检查源码

### 内容区宽度规则
- 幻灯片内容区横向 100%，禁止 max-width: 1200px
- 长页默认 max-width: min(92vw, 1440px)
- 侧栏布局：main flex:1 占满剩余宽度

### 推荐可能使用的技能
- /ui-ux-pro-max
- /html-ppt：HTML 幻灯片主设计
- /pptx-generator：PPTX 布局防溢出
- /mck-ppt-design：Python PPTX 布局方法库
- /docx：DOCX 文档结构
- /echarts：ECharts 图表
- /gsap /gsap-core /gsap-animation：GSAP 动画
- /frontend-slides：HTML 幻灯片前端
- /multi-search-engine：多引擎搜索
- /education-skills：教育领域知识
- /better-icons：图标选型（严禁 emoji 作 UI 图标）
