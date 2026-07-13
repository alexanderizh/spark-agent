# Spark Web Tool Skill

> 内置 skill ID: `builtin:spark-web-tool`
> 位置：`apps/desktop/resources/skills/spark-web-tool/`

将原 `edu-task-agent` 服务中的内容生成能力抽离为可被 SparkWork 调用的本地 skill。

## 覆盖能力

| 任务类型 | 入口 | 适用场景 |
|---------|------|---------|
| `courseware` | 课件 | 多场景的完整交互式课件，含大纲确认环节 |
| `explain` | 专题讲解 | 单题/单知识点的深度讲解 |
| `data-analysis` | 数据分析 | CSV/Excel → HTML 数据分析报告 |

**不包含**（保留给原 edu-task-agent 后端）：

- `exam`（试卷出题）— 后端有专门管线
- `material`（创作素材）— 后端有专门管线
- 多账号/多供应商 LLM 轮询（运行时由 SparkWork 的 agent-runtime 负责）

## 目录结构

```
spark-web-tool/
├── SKILL.md                    # 入口文档（路由 + 关键指引）
├── manifest.json               # 参数定义（taskType/outputFormats/style/...）
├── README.md                   # 本文件（开发者参考）
└── references/                 # 详细 prompt 资产（按需引用）
    ├── courseware/             # 课件任务
    │   ├── outline-system.md           # 大纲生成系统 prompt
    │   ├── content-gen-system.md       # 内容脚本生成系统 prompt
    │   └── workers/                    # 4 种产物 worker system prompts
    │       ├── pptx-system.md
    │       ├── interactive-html-system.md
    │       ├── docx-system.md
    │       └── markdown-system.md
    ├── explain/                # 讲解任务
    │   ├── understand.md               # Step 1 题目理解
    │   ├── search.md                   # Step 2 联网搜索 + 研究 + 解法
    │   ├── verify.md                   # Step 2.5 知识审核
    │   ├── script.md                   # Step 3 讲解脚本（分镜）
    │   ├── output-shared.md            # Step 4 通用规范
    │   ├── output-html.md              # Step 4 HTML 幻灯片
    │   ├── output-custom-html.md       # Step 4 自定义网页
    │   ├── output-ppt.md               # Step 4 PPTX
    │   └── output-docx.md              # Step 4 DOCX
    ├── data-analysis/          # 数据分析任务
    │   └── analysis-system.md          # 完整 system prompt
    ├── clarify/                # 问答澄清
    │   ├── dimensions.md               # 内容/设计维度骨架
    │   ├── survey-system.md            # 调研阶段 system prompt
    │   └── confirm-system.md           # 确认阶段 system prompt
    └── snippets/               # 通用片段
        ├── content-rules.md
        ├── pre-output-checklist.md
        ├── global-system-appendix.md
        ├── cdn-mirrors.md
        ├── layout-width-guidance.md
        ├── output-structure.md
        ├── image-gen-instructions.md
        ├── skills-pptx.md
        ├── skills-html.md
        ├── skills-docx.md
        └── visual-build-flow.md
```

## 任务流程

所有任务都走 **Stage 0 问答澄清**（survey + confirm 两阶段）+ **Stage 1+ 任务主流程**：

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 0: 问答澄清（所有任务必走）                            │
│   ├─ 0A survey:  7-12 个结构化问题（内容 + 设计方向 + 视觉细节）│
│   └─ 0B confirm: 复述 summary + 0-2 个关键追问                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 1+: 任务路由                                           │
│   ├─ courseware:  大纲 → 大纲确认 → 内容脚本 → 多格式产物     │
│   ├─ explain:     理解 → 研究 → 验证 → 脚本 → 多格式产物     │
│   └─ data-analysis: 数据下载 → 分析 → HTML 报告              │
└─────────────────────────────────────────────────────────────┘
```

## 关键设计原则

1. **问答澄清是 Stage 0，不是可选项**
   - 把"模型生成时即兴决定视觉"前移为"创建前用结构化问话确定视觉方向"
   - survey 阶段覆盖 7-12 个问题，设计是重点
   - confirm 阶段基于已有答案合成 summary，必要时追加 0-2 个关键追问

2. **课件流程必走"大纲确认"环节**
   - 大纲生成后**必须**展示给用户确认
   - 用户可调整场景增删/合并/重排
   - 确认后才进入内容脚本生成
   - 不要跳过这步

3. **视觉设计优先级（强制）**
   ```
   锁定的创作简报（来自澄清）> 用户参考模板 > designSystem > 主题方向 > UI 设计技能自由创作
   ```

4. **运行环境约束**
   - 禁止启动 HTTP 服务器
   - 禁止浏览器自动化工具
   - HTML 产物验证只能通过 Read 工具读源码

5. **CDN 国内镜像**
   - 优先 cdn.jsdelivr.net / cdn.bootcdn.cn
   - 禁止 unpkg.com、cdnjs.cloudflare.com

## 源项目对应关系

| 本 skill 资产 | edu-task-agent 源项目 |
|--------------|---------------------|
| `references/courseware/outline-system.md` | `prompts/courseware/outline-system.md` |
| `references/courseware/content-gen-system.md` | `prompts/courseware/content-gen-system.md` |
| `references/courseware/workers/*.md` | `prompts/courseware/workers/*.md` |
| `references/explain/*.md` | `prompts/explain/*.md` |
| `references/data-analysis/analysis-system.md` | 从 `src/pipeline/data-analysis.pipeline.ts` 提取 |
| `references/clarify/*.md` | 从 `src/services/clarify.service.ts` 提取 |
| `references/snippets/*.md` | `prompts/snippets/*.md` |

## 升级指南

当上游 `edu-task-agent` 项目的 prompt 文件更新时：

1. 对比本 skill 的 `references/` 与源项目 `prompts/`
2. 用 `cp` 覆盖更新对应文件
3. 检查 `SKILL.md` 是否仍能正确引用（如新增/删除/改名）
4. 如有新增任务类型，更新 `manifest.json` 的 parameters

## 版本历史

- **v2.0.0**（当前）— 从 edu-task-agent 抽离 courseware/explain/data-analysis 三大能力，添加 Stage 0 问答澄清协议、扩展 manifest 参数
- **v1.0.0** — 测试版，仅支持 explain 专题讲解（5 步流程 + 4 种产物）
