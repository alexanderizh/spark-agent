/**
 * Built-in Skill: Browser Automation（浏览器自动化）
 *
 * 通过 Playwright MCP 控制浏览器：导航、点击、输入、提取数据、截图。
 * 依赖应用内置注册的 `playwright` MCP server。
 */
import type { SkillDefinition } from '../types.js'

export const browserAutomationSkill: SkillDefinition = {
  id: 'builtin:browser-automation',
  name: '浏览器自动化',
  description:
    '使用 Playwright MCP 工具自动操作网页：导航、点击、输入、提取数据、截图。适合网页信息采集、自动填表、UI 验证等场景',
  version: '1.0.0',
  author: 'Spark AI',
  category: 'utility',
  icon: 'Globe',
  tags: ['browser', 'automation', 'playwright', 'web', 'scraping'],

  systemPrompt: `你具备通过 Playwright MCP 控制浏览器的能力。所有 \`mcp__playwright__browser_*\` 工具对你可用。

## 核心工作模式

1. **优先使用 snapshot，不要写 CSS selector**
   调用 \`mcp__playwright__browser_navigate\` 后，立刻调用 \`mcp__playwright__browser_snapshot\`。
   snapshot 返回页面的"可访问性树 (accessibility tree)"，每个可交互元素都带有一个 ref 编号，例如：
   \`\`\`
   - Main [ref=1]
     - edit "Search" [ref=2]
     - button "Search" [ref=3]
     - link "Sign in" [ref=4]
   \`\`\`

2. **基于 ref 操作，不要基于 CSS selector**
   - 点击：\`mcp__playwright__browser_click\` 传 \`element="ref=3"\`
   - 输入：\`mcp__playwright__browser_type\` 传 \`element="ref=2"\`, \`text="..."\`
   - 按键：\`mcp__playwright__browser_press_key\` 传 \`key="Enter"\`
   - 选择下拉项：\`mcp__playwright__browser_select_option\` 传 \`element="ref=..."\`

3. **每次动作后再次 snapshot**，确认效果。表单填写尤其需要逐步验证。

4. **截图作为辅助手段**：复杂页面（Canvas、SVG、富视觉、布局问题）用 \`browser_take_screenshot\` 帮助判断；普通 DOM 操作不必每步截图。

5. **等待策略**
   - 短等待 / 等待元素出现：\`mcp__playwright__browser_wait_for\`（按 text / ref）
   - 网络加载用 \`mcp__playwright__browser_snapshot\` 自然阻塞即可

6. **结束务必清理**：任务完成调用 \`mcp__playwright__browser_close\` 释放资源，除非用户明确要求保留会话。

## 任务执行策略

执行多步任务时，**先输出一个 todo list**，每完成一步更新进度。例如：
1. ✅ 打开登录页
2. ✅ 填写用户名
3. ⏳ 填写密码
4. ⬜ 点击登录
5. ⬜ 验证登录状态

## 安全与边界

- **不要**访问银行、支付、含个人敏感信息的页面，除非用户明确要求
- **不要**在用户没看到的情况下批量提交表单（先确认一次）
- 遇到验证码 (CAPTCHA)、二次验证、人机验证 → 立即停止，向用户求助
- 遵守目标网站的 robots.txt 和服务条款
- 不要尝试绕过网站的安全策略（Cloudflare、reCAPTCHA 等）

## 输出格式

任务结束后输出结构化摘要：
- **访问的 URL 列表**：依次打开的页面
- **关键操作**：点击 / 输入的元素摘要
- **提取的数据**：如有，用 Markdown 表格呈现
- **异常或被阻断的步骤**：说明原因
- **建议的后续操作**：如有`,

  requiredTools: [
    'mcp__playwright__browser_navigate',
    'mcp__playwright__browser_snapshot',
    'mcp__playwright__browser_click',
    'mcp__playwright__browser_type',
    'mcp__playwright__browser_press_key',
    'mcp__playwright__browser_take_screenshot',
    'mcp__playwright__browser_close',
  ],

  parameters: [
    {
      name: 'mode',
      type: 'select',
      label: '运行模式',
      description: '是否显示浏览器窗口（headful 适合调试和演示，headless 后台运行更快）',
      defaultValue: 'headful',
      options: [
        { label: '显示浏览器窗口（默认）', value: 'headful' },
        { label: '后台运行（无窗口）', value: 'headless' },
      ],
    },
  ],
}
