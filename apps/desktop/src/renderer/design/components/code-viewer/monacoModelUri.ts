/**
 * 文件绝对路径 → Monaco 模型 URI（file:// 形式）。
 *
 * 模型必须携带真实文件路径：Monaco 的 TS worker 按模型 URI 的扩展名判定脚本类型，
 * 不带路径的匿名模型会把 .tsx 当普通 .ts 解析（JSX 语法整段误报）。
 * 统一显式 file:// scheme，同时避免 Windows 盘符路径（C:\...）被 Uri.parse
 * 把 "C" 误读为 scheme、或相对路径首段被误读为 host。已带 scheme 的入参原样返回。
 */
export function toMonacoModelUri(filePath: string): string {
  // Windows 盘符（C:\ / C:/）形如 URI scheme，识别 scheme 时须排除，否则整条路径原样透传
  const isScheme = /^[a-z][a-z0-9+.-]*:/i.test(filePath) && !/^[a-z]:/i.test(filePath)
  if (isScheme) return filePath
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${withLeadingSlash}`
}
