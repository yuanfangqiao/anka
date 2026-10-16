# FEATURE.md · 功能全景与状态

> 最后更新：2026-10-15 ｜ 口径：✅ 已完成 ｜ 🚧 进行中 ｜ 📋 已规划未动 ｜ 💡 backlog 想法
> 本文件记「有什么 / 还差什么」；「什么时候改的、怎么改的」看 `CHANGELOG.md`；「为什么这么做」看 `IDEA.md` / `ARCHITECTURE.md`。

## 1. 系统壳层（PWA + 双布局）

| 功能 | 说明 | 状态 |
|------|------|------|
| PWA 可安装 | manifest + Service Worker + 离线 App Shell；mac/Win/iOS/Android 安装，standalone 无地址栏 | ✅ |
| 双布局壳 | 同一路由同一套页面：≤768px 手机形态（TopBar + 底部 dock），>768px 桌面形态（侧栏 + 主窗口） | ✅ |
| macOS 风格 dock | 波浪放大 / 运行点 / tooltip；dock = 已安装应用，装卸随动；手机最多 5 个可横滑 | ✅ |
| iOS 大标题导航 | 手机端 TopBar 大标题，滚动收缩为小标题 | ✅ |
| 安全区适配 | `viewport-fit=cover` + `env(safe-area-inset-*)`，dock 不被手势条遮挡 | ✅ |
| 空系统空态 | 不装应用插件 → 设计过的 EmptyHome，非白屏 | ✅ |
| 移动端刷新稳定 | fixed 钉死视口，安卓下拉刷新不拉伸布局（M17） | ✅ |

## 2. 插件内核（cordis 移植）

| 功能 | 说明 | 状态 |
|------|------|------|
| inject / provide 依赖 | 按依赖拓扑排序加载；服务注册经 `reflect.provide` | ✅ |
| 热启停 + 级联卸载 | `POST /api/plugins/{name}/enable\|disable`，返回级联影响名单 | ✅ |
| 副作用可逆 | 一律 `fiber.effect`（返回 teardown），卸载干净 | ✅ |
| 异步护栏 | 同步内核只能经 `PluginManager` + `asyncio.Lock` + `to_thread` 调用 | ✅ |
| 管理 API | `GET /api/health`、`GET /api/plugins`（状态/依赖/副作用数） | ✅ |

## 3. App 插件模型与管线

| 功能 | 说明 | 状态 |
|------|------|------|
| 前后端一体插件包 | `plugins/<name>/`：`plugin.json` + `server/` + `web/`，`setup(uiCtx)` 注册路由/dock | ✅ |
| 动态安装/卸载 | 目录扫描发现；插件页三分区（运行中/可安装/系统）；卸载弹窗列级联影响 | ✅ |
| 开发态即时编译 | vite 中间件按需编译插件 `.vue/.ts`，带 HMR | ✅ |
| 生产态安装时编译 | install hook 用 esbuild 构建 → `/plugin-dist/` 伺服；`import 'vue'` 映射宿主实例防双 Vue；`.src-hash` 缓存失效 | ✅ |
| 任意文件夹即应用 | 无 plugin.json 的目录降级为 page 类应用（index.html/dist，iframe 同源，可直 fetch 内核 API） | ✅ |
| 系统插件自托管 | 对话 / 插件管理 / 设置（`web/src/system/`），`system: true` 可禁用不可卸载 | ✅ |
| GitHub 一键安装 | 输入仓库 URL → clone 进 `plugins/` → 复用 install API；升级 = 拉取 + 重装 | 📋（M10） |
| 系统插件「禁用」语义 | M6 仅实现不可卸载，禁用未做 | 💡 |
| 长按 dock 抖动编辑 | 排序/卸载手势模式 | 💡 |

## 4. Agent 对话

| 功能 | 说明 | 状态 |
|------|------|------|
| TokenHub 真实模型 | 13 个模型 ID 走同一 OpenAI 兼容端点；对话页下拉切换，设置页配 Key（脱敏只写存储）；无 Key 回退 Echo | ✅ |
| SSE 流式输出 | `/api/chat`，有序 blocks（文本 + 工具卡），打字机渲染 | ✅ |
| 真实会话管理 | `/api/sessions` 日志投影会话列表；新建/切换/删除持久；`derive_messages` 多轮上下文 | ✅ |
| 可终止 | `AbortController` + 后端 cancel，发送中一键终止、UI 即时解锁 | ✅ |
| 工具调用 | `tools-runtime` + `tool-bash`，工具调用全程可视 | ✅ |
| 调用链可视化 | waterfall 洋葱模型展示 listener 包裹层级与耗时 | 💡（M5+ 采纳未排期） |
| 对话 → 笔记联动 | Agent 产出内容一键存为笔记 | 💡（M5+ 采纳未排期） |

## 5. Harness 自我插件开发（M14）

| 功能 | 说明 | 状态 |
|------|------|------|
| Agent 读写 `plugins/` | 脚手架 → 隔离试载校验 → 无重启安装/重载 → 回滚 全链路 | ✅ |
| 写入护栏 | `harness_guard` 限可写区仅 `plugins/`，越界拦截 | ✅ |
| 会话日志 | `session_log` append-only 权威事件源，可投影模型历史 | ✅ |

## 6. Run 常驻化 + 创造模式（M17）

| 功能 | 说明 | 状态 |
|------|------|------|
| RunManager | 断连不取消、重放续传、stop 才终止；切应用/刷新/切后台 run 不中断 | ✅ |
| 全局过程面板 | 悬浮思考/工具步骤流，可拖拽可终止，跨页可见；刷新自动重挂 | ✅ |
| 截屏创造模式 | 对角双指 / Ctrl+点击左下角 → 截图 + 指令发给 Agent 当场改插件 | ✅ |

## 7. 多端同步（内核能力）

| 功能 | 说明 | 状态 |
|------|------|------|
| 通用 WS 通道 | `/api/sync/ws/{room_id}`，`sync_hub` + `sync_store`（SQLite 快照 + op-log） | ✅ |
| 冲突策略 | 服务端定序 + LWW | ✅ |
| 多实例广播 | 单 worker 内存态；多实例需 Redis pub/sub | 💡 |
| 离线对账 | 重连后本地快照 vs 服务端快照对账 | 💡 |

## 8. 应用插件

### anka-jot（速记）✅

- 文本 / 拍照 / 相册 / 语音四入口，按天分组时间线瀑布流（JS `matchMedia` 响应式 2/3/4 列）
- **离线优先**：IndexedDB 唯一事实源 + outbox 保序推送 + `snapshot(sinceRev)` 增量拉取 LWW；毒丸不堵队、5 次转死信、本地未推送编辑保护
- **MicSession**：iOS 二次录音无声修复（会话级持久麦克风流，不重复 getUserMedia）
- **拍照**：`<input capture>` 直呼系统相机；拍完即存，杀进程不丢
- **宿主 Tailwind 解耦**：塌缩级样式一律 `jot-` 语义类（`web/lib/ui.css.ts` 注入）
- 主题跟随宿主 `data-theme`；媒体分块上传（768KB/块）；语音波形 200 点降采样

### 候选回归（以 App 插件形态）

| 插件 | 状态 |
|------|------|
| 网络 Network / 工作区 Workspace | 💡 用途未定义 |
| 任务 Tasks（后台 fiber 可视化） | 💡 M5+ 采纳未排期 |

## 9. 明确不做（边界）

- 多用户 / 鉴权 / 计费 / 插件市场
- 端到端加密（E2EE）、光标 presence
- 单元测试全覆盖（只保关键机制验证脚本）

---

**维护规则**：功能状态变更时更新本表（AI 每次交付功能后同步勾选）；新想法先进 💡 backlog，拍板后进 `PROJECT.md` 里程碑再动工。
