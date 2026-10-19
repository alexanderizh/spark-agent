/**
 * presented_files 块的轮级聚合策略 — 从 event-mapper 拆出的卫星模块（event-mapper 已近 3000 行红线）。
 *
 * 设计定稿：一轮（同一条 assistant 消息）的多图 = 一条横向胶片条（PresentedMedia.less
 * 的 .is-image-gallery，多图横向、不换行、横向滚动）。后端逐批就地发出 presented_files
 * 事件（12fd5bab7），前端把同一轮的批次全部并入第一个块：条带锚定在首批的就地位置
 * （紧随生成它的工具调用），后续批次到达时逐张追加进同一条。
 *
 * 为什么不做「正文文本隔开则不合并」：真实事件流里 agent 在每次生图间都会输出
 * 「第一张完成。继续第二张——」式的进度播报，按文本分隔会让轮级横排在实践中永不
 * 生效，多图退化成纵向堆叠。进度播报不是与某张图强绑定的实质内容，轮级聚合才是
 * 用户要的展示形态（与 12fd5bab7 之前「一轮一块装全部图」的横排语义对齐）。
 */
import type { UIBlock } from './event-mapper'

export type PresentedFilesBlock = Extract<UIBlock, { kind: 'presented_files' }>

/**
 * 找到本轮可聚合的 presented 块：该消息（轮）内第一个 presented_files 块。
 * 返回 null 表示本轮还没有 presented 块，新批次应自成一个块（轮内唯一条带的起点）。
 */
export function findTurnPresentedGalleryBlock(blocks: UIBlock[]): PresentedFilesBlock | null {
  for (const block of blocks) {
    if (block.kind === 'presented_files') return block
  }
  return null
}
