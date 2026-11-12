/** 显式交付文件不按扩展名过滤；自动发现文档仍使用独立白名单。 */
export function filterPresentedFiles<T extends { path: string }>(files: readonly T[]): T[] {
  return files.filter((file) => file.path.trim().length > 0)
}

export function hasPresentedFiles(files: readonly { path: string }[]): boolean {
  return files.some((file) => file.path.trim().length > 0)
}
