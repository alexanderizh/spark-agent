import { Modal } from 'antd'
import { Icons } from '../../Icons'

const CANVAS_SHORTCUT_HELP_GROUPS: Array<{
  title: string
  items: Array<{ keys: string[]; desc: string }>
}> = [
  {
    title: '创作 / 节点',
    items: [
      { keys: ['Tab'], desc: '在选择 / 平移工具之间切换' },
      { keys: ['双击节点'], desc: '展开节点编辑面板' },
      { keys: ['Esc'], desc: '关闭当前浮层 / 弹窗 / 编辑面板' },
      { keys: ['Delete', 'Backspace'], desc: '删除选中节点或连线' },
      { keys: ['Ctrl / Cmd', '点击'], desc: '追加选择节点' },
      { keys: ['Shift', '点击'], desc: '追加选择节点' },
      { keys: ['框选'], desc: '批量选择节点' },
    ],
  },
  {
    title: '视图 / 缩放',
    items: [
      { keys: ['滚轮'], desc: '缩放画布' },
      { keys: ['Ctrl / Cmd', '+'], desc: '放大画布' },
      { keys: ['Ctrl / Cmd', '-'], desc: '缩小画布' },
      { keys: ['Ctrl / Cmd', '0'], desc: '适配全部节点' },
      { keys: ['底部工具栏', '适配'], desc: '一键查看完整画布' },
      { keys: ['底部工具栏', '网格'], desc: '显示 / 隐藏画布网格' },
    ],
  },
  {
    title: '移动画布',
    items: [
      { keys: ['Space', '拖拽'], desc: '临时抓手平移画布' },
      { keys: ['平移工具', '拖拽'], desc: '移动视图' },
      { keys: ['方向键 ↑'], desc: '向上平移画布' },
      { keys: ['方向键 ↓'], desc: '向下平移画布' },
      { keys: ['方向键 ←'], desc: '向左平移画布' },
      { keys: ['方向键 →'], desc: '向右平移画布' },
      { keys: ['底部工具栏', '回到选中'], desc: '把视图移动到选中节点' },
    ],
  },
  {
    title: '其他 / 工具栏入口',
    items: [
      { keys: ['Ctrl / Cmd', 'S'], desc: '保存画布' },
      { keys: ['Ctrl / Cmd', 'Z'], desc: '撤销' },
      { keys: ['Ctrl / Cmd', 'Shift', 'Z'], desc: '重做' },
      { keys: ['Ctrl / Cmd', '\\'], desc: '展开 / 折叠右侧面板' },
      { keys: ['Ctrl / Cmd', 'R'], desc: '刷新当前画布数据' },
      { keys: ['Ctrl / Cmd', 'Shift', 'S'], desc: '开启 / 关闭自动保存' },
      { keys: ['底部工具栏', '任务节点'], desc: '打开任务节点类型列表' },
      { keys: ['底部工具栏', '资源节点'], desc: '打开资源内容节点列表' },
      { keys: ['底部工具栏', '资产中心'], desc: '打开项目资产中心' },
    ],
  },
]

export function CanvasShortcutHelpModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      title={null}
      footer={null}
      width="min(96vw, 1320px)"
      centered={false}
      className="canvas-shortcut-help-modal"
      wrapClassName="canvas-shortcut-help-wrap"
      onCancel={onClose}
    >
      <div className="canvas-shortcut-help">
        <button
          type="button"
          className="canvas-shortcut-help-close"
          aria-label="关闭画布快捷键帮助"
          onClick={onClose}
        >
          <Icons.X size={26} />
        </button>
        <div className="canvas-shortcut-help-grid">
          {CANVAS_SHORTCUT_HELP_GROUPS.map((group) => (
            <section key={group.title} className="canvas-shortcut-help-column">
              <h3>{group.title}</h3>
              <div className="canvas-shortcut-help-list">
                {group.items.map((item) => (
                  <div key={`${group.title}:${item.desc}`} className="canvas-shortcut-help-row">
                    <span>{item.desc}</span>
                    <span className="canvas-shortcut-help-keys">
                      {item.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  )
}
