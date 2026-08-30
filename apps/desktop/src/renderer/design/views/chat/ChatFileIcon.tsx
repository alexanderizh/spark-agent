import { Icons } from '../../Icons'
import { FileTypeIcon, getFileTypeBadge } from '../../components/FileDisplay'

/**
 * 文件引用 chip 的图标。匹配到内置图标时使用文件类型图标，否则回退到通用文件图标。
 */
export function FileChipIcon({ path, size }: { path: string; size: number }) {
  if (!getFileTypeBadge(path).icon) {
    return <Icons.File size={size} />
  }
  return <FileTypeIcon filePath={path} size={size} />
}
