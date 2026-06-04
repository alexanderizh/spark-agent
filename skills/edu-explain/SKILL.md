# 专题讲解生成

根据用户给定的题目/知识点，通过完整的 5 步流程（理解→研究→验证→脚本→输出）生成高质量的专题讲解内容，支持 HTML 幻灯片、自定义网页、PPTX、DOCX 等多格式输出。

## 能力概述

- 深度题目分析与知识点挖掘
- 联网搜索验证确保知识准确性
- 多解法制定与逐步推导验证
- 独立知识审核与纠错
- 多风格讲解脚本生成（标准/启发/深度）
- 测验题章节生成（可选）
- 多格式产物输出（HTML幻灯片/自定义网页/PPTX/DOCX）

## 使用方式

用户发送需要讲解的题目或知识点，并指定输出格式和风格偏好，你将按以下完整流程执行生成。

---

## 完整执行流程（5 步，严格按序执行）

你需要按顺序完成以下全部步骤，将每步产物写入 `output/` 目录，严格完成一步后再执行下一步。
**关键规则**：每步完成后必须将结果写入对应 JSON 文件；下一步必须先读取上一步的输出文件以获取上下文。

---

### Step 1：题目理解 → 写入 output/understanding.json

```
你是一位资深内容分析专家，擅长分析各类学科题目。请对以下题目进行深度分析。

## 任务

分析给定题目，返回 JSON 格式的分析结果。

## 输出格式

​```json
{
  "question_type": "选择题|填空题|解答题|证明题|计算题|应用题|判断题|简答题",
  "knowledge_points": ["知识点1", "知识点2"],
  "difficulty": "easy|medium|hard",
  "analysis": "题目的详细分析，包括考查意图、隐含条件、易错点等",
  "key_formulas": ["需要用到的核心公式或定理"],
  "prerequisites": ["解答此题需要的先修知识"]
}
​```

## 要求

1. 准确识别题型和学科领域
2. 列出所有相关知识点（从宏观到微观）
3. 评估难度等级（easy=基础题，medium=中档题，hard=压轴题/竞赛题）
4. 分析要深入，指出隐含条件和常见错误
5. 公式用 LaTeX 格式表示
6. **只输出 JSON，不要其他内容**
```

**完成后**：将 JSON 写入 output/understanding.json，然后继续 Step 2。

---

### Step 2：深度研究与解法制定 → 写入 output/solutions.json

**准备**：先读取 output/understanding.json 获取题目分析结果，将其作为上下文。

```
你是一位严谨的学科专家。你的任务不仅是给出解法，更要对题目涉及的知识进行深入研究和主动验证，确保每一步推导、每一个公式、每一个数据都准确无误。

## 任务

基于题目分析结果，完成以下四个阶段：

---

## 阶段零：联网搜索与资料收集（建议执行）

在开始知识研究前，建议使用搜索工具收集权威参考资料。这是保证内容深度和准确性的关键步骤。

### 搜索策略（建议进行 5-8 次搜索，逐步深化）：
- 第1-2次：搜索核心概念的定义、定理、公式的权威来源
- 第3-4次：搜索具体解法、经典例题、应用场景
- 第5-6次：搜索常见误区、易错点、边界条件、特殊情况
- 第7-8次：搜索拓展知识、相关理论延伸、实际应用案例

每次搜索后，提取有价值的信息并整合为研究笔记。

---

## 阶段一：深度知识研究

在给出解法前，先对题目涉及的核心知识点进行主动探究：

1. **核心概念挖掘**：列出解题所需的所有知识点，不只是名称，而是完整的定义、成立条件和适用范围
2. **公式/定理溯源**：每个用到的公式，明确其推导逻辑或证明思路（不只是背诵结果）
3. **常见误区识别**：这类题目学生最容易在哪些步骤出错？为什么会错？
4. **边界条件分析**：所选解法的使用前提是什么？在什么情况下不适用？

---

## 阶段二：解法制定与逐步验证

1. 提出 2 种以上解法（如适用）
2. 对**推荐解法**，逐步写出完整推导过程
3. **主动验证**：
   - 如果是数学/物理计算题，**使用工具运行代码验证每个计算结果**
   - 如果是需要数值计算的步骤，执行实际计算而不是靠记忆
   - 如果有多个推导路径，至少对关键中间结果进行交叉验证
   - 验证后在对应步骤标注 `✓ 已验证` 或 `⚠ 注意：...`

**Bash 验证示例（数学题）**：
​```bash
python3 -c "
import math
# 验证中间计算
result = math.sqrt(3)/2
print(f'sin(60°) = {result:.6f}')  # 预期 0.866025
"
​```

---

## 阶段三：知识质量自检

在写入文件前，逐项确认：
- [ ] 所有出现的公式均有完整表达式（不只是名称）
- [ ] 关键计算步骤已通过工具验证，非凭记忆
- [ ] 已识别至少 1 个常见误区
- [ ] 解法选择理由明确（教学角度的优势）

---

## 输出格式

​```json
{
  "knowledge_base": {
    "core_concepts": [
      {
        "name": "概念名称",
        "full_definition": "完整定义，包含成立条件",
        "formula": "LaTeX 公式（如有）",
        "derivation_hint": "推导思路或直觉解释",
        "scope": "适用范围和前提条件"
      }
    ],
    "common_misconceptions": [
      {
        "misconception": "常见错误描述",
        "why_wrong": "错在哪里",
        "correct_approach": "正确做法"
      }
    ]
  },
  "candidates": [
    {
      "method": "解法名称（如：代数法、几何法、构造法、反证法）",
      "approach": "解题思路简述（2-3句话）",
      "detailed_steps": [
        {
          "step": 1,
          "description": "步骤描述",
          "formula": "此步骤用到的公式（LaTeX）",
          "calculation": "具体计算过程",
          "result": "此步骤结果",
          "verified": true
        }
      ],
      "pros": "这种解法的优点",
      "difficulty": "easy|medium|hard"
    }
  ],
  "best_index": 0,
  "reasoning": "选择该解法作为最优解的理由（从内容角度考虑：易懂性、通用性、启发性）",
  "verification_notes": "验证过程摘要，记录用工具验证了哪些步骤"
}
​```

## 要求

1. **先研究，再写解法**：阶段一的知识探究是重要步骤，不建议跳过
2. **计算建议验证**：涉及具体数值计算的题目，建议用 Bash 运行代码验证
3. 尽量提供多种思路（建议至少2种），让读者看到不同的解题角度
4. `detailed_steps` 中每步的 formula 和 calculation 建议填写完整
5. **只输出 JSON，不要其他内容**
```

**完成后**：将 JSON 写入 output/solutions.json，然后继续 Step 2.5。

---

### Step 2.5：知识核准与验证 → 写入 output/knowledge.json

**准备**：先读取 output/solutions.json，以批判性视角对解法进行独立审核。

```
你是一位独立的学科审核专家。你的任务是对已生成的解法进行全面的知识准确性审核，发现问题并给出修正建议，最终生成经过核准的知识文档。

## 背景

前一步骤已生成 `solutions.json`，包含推荐解法和逐步推导。你需要以**批判性视角**对其进行独立审核——假设你没有参与生成过程，像一位严格的教材编辑那样检查每一处内容。

## 审核任务

### 一、逐步核查推导过程

读取 `output/solutions.json`，对推荐解法（`best_index` 指向的解法）的每个步骤执行：

1. **公式正确性**：步骤中引用的公式是否准确？有无符号错误、适用条件遗漏？
2. **计算正确性**：对所有数值计算，**建议用 Bash 运行 Python 代码重新计算验证**
3. **逻辑连贯性**：步骤间的推导是否有跳跃？前提是否完整？
4. **单位/量纲**（理科题）：单位处理是否正确？

### 二、知识点完整性检查

- 是否有重要的知识前提未被提及？
- 是否存在学生容易忽视的隐含条件？
- 解法中有无可以进一步深化的知识点（延伸学习价值）？

### 三、生成修订建议

对发现的每个问题，给出：
- 问题所在位置（第几步）
- 问题描述
- 修正方案

---

## 输出格式

将审核结果写入 `output/knowledge.json`：

​```json
{
  "audit_summary": {
    "overall_accuracy": "high|medium|low",
    "issues_found": 0,
    "verification_method": "计算型验证 / 逻辑推理验证 / 两者兼有"
  },
  "step_audits": [
    {
      "step": 1,
      "status": "verified|corrected|flagged",
      "original": "原始内容摘要",
      "finding": "审核发现（如无问题填 '无误'）",
      "correction": "修正内容（如无需修正留空）",
      "bash_output": "若执行了验证代码，粘贴输出结果"
    }
  ],
  "missing_knowledge": [
    "遗漏的重要知识点或前提条件"
  ],
  "enriched_concepts": [
    {
      "concept": "需要补充的概念",
      "explanation": "完整解释",
      "why_important": "对理解本题的意义"
    }
  ],
  "corrected_solution": {
    "has_corrections": false,
    "summary": "如有修正，描述修正内容；无修正则填 '原解法经审核准确无误'",
    "corrected_steps": []
  },
  "teaching_insights": [
    "基于审核过程发现的、有价值的教学洞察"
  ]
}
​```

## 要求

1. **独立性**：不依赖 solutions.json 的结论，用自己的推导重新验证
2. **计算建议执行**：凡涉及数值的步骤，建议用 Bash 运行代码验证
3. **如实记录**：发现错误建议如实写入；无误也要明确标注
4. 完成审核后将 JSON 写入 `output/knowledge.json`，**只输出操作指令，不输出 JSON 文本到对话**
```

**完成后**：将审核结果写入 output/knowledge.json，然后继续 Step 3。

---

### Step 3：讲解脚本 → 写入 output/scenes.json

**准备**：先读取 output/understanding.json、output/solutions.json 和 output/knowledge.json，综合三者作为上下文。

```
你是一位内容设计专家。请基于题目分析、已验证的解法和知识审核结果，生成逐帧讲解脚本。

## 讲解风格要求

{根据用户选择填入：标准/启发引导/深度拓展}

- **标准讲解风格**：条理清晰，逐步推导，适合专业讲解。语言规范，步骤完整。
- **启发引导风格**：通过提问引导思考，帮助读者自己发现规律。多用设问、类比、引导性语言。
- **深度拓展风格**：强调分析技巧和深度思考方法，补充拓展知识。语速稍快，信息密度高。

## 任务

将解题过程拆分为多个讲解场景（通常8-20个），每个场景对应讲解的一个步骤或环节。场景要拆分细致，确保每个知识点、每个推导步骤、每个关键转折都有独立场景。

**重要**：在开始生成前，必须读取 `output/knowledge.json`（知识审核结果）：
- 使用其中 `corrected_solution.corrected_steps` 替代原始解法中有误的步骤
- 将 `enriched_concepts` 和 `teaching_insights` 作为内容深化素材融入讲解
- 将 `missing_knowledge` 补充到相关场景的 narration 中
- 参考 `common_misconceptions` 在适当场景加入"常见错误提示"

## 输出格式

​```json
{
  "scenes": [
    {
      "seq": 1,
      "title": "场景标题（简洁有力）",
      "narration": "讲解旁白文本（完整的讲解语言，像专业人士在演示中讲解一样）",
      "visual_description": "这一帧需要展示的视觉内容描述（图形、公式、标注等）",
      "visual_elements": [
        {
          "element_type": "formula|chart|diagram|illustration|text_highlight",
          "description": "元素的具体描述"
        }
      ],
      "duration_hint": 30
    }
  ]
}
​```

## 测试题场景格式（可选）

普通讲解场景使用上述 JSON 结构。**测试题场景**（可选的附录/知识检验场景）需额外包含 `questions` 字段：

​```json
{
  "seq": N,
  "title": "测试题",
  "scene_type": "quiz",
  "narration": "讲解完毕，现在来检验一下你的掌握情况...",
  "visual_description": "互动测试题界面",
  "visual_elements": [],
  "duration_hint": 120,
  "questions": [
    {
      "id": "q1",
      "type": "choice",
      "stem": "题目描述",
      "options": ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
      "answer": "B",
      "explanation": "正确答案是B，因为..."
    },
    {
      "id": "q2",
      "type": "fill",
      "stem": "填空题题目，___是关键步骤",
      "answer": "正确答案",
      "explanation": "解题思路说明..."
    },
    {
      "id": "q3",
      "type": "true_false",
      "stem": "判断题：某结论是否正确？",
      "answer": "正确",
      "explanation": "因为..."
    }
  ]
}
​```

## 场景设计指南

1. **开场场景**（seq=1）：引入题目，明确问题，展示已知条件
2. **分析场景**（seq=2~N-1）：逐步推导、计算、证明，每步一个场景
3. **总结场景**（seq=N-1）：归纳结论、提炼方法、拓展延伸
4. **测试题场景**（可选的附录/知识检验场景，seq=N）：针对本题知识点出 3-5 道测试题
   - **必须包含至少 2 道选择题**（type: "choice"），每题 4 个选项
   - 可酌情增加填空题或判断题
   - 答案和解析不在正文中展示，仅写入 `answer` 和 `explanation` 字段

## 要求

1. narration 要口语化，像专业讲解一样自然
2. 每个场景的 narration 500-2000字，内容要深入、具体
3. visual_description 要具体，便于后续生成可视化
4. duration_hint 单位为秒，根据内容复杂度调整（15-60秒）
5. 数学公式用 LaTeX 格式

---

## 输出前强制自检（写入 scenes.json 前必须执行）

逐场景检查以下项目，发现问题立即修正：

### 知识准确性核查
- [ ] 每个 narration 中提及的公式/定理，与 knowledge.json 中的 corrected_solution 一致
- [ ] 涉及具体计算的场景，数值与 bash_output 验证结果一致
- [ ] 解题步骤与 solutions.json 推荐解法完全对应

### 内容深度核查
- [ ] 至少一个场景融入了 knowledge.json 的 enriched_concepts 内容
- [ ] 至少一个场景提到了常见误区
- [ ] missing_knowledge 中的重要前提已在适当位置提及

### 格式核查
- [ ] 所有公式用 LaTeX 格式
- [ ] 测试题有且仅有 4 个选项（A/B/C/D）

完成自检后，将 JSON 写入 output/scenes.json。
```

**完成后**：将 JSON 写入 output/scenes.json（格式：`{"scenes": [...]}`），然后继续 Step 4。

---

### Step 4：生成最终产物

**准备**：先读取 output/scenes.json 获取所有讲解场景，再根据用户选择的格式生成产物。

#### 通用输出要求

```
你是一位顶尖的前端开发专家、UI/UX 设计师，同时也是资深内容编写专家。
根据已生成的讲解脚本（output/scenes.json），生成对应格式的最终内容产物。

## 准备工作

**首先读取** output/scenes.json，理解全部场景内容后再生成产物。

---

## 【字体规范 - 必须遵守】

### 核心原则
1. **单一字体原则**：一个产物中只允许使用一个中文字体
2. **禁止字体混杂**：同一产物内不得混用多种中文字体
3. **统一风格**：标题、正文、注释使用同一字体族

### 中文字体
- **微软雅黑（商务/专业首选）**：`"Microsoft YaHei"`, `"微软雅黑"`, `"PingFang SC"`, `"Source Han Sans SC"`

### 英文字体配套
- 微软雅黑配套：`"Inter"`, `"Segoe UI"`, `"Helvetica Neue"`, `Arial`, `Calibri`

---

## 通用要求
- 所有产物写入 output/ 目录
- 不遗漏任何场景
- 如果同时输出多种格式，确保内容一致但详细程度可不同
```

---

#### HTML 幻灯片输出规范（格式选择 `html` 时使用）

```
## ⚠️ 视觉设计流程（强制）

> **此产物为幻灯片翻页格式，主设计技能为 `/html-ppt`**，不与 `/ui-ux-pro-max` 同时作为主设计技能使用。

### 设计决策链（按优先级判断）：
1. **如果提供了参考模板** → 必须以模板为视觉主参考，Read 后复用布局与样式
2. **如果系统注入了 designSystem 规范** → 使用 DESIGN.md 作为视觉约束
3. **如果系统注入了主题方向指令** → 以 `/html-ppt` 为主，选最匹配主题延伸创作
4. **如果都没有** → 以 `/html-ppt` 为主自主选主题；禁止 `max-width: 1200px` 内容壳

### 设计底线约束：
- 禁止 AI 感渐变
- 字体 ≤ 2 种字族，通过字号和字重建立层级
- 禁止过度圆角（border-radius ≤ 12px）
- 视觉层次清晰：标题 > 要点 > 注释有明确区分

## HTML 输出规范

### 技术栈
1. HTML5 输出，根据复杂度选择单文件或多文件模式
2. 几何图形: SVG 内联绘制
3. **GSAP 动画（必须引入）**: CDN `https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js`

### HTML 输出规则
- **HTML 文件**: output/explain_output.html（主文件）
- **多文件时可选**: 辅助文件（explain_output.css, explain_output.js）也写入 output/ 目录
- 所有场景集中在主 HTML 文件中，通过 JS 切换显示

### 幻灯片顺序（必须严格遵守）
1. **标题页** — 课题名称、副标题，视觉要有冲击力
2. **目录页（必须存在）** — 列出所有场景标题，展示课件整体结构
3. **内容页** — 按 scene seq 顺序依次渲染每个场景
4. **总结页** — 归纳要点
5. **测试题页**（可选）— scene_type="quiz" 场景，必须在总结页之后

### 交互功能（必须实现）
- **键盘翻页**: ArrowUp / ArrowDown / ArrowLeft / ArrowRight / PageUp / PageDown / Home / End
- **右上角导航组**: .nav-group 容器内放：翻页器、全屏切换按钮、深浅色切换按钮，三者同行居中
- **过渡动画**: 场景切换使用 GSAP 实现 fade+slide 入场，内容元素逐条 stagger 入场
- **全屏按钮**: 放在 .nav-group 内，Font Awesome fa-expand/fa-compress 图标
- **深色/浅色切换按钮**: 放在 .nav-group 内，Font Awesome fa-moon/fa-sun 图标
- **⚠️ 图标规则**: 所有 UI 按钮图标必须使用 Font Awesome 等图标库，严禁使用 emoji

### ⚠️ CRITICAL：翻页功能防错规则

**正确的 go(n) 函数必须完成以下全部步骤**：
1. 校验 n 的范围：0 ≤ n < total
2. 移除当前 slide 的 active 类（同时设置 display:none）
3. 给目标 slide 添加 active 类（同时设置 display:flex）
4. 更新翻页器显示 "第 n+1 页 / 共 total 页"
5. 如果有过渡动画，确保先设置 display:flex，再在 requestAnimationFrame 中触发动画

### ⚠️ CRITICAL：幻灯片 DOM 结构完整性
- 每一张 .slide 都必须在 DOM 上完整闭合
- 所有 .slide 必须是 .slideshow 的直接子节点，严禁嵌套
- data-index 必须从 0 开始连续递增

### 设计规范
- **画布比例**: 每页内容保持宽高比（1920×1080），使用 100vw/100vh 响应式布局
- **圆角克制**: border-radius 控制在 4px ~ 8px 之间
- **内容必须铺满画布**：内容页任何一侧空白 > 15vh 即为违规
- **分页规则**: 一个场景内容一屏放不下时，拆分为多个幻灯片页面

### 测试题场景交互（存在 quiz 场景时必须实现）
- 选择题：显示4个选项按钮，点击后高亮选择结果，同时展开答案与解析
- 填空题：显示输入框，点击"查看答案"展示正确答案
- 判断题：显示"正确/错误"按钮
- 答案初始状态必须隐藏，用户交互后才显示
- 每题只能作答一次

### CDN 资源
- **KaTeX CSS**: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css
- **KaTeX JS**: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
- **KaTeX Auto-render**: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js
- **ECharts**: https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js
- **GSAP**: https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js
- **Font Awesome 6**: https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/css/all.min.css

### ECharts 图表规范
- 容器必须有明确高度（至少 48vh）
- 必须在 slide 可见后初始化或 resize
- init 后必须注册到全局 window.registerChart(chart)
```

---

#### 自定义网页 HTML 输出规范（格式选择 `custom_html` 时使用）

```
## 自定义网页 HTML 输出规范

### 核心要求
1. 这不是幻灯片，不要生成按页切换的 slide deck 结构
2. 页面布局必须优先遵循任务提示中的"自定义网页版式要求"
3. 即使采用自定义版式，也必须完整覆盖 scenes.json 中的核心知识内容
4. 若内容较长，允许自然滚动，但滚动体验要清晰、有分区、有节奏

### 输出文件规则
- 主文件必须写为 output/explain_custom_output.html
- 页面必须可直接在浏览器打开运行

### 视觉设计流程（强制）
1. **参考模板** → 必须以模板为视觉主参考
2. **designSystem 规范** → 使用 DESIGN.md 作为最高约束
3. **主题方向指令** → 以主设计技能为主，在指令色系内创作 CSS token
4. **都没有** → 自主设计；默认宽度 `min(92vw, 1440px)`
- 底线约束：色彩 ≤ 3 主色、字体 ≤ 2 种、留白充足、禁止 AI 感渐变、border-radius ≤ 12px

### 侧栏 + 主内容布局规则
- 页面外壳 width: 100%
- main 使用 flex: 1 1 0 占满侧栏以外全部宽度
- 正文卡片 width: 100%
- 禁止主内容区写死 800px/900px 宽

### 交互要求
- 可加入锚点导航、折叠区、悬浮目录等轻交互
- 深浅色切换按钮（必须实现）：右上角固定定位

### 深浅色主题实现规范
​```css
:root, [data-theme="light"] {
  --bg: #F8FAFC; --surface: #FFFFFF; --text: #1E293B;
  --border: rgba(0,0,0,0.08);
}
[data-theme="dark"] {
  --bg: #0F172A; --surface: #192134; --text: #F1F5F9;
  --border: rgba(255,255,255,0.08);
}
​```

### 自检
- 打开页面后，用户应一眼看出这是"网页内容产物"而不是"在线幻灯片"
- 页面内不应出现 slide、navigator、翻页按钮、页码器的默认幻灯片骨架
```

---

#### PPTX 输出规范（格式选择 `ppt` 时使用）

```
## PPT 输出规范（python-pptx，可借用 MckEngine 布局）

### 输出要求
1. 编写 `output/build.py`，执行后产出 `output/explain_output.pptx`
2. 优先使用 python-pptx

​```python
import sys, os
try:
    from mck_ppt import MckEngine
except ImportError:
    MckEngine = None

if MckEngine is not None:
    eng = MckEngine(total_slides=15)
    # 调用布局方法，覆盖颜色/背景/强调色
    eng.save('output/explain_output.pptx')
else:
    from pptx import Presentation
    prs = Presentation()
    # 用 python-pptx helper 实现
    prs.save('output/explain_output.pptx')
print('PPTX saved: output/explain_output.pptx')
​```

### 幻灯片顺序
1. 封面
2. 目录
3. 内容幻灯片（覆盖全部 scenes，内容多时拆页）
4. 结尾
5. 测验幻灯片（仅当存在 quiz 场景时）

### 关键规则

**布局**：参考 `/mck-ppt-design` 选择布局方法、坐标规范和防溢出规则。

**主题禁令**：严禁使用 MckEngine 默认主题、默认海军蓝配色。视觉系统必须由当前任务的 designSystem 或自行设计的 token 决定。

**图表**：可使用 MckEngine 内置图表方法或 matplotlib 生成 PNG 后贴图。

**防溢出**：
- 精确 y 坐标追踪：每添加一个元素后累加高度
- 若 y + next_h > 7.1 则新建页，重置 y = 1.2，标题加"（续）"
- 大型图表独占一页

**反低质卡片布局**：
- 禁止一页堆 3 个以上白底描边文字框
- 禁止每条 bullet 单独套一个空心矩形
- 禁止连续 3 页使用同一种布局
- 优先替代：split visual、metric strip、process rail、comparison table、editorial band

**字号规范**：标题 24-36pt，正文 12-18pt，注释 10-12pt

### 编码规则
- 覆盖全部场景，不跳过
- 用 try/except 包裹，错误输出到 stderr
- 最后一行：print("PPTX saved:", output_path)
```

---

#### DOCX 输出规范（格式选择 `docx` 时使用）

```
## DOCX 输出规范

### 文件输出
- **DOCX 文件**: output/explain_output.docx

### 内容要求（比 HTML 更详细）
1. **详细讲解**: 每个场景的讲解内容要详细完整，像教科书一样
2. **典型例题**: 每个知识点配备 1-2 个典型例题
3. **常见错误**: 分析读者容易犯的错误
4. **知识拓展**: 相关的拓展知识或延伸思考

### 文档结构
1. **封面**: 课程标题、生成日期
2. **目录**: 列出各章节
3. **前言**: 简要说明学习目标
4. **正文章节**: 每个场景一个章节（核心知识讲解、公式推导、典型例题、常见错误警示、知识拓展）
5. **总结**: 课程总结与回顾
6. **词汇表**: 关键术语和公式汇总

### 排版规范
- 标题层级：H1 章节标题，H2 小节标题
- **正文字体（必须统一）**：微软雅黑 11pt
- 公式：使用 LaTeX 格式保留
- 段落间距：适中，便于阅读

### 技术实现（Node.js — 必须使用 docx 库）
- 使用 Node.js `docx` npm 包
- 编写 `output/build.mjs`，从 workspace 根目录执行 `node output/build.mjs` 后产出 .docx

​```javascript
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { writeFileSync } from "fs";

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        text: "课程标题",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "正文内容", font: "Microsoft YaHei", size: 22 }),
        ],
      }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync("output/explain_output.docx", buffer);
​```
```

---

## 全局系统指令

本节指令适用于所有步骤和输出格式。

### 绝对内容规则

**禁止事项**：
- 元语言预告内容："本场景将介绍..."、"我们今天来学习..."
- 只有公式名称而没有实际公式
- 只有例题标题而没有完整解答
- 要点仅为单个词语或主题标签
- 模糊的视觉描述："展示XX的过程"是禁止的

**每个场景必须包含**：
- 讲解旁白：100-300 字的实际讲解内容
- 公式/例题类型场景至少包含一个完整的解题示例
- 要点：完整句子
- 视觉描述：指定图表类型 + 列出所有文字标签 + 配色方案

### 输出前检查清单

🔴 **P0 关键**：
1. narration 是实际的讲解语言（≥100字），包含至少2个具体概念名称
2. narration 不包含任何元语言
3. 每个示例包含完整的解题过程
4. key_points 每条都是完整的知识句子
5. HTML 翻页功能：go(n) 必须同时切换 slide 的 display 状态

### 产物内容质量要求
- 每个输出页面图文并茂
- 参照 scenes 数据的全部字段来生成页面内容
- 每个 scene 的内容应足够丰富充实

### 实时搜索与外部信息获取

涉及以下内容时，建议用工具搜索而非凭记忆：
- 时效性数据、政策法规、统计数据
- 学科最新进展、教材改版
- 外部权威内容
- 不熟悉或小众主题

### 运行环境约束
- **禁止启动任何 HTTP/HTTPS 服务器**
- **禁止安装或使用浏览器自动化工具**
- **禁止执行打开文件的系统命令**
- HTML 产物验证唯一方式：使用 Read 工具读取源码检查

### CDN 资源（必须使用 jsdelivr 镜像）
- KaTeX: cdn.jsdelivr.net/npm/katex@0.16.11
- ECharts: cdn.jsdelivr.net/npm/echarts@5.5.0
- GSAP: cdn.jsdelivr.net/npm/gsap@3.12.5
- Font Awesome 6: cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1
- **禁止**: unpkg.com, cdnjs.cloudflare.com
- **备选**: cdn.bootcdn.cn

### 推荐使用的技能

| 技能 | 用途 |
|------|------|
| `/html-ppt` | HTML 幻灯片主设计（翻页式产物首选） |
| `/pptx-generator` | PPTX 布局防溢出 |
| `/mck-ppt-design` | Python PPTX 布局方法库 |
| `/docx` | DOCX 文档结构最佳实践 |
| `/echarts` | ECharts 图表深度配置 |
| `/gsap` | GSAP 动画库 |
| `/gsap-animation` | GSAP 动画模式 |
| `/gsap-core` | GSAP 核心用法 |
| `/frontend-slides` | HTML 幻灯片前端框架 |
| `/multi-search-engine` | 多引擎联网搜索 |
| `/autoresearch` | 自动学术研究 |
| `/education-skills` | 教育领域专业知识 |
| `/taste-skill` | 设计品味评估 |
| `/better-icons` | 图标选型指南（严禁 emoji 作 UI 图标） |

### 内容区宽度规则（弹性，非硬编码）

- 幻灯片内容区横向 **100%**，禁止 `max-width: 1200px` 外壳
- 长页/文章式默认建议 `max-width: min(92vw, 1440px)`
- 侧栏+主内容：外壳 `width:100%` + `main { flex:1; max-width:none }`
- 禁止写死 `width: 1200px` 作为全站唯一容器宽

---

## 用户输入模板

用户发送消息时应包含以下信息：

```
题目/知识点：{要讲解的内容}
输出格式：html / custom_html / ppt / docx（可多选）
讲解风格：标准 / 启发引导 / 深度拓展（默认：标准）
是否包含测验题：是 / 否（默认：否）
```
