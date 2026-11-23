import { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, View } from 'react-native'
import {
  emptyForm,
  formToCreateInput,
  formToUpdatePatch,
  taskToForm,
  TRIGGER_TYPE_LABELS,
  validateForm,
} from '../../mobile/src/utils/task-form'
import type { TaskForm, TaskTriggerType } from '../../mobile/src/utils/task-form'
import type { BridgeScheduledTask } from '../../mobile/src/utils/task-types'
import type { Relay, Target } from './relay'
import { Action, useUi } from './ui'

const triggerTypes: TaskTriggerType[] = ['once', 'interval', 'cron']

export function SessionTasks({
  relay,
  deviceId,
  sessionId,
  online,
}: Target & { relay: Relay; online: boolean }) {
  const { ui, colors, page, r } = useUi()
  const [tasks, setTasks] = useState<BridgeScheduledTask[]>()
  const [form, setForm] = useState<TaskForm>()
  const [editing, setEditing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [revision, setRevision] = useState(0)
  const pending = useRef(false)
  useEffect(() => {
    if (!online) return
    let current = true
    void relay
      .sessionTasks({ deviceId, sessionId })
      .then((rows) => {
        if (current) setTasks(rows)
      })
      .catch(() => {
        if (current) setFeedback('加载任务失败')
      })
    return () => {
      current = false
    }
  }, [deviceId, online, relay, revision, sessionId])
  const act = async (work: () => Promise<void>) => {
    if (!online || pending.current) return
    pending.current = true
    setBusy(true)
    setFeedback('')
    try {
      await work()
    } catch {
      setFeedback('操作结果未确认，请刷新任务后核对')
    } finally {
      pending.current = false
      setBusy(false)
      setRevision((n) => n + 1)
    }
  }
  const save = () => {
    if (!form) return
    const problem = validateForm(form)
    if (
      problem ||
      (form.triggerType === 'once' &&
        Number.isNaN(Date.parse(`${form.runDate}T${form.runTime}:00`)))
    ) {
      setFeedback(problem || '日期或时间格式不正确')
      return
    }
    void act(async () => {
      if (editing) {
        if (!(await relay.updateTask(deviceId, editing, 'edit', formToUpdatePatch(form))))
          throw new Error('未确认保存')
      } else await relay.createTask({ deviceId, sessionId }, formToCreateInput(form))
      setForm(undefined)
      setEditing(undefined)
    })
  }
  const field = (key: keyof Omit<TaskForm, 'triggerType'>, label: string, multiline?: boolean) => {
    if (!form) return null
    return (
      <View style={{ gap: 4 }}>
        <Text style={ui.muted}>{label}</Text>
        <TextInput
          value={form[key]}
          accessibilityLabel={label}
          onChangeText={(text) => setForm((current) => current && { ...current, [key]: text })}
          editable={!busy}
          multiline={multiline}
          style={ui.input}
        />
      </View>
    )
  }
  return (
    <ScrollView
      contentContainerStyle={[page('session-tasks'), { gap: r(24) }]}
      keyboardShouldPersistTaps="handled"
    >
      {!online && <Text style={ui.error}>电脑离线</Text>}
      {!!feedback && (
        <Text style={ui.muted} accessibilityLiveRegion="polite">
          {feedback}
        </Text>
      )}
      {form ? (
        <>
          {field('name', '任务名称')}
          {field('prompt', '执行提示词', true)}
          <View style={[ui.row, { flexWrap: 'wrap' }]}>
            {triggerTypes.map((type) => (
              <Action
                key={type}
                compact
                label={TRIGGER_TYPE_LABELS[type]}
                primary={form.triggerType === type}
                disabled={busy}
                onPress={() => setForm({ ...form, triggerType: type })}
              />
            ))}
          </View>
          {form.triggerType === 'once' ? (
            <>
              {field('runDate', '日期 YYYY-MM-DD')}
              {field('runTime', '时间 HH:mm')}
            </>
          ) : form.triggerType === 'interval' ? (
            field('intervalMinutes', '间隔分钟')
          ) : (
            field('cronExpression', 'Cron 表达式')
          )}
          {field('timeoutSeconds', '超时秒数')}
          {field('maxRetries', '失败重试次数')}
          <View style={ui.row}>
            <Action label="取消" disabled={busy} onPress={() => setForm(undefined)} />
            <Action primary label="保存" disabled={busy || !online} onPress={save} />
          </View>
        </>
      ) : (
        <>
          <View style={ui.row}>
            <Action
              primary
              label="新建任务"
              disabled={!online || busy}
              onPress={() => {
                setEditing(undefined)
                setForm(emptyForm())
              }}
            />
            <Action
              label="刷新"
              disabled={!online || busy}
              onPress={() => setRevision((n) => n + 1)}
            />
          </View>
          <Text style={ui.muted}>
            {tasks ? (tasks.length ? '' : '暂无定时任务') : online ? '正在加载任务…' : ''}
          </Text>
          {tasks?.map((item) => (
            <View
              key={item.id}
              style={[
                ui.card,
                {
                  borderRadius: r(20),
                  padding: r(24),
                  gap: r(10),
                  borderWidth: 0.5,
                  borderColor: colors.line,
                },
              ]}
            >
              <Text style={ui.section}>{item.name}</Text>
              <Text style={ui.muted}>
                {TRIGGER_TYPE_LABELS[item.triggerType]} · {item.enabled ? '已启用' : '已停用'} ·
                已执行 {item.executionCount} 次
              </Text>
              <Text style={ui.body} numberOfLines={2}>
                {item.prompt}
              </Text>
              <View
                style={[
                  ui.row,
                  { flexWrap: 'wrap', gap: r(8), borderTopWidth: 0.5, borderColor: colors.line },
                ]}
              >
                <Action
                  compact
                  label="编辑"
                  disabled={!online || busy}
                  onPress={() => {
                    setEditing(item.id)
                    setForm(taskToForm(item))
                  }}
                />
                <Action
                  compact
                  label={item.enabled ? '停用' : '启用'}
                  disabled={!online || busy}
                  onPress={() =>
                    void act(async () => {
                      if (
                        !(await relay.updateTask(deviceId, item.id, 'toggle', {
                          enabled: !item.enabled,
                        }))
                      )
                        throw new Error('未确认状态')
                    })
                  }
                />
                <Action
                  compact
                  label="立即执行"
                  disabled={!online || busy}
                  onPress={() =>
                    void act(async () => {
                      setFeedback(
                        (await relay.updateTask(deviceId, item.id, 'run'))
                          ? '已请求执行'
                          : '任务暂无执行回执',
                      )
                    })
                  }
                />
                <Action
                  compact
                  label="删除"
                  disabled={!online || busy}
                  onPress={() =>
                    Alert.alert('删除定时任务？', item.name, [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '删除',
                        style: 'destructive',
                        onPress: () =>
                          void act(async () => {
                            if (!(await relay.updateTask(deviceId, item.id, 'delete')))
                              throw new Error('删除未确认')
                          }),
                      },
                    ])
                  }
                />
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  )
}
