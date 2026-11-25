# 果壳碰碰（NutShell Bump）业务 API 契约文档

本文档与 `server/routes/api.ts` 保持严格一致。

## 通用约定

### 响应格式

所有成功 JSON 响应统一包裹在 `data` 字段内：

```json
{
  "data": {}
}
```

所有错误响应统一格式：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "可理解的中文错误说明",
    "requestId": "req_xxxxxxxxxxxxxxxx"
  }
}
```

### 身份与权限等级

| 等级 | 机制 | 说明 |
| --- | --- | --- |
| `none` | 无鉴权 | `/api/health`、`/api/session` |
| `session` | 签名 HttpOnly Cookie (`nutshell_sid`) | 自动建立或恢复匿名会话（`isDemo=true`，默认 30 天） |
| `owner` | 校验资源 `owner_session_id === req.session.id` | 访问不属于当前会话的私有资源统一返回 `404 NOT_FOUND` |
| `admin` | `Authorization: Bearer <DEMO_ADMIN_TOKEN>` 或 `X-Admin-Token` | 演示状态检查与受保护重置 |

### 幂等规则

`POST /api/cards`、`POST /api/cards/:id/redraw`、`POST /api/card-versions/:id/cancel`、`POST /api/cards/:id/fallback`、`POST /api/cards/:id/bind`、`POST /api/plot/jobs` 均支持请求头 `Idempotency-Key`：

- 同会话 + 同操作 + 同 Key + 相同参数哈希：返回原状态码与原响应体，不重复扣减次数或创建新资源。
- 同 Key 但参数不同：返回 `409 IDEMPOTENCY_CONFLICT`。

---

## 接口清单

### 1. 会话与健康检查

- `GET /api/health` (`none`) → `200 { data: { status: "ok", timestamp } }`
- `POST /api/session` (`none`) → `200` 建立或恢复 HttpOnly Cookie，返回 `{ sessionId, isDemo, expiresAt }`

### 2. 人格、配饰与模板配置

- `GET /api/personas` (`session`) → `200` 返回全部 16 种 MBTI 人格公开字段（`id, name, mbti, tagline, materialHint, openingLine, featured`），**不返回内部 `prompt`**。
- `GET /api/accessories` (`session`) → `200` 返回手作配饰选项列表。
  - 材料包条目含 `referenceImageUrl`，指向用于展示与生图的彩色材料图。
  - 严格实材模式下仅返回有参考图的可用材料。
- `GET /api/templates` (`session`) → `200` 返回预设兜底模板列表。

### 3. 娃娃档案

- `GET /api/dolls` (`session`) → `200` 返回预置 `demo` 娃娃与当前会话拥有的 `personal` 娃娃列表。
- `GET /api/dolls/:id` (`session`) → `200` 返回娃娃公开资料：`{ id, kind, name, avatarUrl, dollUrl, qrData, qrSvg, isOwner, cardUrl, cardId, persona }`。不包含原始照片地址与其他访客私有数据。

### 4. 对话与流式 SSE

- `GET /api/dolls/:id/messages?limit=50&cursor=<iso>` (`session`) → `200` 返回当前会话与该娃娃的消息列表 `{ items, nextCursor }`。
- `POST /api/dolls/:id/chat` (`session`)
  - Body：`{ text: string, clientMessageId: string, rememberText?: string }`
  - 流开始前校验失败（参数无效、娃娃不存在、同 `clientMessageId` 运行中 `409 TASK_ALREADY_RUNNING`、真实模式缺密钥 `503 PROVIDER_NOT_CONFIGURED`）返回标准 HTTP JSON 错误。
  - 若同一 `sessionId + dollId + clientMessageId` 已有 `completed` 回复，则以 SSE 回放已保存结果，不再次调用模型。
  - 若上一次回复为 `failed` / `incomplete`，复用同一 `clientMessageId` 会保留原用户消息并递增 `replyAttempt` 发起新回复尝试。
  - SSE 事件流（每次流仅以 `done` 或 `error` 之一结束）：

```text
event: meta
data: {"requestId":"req_xxx","clientMessageId":"msg_xxx","assistantMessageId":"reply_xxx","provider":"cloud","savedMemoryId":null}

event: delta
data: {"text":"小林，"}

event: done
data: {"assistantMessageId":"reply_xxx","status":"completed","firstTokenMs":842,"totalMs":2130,"savedMemoryId":null}

event: error
data: {"code":"CHAT_TIMEOUT","message":"对话首字响应超过 10000ms 超时上限","requestId":"req_xxx"}
```

### 5. 明确记忆（按 `sessionId + dollId` 隔离）

- `GET /api/dolls/:id/memory` (`session`) → `200` 返回记忆数组。
- `POST /api/dolls/:id/memory` (`session`) → `201` Body `{ type, value }`（`type` 允许 `user_nickname | doll_name | persona | accessories | fact`），返回 `{ memoryId, id, type, value, source, createdAt }`。
- `DELETE /api/dolls/:id/memory/:memoryId` (`owner`) → `204` 删除指定记忆；不存在或不属于本会话返回 `404`。

### 6. 形象卡与版本管理

- `GET /api/cards` (`session`) → `200` 返回当前会话创建的全部作品卡片。
- `POST /api/cards` (`session`, `multipart/form-data`, `Idempotency-Key`)
  - 字段：`photo`（JPEG/PNG/WebP，二进制头校验且 ≤ 2 MB）、`userNickname`、`personaId`、可选 `accessoryIds`。
  - 可选 `photoStyle` 和 `dollDesign`，最多 120 和 180 个字符。文本随任务快照保存，重生成时沿用原方案。
  - 严格实材模式要求选择 1 到 6 种有参考图的可用材料。选材和图片引用随任务保存，缺图时返回 `MATERIAL_REFERENCES_REQUIRED`。
  - 返回 `202 { cardId, versionId, status: "queued", provider, cardUrl, processingUrl }`。
- `GET /api/cards/:id` (`owner`) → `200` 返回卡片详情、全部 `versions`、`activeVersionId`、`remainingAttempts`、`boundDollId`、`boundDoll`、`photoAvailable`。
- `GET /api/cards/:id/photo` (`owner`) → 返回原始上传照片流；已过期返回 `410 PHOTO_EXPIRED`；非拥有者返回 `404`。
- `GET /api/card-versions/:id` (`owner`) → `200` 返回单个版本状态、`provider`、`resultKind`、`resultUrl`、`errorCode`、`latencyMs`。
- `POST /api/cards/:id/redraw` (`owner`, `Idempotency-Key`) → `202` 同一事务内检查未绑定、无运行中任务、原始照片未过期、未超生成次数上限后创建新版本。超限返回 `409 GENERATION_LIMIT_REACHED`，已绑定返回 `409 CARD_LOCKED`，运行中返回 `409 TASK_ALREADY_RUNNING`，照片过期返回 `410 PHOTO_EXPIRED`。
- `POST /api/card-versions/:id/cancel` (`owner`, `Idempotency-Key`) → `200` 仅 `queued` 可取消；`running` 返回 `409 TASK_ALREADY_RUNNING`。
- `POST /api/cards/:id/fallback` (`owner`, `Idempotency-Key`) → `201` Body `{ templateId }`，创建或更新单卡片唯一的 `resultKind=template` 版本，不消耗模型生成次数；存在运行中任务返回 `409 TASK_ALREADY_RUNNING`。
- `POST /api/cards/:id/bind` (`owner`, `Idempotency-Key`)
  - Body：`{ versionId, dollName }`
  - 首次绑定返回 `201`，重复绑定同一 `cardId + versionId` 返回 `200`（原 Doll，不新建）；对已绑定卡片提交其他 `versionId` 返回 `409 CARD_LOCKED`。
  - 绑定时自动将 `user_nickname`、`doll_name`、`persona`、`accessories` 写入该个人娃娃的明确记忆。
  - 返回 `{ dollId, dollUrl, cardUrl, cardVersionId }`。

### 7. 模拟出图任务与资源下载

- `POST /api/plot/jobs` (`owner`, `Idempotency-Key`) → `202` Body `{ cardVersionId, paperSize }`（`A6 | A5 | SQUARE_100`），返回 `{ jobId, cardId, cardVersionId, paperSize, status: "queued", mode: "mock", physicalExecuted: false }`。
- `GET /api/plot/jobs?cardId=` (`owner`) → `200` 返回当前会话的出图任务列表。
- `GET /api/plot/jobs/:id` (`owner`) → `200` 查询单个任务状态与 `mode` / `physicalExecuted`。
- `GET /api/assets/generated/:filename?download=1` → 草稿仅限作品所属会话，绑定娃娃后访客可读取选定版本的头像。附加 `download=1` 时下发附件下载头。

### 8. 演示管理（受 `DEMO_ADMIN_TOKEN` 保护）

- `GET /api/demo/status` (`admin`) → `200` 返回 Provider 配置状态（不暴露密钥值）、预置与个人实体数量、分模式性能指标、活跃演示会话、近期运行与错误日志。
- `POST /api/demo/reset` (`admin`) → `200` Body `{ sessionId }`，仅重置 `isDemo=true` 会话数据并失效该会话；若该会话存在 `running` 任务返回 `409 TASK_ALREADY_RUNNING`。

---

## Provider 扩展契约（供后续 RDK / 机械臂接入）

### Vercel 预览与 NFC

- `GET /api/capabilities` 返回 `imageGenerationEnabled` 与 `photoMbtiEnabled`。
- `GET /nfc/:alias` 返回 `302` 跳转到 `/d/:id/chat?entry=nfc&alias=...`。未绑定返回 `404`。
- `POST /api/demo/nfc-tags/:alias/written` 接收 `{ url, scope }`。工坊核对标签读出的完整 URL 与当前环境的预期地址后登记时间。
- 在 Vercel 配置 `IMAGE_GENERATION_ENABLED=true` 和云端生图密钥后开放生图和重生成。
- `POST /api/mbti/recommend` 可接收一张照片并返回娃娃角色、材料、`photoStyle` 和 `dollDesign`。开启照片分析需配置 `STEPFUN_VISION_MODEL`，照片在应用后端内存中处理。关闭时，照片请求返回 `409 PHOTO_MBTI_UNAVAILABLE`。四题快测使用 JSON 请求。
- 重生成遇到上一次云端结果未确认时返回 `409 GENERATION_REVIEW_REQUIRED`。人工核对结果与费用后可发送 `reviewedUnknown: true`。


### ImageProvider (`server/providers/imageProvider.ts`)

默认云端服务使用 OpenAI 参考图编辑。工坊可手动切换 Nano Banana。生成后保存成品图和服务商请求编号。

- **输入 (`ImageGenerateInput`)**：`cardId`, `versionId`, `versionNumber`, `photoBuffer`, `photoMime`, `userNickname`, `personaId`, `personaName`, `personaMbti`, `personaMaterialHint`, `accessoryIds`, `signal: AbortSignal`
- **输出 (`ImageGenerateResult`)**：`resultUrl`（持久化路径）, `resultKind` (`generated | mock`), `provider`, `providerRequestId`, `latencyMs`, 可选 `suggestedName`, `keywords`

### OutputProvider (`server/providers/outputProvider.ts`)

- **输入 (`OutputJobInput`)**：`jobId`, `cardId`, `cardVersionId`, `resultUrl`, `resultKind`, `paperSize`
- **输出 (`OutputJobResult`)**：`mode` (`mock | arm | printer`), `physicalExecuted` (`boolean`), `artifactNote`

---

## 主要错误码一览

`INVALID_INPUT`、`UNSUPPORTED_IMAGE`、`IMAGE_TOO_LARGE`、`PHOTO_EXPIRED`、`NOT_FOUND`、`UNAUTHORIZED`、`ADMIN_NOT_CONFIGURED`、`PROVIDER_NOT_CONFIGURED`、`PROVIDER_ERROR`、`GENERATION_TIMEOUT`、`GENERATION_LIMIT_REACHED`、`TASK_ALREADY_RUNNING`、`CARD_LOCKED`、`INVALID_CARD_VERSION`、`IDEMPOTENCY_CONFLICT`、`CHAT_TIMEOUT`、`WORKER_RESTARTED`。
