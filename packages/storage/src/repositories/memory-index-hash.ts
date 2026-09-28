/**
 * @module memory-index-hash
 *
 * 记忆索引输入摘要口径（S1B.2 索引新鲜度）
 *
 * 索引（FTS / 向量）建立时把"喂给索引的输入"哈希进 memory_index_meta，
 * 消费侧（懒回填队列 / upsertVec 晚到防护）用同一口径比对，判定
 * "索引是否仍反映当前条目文本"。
 *
 * 口径约束：本模块的拼接方式与
 *   - FTS 输入：memory.repository.maintainFts（name + description + body）
 *   - 向量输入：embedding.service.embeddingTextOf（name + '\n' + description）
 * 必须保持一致；任何一侧调整拼接方式都要 bump 对应版本常量并触发重建
 * （rebuildVecTable / 全量 FTS 重建），否则旧索引摘要与实际输入静默失配。
 */

import { createHash } from 'node:crypto'

/**
 * 向量预处理版本：embeddingTextOf 的拼接口径版本。
 * 修改 embedding 输入拼接方式时 bump，并配合 rebuildVecTable 重建。
 */
export const EMBEDDING_PREPROCESSOR_VERSION = 'v1'

/** FTS 预处理版本：maintainFts 的字段拼接口径版本。 */
export const FTS_PREPROCESSOR_VERSION = 'v1'

/** 通用索引输入哈希：parts 以 '\n' 连接后 SHA-256（hex）。 */
export function hashIndexInput(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex')
}

/** 向量索引输入摘要（与 embeddingTextOf 同口径：name + '\n' + description）。 */
export function hashEmbeddingInput(name: string, description: string): string {
  return hashIndexInput([name, description])
}

/** FTS 索引输入摘要（name + description + body；body 缺省按空串参与拼接）。 */
export function hashFtsInput(name: string, description: string, body: string): string {
  return hashIndexInput([name, description, body])
}
