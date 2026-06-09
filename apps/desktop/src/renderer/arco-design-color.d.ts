declare module '@arco-design/color' {
  export function generate(
    color: string,
    options?: { index?: number; dark?: boolean; list?: boolean; format?: 'hex' | 'rgb' | 'hsl' },
  ): string | string[]
  export function getRgbStr(color: string): string
}
