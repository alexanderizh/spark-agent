import { randomUUID } from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native'
import { buildTurnRail } from '../../mobile/src/utils/turn-rail'
import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import type { ChatCache, ChatSnapshot } from './ChatCache'
import { ChatComposerMedia, readComposerFile, type ComposerFile } from './ChatComposerMedia'
import { ChatInteractions } from './ChatInteractions'
import { ChatRow } from './ChatRow'
import type { ChatDraft } from './chat-draft'
import type { Relay, Session, Target } from './relay'
import { mergeEvents, reduceTimeline, timelineRows } from './timeline'
import type { TimelineItem } from './timeline'
import { Action, useUi } from './ui'

export function Chat({
  relay,
  deviceId,
  sessionId,
  draft,
  cache,
  online,
  connection,
  onNavigate,
  openSettings,
  settingsRevision,
  back,
}: Target & {
  relay: Relay
  draft: ChatDraft
  cache: ChatCache
  online: boolean
  connection: number
  onNavigate(session: Session): void
  openSettings(): void
  settingsRevision: number
  back(): void
}) {
  const appearance = useUi()
  const styles = createStyles(appearance)
  const { ui, colors } = appearance
  const cacheTarget = useMemo(() => ({ deviceId, sessionId }), [deviceId, sessionId])
  const [cached] = useState(() => cache.read(cacheTarget))
  const [timeline, setTimeline] = useState<ChatSnapshot['timeline']>(
    cached?.timeline ?? { events: [] },
  )
  const [modelLabel, setModelLabel] = useState('模型配置')
  useEffect(() => {
    if (!online) return
    let current = true
    void relay
      .getRuntime({ deviceId, sessionId })
      .then((runtime) => {
        if (current) {
          const model = typeof runtime?.modelId === 'string' ? runtime.modelId : '默认模型'
          const effort = typeof runtime?.reasoningEffort === 'string' ? runtime.reasoningEffort : ''
          setModelLabel(effort ? `${model} · ${effort}` : model)
        }
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [deviceId, online, relay, sessionId, settingsRevision])
  const [suggestions, setSuggestions] = useState<{ name: string; description: string }[]>([])
  const [files, setFiles] = useState<ComposerFile[]>(() => cache.getFiles(cacheTarget))
  const [uploading, setUploading] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const uploadingRef = useRef(false)
  const uploadedFiles = useRef(new Map<ComposerFile, string>())
  const [lineage, setLineage] = useState<{ parent?: Session; children: Session[] }>({
    children: [],
  })
  const [showBranches, setShowBranches] = useState(false)
  const [forkAnchor, setForkAnchor] = useState<string>()
  const [forkTitle, setForkTitle] = useState('')
  const [forking, setForking] = useState(false)
  const forkPending = useRef(false)
  const pageActive = useRef(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [showLatest, setShowLatest] = useState(false)
  const streamRevision = useRef(0)
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const stopPending = useRef(false)
  const [earlierError, setEarlierError] = useState('')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [nextBeforeSeq, setNextBeforeSeq] = useState<number | null>(cached?.nextBeforeSeq ?? null)
  const historyGeneration = useRef(0)
  const earlierPending = useRef(false)
  const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot)
  const { text: compose, status, notice } = snapshot
  const sending = status === 'sending'
  const uncertain = status === 'unconfirmed'
  const list = useRef<FlatList<TimelineItem>>(null)
  const follow = useRef(true)
  const gesture = useRef(false)
  const reduced = useMemo(() => reduceTimeline(timeline.events, timeline.running), [timeline])
  const [hideExecution, setHideExecution] = useState(false)
  const [showTurns, setShowTurns] = useState(false)
  const [turnPreview, setTurnPreview] = useState<{ key: string; y: number }>()
  const [visibleIndex, setVisibleIndex] = useState(0)
  const { height } = useWindowDimensions()
  const [messageAreaHeight, setMessageAreaHeight] = useState(0)
  const messageArea = useRef<View>(null)
  const viewability = useRef({ itemVisiblePercentThreshold: 1 }).current
  const onVisibleRows = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<TimelineItem>[] }) => {
      const index = viewableItems[0]?.index
      if (index != null) setVisibleIndex(index)
    },
  ).current
  const { items: rows, turns } = useMemo(
    () => buildTurnRail(timelineRows(reduced, expanded, hideExecution)),
    [reduced, expanded, hideExecution],
  )
  const currentTurn = useMemo(() => {
    for (let index = Math.min(rows.length - 1, visibleIndex); index >= 0; index -= 1) {
      if (rows[index].turnAnchorId) return rows[index].key
    }
    return turns[0]?.key
  }, [rows, turns, visibleIndex])
  const jumpToTurn = (key: string) => {
    const index = rows.findIndex((row) => row.key === key)
    if (index < 0) return
    follow.current = false
    setShowTurns(false)
    setTurnPreview(undefined)
    setShowLatest(true)
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 0 })
  }
  const previewedTurn = turns.find((turn) => turn.key === turnPreview?.key)
  const running = reduced.running
  const imageRequests = useRef(new Map<string, Promise<string>>())
  const loadImage = useCallback(
    (path: string) => {
      if (/^https:\/\/[^\s]+$/i.test(path)) return Promise.resolve(path)
      const cached = imageRequests.current.get(path)
      if (cached) return cached
      if (!online) return Promise.reject(new Error('电脑离线'))
      const request = relay.attachmentImage(deviceId, path).catch((error: unknown) => {
        if (imageRequests.current.get(path) === request) imageRequests.current.delete(path)
        throw error
      })
      // Keep the number of cached base64 images bounded per mounted chat.
      if (imageRequests.current.size >= 8) {
        const oldest = imageRequests.current.keys().next().value
        if (oldest !== undefined) imageRequests.current.delete(oldest)
      }
      imageRequests.current.set(path, request)
      return request
    },
    [deviceId, online, relay],
  )
  const toggle = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const jumpLatest = () => {
    follow.current = true
    setShowLatest(false)
    list.current?.scrollToEnd({ animated: false })
  }

  const snapshotForCache = useRef<ChatSnapshot>({ timeline, nextBeforeSeq })
  useEffect(() => {
    snapshotForCache.current = { timeline, nextBeforeSeq }
  }, [timeline, nextBeforeSeq])
  useEffect(() => () => cache.write(cacheTarget, snapshotForCache.current), [cache, cacheTarget])
  useEffect(() => cache.setFiles(cacheTarget, files), [cache, cacheTarget, files])

  useEffect(
    () =>
      relay.subscribe({ deviceId, sessionId }, (incoming) => {
        if (!incoming.length) return
        streamRevision.current += 1
        setTimeline((previous) => {
          const events = mergeEvents(previous.events, incoming)
          const hasNewTail = (events.at(-1)?.seq ?? -1) > (previous.events.at(-1)?.seq ?? -1)
          return { events, running: hasNewTail ? undefined : previous.running }
        })
      }),
    [deviceId, relay, sessionId],
  )

  useEffect(() => {
    setLoaded(false)
    setLoadingEarlier(false)
    setEarlierError('')
    earlierPending.current = false
    if (!online) return
    let current = true
    setHistoryError('')
    const revisionAtRequest = streamRevision.current
    void relay
      .history({ deviceId, sessionId })
      .then((result) => {
        if (!current) return
        const reconciled = streamRevision.current === revisionAtRequest
        setTimeline((previous) => ({
          events: mergeEvents(previous.events, result.events),
          running: reconciled ? result.running : previous.running,
        }))
        // Resume from the refreshed window so a long disconnect cannot skip unseen pages.
        setNextBeforeSeq(result.nextBeforeSeq)
        setLoaded(true)
      })
      .catch(() => {
        if (current) setHistoryError('历史同步失败，请重试')
      })
    return () => {
      current = false
      historyGeneration.current += 1
    }
  }, [connection, deviceId, online, relay, reload, sessionId])

  useEffect(() => {
    pageActive.current = true
    return () => {
      pageActive.current = false
    }
  }, [])

  useEffect(() => {
    if (!online) return
    let current = true
    void relay
      .lineage({ deviceId, sessionId })
      .then((value) => {
        if (current) setLineage(value)
      })
      .catch(() => {
        /* Older desktops do not have a lineage route. */
      })
    return () => {
      current = false
    }
  }, [connection, deviceId, online, relay, sessionId])

  const openFork = (turnId: string) => {
    setForkTitle('')
    setForkAnchor(turnId)
  }

  const submitFork = async () => {
    if (!forkAnchor || !online || forkPending.current) return
    forkPending.current = true
    setForking(true)
    try {
      const result = await relay.fork({ deviceId, sessionId }, forkAnchor, forkTitle.trim())
      if (!pageActive.current) return
      setForkAnchor(undefined)
      if (result.bindingWarning) Alert.alert('分支已创建', '复制的工作流绑定当前不可用')
      onNavigate(result.session)
    } catch {
      if (pageActive.current) {
        setForkAnchor(undefined)
        Alert.alert('分支创建结果未确认', '请先在电脑端核对分支列表。')
      }
    } finally {
      forkPending.current = false
      if (pageActive.current) setForking(false)
    }
  }

  const loadEarlier = async () => {
    if (!online || !loaded || nextBeforeSeq === null || earlierPending.current) return
    const generation = historyGeneration.current
    earlierPending.current = true
    setLoadingEarlier(true)
    setEarlierError('')
    follow.current = false
    try {
      const result = await relay.history({ deviceId, sessionId }, nextBeforeSeq)
      if (generation !== historyGeneration.current) return
      setTimeline((previous) => ({
        ...previous,
        events: mergeEvents(result.events, previous.events),
      }))
      setNextBeforeSeq(result.nextBeforeSeq)
    } catch {
      if (generation === historyGeneration.current) setEarlierError('更早消息加载失败')
    } finally {
      if (generation === historyGeneration.current) {
        earlierPending.current = false
        setLoadingEarlier(false)
      }
    }
  }

  const stop = async () => {
    if (!online || !running || stopPending.current) return
    stopPending.current = true
    setStopping(true)
    setStopError('')
    const revisionAtRequest = streamRevision.current
    try {
      await relay.cancel({ deviceId, sessionId })
      if (streamRevision.current === revisionAtRequest) {
        setTimeline((previous) => ({ ...previous, running: false }))
      }
    } catch {
      setStopError('停止结果未确认，请检查会话状态')
    } finally {
      stopPending.current = false
      setStopping(false)
    }
  }

  const trigger = /(?:^|\s)([/@])([^\s/]*)$/.exec(compose)
  const suggestionMode =
    trigger?.[1] === '/' && trigger.index === 0
      ? 'commands'
      : trigger?.[1] === '@'
        ? 'skills'
        : undefined
  useEffect(() => {
    setSuggestions([])
    if (!suggestionMode || !online) return
    let current = true
    void relay
      .composerSuggestions({ deviceId, sessionId }, suggestionMode)
      .then((items) => {
        if (current) setSuggestions(items)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [deviceId, online, relay, sessionId, suggestionMode])
  const matching =
    suggestionMode && trigger
      ? suggestions.filter((entry) =>
          entry.name.replace(/^[/@]/, '').toLowerCase().startsWith(trigger[2].toLowerCase()),
        )
      : []

  const send = async () => {
    if (!online || !loaded || uploadingRef.current || sending || uncertain) return
    const target = { deviceId, sessionId }
    const pendingFiles = files
    const paths: string[] = []
    if (pendingFiles.length) {
      uploadingRef.current = true
      setUploading(true)
      setMediaError('')
      try {
        for (const file of pendingFiles) {
          if (!pageActive.current) return
          const path =
            uploadedFiles.current.get(file) ??
            (await relay.uploadAttachment(target, await readComposerFile(file)))
          uploadedFiles.current.set(file, path)
          paths.push(path)
        }
      } catch (error) {
        if (pageActive.current)
          setMediaError(error instanceof Error ? error.message : '附件上传失败')
        return
      } finally {
        uploadingRef.current = false
        if (pageActive.current) setUploading(false)
      }
    }
    if (!pageActive.current) return
    if (!compose.trim() && paths.length) draft.setText('\u200b请查看附件')
    if (
      await draft.send(async (text) => {
        if (text.startsWith('/') && !paths.length) {
          const result = await relay.executeCommand(target, text)
          if (result.handled) return result
        }
        return relay.submit(target, text, randomUUID(), paths)
      })
    ) {
      if (cache.getFiles(cacheTarget) === pendingFiles) cache.setFiles(cacheTarget, [])
      if (pageActive.current)
        setFiles((current) => current.filter((file) => !pendingFiles.includes(file)))
      uploadedFiles.current.clear()
      jumpLatest()
    }
  }

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {(lineage.parent || lineage.children.length > 0) && (
        <View style={styles.lineage}>
          {lineage.parent && (
            <Action
              label={`分支自「${lineage.parent.title}」`}
              onPress={() => {
                if (lineage.parent) onNavigate(lineage.parent)
              }}
            />
          )}
          {lineage.children.length > 0 && (
            <Action
              label={`${lineage.children.length} 个分支`}
              onPress={() => setShowBranches(true)}
            />
          )}
        </View>
      )}
      <Modal
        visible={showBranches || !!forkAnchor}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!forkPending.current) {
            setShowBranches(false)
            setForkAnchor(undefined)
          }
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalBody}>
            <Text style={ui.section}>{showBranches ? '分支列表' : '从此处分支'}</Text>
            {showBranches ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                {lineage.children.map((child) => (
                  <Action
                    key={child.id}
                    label={child.title}
                    onPress={() => {
                      setShowBranches(false)
                      onNavigate(child)
                    }}
                  />
                ))}
              </ScrollView>
            ) : (
              <>
                <Text style={ui.muted}>复制该会话到此轮消息为止，生成独立子会话。</Text>
                <TextInput
                  style={ui.input}
                  value={forkTitle}
                  onChangeText={setForkTitle}
                  editable={!forking}
                  placeholder="子会话标题（可留空）"
                />
              </>
            )}
            <View style={[ui.row, { justifyContent: 'flex-end' }]}>
              <Action
                label={showBranches ? '关闭' : '取消'}
                disabled={forking}
                onPress={() => {
                  setShowBranches(false)
                  setForkAnchor(undefined)
                }}
              />
              {!showBranches && (
                <Action
                  primary
                  label={forking ? '创建中…' : '创建分支'}
                  disabled={!online || forking}
                  onPress={() => void submitFork()}
                />
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <View style={[ui.row, { justifyContent: 'flex-end', paddingHorizontal: 8 }]}>
        <Action
          label={hideExecution ? '显示执行详情' : '隐藏执行详情'}
          onPress={() => setHideExecution(!hideExecution)}
        />
        <Action label="对话轮次" disabled={!turns.length} onPress={() => setShowTurns(true)} />
      </View>
      <Modal
        visible={showTurns}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTurns(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBody}>
            <Text style={ui.section}>对话轮次</Text>
            <ScrollView style={{ flexGrow: 0, maxHeight: 440 }}>
              {turns.map((turn) => (
                <Action
                  key={turn.key}
                  label={`${turn.ordinal}. ${turn.userPreview}`}
                  onPress={() => jumpToTurn(turn.key)}
                />
              ))}
            </ScrollView>
            <Action label="关闭" onPress={() => setShowTurns(false)} />
          </View>
        </View>
      </Modal>
      <View
        ref={messageArea}
        style={styles.messageArea}
        onLayout={(event) => setMessageAreaHeight(event.nativeEvent.layout.height)}
      >
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.messages}
          scrollEventThrottle={80}
          viewabilityConfig={viewability}
          onViewableItemsChanged={onVisibleRows}
          onScrollToIndexFailed={({ averageItemLength, index }) =>
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })
          }
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          ListHeaderComponent={
            <View>
              {nextBeforeSeq !== null && (
                <Action
                  label={
                    loadingEarlier
                      ? '正在加载更早消息…'
                      : earlierError
                        ? '更早消息加载失败，点击重试'
                        : '点击加载更早消息'
                  }
                  disabled={!online || !loaded || loadingEarlier}
                  onPress={() => void loadEarlier()}
                />
              )}
            </View>
          }
          onContentSizeChange={() => {
            if (follow.current) list.current?.scrollToEnd({ animated: false })
          }}
          onScrollBeginDrag={() => {
            gesture.current = true
          }}
          onMomentumScrollBegin={() => {
            gesture.current = true
          }}
          onMomentumScrollEnd={() => {
            gesture.current = false
          }}
          onScrollEndDrag={() => {
            gesture.current = false
          }}
          onScroll={({ nativeEvent: n }) => {
            if (!gesture.current) return
            const nearBottom =
              n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height < 72
            follow.current = nearBottom
            setShowLatest(!nearBottom)
          }}
          ListEmptyComponent={
            <Text style={ui.muted}>
              {!online
                ? '等待云中继连接'
                : historyError || (loaded ? '最近没有文字消息' : '正在同步历史…')}
            </Text>
          }
          renderItem={({ item }) => (
            <ChatRow
              item={item}
              expanded={expanded.has(item.key)}
              onToggle={toggle}
              onFork={online ? openFork : undefined}
              loadImage={loadImage}
            />
          )}
        />
        {turns.length > 1 && (
          <View pointerEvents="box-none" style={styles.railArea}>
            <ScrollView
              style={{ height: Math.min(height * 0.46, turns.length * 20), flexGrow: 0 }}
              showsVerticalScrollIndicator={false}
            >
              {turns.map((turn) => (
                <Pressable
                  key={turn.key}
                  style={styles.railTick}
                  accessibilityRole="button"
                  accessibilityState={{ selected: turn.key === currentTurn }}
                  accessibilityLabel={`第 ${turn.ordinal} 轮，${turn.userPreview}`}
                  onPress={() => jumpToTurn(turn.key)}
                  hitSlop={{ left: 5, top: 3, bottom: 3 }}
                  onLongPress={(event) => {
                    const touchY = event.nativeEvent.pageY
                    messageArea.current?.measure((_x, _y, _w, _h, _px, py) =>
                      setTurnPreview({ key: turn.key, y: touchY - py }),
                    )
                  }}
                >
                  <View
                    style={[styles.railMark, turn.key === currentTurn && styles.railMarkActive]}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        {previewedTurn && turnPreview && (
          <View style={styles.previewLayer}>
            <Pressable
              style={StyleSheet.absoluteFill}
              accessible={false}
              onPress={() => setTurnPreview(undefined)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`跳转到第 ${previewedTurn.ordinal} 轮`}
              onPress={() => jumpToTurn(previewedTurn.key)}
              style={[
                styles.railPreview,
                { top: Math.max(0, Math.min(turnPreview.y, messageAreaHeight - 148)) },
              ]}
            >
              <Text style={ui.groupTitle}>
                第 {previewedTurn.ordinal} 轮 / {turns.length}
              </Text>
              <Text numberOfLines={2} style={ui.body}>
                {previewedTurn.userPreview}
              </Text>
              <Text numberOfLines={3} style={ui.muted}>
                {previewedTurn.assistantPreview}
              </Text>
            </Pressable>
          </View>
        )}
        {showLatest && (
          <View style={styles.latest}>
            <Action label="回到最新消息" symbol="↓" onPress={jumpLatest} />
          </View>
        )}
      </View>
      <ChatInteractions
        relay={relay}
        deviceId={deviceId}
        sessionId={sessionId}
        online={online}
        running={running}
      />
      <View style={styles.dock}>
        {!!historyError && (
          <View style={ui.row}>
            <Text style={[ui.error, { flex: 1 }]}>{historyError}</Text>
            <Action
              label="同步历史"
              disabled={!online}
              onPress={() => setReload((value) => value + 1)}
            />
          </View>
        )}
        {!!stopError && (
          <Text accessibilityLiveRegion="polite" style={ui.error}>
            {stopError}
          </Text>
        )}
        {!!notice && (
          <Text accessibilityLiveRegion="polite" style={uncertain ? ui.error : ui.muted}>
            {notice}
          </Text>
        )}
        {uncertain && (
          <Action
            label="在电脑端核对后解锁"
            onPress={() =>
              Alert.alert(
                '确认在电脑端核对过？',
                '请同时检查该会话的排队消息和对话记录。如果消息已排队或已收到，请勿重发。',
                [
                  {
                    text: '不重发，清空草稿',
                    style: 'destructive',
                    onPress: () => draft.resolveUnconfirmed(snapshot, true),
                  },
                  { text: '取消', style: 'cancel' },
                  {
                    text: '确认未收到，解锁草稿',
                    onPress: () => draft.resolveUnconfirmed(snapshot, false),
                  },
                ],
              )
            }
          />
        )}
        {!!mediaError && (
          <Text style={ui.error} accessibilityLiveRegion="polite">
            {mediaError}
          </Text>
        )}
        {matching.length > 0 && trigger && !sending && !uncertain && (
          <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
            {matching.slice(0, 12).map((item) => (
              <Action
                key={item.name}
                label={`${trigger[1]}${item.name.replace(/^[/@]/, '')}`}
                onPress={() =>
                  draft.setText(
                    `${compose.slice(0, trigger.index).trimEnd()}${trigger.index ? ' ' : ''}${trigger[1]}${item.name.replace(/^[/@]/, '')} `,
                  )
                }
              />
            ))}
          </ScrollView>
        )}
        <ChatComposerMedia
          relay={relay}
          deviceId={deviceId}
          disabled={!online || uploading || sending || uncertain}
          files={files}
          add={(rows) => setFiles((current) => current.concat(rows).slice(0, 20))}
          remove={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
          transcribed={(text) => {
            const current = draft.getSnapshot().text.trim()
            draft.setText(current ? `${current} ${text}` : text)
          }}
          modelLabel={modelLabel}
          openSettings={openSettings}
          insert={(prefix) => {
            if (prefix === '/' && compose.trim())
              return Alert.alert('使用命令', '请使用空白输入框选择命令，当前草稿已保留。')
            draft.setText(prefix === '@' && compose.trim() ? `${compose.trimEnd()} @` : prefix)
          }}
          sendControl={
            running || stopping ? (
              <Action
                primary
                label={stopping ? '正在停止' : '停止生成'}
                symbol="■"
                disabled={!online || stopping}
                onPress={() => void stop()}
              />
            ) : (
              <Action
                primary
                label={uploading ? '正在上传' : sending ? '发送中' : '发送'}
                symbol="↑"
                disabled={
                  !online ||
                  !loaded ||
                  (!compose.trim() && !files.length) ||
                  sending ||
                  uncertain ||
                  uploading
                }
                onPress={() => void send()}
              />
            )
          }
        >
          <TextInput
            style={styles.input}
            placeholder="继续对话…"
            placeholderTextColor={colors.muted}
            accessibilityLabel="消息"
            value={compose.startsWith('\u200b') ? '' : compose}
            onChangeText={draft.setText}
            multiline
            editable={!sending && !uncertain && !uploading}
          />
        </ChatComposerMedia>
        {!online && <Action label="返回电脑列表" onPress={back} />}
      </View>
    </KeyboardAvoidingView>
  )
}

function createStyles({ colors, ui, r }: ReturnType<typeof useUi>) {
  return StyleSheet.create({
    lineage: { ...ui.row, flexWrap: 'wrap', paddingHorizontal: 8, backgroundColor: colors.paper },
    modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0006' },
    modalBody: {
      maxHeight: '70%',
      gap: 12,
      padding: 16,
      borderRadius: 14,
      backgroundColor: colors.paper,
    },
    messageArea: { flex: 1, backgroundColor: colors.background },
    messages: { paddingHorizontal: r(32), paddingVertical: r(24) },
    railArea: { position: 'absolute', right: 1, top: 0, bottom: 0, justifyContent: 'center' },
    railTick: { width: 15, height: 20, alignItems: 'flex-end', justifyContent: 'center' },
    railMark: { width: 4, height: 1, borderRadius: 1, backgroundColor: colors.rail },
    railMarkActive: { width: r(22), backgroundColor: colors.text },
    previewLayer: { ...StyleSheet.absoluteFill, zIndex: 2 },
    railPreview: {
      position: 'absolute',
      right: r(42),
      width: r(300),
      padding: r(20),
      borderRadius: r(16),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.fieldLine,
      backgroundColor: colors.paper,
      elevation: 5,
      shadowColor: '#000',
      shadowRadius: r(16),
      shadowOpacity: 0.16,
      shadowOffset: { width: 0, height: r(12) },
    },
    latest: {
      position: 'absolute',
      bottom: 12,
      right: 16,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.paper,
    },
    dock: {
      paddingHorizontal: r(24),
      paddingTop: r(12),
      paddingBottom: r(18),
      gap: r(12),
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    input: {
      ...ui.input,
      maxHeight: r(240),
      minHeight: r(56),
      paddingHorizontal: 0,
      fontSize: r(30),
      lineHeight: r(46),
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
  })
}
