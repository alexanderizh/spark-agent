import { useEffect, useState } from 'react'
import { FlatList, Platform, Text, View } from 'react-native'
import { formatBytes, formatRelativeTime } from '../../mobile/src/utils/format'
import { accountData } from './auth'
import { object } from './relay'
import { Action, useUi } from './ui'

export type AccountPage = '同步中心' | '设备与登录会话'
interface Row {
  id: string
  label: string
  detail: string
}
function readText(value: unknown) {
  return typeof value === 'string' ? value : ''
}
function readNumber(value: unknown) {
  return typeof value === 'number' ? value : 0
}

export function AccountPages({ token, page }: { token: string; page: AccountPage }) {
  const { ui, page: pageInsets, colors, r } = useUi()
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState('')
  const [revision, setRevision] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  useEffect(() => {
    let current = true
    setLoading(true)
    setIssue('')
    const load = async () => {
      const size = page === '同步中心' ? 20 : 100
      const [raw, status] = await Promise.all([
        accountData(`/desktop-sync/history?page=${pageNumber}&pageSize=${size}`, token),
        page === '同步中心' && pageNumber === 1
          ? accountData('/desktop-sync/status', token).catch(() => null)
          : null,
      ])
      if (!current) return
      const history = object(raw)
      if (!Array.isArray(history?.list)) throw new Error('同步记录格式异常')
      if (page === '同步中心') {
        const items = history.list.flatMap((value: unknown): Row[] => {
          const item = object(value)
          if (typeof item?.operationId !== 'string') return []
          return [
            {
              id: item.operationId,
              label: readText(item.deviceLabel) || '未知设备',
              detail: `${readText(item.status)} · ${formatRelativeTime(readText(item.createdAt))}`,
            },
          ]
        })
        const details = object(status)
        if (details)
          setSummary(
            `最近同步 ${formatRelativeTime(readText(details.lastSyncAt) || null)} · 单次上限 ${formatBytes(readNumber(details.maxPayloadBytes))}`,
          )
        setRows((previous) => [
          ...new Map(
            [...(pageNumber === 1 ? [] : previous), ...items].map((item) => [item.id, item]),
          ).values(),
        ])
        setMore(pageNumber * size < readNumber(history.total))
      } else {
        const devices = new Map<string, { count: number; last: string }>()
        for (const value of history.list) {
          const item = object(value)
          const label = readText(item?.deviceLabel)
          if (!label) continue
          const latest = readText(item?.createdAt)
          const existing = devices.get(label)
          devices.set(label, {
            count: (existing?.count ?? 0) + 1,
            last: latest > (existing?.last ?? '') ? latest : (existing?.last ?? ''),
          })
        }
        setRows(
          [...devices]
            .sort(([, a], [, b]) => b.last.localeCompare(a.last))
            .map(([label, value]) => ({
              id: label,
              label,
              detail: `${value.count} 次同步 · ${formatRelativeTime(value.last)}`,
            })),
        )
      }
    }
    void load()
      .catch(() => {
        if (current) setIssue('加载失败，请重试')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [page, pageNumber, revision, token])

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      contentContainerStyle={pageInsets(page === '同步中心' ? 'sync' : 'devices')}
      ListHeaderComponent={
        <View style={{ gap: r(24) }}>
          {page === '同步中心' ? (
            <View style={ui.card}>
              <Text style={ui.groupTitle}>同步状态</Text>
              <Text style={ui.body}>{summary || '暂无同步状态'}</Text>
            </View>
          ) : (
            <View style={ui.card}>
              <Text style={ui.groupTitle}>当前设备</Text>
              <View style={[ui.listRow, { justifyContent: 'space-between' }]}>
                <Text style={ui.body}>运行平台</Text>
                <Text style={ui.muted}>{Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
              </View>
              <View style={ui.separator} />
              <View style={[ui.listRow, { justifyContent: 'space-between' }]}>
                <Text style={ui.body}>系统版本</Text>
                <Text style={ui.muted}>{Platform.Version}</Text>
              </View>
            </View>
          )}
          <View
            style={{
              backgroundColor: colors.paper,
              borderTopLeftRadius: r(32),
              borderTopRightRadius: r(32),
              padding: r(28),
              paddingBottom: r(8),
            }}
          >
            <Text style={ui.groupTitle}>{page === '同步中心' ? '同步记录' : '桌面端设备'}</Text>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={ui.muted}>{loading ? '正在加载…' : issue ? '' : '暂无记录'}</Text>
      }
      ListFooterComponent={
        issue ? (
          <Action label={issue} onPress={() => setRevision((n) => n + 1)} />
        ) : more ? (
          <Action
            label={loading ? '正在加载…' : '加载更多'}
            disabled={loading}
            onPress={() => setPageNumber((n) => n + 1)}
          />
        ) : null
      }
      renderItem={({ item, index }) => (
        <View style={{ backgroundColor: colors.paper, paddingHorizontal: r(28) }}>
          {index > 0 && <View style={ui.separator} />}
          <View style={{ paddingVertical: r(20) }}>
            <Text style={ui.body}>{item.label}</Text>
            <Text style={ui.muted}>{item.detail}</Text>
          </View>
        </View>
      )}
    />
  )
}
