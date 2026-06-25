import { RELEASES_URL } from '../lib/links'

export const downloads = [
  {
    id: 'mac-arm64',
    platform: 'mac',
    label: 'macOS Apple Silicon',
    arch: 'arm64',
    format: 'dmg / zip',
    href: RELEASES_URL,
    note: '推荐 M 系列芯片，适合日常开发和创作工作流。',
    install: '下载 DMG 后拖入 Applications，首次打开如遇系统提示，请在隐私与安全性中允许。',
  },
  {
    id: 'mac-x64',
    platform: 'mac',
    label: 'macOS Intel',
    arch: 'x64',
    format: 'dmg / zip',
    href: RELEASES_URL,
    note: 'Intel Mac 备用包，适合仍在使用 x64 设备的团队。',
    install: '安装方式与 Apple Silicon 版本一致，注意选择 x64 产物。',
  },
  {
    id: 'windows-x64',
    platform: 'windows',
    label: 'Windows',
    arch: 'x64',
    format: 'exe',
    href: RELEASES_URL,
    note: 'Windows 10/11 x64，建议使用正式安装包。',
    install: '从 Releases 下载 exe，按安装向导完成；原生依赖开发建议安装 Visual Studio Build Tools。',
  },
  {
    id: 'linux-x64',
    platform: 'linux',
    label: 'Linux',
    arch: 'x64',
    format: 'AppImage / deb / rpm',
    href: RELEASES_URL,
    note: '以 Release 产物为准，适合桌面 Linux 和远程开发机。',
    install: 'AppImage 需要添加执行权限；deb / rpm 按发行版包管理器安装。',
  },
]
