# HTML 在线幻灯片输出规范

## 视觉设计：由 UI 设计技能全权负责

在 `/ui-ux-pro-max` 与 `/design-taste-frontend` 中**二选一**（不混用），由所选技能**全权决定**本产物的全部视觉设计：主题方向与明暗、配色体系、字体选型与搭配、版式与构图、留白节奏、装饰与视觉元素、组件样式、动效风格。

- **技能选择建议**：数据图表/标准信息架构/专业内容优先 `/ui-ux-pro-max`；品牌感/编辑感/强视觉差异化优先 `/design-taste-frontend`。
- 系统不附加额外的配色、圆角、渐变、明暗等风格限制——设计判断完全交给所选技能。鼓励大胆使用全幅背景、层叠装饰、大字标题、不对称构图等手法，让每一页有真实的"幻灯片设计感"，而不是网页卡片的堆叠。
- 为每一页明确：页面角色（封面/目录/讲解/图表/例题/总结/测验）、主视觉焦点、布局结构。**每页布局可以完全不同**——封面可以是全屏视觉，内容页可以是双栏/全图/网格/自由排版，禁止把同一套卡片模板复制到每一页。
- 用 `:root` CSS 变量建立设计 token（色彩、字体、间距），整份 deck 保持一致的设计语言。
- 优先级：用户参考模板 > designSystem > 主题方向指令 > 设计技能自由创作。

### 字号底线（唯一硬性视觉约束）

在线幻灯片是远距离观看的演示载体，**字号宁大勿小**：

- 正文/要点文字：**不得低于 20px**，推荐 22–28px
- 页面标题：推荐 40–72px（封面更大）；卡片/小节标题 ≥ 24px
- 辅助说明/脚注/图表轴标签可低于正文，但不低于 14px
- 行高：正文 ≥ 1.5，标题 ≥ 1.2
- 内容放不下时**拆页，绝不缩小字号**
- 自检：`grep -nE "font-size:\s*(1[0-9]px|0\.[0-9]+rem)" output/*.html` 命中处若为正文文字，必须改大

## HTML 输出规则

### 技术栈
1. **不使用 Python** 生成图片，不调用 pip install；如需配图请使用系统提供的 AI 图片生成接口
2. HTML5 输出，根据复杂度选择单文件（CSS/JS 内联）或多文件（外部 CSS/JS）模式
3. 几何图形用 SVG 内联绘制；公式行内 `$...$` / 块级 `$$...$$` 用 KaTeX 渲染
4. 画布：16:9 横屏，`100vw/100vh` 响应式布局；**每页内容一屏放完，超出必须拆页**（不靠滚动）

### 文件
- **主文件**: output/explain_output.html
- 多文件模式时辅助文件（.css/.js）也写入 output/ 目录

### 幻灯片顺序（必须严格遵守）
1. **标题页** — 课题名称、副标题，视觉要有冲击力
2. **目录页（必须存在）** — 列出所有场景标题，展示内容整体结构
3. **内容页** — 按 scene seq 顺序依次渲染每个场景（非 quiz/summary 类型）
4. **总结页** — scene_type="summary" 场景，归纳要点
5. **测试题页**（根据场景和用户要求确定是否需要）— scene_type="quiz" 场景，必须在总结页**之后**渲染，基于 `questions` 数组实现互动做题

### 内容要求
- 每个场景的 key_points 逐条完整呈现，narration 中的核心知识要点必须体现在幻灯片上，不要用一句话概括
- 一个场景一屏放不下时拆为多页
- 大型图表可独占一页大图展示，配套讲解文字放相邻页；小图标/示意图可与文字同页

### 交互功能（必须实现）
- **键盘翻页**: ArrowLeft / ArrowRight / PageUp / PageDown / Home / End
- **分页器（必须存在）**：显示"第 X 页 / 共 Y 页"页码 + 左/右翻页按钮，位置与样式由设计决定
- **全屏按钮（必须实现）**：Fullscreen API 进入/退出全屏，F 键快捷键
- **单一主题**：整份产物一套 `:root` 主题变量（明暗由设计技能根据内容决定），不实现深浅色切换按钮
- **UI 图标**：翻页/全屏等功能性图标使用图标库（Font Awesome 等，参考 `/better-icons`），不用 emoji 充当 UI 图标

## 入场动画（渐进增强，防"内容不可见"事故）

允许 GSAP / CSS keyframes 做入场动画，**但元素可见性永远不能依赖 JS 成功执行**。

**核心铁律**：CSS 中内容元素默认 `opacity: 1`、无 transform——**绝不**写 `.reveal { opacity: 0 }` 作为入场起点。GSAP 用 `gsap.from()` 在运行时临时压暗再播回 CSS 的可见状态，JS 失败时元素停在可见状态。

```html
<script src="https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<!-- 仅当用 ScrollTrigger 才引入对应插件 CDN -->
```

```js
window.addEventListener('load', function () {
  if (typeof gsap === 'undefined') return;                  // 守门 1
  if (typeof ScrollTrigger !== 'undefined') {               // 守门 2
    gsap.registerPlugin(ScrollTrigger);
  }
  gsap.from('.fade-in-item', { opacity: 0, y: 20, duration: 0.3, stagger: 0.04, ease: 'power2.out' });
});
```

**禁用反模式**（任一项都会触发"JS 失败 = 整页不可见"事故）：
- ❌ `.reveal / .fade-in / .hidden-on-load { opacity: 0 }` 作为入场起点
- ❌ `IntersectionObserver` + `classList.add('visible')` 驱动可见性
- ❌ `gsap.set(el, {opacity:0})` 写在初始化里
- ❌ 入场 tween 上 `clearProps` / `repeat: -1` / `yoyo: true`
- ❌ 不守门直接调 `gsap.from()` / `registerPlugin(ScrollTrigger)`
- ❌ 用了 ScrollTrigger 但没引入插件 CDN

纯 CSS 方案是唯一允许 CSS 写 `opacity: 0` 起点的情况，**必须**配 `animation: ... both`（或 `forwards`），让动画结束后停在可见终态。

**翻页过渡**：`go(n)` 给新 active slide 加 `fade-in` 类做一次性整 slide 纯 CSS 淡入；目录页不要 stagger。

**验收**：断网/禁 JS 后重新打开 HTML，所有内容必须仍然可见（只是没动画）。

**自检（生成后 grep 扫描）**：

```bash
grep -nE "\.(reveal|fade-in|fade-up|hidden-on-load)[^{]*\{[^}]*opacity:\s*0" output/*.html
grep -nE "IntersectionObserver" output/*.html | grep -iE "visible|reveal|show|active"
grep -nE "gsap\.(from|fromTo|to)[^;]*clearProps" output/*.html
grep -q "registerPlugin(ScrollTrigger)" output/*.html && grep -q "ScrollTrigger.min.js" output/*.html || echo "用了 ScrollTrigger 但没引插件"
```

## ⚠️ CRITICAL：翻页功能防错规则（违反会导致翻页失效）

**常见 Bug**：翻页器数字滚动正常，但页面内容停留在首页不动。原因与对策：

1. `go(n)` 必须：先移除当前 slide 的 `active` 类，再给目标 slide 添加 `active` 类——不能只更新页码文字
2. `display:none → display:flex` 切换时 CSS animation 不触发——先设置 display，再在 `requestAnimationFrame` 中触发动画
3. 确保 `.slide.active { display: flex }` 优先级高于 `.slide { display: none }`

**强制自测**：生成代码后脑内模拟：初始第 1 页可见 → 点击下一页 3 次每次正确切换 → Home 回首页 → End 到末页。

### 翻页控制器 JS 参考（必须参照此模式实现；页面布局与视觉样式完全由设计决定，不受此骨架约束）

```html
<body>
  <div class="slideshow">
    <div class="slide active" data-index="0"><!-- 每页内容与布局由 UI 设计技能自主设计 --></div>
    <!-- 更多幻灯片：data-index 依次递增 1, 2, 3... -->
  </div>
  <script>
    (function() {
      const slides = document.querySelectorAll('.slide');
      const total = slides.length;
      let current = 0;
      const pageInfo = document.querySelector('.page-info');

      // ECharts 实例注册表（每次 init 后调用 window.registerChart(chart) 注册）
      window.echartsInstances = window.echartsInstances || [];
      window.registerChart = function(c) { window.echartsInstances.push(c); };

      function go(n) {
        if (n < 0 || n >= total || n === current) return;
        slides[current].classList.remove('active', 'fade-in');
        current = n;
        slides[current].classList.add('active');
        requestAnimationFrame(function() {
          slides[current].classList.add('fade-in');
          // ECharts 从 display:none 切到可见后必须 resize，否则尺寸为 0
          window.echartsInstances.forEach(function(c) { c && c.resize && c.resize(); });
          // 可选：GSAP 渐进增强元素入场（守门 + CSS 默认可见 + 严禁 clearProps）
          if (typeof gsap !== 'undefined') {
            const items = slides[current].querySelectorAll('.fade-in-item');
            if (items.length) {
              gsap.from(items, { opacity: 0, y: 16, duration: 0.3, stagger: Math.min(0.05, 0.4 / items.length), ease: 'power2.out' });
            }
          }
        });
        pageInfo.textContent = '第 ' + (current + 1) + ' 页 / 共 ' + total + ' 页';
      }

      document.querySelector('.nav-prev').addEventListener('click', function() { go(current - 1); });
      document.querySelector('.nav-next').addEventListener('click', function() { go(current + 1); });
      document.addEventListener('keydown', function(e) {
        switch(e.key) {
          case 'ArrowRight': case 'ArrowDown': case 'PageDown': go(current + 1); break;
          case 'ArrowLeft':  case 'ArrowUp':   case 'PageUp':   go(current - 1); break;
          case 'Home': go(0); break;
          case 'End':  go(total - 1); break;
        }
      });
      pageInfo.textContent = '第 1 页 / 共 ' + total + ' 页';

      // 全屏切换
      const fsBtn = document.getElementById('fs-btn');
      function toggleFullscreen() {
        if (!document.fullscreenElement) { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
        else { document.exitFullscreen && document.exitFullscreen(); }
      }
      if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
      document.addEventListener('keydown', function(e) { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); });
    })();

    // KaTeX 自动渲染
    document.addEventListener('DOMContentLoaded', function() {
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(document.body, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
          ]
        });
      }
    });
  </script>
</body>
```

配套必需 CSS（仅功能性规则，其余样式自由设计）：

```css
.slide { display: none; }
.slide.active { display: flex; }
@keyframes slideFadeIn { from { opacity: 0; } to { opacity: 1; } }
.slide.active.fade-in { animation: slideFadeIn 0.35s ease-out both; }
```

## ⚠️ CRITICAL：幻灯片 DOM 结构完整性

- 每一张 `.slide` 必须完整闭合，不能遗漏 `</div>`
- 所有 `.slide` 必须是 `.slideshow` 的**直接子节点**，禁止 `.slide` 嵌套 `.slide`（嵌套会导致翻页空白页）
- `data-index` 从 `0` 开始连续递增，不重复、不跳号
- 生成完成后回读 HTML，逐页检查 `.slide` 顺序与闭合标签一一对应

## ⚠️ CRITICAL：内容可见性验证

逐页检查每个 `.slide`：active 状态且入场动画执行完毕后，内部所有内容元素 opacity 必须为 1：
- 初始 `opacity: 0` 的元素，对应 CSS 动画**必须**带 `forwards` / `both`
- 入场动画上**严禁任何形式的 `clearProps`**
- 起点状态只在一处声明：CSS 控制就别用 GSAP 接管，GSAP 接管就删掉 CSS 起点
- 检查动画名称拼写与 keyframes 是否存在

## ⚠️ CRITICAL：ECharts 图表尺寸与初始化规范

**图表太小的根因**：容器无显式高度 / 在 `display:none` 的 slide 中初始化导致尺寸为 0。

1. **图表容器必须有显式高度**（如 `height: 55vh`），具体尺寸由页面设计决定，但要与页面相称、足够大
2. **ECharts 在 `DOMContentLoaded` 中 init 并调用 `window.registerChart(chart)` 注册**——翻页时 `go(n)` 内的 `resize()` 自动修正尺寸，两步缺一不可
3. **SVG 图表用 `viewBox` + CSS 控制尺寸**，不设固定 `width/height` 属性
4. 大型图表页避免在图表下方堆叠长内容导致溢出；图表讲解内容多时拆到相邻页

## 测试题场景交互功能（存在测试题生成要求时必须实现）

场景数据中 `questions` 数组包含测试题，必须实现以下交互：

- **选择题（type: "choice"）**：题干 + 4 个选项按钮；点击后高亮选择结果，展开"答案与解析"区域
- **填空题（type: "fill"）**：题干 + 输入框；点击"查看答案"后展示答案和解析
- **判断题（type: "true_false"）**：题干 + "正确/错误"按钮；点击后展示答案和解析
- **通用规则**：
  - 答案（answer）与解析（explanation）初始必须隐藏，不得直接出现在可见位置
  - 交互后以淡入动画显示答案区域
  - 选对按钮变绿；选错变红并同时高亮正确答案为绿
  - **每题只能作答一次**：作答后选项立即禁用（pointer-events: none）
  - 每题独立状态，互不影响
