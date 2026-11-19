import { useCallback, useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { SvgUri } from 'react-native-svg'
import { getCaptcha, login } from './auth'
import { Action, colors, ui } from './ui'

export function Login({ onLogin }: { onLogin(token: string): void }) {
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

  const submit = async () => {
    if (!captcha || busy || !account.trim() || !password || !captchaText.trim()) return
    setBusy(true)
    setError('')
    try {
      onLogin(
        await login({
          account: account.trim(),
          password,
          captchaId: captcha.id,
          captchaText: captchaText.trim(),
        }),
      )
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
      refreshCaptcha((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          ui.page,
          { paddingTop: 36, width: '100%', maxWidth: 520, alignSelf: 'center' },
        ]}
      >
        <View style={{ gap: 6, marginBottom: 16 }}>
          <Text style={ui.title}>SparkWork</Text>
          <Text style={ui.muted}>登录账号</Text>
        </View>
        <TextInput
          accessibilityLabel="账号"
          placeholder="邮箱或账号"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          editable={!busy}
          value={account}
          onChangeText={setAccount}
          style={ui.input}
        />
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
        <TextInput
          accessibilityLabel="图形验证码"
          placeholder="图形验证码"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !!captcha}
          value={captchaText}
          onChangeText={setCaptchaText}
          style={ui.input}
        />
        <View style={[ui.row, { minHeight: 46, flexWrap: 'wrap' }]}>
          {captcha && (
            <SvgUri
              uri={captcha.svg}
              width={126}
              height={44}
              accessibilityLabel="图形验证码图片"
              onError={onCaptchaError}
            />
          )}
          <Action
            label={captchaLoading ? '加载中…' : '刷新验证码'}
            disabled={busy || captchaLoading}
            onPress={() => {
              setError('')
              refreshCaptcha((value) => value + 1)
            }}
          />
        </View>
        {!!error && (
          <Text accessibilityLiveRegion="polite" style={ui.error}>
            {error}
          </Text>
        )}
        <Action
          primary
          label={busy ? '登录中…' : '登录'}
          disabled={busy || !captcha || !account.trim() || !password || !captchaText.trim()}
          onPress={() => void submit()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
