/**
 * errorMapping — 把后端业务错误消息关联到具体表单字段
 *
 * 后端常见错误（zh）：
 *   - "验证码错误" / "验证码已过期" / "图片验证码失效" → captchaText
 *   - "密码错误" / "账号或密码错误" → password
 *   - "邮箱验证码错误" / "邮箱验证码已过期" → emailCode
 *   - "账号不存在" / "邮箱未注册" → account
 *
 * 没匹配上的返回 null，由调用方决定是否走 toast。
 */

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  captchaText: [
    /图片验证码/,
    /captcha/i,
    /图形验证码/,
  ],
  emailCode: [
    /邮箱验证码/,
    /email[\s-]*code/i,
    /验证码.*(已过期|失效|错误)/,
  ],
  smsCode: [/短信验证码/, /sms[\s-]*code/i, /验证码.*(已过期|失效|错误)/],
  password: [
    /密码/,
    /password/i,
    /账号或密码/,
  ],
  account: [
    /账号不存在/,
    /账号.*禁用/,
    /邮箱未注册/,
    /account.*(not.*found|disabled)/i,
  ],
}

/**
 * 在候选字段中找出第一个匹配错误信息的字段。
 *
 * @param msg 后端错误消息
 * @param candidates 候选字段名（按优先级排序；只在这些字段中匹配）
 * @returns 匹配到的字段名，或 null
 */
export function matchFieldError(
  msg: string,
  candidates: readonly string[],
): string | null {
  if (!msg) return null
  for (const field of candidates) {
    const patterns = FIELD_PATTERNS[field]
    if (!patterns) continue
    if (patterns.some((re) => re.test(msg))) return field
  }
  return null
}
