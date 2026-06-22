import { RELEASES_URL } from '../lib/links'

export const downloads = [
  {
    id: 'mac-arm64',
    platform: 'mac',
    label: 'macOS Apple Silicon',
    arch: 'arm64',
    format: 'dmg / zip',
    href: RELEASES_URL,
    note: '推荐 M 系列芯片',
  },
  {
    id: 'mac-x64',
    platform: 'mac',
    label: 'macOS Intel',
    arch: 'x64',
    format: 'dmg / zip',
    href: RELEASES_URL,
    note: 'Intel Mac 备用',
  },
  {
    id: 'windows-x64',
    platform: 'windows',
    label: 'Windows',
    arch: 'x64',
    format: 'exe',
    href: RELEASES_URL,
    note: 'Windows 10/11',
  },
  {
    id: 'linux-x64',
    platform: 'linux',
    label: 'Linux',
    arch: 'x64',
    format: 'AppImage / deb / rpm',
    href: RELEASES_URL,
    note: '以 Release 产物为准',
  },
]
