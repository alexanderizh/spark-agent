/**
 * media-extract.mjs 的 TypeScript 类型声明。
 * 让 TS adapter import 纯 JS 共享模块时获得类型。
 */

export type ExtractedImage =
  | { kind: 'url'; value: string; mimeType?: string }
  | { kind: 'base64'; value: string; mimeType: string }

export function walkJson(value: unknown, visit: (node: unknown, key: string) => void): void
export function extractImages(value: unknown): ExtractedImage[]
export function extractMediaUrls(
  value: unknown,
  opts?: { kind?: 'audio' | 'video' },
): string[]
export function extractText(value: unknown): string
export function extractTaskId(value: unknown): string
export function extractStatus(value: unknown): string
