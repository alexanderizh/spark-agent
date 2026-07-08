## 自定义网页 HTML 输出规范

### 技术栈
1. 输出 `HTML5` 成品，必要时可拆分 `CSS/JS` 辅助文件
2. 禁止使用 Python、禁止安装额外依赖
3. 图形优先使用原生 `SVG`、`CSS`、`Canvas`、`ECharts`

### 输出文件规则
- 主文件必须写为 `output/explain_custom_output.html`
- 如需外链资源，可额外输出：
  - `output/explain_custom_output.css`
  - `output/explain_custom_output.js`
- 页面必须可直接在浏览器打开运行

### 核心要求
1. 这不是幻灯片，不要生成按页切换的 slide deck 结构
2. 页面布局必须优先遵循任务提示中的“自定义网页版式要求”
3. 如果版式要求与默认设计习惯冲突，以用户指定版式为准
4. 即使采用自定义版式，也必须完整覆盖 `scenes.json` 中的核心知识内容
5. 若内容较长，允许自然滚动，但滚动体验要清晰、有分区、有节奏

### 版式理解规则
- 用户可能会指定：单屏网页、长页面、左右分栏、海报式、文章式、知识地图式、卡片式、滚动叙事等
- 你需要先抽取这些版式要求，再把所有讲解内容组织成匹配该版式的 HTML
- 当用户描述不够具体时，可补足合理的页面结构，但不能退化成幻灯片翻页

### ⚠️ 视觉设计流程（强制）

> **此产物为自定义网页（非翻页式），主设计技能从 `/ui-ux-pro-max` 与 `/design-taste-frontend` 中二选一**（不可混用，详见 skills-html 选用规则）。下文以「主设计技能」统称选定的那一个。

1. **参考模板**（`reference-template.html` 或任务 URL）→ 必须以模板为视觉主参考，Read 后复用；主设计技能仅作质量底线。
2. **designSystem 规范** → 使用 DESIGN.md 作为最高约束；主容器建议 `max-width: min(92vw, 1440px)`，勿锁死 1200px。
3. **主题方向指令** → 以主设计技能为主，在指令色系内创作 CSS token。
4. **都没有** → 以主设计技能为主自主设计；默认宽度 `min(92vw, 1440px)`，宽表可更宽。
- 底线约束：色彩 ≤ 3 主色、字体 ≤ 2 种、留白充足、禁止 AI 感渐变、border-radius ≤ 12px

### 设计要求
- 页面视觉必须完整、成体系，不可只堆纯文本
- 必须有明确的信息层级：标题区、主体区、重点强调区、总结区至少要具备其中 3 类
- 内容容器数量要克制，避免碎片化堆砌
- 保持响应式，桌面和移动端都能正常浏览
- 如果使用图表或公式，要保证可读性和尺寸充足

### 侧栏 + 主内容布局（目录导航 / 时间轴等）—— 可选版式，非默认

> ⚠️ 该版式**不是默认版式**，不要主动套用。仅在以下任一条件满足时才考虑：
> - 用户明确要求"目录导航 / 时间轴 / 侧边大纲 / 左右分栏"等类似版式
> - 用户未指定版式，但主题/内容确实更适合该结构（如长篇章节式讲解、流程式知识脉络）
>
> 用户偏好海报式、单屏、文章式、卡片式、滚动叙事等其他版式时，**不要回退到侧栏布局**。

一旦确定采用「左侧目录/时间轴 + 右侧正文」，**必须**遵守系统注入的「侧栏 + 主内容」宽度规则（见 layout-width-guidance）：

- 页面外壳 `width: 100%`，勿用整页 `max-width: 1200px` 居中把主区压窄。
- `main` 使用 `flex: 1 1 0` 占满侧栏以外全部宽度；正文卡片 `width: 100%`。
- **禁止**主内容区写死 800px/900px 宽并贴侧栏、导致右侧大片空白。
- 桌面端主列应明显宽于侧栏（主列约占除侧栏外 100% 宽度），模块在主列内可对称 padding，不要只挤在左侧。

### 交互要求
- 可按需要加入锚点导航、折叠区、悬浮目录、标签切换、局部高亮等轻交互
- 不要求实现幻灯片翻页器、页码器、全屏切换
- 交互必须服务于内容理解，不要为了炫技加入无关动画
- **深浅色切换按钮（必须实现）**：在页面右上角放一个固定定位按钮（`position:fixed; top:12px; right:12px; z-index:9999`），点击后在 `<html>` 上切换 `data-theme="dark"/"light"` 属性，并通过 CSS 变量实现配色切换；图标使用 Font Awesome `<i class="fa-solid fa-moon"></i>`（切换后变为 `fa-sun`），**严禁使用 emoji 图标**（🌙/☀️），默认主题由 UI 设计技能根据内容调性决定

### 深浅色主题实现规范
```css
/* 浅色模式 */
:root, [data-theme="light"] {
  /* 色值由 UI 设计技能根据内容主题决定 */
  --bg: ...; --surface: ...; --text: ...;
  --primary: ...; --border: rgba(0,0,0,0.08);
}
/* 深色模式（由 UI 设计技能基于浅色方案推导） */
[data-theme="dark"] {
  --bg: ...; --surface: ...; --text: ...;
  --primary: ...; --border: rgba(255,255,255,0.08);
}
```

```javascript
// 主题切换 JS（必须实现）
const root = document.documentElement;
// 初始化默认主题（由 UI 设计技能根据内容调性决定默认浅色或深色）
root.setAttribute('data-theme', 'light'); /* 或 'dark'，由设计决定 */
const themeIcon = document.getElementById('theme-icon');
function updateThemeIcon(isDark) {
  if (themeIcon) themeIcon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}
updateThemeIcon(false);
document.getElementById('theme-btn').addEventListener('click', function() {
  const isDark = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  updateThemeIcon(!isDark);
});
```

### 内容组织要求
- 允许按照主题区块重组内容，不必严格保持“1 个 scene = 1 页”
- 但必须覆盖原始脚本中的核心结论、推导步骤、关键要点、总结
- 如果原始脚本含题目/练习，可在页面底部或独立分区呈现

### 自检
- 打开页面后，用户应一眼看出这是”网页内容产物”而不是”在线幻灯片”
- 页面结构必须体现用户指定版式
- 页面内不应出现基于 `slide`、`navigator`、翻页按钮、页码器的默认幻灯片骨架
- 若有侧栏布局：检查 `main` 是否 `flex:1` 全宽、内容卡片是否 `width:100%`、是否存在右侧大面积无内容空白（有则改 CSS）

### ⚠️ CRITICAL：内容可见性验证（渐进增强模式）

**核心原则**：允许 GSAP / CSS keyframes 等动画，**但元素的可见性永远不能依赖 JS 成功执行**。任何 JS 环节失败（CDN 超时、插件未引入、registerPlugin 抛错、JS 异常）时，内容必须仍然可见——这是部署后最高频的事故。

**A. 黄金铁律：CSS 中元素永远默认可见**

```css
/* ✅ 入场目标元素的 CSS 默认值必须是可见状态 */
.fade-in-item { opacity: 1; transform: none; }

/* ❌ 永远不要写：一旦 JS 没跑元素就永远不可见 */
/* .reveal { opacity: 0; transform: translateY(24px); transition: ... } */
/* .reveal.visible { opacity: 1; } */
```

**B. GSAP 渐进增强模板**（推荐做高级动画时用）

```html
<script src="https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<!-- 仅当用 ScrollTrigger 才引入 -->
<script src="https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
```

```js
window.addEventListener('load', function () {
  if (typeof gsap === 'undefined') return;                       // 守门 1
  if (typeof ScrollTrigger !== 'undefined') {                    // 守门 2
    gsap.registerPlugin(ScrollTrigger);
  }
  // gsap.from() 临时把元素压到 from 状态，动画到 CSS 现有的 opacity:1
  // JS 跑了 → 漂亮的入场；JS 失败 → 元素停在 CSS 的 opacity:1 → 仍可见
  gsap.from('.fade-in-item', {
    opacity: 0, y: 20, duration: 0.3, stagger: 0.04, ease: 'power2.out'
  });
});
```

**C. 反模式禁用清单**

- ❌ `.reveal / .fade-in / .hidden-on-load { opacity: 0 }` 作为入场起点
- ❌ `.reveal { opacity: 0 } / .reveal.visible { opacity: 1 }` + JS 给加 visible class
- ❌ `IntersectionObserver` + `classList.add('visible')` 驱动可见性
- ❌ `gsap.set(el, {opacity:0})` 在初始化里
- ❌ 入场 tween 上 `clearProps: 'all' / 'opacity'` / `repeat: -1` / `yoyo: true`
- ❌ 不守门直接调 `gsap.from()` / `registerPlugin(ScrollTrigger)`
- ❌ 用了 ScrollTrigger 却没引入 ScrollTrigger 插件 CDN

**D. 纯 CSS 方案**（更简单的入场动画推荐这条路）

```css
@keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.fade-in { animation: fadeInUp 0.5s ease-out both; }   /* both 不能漏 */
```

**E. 自检（输出前 grep 强制扫描）**

```bash
# CSS 静态隐藏起点（除非配 animation forwards/both）
grep -nE "\.(reveal|fade-in|fade-up|hidden-on-load)[^{]*\{[^}]*opacity:\s*0" output/*.html
# IntersectionObserver 驱动可见性
grep -nE "IntersectionObserver" output/*.html | grep -iE "visible|reveal|show|active"
# 入场 tween 用 clearProps
grep -nE "gsap\.(from|fromTo|to)[^;]*clearProps" output/*.html
# 用了 ScrollTrigger 但没引入插件 CDN
grep -q "registerPlugin(ScrollTrigger)" output/*.html && grep -q "ScrollTrigger.min.js" output/*.html || echo "❌ 用了 ScrollTrigger 但没引插件 CDN"
```

- **验收**：断网/禁用 JS 后重新打开 HTML，所有内容必须仍然可见（只是没动画）。这是渐进增强的核心验收标准。
