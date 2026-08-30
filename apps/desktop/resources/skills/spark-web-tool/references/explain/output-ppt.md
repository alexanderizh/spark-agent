## PPT 输出规范（python-pptx，可借用 MckEngine 布局）

### 输出要求
1. 编写 `output/build.py`，执行后产出 `output/explain_output.pptx`
2. 从 workspace 根目录执行：`/opt/py/bin/python3 output/build.py`
3. 不生成 HTML；优先使用 python-pptx。MckEngine 可用时只借用布局方法和避坑指南，不使用其主题；MckEngine 不可用时直接用 python-pptx 自定义布局完成

```python
import sys
import os
for _dir in [
    os.environ.get('MCK_PPT_SKILL_DIR'),
    os.environ.get('SKILLS_DIR', '') + '/skills/mck-ppt-design',
    os.path.abspath('claude-skills/skills/mck-ppt-design'),
    '/home/node/.claude/skills/mck-ppt-design',
]:
    if _dir and os.path.isdir(_dir) and _dir not in sys.path:
        sys.path.insert(0, _dir)

try:
    from mck_ppt import MckEngine
except ImportError:
    MckEngine = None

if MckEngine is not None:
    eng = MckEngine(total_slides=15)
    # ... 调用布局方法，并显式覆盖颜色/背景/强调色，禁止使用默认主题 ...
    eng.save('output/explain_output.pptx')
else:
    from pptx import Presentation
    prs = Presentation()
    # ... 用 python-pptx helper 实现封面、目录、内容页、结尾页 ...
    prs.save('output/explain_output.pptx')
print('PPTX saved: output/explain_output.pptx')
```

### 幻灯片顺序
1. 封面（`eng.cover()`）
2. 目录（`eng.toc()`）
3. 内容幻灯片（覆盖全部 scenes，内容多时拆页，不跳过）
4. 结尾（`eng.closing()`）
5. 测验幻灯片（仅当存在 quiz 场景时；每题一页，**不显示答案**）

### ⚠️ 关键规则

**布局**：参考 `/mck-ppt-design` 选择合适的布局方法、坐标规范和防溢出规则；MckEngine 不可用或方法不匹配时，允许使用底层 python-pptx API 自定义布局。

**主题禁令**：严禁使用 MckEngine 默认主题、默认海军蓝/咨询风配色、默认字体或主题矩阵。MckEngine 只提供布局和避坑经验，视觉系统必须由当前任务的 designSystem、用户主题方向或自行设计的 token 决定。

**图表**：可使用 MckEngine 内置图表方法（`grouped_bar()`、`donut()`、`horizontal_bar()` 等）或 matplotlib 生成 PNG 后贴图；不要因为 MckEngine 不可用而放弃图表。

**中文**：MckEngine 内置 CJK 支持，直接传中文字符串，无需额外配置。

**错误恢复**：执行失败时读取 stderr → 修复 `output/build.py` → 重新执行。
常见原因：参数类型错误（列表传成字符串）、图片路径不存在（改为 `image_path=None`）。

### 编码规则
- 覆盖全部场景，不跳过
- 用 try/except 包裹，错误输出到 stderr
- 最后一行：`print("PPTX saved:", output_path)`
