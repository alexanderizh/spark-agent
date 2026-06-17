## CDN 资源（必须使用国内镜像）

### 数学公式
- **KaTeX CSS**: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css
- **KaTeX JS**: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js
- **KaTeX Auto-render**: https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js

### 图表与可视化
- **VChart**: https://cdn.jsdelivr.net/npm/@visactor/vchart@1.13.4/build/index.min.js
- **ECharts**: https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js
- **Chart.js**: https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
- **D3.js**: https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js

### 动画增强（国内访问稳定的 bootcdn 优先）
- **GSAP Core**: https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/gsap.min.js
- **GSAP ScrollTrigger**: https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js
- **GSAP Flip**: https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/Flip.min.js
- **GSAP Draggable**: https://cdn.bootcdn.net/ajax/libs/gsap/3.12.5/Draggable.min.js
- **Anime.js**: https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js

注：GSAP SplitText / MotionPathPlugin 等部分插件 bootcdn 没有镜像（属于 GSAP 收费插件或非公开版本），禁止使用。
即便 CDN 国内可用，**仍必须使用渐进增强模式**——agent 漏引插件、JS 抛错等场景与 CDN 速度无关，CSS 默认可见才是最终兜底。

### 图标
- **Font Awesome 6**: https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/css/all.min.css

**禁止**: unpkg.com, cdnjs.cloudflare.com, raw.githubusercontent.com
**备选**: cdn.bootcdn.cn
如需其他库，优先使用 cdn.jsdelivr.net 或 cdn.bootcdn.cn
