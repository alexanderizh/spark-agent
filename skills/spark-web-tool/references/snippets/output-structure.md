## 输出结构

根据内容复杂度自行选择单文件或多文件模式：

### 单文件模式
所有 CSS/JS 内联到 HTML 文件中, 输出单个文件。适合内容较少的简单演示。

### 多文件模式
主 HTML 文件引用同目录下的外部 CSS/JS 文件, 适合内容较多、交互复杂的演示：
```
output/
  {main_file}.html    ← 主文件（必需）
  {main_file}.css     ← 外部样式（可选）
  {main_file}.js      ← 外部脚本（可选）
  assets/             ← 辅助资源目录（可选）
```

### 多文件引用规则
- CSS: `<link rel="stylesheet" href="{main_file}.css">`
- JS: `<script src="{main_file}.js"></script>`
- 必须使用**相对路径**（同目录引用,不加 `./` 前缀）
- 禁止绝对路径、禁止跨目录引用
