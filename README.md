# 果壳碰碰（NutShell Bump）｜网页演示版本

结合天然果实手作娃娃与 AI 角色的参赛演示用全栈网页应用。支持固定链接即聊（对应 NFC 入口能力）、明确记忆读写与删除、照片/摄像头采集、异步形象生成与版本保留、个人娃娃绑定、模拟出图任务及受保护的演示会话重置。

## 本地运行

使用 Node.js 24 和 npm。服务会建立 SQLite 表并初始化 16 种人格、4 个展示娃娃和工坊材料。

```bash
npm ci
cp .env.example .env
npm run dev
```

本地数据默认在 `data/nutshell.sqlite`，媒体文件在 `storage`。可以设置 `CHAT_PROVIDER=mock` 和 `IMAGE_PROVIDER=mock` 运行离线演示。

## Vercel 预览部署

Vite 构建前端。Express API 和 NFC 跳转运行在 Vercel Functions。预览连接独立 Turso Starter 数据库与私有 Vercel Blob，后台任务使用 Vercel Queues。首次初始化只导入演示内容。

| 预览环境变量 | 用途 |
| --- | --- |
| `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` | 独立预览数据库，由 Turso 集成提供 |
| `BLOB_READ_WRITE_TOKEN` | 私有 Blob 读写，由 Vercel Storage 集成提供 |
| `SESSION_SECRET` | 会话与队列消息的签名密钥，预览内固定以支持跨部署恢复 |
| `DEMO_ADMIN_TOKEN` | `/dev` 工坊管理密钥 |
| `STEPFUN_API_KEY`、`STEPFUN_CHAT_MODEL` | 阶跃星辰流式对话和照片分析的服务端认证，聊天模型由后者指定 |
| `STEPFUN_VISION_MODEL` | 照片分析使用的阶跃星辰视觉模型，预览使用 `step-5-preview` |
| `IMAGE_GENERATION_ENABLED` | 设为 `true` 开放娃娃形象生成 |
| `OPENAI_API_KEY` | GPT Image 的服务端密钥 |
| `PREVIEW_APP_URL` | 固定 HTTPS 预览地址，用于测试贴纸和角色分享链接 |

通过 `/api/health` 检查后端就绪情况。在 `/create` 点「拍照并分析」或「选照片并分析」，阶跃星辰会为虚构娃娃推荐角色与配色，页面直接显示方案和备料清单。点推荐角色的邀请可以自由聊天。想再选选角色时，可以从聊天里打开情景测验，采用结果后沿用照片配色更新材料。情景题和四题快测都按固定规则计分。

摄像头在设备上用 MediaPipe Face Detector 筛选单人、稳定且清晰的画面，再用 Face Landmarker 检查候选帧的朝向与闭眼情况。模型和运行文件随站点发布。

工坊材料图册包含团队素材包中的 55 种彩色材料图。已有数据库会追加这些条目，工坊可在 `/dev` 更新可用状态。严格实材模式只将本次选中的材料图交给生图服务。线上任务在保存成品前会用 StepFun 核对部件。

开放定制的环境使用 `OPENAI_API_KEY` 配置 GPT Image。工坊人员可在 `/dev` 手动切换至 Nano Banana，凭据使用 `GEMINI_API_KEY`。任务保存提交时的模型与质量档位。远程结果未知时，核对服务商的结果与费用后方可继续提交。原始照片保留 24 小时，已生成的作品按作品权限读取。

云端生图默认每个会话同时接受 1 个任务，全站排队和运行任务合计上限为 5。每天全站 60 单、单会话 10 单、单 IP 每 10 分钟 20 单，日额度在北京时间零点重置。额度以接受的生成任务计，重试同一幂等请求沿用原任务。工坊可通过 `.env.example` 中的 `IMAGE_*_LIMIT` 环境变量调整。

跨浏览器续聊口令有效期最长 10 分钟，使用后失效。重新生成会替换上一条未用口令，各浏览器保有自己的会话恢复标识。

### NFC 写签和检查

- 测试贴纸使用固定预览地址下的 `/nfc/acorn`、`/nfc/chestnut`、`/nfc/walnut` 或 `/nfc/hazelnut`。每张贴纸只写一条 HTTPS URL/URI 记录。
- iPhone 写签使用 NFC Tools。写完从同一张贴纸读回地址，到 `/dev` 对应行核对。Android Chrome 支持在该行直接写入和读回。
- 兼容机型亮屏时，用 iPhone 顶部靠近标签并点击系统通知。HTTP 短链接直接跳转到娃娃聊天。正式域名接入后，通过 `PUBLIC_APP_URL` 指定正式写签域名。


### 构建与生产运行

```bash
npm run build
NODE_ENV=production npm start
```

---

## 核心业务演示步骤（核心闭环验收）

1. **打开首页 `/`**：查看 4 个预置展示娃娃，点击任意一个（如 `/d/demo-acorn`）可查看公开资料、固定链接二维码并进入 `/d/demo-acorn/chat` 进行真实流式对话。
2. **前往 `/create` 创作个人娃娃**：
   - 选择「拍照并分析」或「选照片并分析」。摄像头需要 HTTPS 或 localhost，客户端自动校正照片方向并压缩到 2 MB 以内。
   - 查看推荐角色、备料数量和尺寸。假如推荐的是观察者，点「让观察者陪你继续聊」就能与它对话。回到方案也可更换在库材料。
   - 填写称呼。
   - 点击 **生成娃娃形象**，自动跳转到 `/create/processing?cardId=...`（刷新页面按 `cardId` 恢复轮询，不重复提交）。
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
   - 打开 `/dev`，输入 `DEMO_ADMIN_TOKEN`；
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

- **NFC 碰一碰**使用一条 HTTPS NDEF URI 记录。打开 /nfc/{alias} 会跳转到娃娃聊天页。
- **RDK 本地生图**：实现 `ImageProvider` 契约（`server/providers/imageProvider.ts` 中的 `ImageGenerateInput -> ImageGenerateResult`），在 `RdkImageProvider` 调用板端 HTTP 推理服务并落盘到 `STORAGE_PATH/generated`。
- **机械臂 / 实体打印机**：实现 `OutputProvider` 契约（`server/providers/outputProvider.ts`），接收已锁定的 `cardVersionId`、`resultUrl`、`paperSize`，在适配器内执行位图转 SVG/路径与硬件调度，完成后返回 `mode: 'arm' | 'printer'` 与 `physicalExecuted: true`。
