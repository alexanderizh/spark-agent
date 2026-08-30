/**
 * 资产库左侧分类导航（步骤模式设计文档 §5.4，P2）。
 *
 * 分类分四组：快捷视图 / 创作资产 / 剧本与文本 / 工作流。
 * 其中 分镜分组、提示词库、Files 与全部资产共用同一份资产数据，
 * 仅切换主区视图（与旧资产中心 TAB_ORDER 对齐，Explore 报告 B 表）。
 */

export type AssetLibraryCategory =
  | 'all'
  | 'favorite'
  | 'character'
  | 'scene'
  | 'prop'
  | 'effect'
  | 'manuscript'
  | 'script'
  | 'shots'
  | 'prompt_library'
  | 'files'

type SidebarEntry = {
  key: AssetLibraryCategory
  label: string
  /** 分类色点（对应 assetLibrary.less 的 kind-* 变量） */
  dot?: string
}

const SIDEBAR_GROUPS: Array<{ group: string; entries: SidebarEntry[] }> = [
  {
    group: '快捷视图',
    entries: [
      { key: 'all', label: '全部资产', dot: 'generic' },
      { key: 'favorite', label: '收藏', dot: 'generic' },
    ],
  },
  {
    group: '创作资产',
    entries: [
      { key: 'character', label: '角色', dot: 'character' },
      { key: 'scene', label: '场景', dot: 'scene' },
      { key: 'prop', label: '道具', dot: 'prop' },
      { key: 'effect', label: '特效', dot: 'effect' },
    ],
  },
  {
    group: '剧本与文本',
    entries: [
      { key: 'manuscript', label: '文稿', dot: 'manuscript' },
      { key: 'script', label: '剧本', dot: 'script' },
    ],
  },
  {
    group: '工作流',
    entries: [
      { key: 'shots', label: '分镜分组', dot: 'generic' },
      { key: 'prompt_library', label: '提示词库', dot: 'generic' },
      { key: 'files', label: 'Files', dot: 'generic' },
    ],
  },
]

export type AssetLibrarySidebarProps = {
  active: AssetLibraryCategory
  onSelect: (category: AssetLibraryCategory) => void
  /** 分类计数（缺失的分类不显示数字） */
  counts?: Partial<Record<AssetLibraryCategory, number>>
}

export function AssetLibrarySidebar({ active, onSelect, counts }: AssetLibrarySidebarProps) {
  return (
    <nav className="asset-library-sidebar">
      {SIDEBAR_GROUPS.map((group) => (
        <div key={group.group}>
          <div className="asset-library-sidebar-group">{group.group}</div>
          {group.entries.map((entry) => {
            const count = counts?.[entry.key]
            return (
              <button
                key={entry.key}
                type="button"
                className={`asset-library-sidebar-item${active === entry.key ? ' active' : ''}`}
                onClick={() => onSelect(entry.key)}
              >
                {entry.dot ? <span className={`asset-library-kind-dot kind-${entry.dot}`} /> : null}
                {entry.label}
                {typeof count === 'number' ? (
                  <span className="asset-library-sidebar-count">{count}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
