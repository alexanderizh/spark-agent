# TokenHub 错误码（OpenAI / Responses / Anthropic 兼容协议）

> 状态: 实施中 | 最后核对: 2026-07-22
> 来源: https://cloud.tencent.com/document/product/1823/131595

## 一、OpenAI / Responses 兼容协议（标准链路）

### 1.1 错误响应结构

```json
{
  "error": {
    "message": "<英文错误描述>",
    "message_zh": "<中文错误描述>",
    "code": "<业务错误码>",
    "type": "<错误类型>",
    "source": "client | gateway | upstream",
    "upstream_code": "<上游错误码，仅 source=upstream>",
    "upstream_status": "<上游 HTTP 状态码，仅 source=upstream>",
    "request_id": "<请求唯一标识>"
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| message | string | 英文错误描述 |
| message_zh | string | 中文错误描述，与 message 一一对应 |
| code | string | 平台业务错误码（如 401002）；限流场景可能以整型数字返回 |
| type | string | 错误大类；请求链路早期短路（鉴权/参数校验）统一 `gateway_error` |
| source | string | client / gateway / upstream；仅 Handler 层错误返回 |
| upstream_code | string | 上游原始错误码，仅 source=upstream |
| upstream_status | number | 上游 HTTP 状态码，仅 source=upstream |
| request_id | string | 请求唯一标识 |

注意：
- 早期短路错误 `type` 一律 `gateway_error`，无 `source` 字段
- 限流（429）时 `code` 可能整型数字返回，并带 `Retry-After`（秒）响应头

### 1.2 业务错误码速查表

| HTTP | code | 名称 | 处理建议 |
| --- | --- | --- | --- |
| 400 | 400001 | CodeInvalidRequest | 请求不合法，检查请求体/必填/格式 |
| 400 | 400002 | CodeInvalidParameter | 参数无效或缺失，检查取值 |
| 400 | 400003 | CodeInputTooLong | 输入 Token 超出模型上下文 |
| 400 | 400004 | CodeModelNotFound | 模型或服务 ID 不存在 |
| 400 | 400005 | CodeUnsupportedModel | 模型不支持所请求协议/能力 |
| 400 | 400006 | CodeUnsupportedFormat | 模型不支持请求的 response_format/输出格式 |
| 400 | 401006 | CodeInvalidEndpoint | 服务 ID 不存在或与服务不匹配 |
| 401 | 401001 | CodeUnauthorized | 未携带认证信息或无法识别 |
| 401 | 401002 | CodeInvalidAPIKey | API Key 不存在或签名校验失败 |
| 401 | 401003 | CodeAPIKeyExpired | API Key 已过期 |
| 401 | 401004 | CodeAPIKeyDisabled | API Key 已被禁用 |
| 401 | 401005 | CodeSignatureInvalid | CAM 或自定义签名校验未通过 |
| 402 | 401007 | CodeEndpointNoFreePackage | 服务无可用免费体验额度且未开启后付费 |
| 402 | 401008 | CodeEndpointFreeQuotaExhausted | 免费体验额度耗尽且未开后付费 |
| 402 | 403004 | CodeInsufficientBalance | 账号欠费，服务被隔离 |
| 403 | 403001 | CodePermissionDenied | 套餐包被禁用或无调用权限 |
| 403 | 403002 | CodeModelAccessDenied | API Key 无权访问该模型 |
| 403 | 403003 | CodeAccountBlocked | 账号已被禁用 |
| 403 | 403005 | CodeIPNotAllowed | 请求来源 IP 不在 API Key 白名单 |
| 403 | 403006 | CodeToolUnavailable | 工具不可用或未订阅 |
| 410 | 410001 | CodeSessionExpired | 会话 provider 已下线，重建会话 |
| 413 | 413001 | CodeRequestBodyTooLarge | 请求体过大 |
| 429 | 429001 | CodeRateLimitExceeded | 请求速率超阈值 |
| 429 | 429002 | CodeRPMLimitExceeded | RPM 超阈值 |
| 429 | 429003 | CodeTPMLimitExceeded | TPM 超阈值 |
| 429 | 429004 | CodeTPDLimitExceeded | TPD 超阈值 |
| 429 | 429005 | CodeConcurrencyLimitExceeded | 并发超阈值 |
| 429 | 429006 | CodeUpstreamRateLimitExceeded | 上游服务繁忙 |
| 451 | 451001 | CodeContentFiltered | 输入/输出触发安全策略 |
| 499 | 499001 | CodeRequestCanceled | 客户端主动断开 |
| 500 | 500001 | CodeInternalError | 未知错误，请重试 |
| 502 | 502001 | CodeUpstreamError | 上游异常或不可达 |
| 503 | 503001 | CodeServiceUnavailable | 服务暂不可用 |
| 504 | 504001 | CodeGatewayTimeout | 上游响应超时 |

### 1.3 错误响应示例

**A. API Key 无效（HTTP 401）**

```json
{
  "error": {
    "message": "The API Key does not exist or signature verification failed. Please check whether the API Key is correct. See: https://console.cloud.tencent.com/tokenhub/apikey",
    "message_zh": "API Key 不存在或签名校验失败，请检查 API Key 是否正确，查看链接：https://console.cloud.tencent.com/tokenhub/apikey",
    "code": "401002",
    "type": "gateway_error",
    "request_id": "7e6dc7d0-a8d7-4993-a74d-f6cd24b33925"
  }
}
```

**B. 参数缺失（HTTP 400）**

```json
{
  "error": {
    "message": "The request parameter messages is invalid or missing. Please check the value of this parameter.",
    "message_zh": "请求参数 messages 无效或缺失，请检查该参数取值是否正确。",
    "code": "400002",
    "type": "gateway_error",
    "request_id": "5fcdcb74-bd31-4bc6-b265-1389cea2d915"
  }
}
```

**C. 模型不存在（HTTP 400）**

```json
{
  "error": {
    "message": "The model or service ID gpt-9-turbo does not exist. ...",
    "message_zh": "请求中的模型或服务 ID gpt-9-turbo 不存在，请检查服务 ID 是否正确。",
    "code": "400004",
    "type": "gateway_error",
    "request_id": "7a948a0f-740f-4d37-846f-0b500c3f1c48"
  }
}
```

**D. Responses 协议参数非法（HTTP 400）**

```json
{
  "error": {
    "message": "The request is invalid: temperature must be [0.0, 2.0]. ...",
    "message_zh": "请求不合法：temperature must be [0.0, 2.0]，请检查请求体、必填字段及请求格式是否正确。",
    "code": "400001",
    "type": "invalid_request_error",
    "source": "client",
    "request_id": "d4924d12-a56f-4a51-94f4-dab3608dd6c4"
  }
}
```

**E. 限流（HTTP 429）**

```json
{
  "error": {
    "code": 429001,
    "message": "The request rate exceeds the current model deepseek-v4-flash-202605 limit 60. Please reduce the request frequency or contact Tencent Cloud support to request a higher limit.",
    "message_zh": "请求速率超过当前模型 deepseek-v4-flash-202605 阈值 60，请降低访问频率或联系腾讯云售后申请更高限额。",
    "request_id": "req-16c2ae01"
  }
}
```

**F. 上游错误（HTTP 502）**

```json
{
  "error": {
    "message": "The upstream model service is abnormal or unreachable. ...",
    "message_zh": "上游模型服务异常或不可达，请重试。",
    "code": "502001",
    "type": "upstream_error",
    "source": "upstream",
    "upstream_status": 502,
    "request_id": "req-7d2c4a11"
  }
}
```

## 二、Anthropic 兼容协议

```json
{
  "type": "error",
  "error": {
    "type": "<错误类型>",
    "message": "<错误描述>",
    "reqid": "<请求唯一标识>"
  }
}
```

### 与 OpenAI/Responses 协议区别

| 区别项 | OpenAI / Responses 协议 | Anthropic 协议 |
| --- | --- | --- |
| 外层结构 | 仅 `error` 对象 | 外层多一个 `"type": "error"` |
| 业务码 | 返回 `code` 字段 | 不返回 `code` |
| 中文错误描述 | 含 `message_zh` | 通常不含 |
| 鉴权失败示例 | API Key 无效 → HTTP 401 | 同 |

## 三、旧混元生图（1668）业务错误码（部分）

> 来源: https://cloud.tencent.com/document/product/1668/88076

| 错误码 | 描述 |
| --- | --- |
| AuthFailure.UnauthorizedOperation | CAM 权限不足 |
| FailedOperation.ConsoleServerError | 控制台服务异常 |
| FailedOperation.GenerateImageFailed | 生成图片审核不通过 |
| FailedOperation.ImageDecodeFailed | 图片解码失败 |
| FailedOperation.ImageDownloadError | 图片下载错误 |
| FailedOperation.InnerError | 服务内部错误 |
| FailedOperation.ModerationFailed | 审核失败 |
| FailedOperation.RequestEntityTooLarge | 请求体过大 |
| FailedOperation.RequestTimeout | 后端服务超时 |
| FailedOperation.RpcFail | RPC 失败 |
| FailedOperation.ServerError | 服务内部错误 |
| FailedOperation.Unknown | 未知错误 |
| InvalidParameter.InvalidParameter | 参数不合法 |
| InvalidParameterValue.ImageEmpty | 图片为空 |
| InvalidParameterValue.ParameterValueError | 参数字段或值有误 |
| InvalidParameterValue.TextLengthExceed | 输入文本过长 |
| InvalidParameterValue.UrlIllegal | URL 格式不合法 |
| OperationDenied.ImageIllegalDetected | 图片违规 |
| OperationDenied.TextIllegalDetected | 文本违规 |
| RequestLimitExceeded | 请求次数超频率限制 |
| RequestLimitExceeded.JobNumExceed | 同时处理任务过多 |
| ResourceUnavailable.InArrears | 账号欠费 |
| ResourceUnavailable.LowBalance | 余额不足 |
| ResourceUnavailable.NotExist | 计费状态未知 |
| ResourceUnavailable.StopUsing | 账号停服 |
| ResourcesSoldOut.ChargeStatusException | 计费状态异常 |