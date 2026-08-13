/**
 * 文件名搜索框。Esc / 清除按钮关闭搜索；输入实时驱动 useFileExplorerTree 的 filterBySearch。
 */

import type { ReactNode } from 'react'
import { Icons } from '../../../Icons'

export interface FileSearchBoxProps {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export function FileSearchBox({ value, onChange, onClose }: FileSearchBoxProps): ReactNode {
  return (
    <div className="fe-search">
      <span className="fe-search-icon">
        <Icons.Search size={13} />
      </span>
      <input
        className="fe-search-input"
        placeholder="按文件名搜索"
        value={value}
        spellCheck={false}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      {value !== '' && (
        <button
          type="button"
          className="fe-search-clear"
          title="清除"
          onClick={() => onChange('')}
        >
          ×
        </button>
      )}
    </div>
  )
}
