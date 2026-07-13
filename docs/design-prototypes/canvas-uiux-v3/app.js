const titles = {
  nodes: '节点系统 · 全类型与运行状态',
  video: '视频工作台 · 剪辑与关键帧生产',
  stage3d: '3D 工作台 · 场景调度与镜头设计',
  assets: '资产中心 · 统一治理与深度预览',
  config: '生成配置 · 分步参数与运行预检',
  sidepanel: '右侧面板 · 上下文驱动的四个 Tab',
  agent: 'Agent 助手 · 可观察、可中断的画布执行',
  filmassets: '项目资产中心 · 制作圣经与角色资产',
  projects: '项目卡片 · 以制作进度继续工作',
}

const shell = document.querySelector('.review-shell')
const viewTitle = document.getElementById('viewTitle')
const navItems = [...document.querySelectorAll('[data-view]')]
const views = [...document.querySelectorAll('[data-page]')]

function activateView(viewName) {
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === viewName))
  views.forEach((view) => view.classList.toggle('active', view.dataset.page === viewName))
  viewTitle.textContent = titles[viewName] ?? titles.nodes
  window.location.hash = viewName
}

navItems.forEach((item) => item.addEventListener('click', () => activateView(item.dataset.view)))

document.querySelectorAll('[data-tab-group]').forEach((group) => {
  const scope = group.parentElement
  group.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab
      group.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item.dataset.tab === tab))
      scope.querySelectorAll(':scope > .tab-pane, :scope > * > .tab-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.dataset.tabPane === tab)
      })
    })
  })
})

const motionToggle = document.getElementById('motionToggle')
motionToggle.addEventListener('click', () => {
  const paused = shell.classList.toggle('motion-off')
  motionToggle.classList.toggle('active', !paused)
  motionToggle.innerHTML = paused
    ? '<span class="live-dot"></span>动效暂停'
    : '<span class="live-dot"></span>动效开启'
})

const hashView = window.location.hash.slice(1)
activateView(titles[hashView] ? hashView : 'nodes')
