import type { ApiArch, ApiPlatform, LatestRelease } from '../lib/releases'
import { RELEASES_URL } from '../lib/links'

/** UI 渲染用：展示文案 + 后端拉到的下载元数据 */
export interface DownloadItem {
  id: string
  /** 与 platform.ts 中 PlatformGuess.platform 对齐（'windows' 而非 'win'） */
  platform: 'mac' | 'windows'
  /** 与后端一致 */
  arch: ApiArch
  label: string
  format: string
  note: string
  install: string
  /** 真实下载 URL；未拉到对应版本时回退到 fallbackHref */
  href: string
  /** 真实拉到时填，UI 可展示 "v1.4.2 · 187 MB" */
  version: string | null
  fileSize: number | null
  publishedAt: string | null
  /** true 表示这一行来自接口；false 表示还在用 fallback 文案 */
  hasRelease: boolean
}

/**
 * 手写的展示文案：与具体版本无关，长期不变。
 * 真实下载链接/版本/大小由 lib/releases.ts 在运行时合并进来。
 */
interface DownloadCopy {
  id: string
  platform: DownloadItem['platform']
  /** 后端枚举 */
  apiPlatform: ApiPlatform
  arch: ApiArch
  label: string
  format: string
  note: string
  install: string
}

const COPY: DownloadCopy[] = [
  {
    id: 'mac-arm64',
    platform: 'mac',
    apiPlatform: 'mac',
    arch: 'arm64',
    label: 'macOS Apple Silicon',
    format: 'dmg',
    note: '推荐 M 系列芯片，适合日常开发和创作工作流。',
    install:
      '下载 DMG 后拖入 Applications，首次打开如遇系统提示，请在隐私与安全性中允许。',
  },
  {
    id: 'mac-x64',
    platform: 'mac',
    apiPlatform: 'mac',
    arch: 'x64',
    label: 'macOS Intel',
    format: 'dmg',
    note: 'Intel Mac 备用包，适合仍在使用 x64 设备的团队。',
    install: '安装方式与 Apple Silicon 版本一致，注意选择 x64 产物。',
  },
  {
    id: 'windows-x64',
    platform: 'windows',
    apiPlatform: 'win',
    arch: 'x64',
    label: 'Windows',
    format: 'exe',
    note: 'Windows 10/11 x64，建议使用正式安装包。',
    install:
      '下载 exe 后按安装向导完成；原生依赖开发建议安装 Visual Studio Build Tools。',
  },
]

/**
 * 当某个平台/架构在后端还没有 release 时的兜底链接。
 * 兜回历史版本聚合页（自建版本中心），用户至少不会撞死链。
 */
const FALLBACK_HREF = RELEASES_URL

/** 合并接口数据与手写文案：UI 真正消费的入口 */
export function buildDownloadItems(releases: LatestRelease[]): DownloadItem[] {
  const map = new Map<string, LatestRelease>()
  for (const r of releases) {
    map.set(`${r.platform}-${r.arch}`, r)
  }
  return COPY.map((copy) => {
    const found = map.get(`${copy.apiPlatform}-${copy.arch}`)
    if (found) {
      return {
        id: copy.id,
        platform: copy.platform,
        arch: copy.arch,
        label: copy.label,
        format: copy.format,
        note: copy.note,
        install: copy.install,
        href: found.publicUrl,
        version: found.version,
        fileSize: found.fileSize,
        publishedAt: found.publishedAt,
        hasRelease: true,
      }
    }
    return {
      id: copy.id,
      platform: copy.platform,
      arch: copy.arch,
      label: copy.label,
      format: copy.format,
      note: copy.note,
      install: copy.install,
      href: FALLBACK_HREF,
      version: null,
      fileSize: null,
      publishedAt: null,
      hasRelease: false,
    }
  })
}

/** 兼容旧代码的别名（避免一次性全量替换） */
export type DownloadEntry = DownloadItem
