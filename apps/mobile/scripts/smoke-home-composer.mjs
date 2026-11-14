#!/usr/bin/env node
/**
 * 主页新建会话闭环冒烟：执行真实 home Page 方法，mock 中继 API，不创建线上会话。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const calls = {
  listProjects: [],
  getCatalog: [],
  createSession: [],
  updateSession: [],
  submitTurn: [],
  showToast: [],
}
let shouldFailSubmit = false
let pageOptions
const navigations = []

globalThis.wx = {
  // image-cache 在模块顶层读取 wx.env.USER_DATA_PATH；mock 里必须给，否则加载即崩
  env: { USER_DATA_PATH: '/tmp/spark-mobile-smoke' },
  getStorageSync: () => '',
  setStorageSync: () => {},
  getRealtimeLogManager: () => ({ error: () => {} }),
  navigateTo: (options) => navigations.push(options.url),
  showToast: (options) => calls.showToast.push(options.title),
}
globalThis.Page = (options) => {
  pageOptions = options
}

const bridge = require(join(root, 'dist/api/bridge.js'))
bridge.setSelectedDeviceId = () => {}
bridge.listProjects = async (_limit, deviceId) => {
  calls.listProjects.push(deviceId)
  return { projects: [{ id: `project-${deviceId}`, name: `项目 ${deviceId}` }], total: 1 }
}
bridge.getCatalog = async (deviceId) => {
  calls.getCatalog.push(deviceId)
  return {
    agents: [],
    workflows: [],
    providers: [
      {
        id: `provider-${deviceId}`,
        name: '测试渠道',
        providerType: 'openai',
        isAutoRouter: false,
        models: [{ id: `model-${deviceId}`, name: '测试模型' }],
      },
    ],
    permissionModes: {},
    reasoningEfforts: ['low', 'medium', 'high'],
  }
}
bridge.createSession = async (title, projectId, deviceId) => {
  calls.createSession.push({ title, projectId, deviceId })
  return { session: { id: `session-${calls.createSession.length}`, title } }
}
bridge.updateSession = async (sessionId, patch, deviceId) => {
  calls.updateSession.push({ sessionId, patch, deviceId })
  return { session: { id: sessionId, title: '验收会话' } }
}
bridge.submitTurn = async (sessionId, text, attachments, deviceId) => {
  calls.submitTurn.push({ sessionId, text, attachments, deviceId })
  if (shouldFailSubmit) throw new Error('mock network timeout')
}

require(join(root, 'dist/pages/home/index.js'))
assert.ok(pageOptions, 'home Page 已注册')

function makePage() {
  const data = { ...pageOptions.data }
  const page = {
    data,
    setData(patch) {
      Object.assign(data, patch)
    },
  }
  for (const [key, value] of Object.entries(pageOptions)) {
    if (key === 'data') continue
    page[key] = typeof value === 'function' ? value.bind(page) : value
  }
  return page
}

function setOnlineComputers(page) {
  page.setData({
    devices: [
      {
        deviceId: 'computer-a',
        name: '电脑 A',
        pickerLabel: '电脑 A · 在线',
        online: true,
      },
      {
        deviceId: 'computer-b',
        name: '电脑 B',
        pickerLabel: '电脑 B · 在线',
        online: true,
      },
    ],
    composerDeviceId: 'computer-a',
    composerDeviceIndex: 0,
  })
}

async function main() {
  const page = makePage()
  setOnlineComputers(page)
  await page.onOpenConfig()
  assert.equal(page.data.configOpen, true, '打开会话配置面板')
  assert.equal(page.data.projectOptions.length, 2, '项目包含未归属和电脑 A 项目')
  assert.equal(page.data.modelOptions.length, 2, '模型选项包含电脑默认和渠道模型')
  assert.deepEqual(
    page.data.reasoningOptions.map((item) => item.id),
    ['low', 'medium', 'high'],
    '推理强度只列真实档位，不再有「电脑默认」',
  )
  assert.ok(
    page.data.permissionOptions.every((item) => item.id !== 'default'),
    '权限策略不再有「电脑默认」',
  )
  assert.deepEqual(calls.listProjects, ['computer-a'], '初始项目查询定向到电脑 A')

  await page.applyDeviceIndex(1)
  assert.deepEqual(calls.listProjects, ['computer-a', 'computer-b'], '切电脑后重载项目')
  assert.deepEqual(calls.getCatalog, ['computer-a', 'computer-b'], '切电脑后重载模型目录')
  assert.equal(page.data.selectedDeviceId, 'computer-b', '配置选中的电脑同步为当前电脑')
  page.applyProjectIndex(1)
  page.applyModelIndex(1)
  page.onReasoningChange({ detail: { value: 2 } })
  page.onQuickInput({ detail: { value: '创建并发送测试消息' } })
  await page.onQuickSend()

  assert.deepEqual(calls.createSession[0], {
    title: '创建并发送测试消息',
    projectId: 'project-computer-b',
    deviceId: 'computer-b',
  })
  assert.deepEqual(calls.updateSession[0], {
    sessionId: 'session-1',
    patch: {
      providerProfileId: 'provider-computer-b',
      modelId: 'model-computer-b',
      reasoningEffort: 'high',
    },
    deviceId: 'computer-b',
  })
  assert.deepEqual(calls.submitTurn[0], {
    sessionId: 'session-1',
    text: '创建并发送测试消息',
    attachments: undefined,
    deviceId: 'computer-b',
  })
  assert.match(navigations[0], /deviceId=computer-b/, '聊天路由保留目标电脑 ID')
  assert.equal(page.data.pendingSessionId, '', '成功后清理待处理状态')

  shouldFailSubmit = true
  const uncertainPage = makePage()
  setOnlineComputers(uncertainPage)
  await uncertainPage.onOpenConfig()
  uncertainPage.onQuickInput({ detail: { value: '网络结果不确定的测试消息' } })
  await uncertainPage.onQuickSend()
  assert.equal(uncertainPage.data.pendingSubmissionUnknown, true, '发送超时进入待检查状态')
  const submitCount = calls.submitTurn.length
  await uncertainPage.onQuickSend()
  assert.equal(calls.submitTurn.length, submitCount, '结果不确定时不会重复提交')
  assert.match(navigations.at(-1) ?? '', /session-2/, '再次点击打开已创建的会话')

  bridge.getRelayPresenceDevices = () => []
  bridge.isRelayPresenceFresh = () => false
  const restoredPage = makePage()
  restoredPage.restDevices = [
    { deviceId: 'computer-a', name: '电脑 A', online: true },
    { deviceId: 'computer-b', name: '电脑 B', online: true },
  ]
  restoredPage.setData({ selectedDeviceId: 'computer-b' })
  restoredPage.rebuildDevices()
  assert.equal(restoredPage.data.composerDeviceId, 'computer-b', '首页恢复已选在线电脑')

  // 配置项走应用内半屏列表（原生 picker 不跟随主题）
  const chooserPage = makePage()
  setOnlineComputers(chooserPage)
  await chooserPage.onOpenConfig()
  chooserPage.onOpenChooser({
    currentTarget: { dataset: { kind: 'device', disabled: false } },
  })
  assert.equal(chooserPage.data.chooserShow, true, '点配置行打开半屏选择列表')
  assert.equal(chooserPage.data.chooserTitle, '选择电脑')
  assert.deepEqual(
    chooserPage.data.chooserOptions.map((item) => item.label),
    ['电脑 A · 在线', '电脑 B · 在线'],
  )
  assert.equal(chooserPage.data.chooserOptions[0].checked, true, '当前电脑打勾')
  chooserPage.onChooserSelect({ detail: { id: '1' } })
  assert.equal(chooserPage.data.chooserShow, false, '选完关闭列表')
  assert.equal(chooserPage.data.composerDeviceId, 'computer-b', '选电脑后切到目标电脑')

  chooserPage.onOpenChooser({
    currentTarget: { dataset: { kind: 'permission', disabled: false } },
  })
  assert.equal(chooserPage.data.chooserShow, true)
  assert.equal(chooserPage.data.chooserTitle, '权限策略')
  chooserPage.onChooserClose()
  assert.equal(chooserPage.data.chooserShow, false, '关闭按钮收起列表')

  chooserPage.onOpenChooser({ currentTarget: { dataset: { kind: 'model', disabled: true } } })
  assert.equal(chooserPage.data.chooserShow, false, '禁用态点不开')
  assert.equal(calls.showToast.at(-1), '配置读取中，请稍候', '禁用态要说明原因，不做无反应的点击')

  // 不同基础库可能把 data-* 的布尔落成字符串，两种都要拦住
  chooserPage.onOpenChooser({ currentTarget: { dataset: { kind: 'model', disabled: 'true' } } })
  assert.equal(chooserPage.data.chooserShow, false, '禁用态传成字符串也点不开')

  chooserPage.onOpenChooser({ currentTarget: { dataset: { kind: 'model', disabled: 'false' } } })
  assert.equal(chooserPage.data.chooserShow, true, '字符串 false 视作可点')

  console.log('主页新建会话闭环冒烟：27 项断言通过')
}

main().catch((error) => {
  console.error('主页新建会话闭环冒烟失败:', error)
  process.exitCode = 1
})
