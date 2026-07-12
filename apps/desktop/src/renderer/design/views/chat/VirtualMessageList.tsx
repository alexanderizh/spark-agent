import React, { forwardRef, useImperativeHandle } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const DEFAULT_VIRTUALIZE_AT = 40
const DEFAULT_ESTIMATED_ROW_SIZE = 180

export interface VirtualMessageListHandle {
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'auto') => void
}

interface VirtualMessageListProps<T> {
  items: T[]
  scrollElementRef: React.RefObject<HTMLElement | null>
  getItemKey: (item: T, index: number) => React.Key
  renderItem: (item: T, index: number) => React.ReactNode
  renderAfterItem?: (item: T, index: number) => React.ReactNode
  estimateSize?: (item: T, index: number) => number
  virtualizeAt?: number
  overscan?: number
}

function VirtualMessageListInner<T>(
  props: VirtualMessageListProps<T>,
  ref: React.ForwardedRef<VirtualMessageListHandle>,
) {
  if (props.items.length === 0) return null
  if (props.items.length < (props.virtualizeAt ?? DEFAULT_VIRTUALIZE_AT)) {
    return <StaticMessageList ref={ref} {...props} />
  }
  return <VirtualizedMessageList ref={ref} {...props} />
}

function StaticMessageListInner<T>(
  { items, scrollElementRef, getItemKey, renderItem, renderAfterItem }: VirtualMessageListProps<T>,
  ref: React.ForwardedRef<VirtualMessageListHandle>,
) {
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, align = 'auto') {
        const row = scrollElementRef.current?.querySelector<HTMLElement>(
          `[data-virtual-message-index="${index}"]`,
        )
        row?.scrollIntoView({ behavior: 'smooth', block: align === 'auto' ? 'nearest' : align })
      },
    }),
    [scrollElementRef],
  )

  return (
    <div className="chat-message-list" role="list" aria-label="会话消息">
      {items.map((item, index) => (
        <div key={getItemKey(item, index)} data-virtual-message-index={index} role="listitem">
          {renderItem(item, index)}
          {renderAfterItem?.(item, index)}
        </div>
      ))}
    </div>
  )
}

const StaticMessageList = forwardRef(StaticMessageListInner) as <T>(
  props: VirtualMessageListProps<T> & React.RefAttributes<VirtualMessageListHandle>,
) => React.ReactElement

function VirtualizedMessageListInner<T>(
  {
    items,
    scrollElementRef,
    getItemKey,
    renderItem,
    renderAfterItem,
    estimateSize = () => DEFAULT_ESTIMATED_ROW_SIZE,
    overscan = 6,
  }: VirtualMessageListProps<T>,
  ref: React.ForwardedRef<VirtualMessageListHandle>,
) {
  // TanStack Virtual intentionally exposes mutable measurement methods; React Compiler skips it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    getItemKey: (index) => {
      const item = items[index]
      return item == null ? index : getItemKey(item, index)
    },
    estimateSize: (index) => {
      const item = items[index]
      return item == null ? DEFAULT_ESTIMATED_ROW_SIZE : estimateSize(item, index)
    },
    overscan,
  })

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, align = 'auto') {
        virtualizer.scrollToIndex(index, { align })
      },
    }),
    [virtualizer],
  )

  const virtualItems = virtualizer.getVirtualItems()
  return (
    <div
      data-virtual-message-list
      className="chat-virtual-message-list"
      role="list"
      aria-label="会话消息"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index]
        if (item == null) return null
        return (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            data-virtual-message-index={virtualRow.index}
            className="chat-virtual-message-row"
            role="listitem"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderItem(item, virtualRow.index)}
            {renderAfterItem?.(item, virtualRow.index)}
          </div>
        )
      })}
    </div>
  )
}

const VirtualizedMessageList = forwardRef(VirtualizedMessageListInner) as <T>(
  props: VirtualMessageListProps<T> & React.RefAttributes<VirtualMessageListHandle>,
) => React.ReactElement

export const VirtualMessageList = forwardRef(VirtualMessageListInner) as <T>(
  props: VirtualMessageListProps<T> & React.RefAttributes<VirtualMessageListHandle>,
) => React.ReactElement
