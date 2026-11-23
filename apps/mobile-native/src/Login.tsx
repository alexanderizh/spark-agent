import { useCallback, useEffect, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SvgUri } from 'react-native-svg'
import { authenticateWithCode, getCaptcha, login, sendAuthCode, smsEnabled } from './auth'
import type { AuthSession } from './auth'
import { Action, useUi } from './ui'

export function Login({ onLogin }: { onLogin(session: AuthSession): void }) {
  const { ui, colors, page, r } = useUi()
  const [mode, setMode] = useState<'password' | 'email' | 'sms' | 'register'>('password')
  const [smsAvailable, setSmsAvailable] = useState(false)
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [captchaText, setCaptchaText] = useState('')
  const [captcha, setCaptcha] = useState<Awaited<ReturnType<typeof getCaptcha>>>()
  const [captchaVersion, refreshCaptcha] = useState(0)
  const [captchaLoading, setCaptchaLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const onCaptchaError = useCallback(() => setError('验证码图片无法显示，请刷新'), [])

  useEffect(() => {
    let current = true
    setCaptcha(undefined)
    setCaptchaText('')
    setCaptchaLoading(true)
    void getCaptcha()
      .then((value) => {
        if (current) setCaptcha(value)
      })
      .catch(() => {
        if (current) setError('验证码加载失败，请重试')
      })
      .finally(() => {
        if (current) setCaptchaLoading(false)
      })
    return () => {
      current = false
    }
  }, [captchaVersion])

  useEffect(() => {
    let current = true
    void smsEnabled()
      .then((enabled) => {
        if (current) setSmsAvailable(enabled)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])

  const switchMode = (choice: typeof mode) => {
    setMode(choice)
    setPassword('')
    setCode('')
    setCodeSent(false)
    setError('')
    refreshCaptcha((value) => value + 1)
  }
  const sendCode = async () => {
    if (mode === 'password' || !captcha || busy || !captchaText.trim() || !account.trim()) return
    setBusy(true)
    setError('')
    try {
      await sendAuthCode(mode, account.trim(), captcha.id, captchaText.trim())
      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送验证码失败')
    } finally {
      refreshCaptcha((value) => value + 1)
      setBusy(false)
    }
  }

  const submit = async () => {
    if (busy || !account.trim()) return
    if (mode === 'password' && (!captcha || !password || !captchaText.trim())) return
    if (mode !== 'password' && (!code.trim() || (mode === 'register' && !password))) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'password' && captcha) {
        onLogin(
          await login({
            account: account.trim(),
            password,
            captchaId: captcha.id,
            captchaText: captchaText.trim(),
          }),
        )
      } else if (mode !== 'password') {
        onLogin(
          await authenticateWithCode(mode, account.trim(), code.trim(), password, invite.trim()),
        )
      }
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
      refreshCaptcha((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  const modeOptions: Array<[typeof mode, string]> = [
    ['password', '密码登录'],
    ['email', '邮箱验证码'],
    ['sms', '短信登录'],
  ]

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          page('login'),
          { gap: r(24), width: '100%', maxWidth: 520, alignSelf: 'center' },
        ]}
      >
        <View style={{ alignItems: 'center', marginTop: r(24), marginBottom: r(32) }}>
          <Image
            source={require('../../mobile/src/assets/brand/logo.png')}
            resizeMode="contain"
            style={{
              width: r(120),
              height: r(120),
              backgroundColor: '#FFFFFF',
              borderRadius: r(28),
              marginBottom: r(24),
            }}
          />
          <Text style={[ui.title, { fontSize: r(40), lineHeight: r(56), marginBottom: r(10) }]}>
            SparkWork
          </Text>
          <Text style={[ui.muted, { textAlign: 'center' }]}>
            桌面端的移动伴侣 · 账号同步 · 设备互通
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            padding: r(6),
            borderRadius: r(20),
            marginBottom: r(16),
            backgroundColor: colors.tint,
          }}
        >
          {modeOptions.map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{
                selected: mode === value,
                disabled: busy || (value === 'sms' && !smsAvailable),
              }}
              disabled={busy || (value === 'sms' && !smsAvailable)}
              onPress={() => switchMode(value)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: r(72),
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: r(15),
                backgroundColor: mode === value ? colors.paper : 'transparent',
                opacity: value === 'sms' && !smsAvailable ? 0.6 : pressed ? 0.72 : 1,
              })}
            >
              <Text
                style={[
                  ui.muted,
                  { fontSize: r(28) },
                  mode === value && { color: colors.text, fontWeight: '600' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ gap: r(10) }}>
          <Text style={ui.groupTitle}>
            {mode === 'sms' ? '手机号' : mode === 'password' ? '账号（邮箱 / 手机号）' : '邮箱账号'}
          </Text>
          <TextInput
            accessibilityLabel="账号"
            placeholder={mode === 'sms' ? '手机号' : mode === 'password' ? '邮箱或账号' : '邮箱'}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            editable={!busy}
            value={account}
            onChangeText={(value) => {
              setAccount(value)
              setCodeSent(false)
              setCode('')
            }}
            style={ui.input}
          />
        </View>
        {(mode === 'password' || mode === 'register') && (
          <View style={{ gap: r(10) }}>
            <Text style={ui.groupTitle}>密码</Text>
            <TextInput
              accessibilityLabel="密码"
              placeholder="密码"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoComplete="current-password"
              editable={!busy}
              value={password}
              onChangeText={setPassword}
              style={ui.input}
            />
          </View>
        )}
        {mode === 'register' && (
          <TextInput
            value={invite}
            onChangeText={setInvite}
            editable={!busy}
            placeholder="邀请码（选填）"
            style={ui.input}
          />
        )}
        <View style={{ gap: r(10) }}>
          <Text style={ui.groupTitle}>图片验证码</Text>
          <View style={ui.row}>
            <TextInput
              accessibilityLabel="图形验证码"
              placeholder="请输入验证码"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy && !!captcha}
              value={captchaText}
              onChangeText={setCaptchaText}
              style={[ui.input, { flex: 1, minWidth: 0 }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新验证码"
              disabled={busy || captchaLoading}
              onPress={() => {
                setError('')
                refreshCaptcha((value) => value + 1)
              }}
              style={[
                ui.input,
                {
                  width: r(200),
                  paddingHorizontal: 0,
                  justifyContent: 'center',
                  alignItems: 'center',
                  overflow: 'hidden',
                  backgroundColor: '#fff',
                },
              ]}
            >
              {captcha ? (
                <SvgUri uri={captcha.svg} width={r(200)} height={r(86)} onError={onCaptchaError} />
              ) : (
                <Text style={[ui.muted, { color: '#6b6b6b' }]}>
                  {captchaLoading ? '加载中…' : '点击刷新'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
        {mode !== 'password' && (
          <>
            <Action
              label={codeSent ? '重新发送验证码' : '发送验证码'}
              disabled={busy || !captcha || !captchaText.trim() || !account.trim()}
              onPress={() => void sendCode()}
            />
            {codeSent && (
              <Text style={ui.muted} accessibilityLiveRegion="polite">
                验证码已发送
              </Text>
            )}
            <TextInput
              accessibilityLabel="登录验证码"
              value={code}
              onChangeText={setCode}
              placeholder="邮箱或短信验证码"
              editable={!busy}
              style={ui.input}
            />
          </>
        )}
        {!!error && (
          <Text accessibilityLiveRegion="polite" style={ui.error}>
            {error}
          </Text>
        )}
        <Action
          primary
          label={busy ? '处理中…' : mode === 'register' ? '注册' : '登录'}
          disabled={
            busy ||
            !account.trim() ||
            (mode === 'password'
              ? !captcha || !password || !captchaText.trim()
              : !code.trim() || (mode === 'register' && !password))
          }
          onPress={() => void submit()}
        />
        <Action
          label={mode === 'register' ? '已有账号？去登录' : '没有账号？注册新账号'}
          disabled={busy}
          onPress={() => switchMode(mode === 'register' ? 'password' : 'register')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
