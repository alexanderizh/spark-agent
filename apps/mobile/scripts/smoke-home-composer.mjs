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
}
let shouldFailSubmit = false
let pageOptions
const navigations = []

globalThis.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  getRealtimeLogManager: () => ({ error: () => {} }),
  navigateTo: (options) => navigations.push(options.url),
  showToast: () => {},
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
  assert.deepEqual(calls.listProjects, ['computer-a'], '初始项目查询定向到电脑 A')

  await page.onConfigDeviceChange({ detail: { value: '1' } })
  assert.deepEqual(calls.listProjects, ['computer-a', 'computer-b'], '切电脑后重载项目')
  assert.deepEqual(calls.getCatalog, ['computer-a', 'computer-b'], '切电脑后重载模型目录')
  assert.equal(page.data.selectedDeviceId, 'computer-b', '配置选中的电脑同步为当前电脑')
  page.onProjectChange({ detail: { value: '1' } })
  page.onModelChange({ detail: { value: '1' } })
  page.onReasoningChange({ detail: { value: 3 } })
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

  console.log('主页新建会话闭环冒烟：17 项断言通过')
}

main().catch((error) => {
  console.error('主页新建会话闭环冒烟失败:', error)
  process.exitCode = 1
})
