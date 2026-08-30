# 插桩上报器模板

`mcp__spark_debug__begin` 与 `next_round` 返回的 `snippets` 已经把 `<sid>` / `<round>` / `<port>` 占位符替换成真实值——**直接粘贴**即可，不要手改这些值。本文件说明结构与用法。

## 上报字段（POST /ingest 的 body）

| 字段 | 说明 |
|------|------|
| `sid` | 调试会话 id（= 对话 id），跨 turn 不变。**必填**，由 snippet 填好 |
| `round` | 当前轮次，由 snippet 填好；服务端按 round 分桶，`read` 默认只取当前轮 |
| `tag` | 你给这条日志的标签，建议用假设名，如 `'hypothesis-A'` / `'after-fix'` |
| `data` | 任意结构化负载（变量快照、分支命中、入参等） |
| `source` | `'browser'` / `'node'` 等，仅用于区分来源 |
| `ts` | 客户端时间戳，snippet 自动填 `Date.now()` |

## JS / TS（浏览器 & Node 通用）

```js
// __SPARK_DEBUG_START__ sid=<sid> round=<round>
function __sparkDebug(tag, data) {
  try {
    fetch('http://127.0.0.1:<port>/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: '<sid>', round: <round>, tag, data, ts: Date.now(), source: 'browser' }),
      keepalive: true,
    }).catch(() => {})
  } catch (_) {}
}
// __SPARK_DEBUG_END__
```

用法：在可疑点调用 `__sparkDebug('hypothesis-A', { userId, cartState, step })`。

- `keepalive: true` 保证页面跳转/卸载瞬间的日志也能发出。
- 整个上报 `try/catch` 包裹 + `.catch(() => {})`，日志服务不可用时**绝不影响**被调试的应用。

## Python

```python
# __SPARK_DEBUG_START__ sid=<sid> round=<round>
import json, urllib.request, threading, time
def __spark_debug(tag, data=None):
    def _send():
        try:
            req = urllib.request.Request(
                'http://127.0.0.1:<port>/ingest',
                data=json.dumps({'sid':'<sid>','round':<round>,'tag':tag,'data':data,'ts':int(time.time()*1000),'source':'node'}).encode(),
                headers={'Content-Type':'application/json'})
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()
# __SPARK_DEBUG_END__
```

用法：`__spark_debug('hypothesis-A', {'user_id': uid, 'state': state})`。后台线程发送，不阻塞主逻辑。

## 其他语言

照搬上面结构即可：向 `http://127.0.0.1:<port>/ingest` POST 一个含 `sid/round/tag/data/source/ts` 的 JSON，失败静默。务必用 `__SPARK_DEBUG_START__ / __SPARK_DEBUG_END__` 注释把插入块包起来。

## 清除（交付前必做）

`finish` 返回标记后：

```
grep -rn "__SPARK_DEBUG" <project>
```

逐块删除 `__SPARK_DEBUG_START__ ... __SPARK_DEBUG_END__` 之间的内容（含两行标记），以及你额外加的 `__sparkDebug(...)` / `__spark_debug(...)` 调用点。删完**再 grep 一次**，命中数必须为 0。
