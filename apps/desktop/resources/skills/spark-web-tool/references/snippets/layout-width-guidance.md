## 内容区宽度（弹性，非硬编码）

以下规则**覆盖**设计系统 DESIGN.md、`/ui-ux-pro-max` 技能中「约 1200px 容器」等表述：那些数值仅为参考，**不得**写死为唯一上限。

### 幻灯片 / 翻页 HTML（`.slide`、`.slide-main`）

- 画布：`100vw` × `100vh`（或 16:9 逻辑分辨率），内容区横向 **100%** 铺满可用空间。
- **禁止**在 `.slide` / `.slide-main` 外包 `max-width: 1200px`（或任意固定 px 上限）后再居中，导致左右大块留白。

### 长页 / 文章式 / 自定义网页 / 数据分析

- **默认建议**：主内容容器 `max-width: min(92vw, 1440px)`，`margin: 0 auto`，随视口伸缩。
- 宽表、双栏对比、数据密集页：可用 `min(96vw, 1600px)` 或更宽，按内容需要调整。
- **禁止**写死 `width: 1200px` 或 `max-width: 1200px` 作为全站唯一容器宽（除非用户版式明确要求更窄）。

### 侧栏 + 主内容（目录导航 / 时间轴 / App Shell）— CRITICAL

此类布局最常见问题是：**右侧主内容区过窄、贴左、右侧留大片空白**。

**禁止：**

- 在 `body` 下用 `max-width: 1200px; margin: 0 auto` 包住「侧栏+主区」，导致主区实际只剩几百像素。
- 给 `main` / `.content` 写死 `width: 800px`、`max-width: 900px` 或 `max-width: 65%` 且**不**占满侧栏以外的剩余宽度。
- 主内容卡片宽度小于主列可用宽度，却在主列内左对齐、右侧空置（应 `width: 100%` 撑满主列）。

**必须：**

1. **外壳铺满视口**：`.page-shell`（或等价根布局）`width: 100%; max-width: 100%; min-height: 100vh; display: flex; align-items: stretch;`
2. **侧栏固定比例**：`aside` / `.sidebar` 使用 `flex: 0 0 clamp(220px, 18vw, 300px);`，不要用 `position: fixed` 挤占主区宽度除非移动端断点。
3. **主列吃掉剩余空间**：`main` / `.main` 使用 `flex: 1 1 0; min-width: 0; width: auto; max-width: none;`（主列应占满除侧栏外的全部横向空间）。
4. **主区内模块全宽**：标题区、正文卡片、章节块在 `main` 内 `width: 100%; box-sizing: border-box;`。
5. **可选阅读行长**：若需限制行长，仅在 `main` **内部**增加 `.main-inner { width: 100%; max-width: min(100%, 1200px); margin: 0 auto; padding: ... }`——`max-width` 相对**主列宽度**，不是相对整页 1200px 居中壳。
6. **自检**：桌面宽度 ≥ 1280px 时，主列（侧栏右缘到视口右缘）应至少占可用宽度的 **70%**；主列内首个大块内容（如标题卡片）左右 padding 对称，不得出现「内容挤在左侧 40%、右侧 50% 空白」。

```css
/* 推荐骨架（可按设计系统改色，结构勿改） */
.page-shell {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  align-items: stretch;
}
.sidebar {
  flex: 0 0 clamp(220px, 18vw, 300px);
  min-width: 0;
}
.main {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
  max-width: none;
}
.main .section-card,
.main .hero,
.main article {
  width: 100%;
  box-sizing: border-box;
}
```

### 试卷（custom_html + 横版双栏等）

- **版式规范优先**（如 `.exam-sheet` 的 `277mm`、双栏 flex）高于任何通用 1200px 习惯。
- **禁止**在 `body` 外包一层 `max-width: 1200px` 的 `.container` 再嵌套试卷结构。

### 图表容器

- 全页图表宽度建议：`min(85%, 90vw)`，高度 `≥ 58vh`；勿将 `1200px` 作为图表或页面主容器的硬上限。

### 自检

生成后检查 CSS：若存在 `max-width: 1200px` 且非用户版式明确要求，应改为 `min(92vw, 1440px)` 或 `100%`（幻灯片场景）。
