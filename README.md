# 果壳碰碰（NutShell Bump）｜网页演示版本

结合天然果实手作娃娃与 AI 角色的参赛演示用全栈网页应用。支持固定链接即聊（对应 NFC 入口能力）、明确记忆读写与删除、照片/摄像头采集、异步形象生成与版本保留、个人娃娃绑定、模拟出图任务及受保护的演示会话重置。

## 技术栈选择

- **前端**：React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + React Router 7 + Lucide Icons
- **后端**：Express 4 + TypeScript（`server.ts` 统一承载业务 API、静态资源与 Vite SPA）
- **持久化**：SQLite（`better-sqlite3`，WAL 模式，外键约束与原子事务）+ 本地磁盘文件存储（`./storage/photos`、`./storage/generated`）
- **AI 与二维码**：`@google/genai` 官方服务端 SDK（亦兼容 OpenAI 协议的 `CHAT_API_BASE` / `IMAGE_API_BASE`）+ `qrcode` 服务端 SVG 二维码生成

> 部署提示：使用本地 SQLite 数据库（`DATABASE_URL`）与文件存储（`STORAGE_PATH`）时，生产环境需挂载持久磁盘以保留数据与生成成品图。

---

## 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，按需配置模型凭据与运行模式：

```bash
cp .env.example .env
```

关键开关说明（详见 `.env.example`）：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `APP_BASE_URL` | 生成 `dollUrl` 与 `cardUrl` 的基准地址 | `http://localhost:3000` |
| `DATABASE_URL` | SQLite 数据库文件路径 | `./data/nutshell.sqlite` |
| `STORAGE_PATH` | 原始照片与生成成品图存储目录 | `./storage` |
| `SESSION_SECRET` | HttpOnly 匿名会话 Cookie 签名密钥 | 内置演示默认值（生产务必替换） |
| `SESSION_TTL_DAYS` | 匿名会话有效期（天） | `30` |
| `CHAT_PROVIDER` | `cloud` 或 `mock`；留空时检测到有效 Key 自动用 `cloud`，显式 `cloud` 缺 Key 返回 `PROVIDER_NOT_CONFIGURED` | 自动检测 |
| `CHAT_MODEL` | 对话模型名称 | `gemini-4-hydrogen` |
| `CHAT_API_BASE` / `CHAT_API_KEY` | 可选：OpenAI 兼容对话接口地址与密钥（留空则用 `@google/genai` + `GEMINI_API_KEY`） | 空 |
| `IMAGE_PROVIDER` | `cloud` 或 `mock`；显式 `cloud` 缺 Key 返回 `PROVIDER_NOT_CONFIGURED`，不静默回退 | 缺 Key 时为 `mock` |
| `IMAGE_MODEL` | 生图模型名称 | `gemini-3.1-flash-lite-image` |
| `IMAGE_API_BASE` / `IMAGE_API_KEY` | 可选：OpenAI 兼容生图接口或独立生图密钥 | 空 |
| `IMAGE_TIMEOUT_MS` | 生图硬超时（毫秒；性能目标 40000ms 单独记录） | `60000` |
| `CHAT_FIRST_TOKEN_TIMEOUT_MS` | 对话首 token 硬超时（毫秒；性能目标 3000ms 单独记录） | `10000` |
| `MAX_REGENERATIONS` | 初次生成后最多重生成次数（默认 2，即单卡片最多 3 次模型尝试） | `2` |
| `OUTPUT_PROVIDER` | 本版固定 `mock` | `mock` |
| `DEMO_ADMIN_TOKEN` | `/dev` 及管理接口授权令牌 | `demo-admin-2026` |
| `PHOTO_TTL_HOURS` | 原始上传照片保留时间（小时），到期自动清理且保留已生成图 | `24` |

### 3. 启动开发服务（端口 3000）

```bash
npm run dev
```

启动时自动完成：
1. SQLite 建表、索引与唯一约束初始化；
2. 写入 **16 种 MBTI 人格**（含 4 个重点验证风格）与 **4 个只读预置展示娃娃**（`demo-acorn`、`demo-chestnut`、`demo-walnut`、`demo-hazelnut`）；
3. 重启任务恢复：将未知状态的 `running` 任务标记为 `failed`（`errorCode=WORKER_RESTARTED`），避免重复计费；重新入队 `queued` 任务；
4. 启动原始照片定时清理（`PHOTO_TTL_HOURS`）。

### 4. 构建与生产运行

```bash
npm run build
NODE_ENV=production npm start
```

---

## 核心业务演示步骤（核心闭环验收）

1. **打开首页 `/`**：查看 4 个预置展示娃娃，点击任意一个（如 `/d/demo-acorn`）可查看公开资料、固定链接二维码并进入 `/d/demo-acorn/chat` 进行真实流式对话。
2. **前往 `/create` 创作个人娃娃**：
   - 上传相册照片（JPEG/PNG/WebP）或切换“摄像头拍摄”（需 HTTPS 或 localhost）；客户端会自动校正方向并压缩至 2 MB 以内；
   - 填写称呼（如：`小林`）；
   - 选择人格（可展开全部 16 种 MBTI，默认推荐 4 个风格差异显著的角色）；
   - 选择手作配饰（如：`苔绿手织围巾`、`黄铜细框眼镜`）；
   - 点击 **开始生成娃娃形象**，自动跳转到 `/create/processing?cardId=...`（刷新页面按 `cardId` 恢复轮询，不重复提交）。
3. **在 `/card/{cardId}` 查看版本、重生成与绑定**：
   - 查看生成结果、耗时与 `resultKind`（`generated` / `mock` / `template`），支持下载成品图；
   - 可点击 **重新生成新版本**（旧版本永久保留，最多重生成 2 次）或 **使用预设模板兜底**（不计入模型次数）；
   - 选定一个成功版本，给娃娃起名（如：`栗子`），点击 **确认绑定并生成固定链接**；卡片随即冻结锁定，生成专属 `dollUrl` 与二维码。
4. **固定链接恢复与记忆验证**：
   - 打开或复制 `dollUrl`（`/d/{dollId}`）并进入对话页 `/d/{dollId}/chat`；
   - 角色会读取创建时写入的称呼（`小林`）、娃娃名（`栗子`）、人格与配饰；
   - 通过输入框“同时记住一件事”、发送 `记住：……` 前缀消息或右侧记忆栏添加明确事实，关闭标签页并重新打开同一固定链接，所有历史与记忆完整保留；
   - 在无痕窗口或另一浏览器打开同一链接，验证会话隔离（读不到另一浏览器的聊天和记忆，且无法访问私有 `/card/{cardId}`）。
5. **提交模拟出图**：
   - 在 `/card/{cardId}` 选择纸张规格（`A6` / `A5` / `SQUARE_100`）点击 **提交模拟出图**；
   - 任务推进 `queued -> running -> succeeded`，返回 `mode=mock`、`physicalExecuted=false`。
6. **下一轮演示重置**：
   - 打开 `/dev`，输入 `DEMO_ADMIN_TOKEN`（默认 `demo-admin-2026`）；
   - 查看 Provider 配置、分模式性能指标与运行记录，点击对应会话的 **重置此会话** 清理当前演示数据；预置娃娃、人格配置与其他会话不受影响。

---

## 明确记忆与对话历史的区分

- **写入规则**：本版不依赖二次 LLM 抽取，不自动将任意聊天永久存为记忆。记忆仅来自：
  1. 个人娃娃绑定时直接写入的创建选项（`user_nickname`、`doll_name`、`persona`、`accessories`）；
  2. 对话请求中显式携带的 `rememberText` 字段，或消息严格以 `记住：` / `记住:` 开头触发的显式规则；
  3. 用户在右侧“明确记忆档案”手动添加（`POST /api/dolls/{id}/memory`）。
- **删除行为**：通过 `DELETE /api/dolls/{id}/memory/{memoryId}` 删除某条记忆后，后续模型调用立即不再注入该条 Memory；但若同一事实仍出现在最近 20 条已完成聊天记录中，模型仍可能从对话历史上下文读到。如需彻底清空当前演示者的全部记忆与历史，请使用 `/dev` 中的受保护重置功能。

---

## 后续硬件与端侧接入说明（RDK / NFC / 机械臂）

接口文档详见 [`docs/API.md`](docs/API.md)，代码预留位置在 `server/providers/rdkAdapter.ts`：

- **NFC 碰一碰**：实体 NFC 标签写入 NDEF URI 记录，指向固定链接 `${APP_BASE_URL}/d/{dollId}`，浏览器直接打开即可完成续聊。
- **RDK 本地生图**：实现 `ImageProvider` 契约（`server/providers/imageProvider.ts` 中的 `ImageGenerateInput -> ImageGenerateResult`），在 `RdkImageProvider` 调用板端 HTTP 推理服务并落盘到 `STORAGE_PATH/generated`。
- **机械臂 / 实体打印机**：实现 `OutputProvider` 契约（`server/providers/outputProvider.ts`），接收已锁定的 `cardVersionId`、`resultUrl`、`paperSize`，在适配器内执行位图转 SVG/路径与硬件调度，完成后返回 `mode: 'arm' | 'printer'` 与 `physicalExecuted: true`。
