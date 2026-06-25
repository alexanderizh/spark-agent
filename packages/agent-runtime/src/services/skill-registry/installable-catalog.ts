/**
 * @module skill-registry/installable-catalog
 *
 * 内置「可安装技能目录」（Installable Skill Catalog）
 *
 * 这是一份**写死在代码里**的清单，用来在技能商店里展示「精选 / 可一键安装」的技能卡片。
 * 与已安装的技能（DB 中的 skills 表）和远程市场源（skill_registries 表）不同：
 *   - 它**不落库**，纯展示；
 *   - 它**不依赖联网**——新机器装完应用即可看到这几张卡片；
 *   - 真正的技能内容在用户点击「安装」时才从 GitHub 按需下载（完整原装，不裁剪）。
 *
 * 设计目的：让 `ppt-master` / `playwright` 这类体积较大、或不便随包内置的技能，
 * 以「卡片 + 一键安装」的形式开箱可用，而不会撑大安装包体积。
 *
 * 新增一个可安装技能时，往 INSTALLABLE_SKILL_CATALOG 追加一项即可，无需改其它代码。
 */

/** 可安装技能的来源 */
export type InstallableSkillSource =
  | {
      /** 走 tarball 整库下载（突破 GitHub Contents API 60 文件 / 1MB 限制，适合大体量技能） */
      type: 'tarball'
      /** 形如 "hugohe3/ppt-master" */
      repo: string
      /** 分支 / 标签 / commit，缺省取默认分支 */
      ref?: string
      /** 仓库内技能目录（相对于仓库根），缺省为根 */
      path?: string
    }
  | {
      /** 走 GitHub Contents API 逐文件下载（≤60 文件 / 单文件 ≤1MB 的小技能） */
      type: 'github'
      /** 形如 "owner/name" */
      repo: string
      /** 分支 / 标签 / commit，缺省取默认分支 */
      ref?: string
      /** 仓库内技能目录（相对于仓库根），缺省为根 */
      path?: string
    }

/** 内置可安装技能清单中的一条 */
export interface InstallableSkillCatalogItem {
  /** 卡片唯一标识（不进 DB，仅用于前端 key / 安装状态匹配） */
  id: string
  /** 落盘后的目录名（slug），安装状态判断与去重都以此为准 */
  slug: string
  /** 显示名 */
  name: string
  /** 一句话描述 */
  description: string
  /** 图标 emoji（卡片占位图标） */
  icon: string
  /** 作者 / 来源标注 */
  author: string
  /** 标签 */
  tags: string[]
  /** 来源信息 */
  source: InstallableSkillSource
  /** 主页 URL（可选，卡片「查看来源」按钮） */
  homepageUrl?: string
  /**
   * 安装后是否需要额外的运行时依赖（如 Python 包）。
   * 若给出，安装完成时会在 UI 上提示用户执行相应命令。
   */
  postInstallHint?: string
}

/**
 * 内置可安装技能目录。
 *
 * 当前收录：
 *   - ppt-master：高质量原生可编辑 PPTX 生成（SVG → PPTX 全链路），完整原装 ~96MB。
 *   - playwright：微软官方 playwright-cli 终端浏览器自动化技能。
 *
 * 注：`multi-search-engine` 已随包内置（resources/skills/multi-search-engine），
 * 不在此清单中——它不需要安装。
 */
export const INSTALLABLE_SKILL_CATALOG: readonly InstallableSkillCatalogItem[] = [
  {
    id: 'ppt-master',
    slug: 'ppt-master',
    name: 'PPT Master',
    description:
      'AI 驱动的多格式 SVG 内容生成系统：把 PDF / DOCX / URL / Markdown 转成高质量 SVG 页面并导出为原生可编辑 PPTX（真实 DrawingML 形状 / 文本框 / 图表 / 动画）。',
    icon: '📊',
    author: 'Hugo He',
    tags: ['pptx', 'presentation', 'powerpoint', 'svg', 'drawingml', '演示文稿'],
    source: {
      type: 'tarball',
      repo: 'hugohe3/ppt-master',
      ref: 'main',
      path: 'skills/ppt-master',
    },
    homepageUrl: 'https://github.com/hugohe3/ppt-master',
    postInstallHint:
      '该技能依赖一组 Python 包（python-pptx / PyMuPDF / cairosvg 等）。首次使用前请在技能目录执行：pip install -r requirements.txt',
  },
  {
    id: 'playwright',
    slug: 'playwright',
    name: 'Playwright CLI',
    description:
      '微软官方 playwright-cli 技能：在终端驱动真实浏览器做导航、填表、截图、数据抓取与 UI 流程调试，靠 npx 调用，与内置的浏览器自动化 MCP 互补。',
    icon: '🎭',
    author: 'Microsoft',
    tags: ['browser', 'automation', 'e2e', 'playwright', '浏览器自动化'],
    source: {
      type: 'tarball',
      repo: 'microsoft/playwright-cli',
      ref: 'main',
      path: 'skills/playwright-cli',
    },
    homepageUrl: 'https://github.com/microsoft/playwright-cli',
    postInstallHint:
      '运行时通过 npx 调用 @playwright/cli，需本机装有 Node.js/npm（提供 npx）。浏览器内核按需由 Playwright 管理。',
  },
]

/** 按 slug 取条目 */
export function getInstallableSkillBySlug(
  slug: string,
): InstallableSkillCatalogItem | undefined {
  return INSTALLABLE_SKILL_CATALOG.find((item) => item.slug === slug)
}
