## DOCX 输出规范

### 文件输出
- **DOCX 文件**: output/explain_output.docx

### 内容要求（比 HTML 更详细）
1. **详细讲解**: 每个场景的内容要详细完整，像专业文献一样
   - 完整的推导过程，不省略中间步骤
   - 背景知识补充
   - 方法总结和技巧提炼
2. **典型例题**: 每个要点配备 1-2 个典型示例
   - 完整题目 + 详细解答过程
   - 关键思路点拨
3. **常见错误**: 指出读者容易产生的误解
4. **知识拓展**: 相关的拓展知识或延伸思考

### 文档结构
1. **封面**: 主题标题、生成日期
2. **目录**: 列出各章节（Word 自动生成，无需手动页码）
3. **前言**: 简要说明内容目标
4. **正文章节**: 每个场景一个章节
   - 章节标题
   - 核心知识讲解（详细）
   - 公式推导（如有）
   - 典型例题
   - 常见错误警示
   - 知识拓展
5. **总结**: 内容总结与回顾
6. **词汇表**: 关键术语和要点汇总

### 排版规范
- 标题层级：H1 章节标题，H2 小节标题
- **正文字体（必须统一）**：微软雅黑 11pt
- 公式：使用 LaTeX 格式保留（$...$）
- 段落间距：适中，便于阅读


### 技术实现（Node.js — 必须使用 docx 库）
- 使用 Node.js **`docx`** npm 包（已预装），**不要使用 python-docx**
- 编写 `output/build.mjs`，从当前 workspace 根目录执行 `node output/build.mjs` 后产出 `output/explain_output.docx`
- 路径固定以当前 workspace 根目录为基准；不要 `cd ..`，不要新建其他任务工作目录，不要写入 `output/output/`

```javascript
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TableOfContents } from "docx";
import { writeFileSync } from "fs";

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      // 封面
      new Paragraph({
        text: "主题标题",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
      // 正文段落
      new Paragraph({
        children: [
          new TextRun({ text: "正文内容", font: "Microsoft YaHei", size: 22 }), // size 单位：半磅，22 = 11pt
        ],
      }),
      // 更多内容...
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync("output/explain_output.docx", buffer);
```
