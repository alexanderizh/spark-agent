import { useEffect, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, View } from 'react-native'
import { SvgUri } from 'react-native-svg'
import { changePassword, getCaptcha, sendPasswordCode, smsEnabled } from './auth'
import { Action, useUi } from './ui'

export function PasswordPage({ token, exit }: { token: string; exit(): void }) {
  const { ui, page, r } = useUi()
  const [enabled, setEnabled] = useState(false)
  const [captcha, setCaptcha] = useState<Awaited<ReturnType<typeof getCaptcha>>>()
  const [answer, setAnswer] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const refresh = async () => {
    setAnswer('')
    try {
      setCaptcha(await getCaptcha())
    } catch {
      setIssue('验证码加载失败')
    }
  }
  useEffect(() => {
    let current = true
    void smsEnabled()
      .then((allowed) => {
        if (current) setEnabled(allowed)
        if (current && allowed) void refresh()
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])
  useEffect(() => {
    if (seconds === 0) return
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  const send = async () => {
    if (!enabled || !captcha || !answer.trim() || busy || seconds) return
    setBusy(true)
    setIssue('')
    try {
      await sendPasswordCode(token, captcha.id, answer.trim())
      setSeconds(60)
    } catch (error) {
      setIssue(error instanceof Error ? error.message : '发送失败')
    } finally {
      await refresh()
      setBusy(false)
    }
  }
  const submit = async () => {
    if (
      busy ||
      !enabled ||
      !/^1[3-9]\d{9}$/.test(phone.trim()) ||
      !code.trim() ||
      password.length < 8 ||
      confirmation !== password
    )
      return
    setBusy(true)
    setIssue('')
    try {
      await changePassword(token, phone.trim(), code.trim(), password)
      Alert.alert('密码已修改', '请使用新密码重新登录。', [{ text: '确定', onPress: exit }])
    } catch (error) {
      setIssue(error instanceof Error ? error.message : '修改密码失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ScrollView
      contentContainerStyle={[page('password'), { gap: r(24) }]}
      keyboardShouldPersistTaps="handled"
    >
      {enabled ? (
        <>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            style={ui.input}
            placeholder="账号绑定的手机号"
          />
          <View style={ui.row}>
            {captcha && <SvgUri uri={captcha.svg} width={126} height={44} />}
            <Action label="刷新图片" disabled={busy} onPress={() => void refresh()} />
          </View>
          <TextInput
            value={answer}
            onChangeText={setAnswer}
            style={ui.input}
            placeholder="图形验证码"
          />
          <Action
            label={seconds ? `${seconds} 秒后重发` : '发送验证码'}
            disabled={
              busy || !!seconds || !/^1[3-9]\d{9}$/.test(phone.trim()) || !captcha || !answer.trim()
            }
            onPress={() => void send()}
          />
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            style={ui.input}
            placeholder="短信验证码"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={ui.input}
            placeholder="新密码（至少 8 位）"
          />
          <TextInput
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            style={ui.input}
            placeholder="确认新密码"
          />
          <Action
            primary
            label="确认修改"
            disabled={busy || !code.trim() || password.length < 8 || password !== confirmation}
            onPress={() => void submit()}
          />
        </>
      ) : (
        <View style={{ paddingTop: r(32), paddingHorizontal: r(8), gap: r(12) }}>
          <Text style={[ui.body, { fontWeight: '600' }]}>短信服务升级中</Text>
          <Text style={ui.muted}>请前往官网或桌面端修改密码。</Text>
        </View>
      )}
      {!!issue && (
        <Text style={ui.error} accessibilityLiveRegion="polite">
          {issue}
        </Text>
      )}
    </ScrollView>
  )
}
