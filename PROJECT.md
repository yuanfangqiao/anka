# PROJECT.md · 产品范围与里程碑

> 最后更新：2026-10-04 ｜ 当前状态：**M15 完成**（真实模型 + 自我插件开发 + 对话真实化/可终止）

## 1. 一句话定义

一个**可以安装到桌面/主屏幕的 PWA**，用最小成本演示「Agent = 一组可热插拔的插件」：手机形态是 dock 栏 + 主应用，桌面形态是侧边栏 + 主窗口；后端 Python 承载 Agent 内核，前端 Vue 承载界面壳。

## 2. 目标

- **演示插件架构**：让「everything is plugin」看得见——插件有列表、有依赖（inject → provide）、能热启停、会级联卸载
- **演示 PWA**：manifest + Service Worker + 离线 App Shell，mac/Win/iOS/Android 均可安装
- **演示双布局**：同一路由 + 同一套页面组件，手机/桌面只换外壳
- **控制复杂度**：Fake LLM 跑通全链路，架构上留好真实模型的插座位

非目标：做一个可用的真实 Agent 产品、多用户系统、鉴权计费、插件市场。

## 3. 用户与环境

| 维度 | 范围 |
|------|------|
| 客户端 | macOS / Windows 桌面浏览器（Chrome、Edge）；iOS Safari、Android Chrome |
| 形态 | PWA 独立窗口（`display: standalone`），无地址栏观感 |
| 屏幕 | 手机 360–430px 宽；桌面 ≥1024px（1280px 侧栏全展开） |
| 主题 | 暗色优先，明亮次之 |

## 4. 功能模块

### 4.1 外壳（M1 建成，M6 重构交互模型）
- **dock = 已安装的应用**：双端共用（手机贴底、桌面底部居中），手机最多显示 5 个、超出横向滑动
- **桌面左栏 = 当前 App 自己的工作栏**（对话→会话列表；笔记→文件夹/标签；插件→分类）；无声明 → 左栏隐藏、主窗口变宽
- **手机工作栏**：TopBar 左侧按钮上下文化（有工作栏 → 面板图标滑出左侧抽屉；无 → 返回）
- **空系统**：不装应用插件 → 主页为设计过的空态（EmptyHome），默认仅系统插件（对话/插件管理/设置）
- 全部入口由「应用注册表」元数据驱动，App 插件经 `setup(uiCtx)` 运行时注册

### 4.2 页面（MVP 占位，后续填充）
对话 / 笔记 / 探索 / 设置（手机可见）；插件 / 任务 / 网络 / 工作区（桌面侧栏，手机从设置进入）

### 4.3 管理能力
- `GET /api/health`：进程与插件计数
- `GET /api/plugins`：插件列表、状态、依赖、副作用数
- `POST /api/plugins/{name}/enable|disable`：热启停，返回被级联影响的插件名单

### 4.4 Agent 对话（后置）
SSE 流式输出，AgengLoop 消费 `llm` + `tools` 两个服务

## 5. 里程碑

| 里程碑 | 内容 | 验收标准 | 状态 |
|--------|------|----------|------|
| **M0** | 想法补全：`IDEA.md` / `PROJECT.md` / `ARCHITECTURE.md` / `AGENT.md` / `README.md` | 文档齐备、决策无二义 | ✅ 进行中 |
| **M1** | 双布局壳 + PWA | 390×844 显示 dock；1440×900 显示侧栏；localhost 可安装；离线打开仍有壳 | ⬜ |
| **M2** | 后端内核落地 | cordis 移植 + FastAPI bootstrap；`/api/health` 返回 6/6 活跃 | ⬜ |
| **M3** | 插件面板（查看 + 启停） | 列表显示 inject/provide；关闭 `llm-runtime` 级联 `agent-loop` 并提示；重新启用恢复 | ⬜ |
| **M4** | 对话流式 | SSE 打字机输出，Fake LLM 回声；tool_call 路径可见 | ⬜ |
| **M5+** | 已采纳：调用链可视化（对话页）、后台任务插件（任务页）、对话→笔记联动（笔记页）；backlog：网络 / 工作区、真实 LLM adapter、SQLite 持久化（均以 App 插件形态回归） | 各自独立验收 | ⬜ |
| **M6** | **App 插件模型重构**：插件 = 前后端一体文件夹；主系统空壳化；动态安装/卸载；dock=已安装应用（手机 5 个可横滑）；桌面左栏=当前 App 工作栏；手机左侧抽屉 | 空系统空态可见；notes/explore 可装卸且 dock 随动；左栏随 App 切换；双视口验证无报错 | ✅ 完成 |
| **M7** | **macOS 风格壳层重构**：dock 全面 macOS 化（波浪放大/运行点/tooltip）；主窗口布局权下放，各 App 自绘左右分栏或全屏；删除内核工作栏与手机抽屉 | 桌面/手机双视口 dock 与自绘布局正常；装卸链路 dock 随动；控制台无报错 | ✅ 完成 |
| **M8** | **壳层精修与 PWA 修复**：移除主窗口标题条、设置进 dock、dock 缩小、git 插件目录约定、切页白屏修复 | 切页正常无白屏；已安装 PWA 从生产构建重装 | ✅ 完成 |
| **M9** | **生产态插件管线**：install hook 用 esbuild 安装时编译插件 `web/` → 缓存产物；FastAPI mount `/plugins` 伺服；`import 'vue'` 映射宿主实例（防双 Vue）；插件前端 = Vue SFC + TS（dev 态即时编译已就绪） | 生产构建下安装/卸载 demo 插件可用且 dock 随动；插件内 vue 与宿主同实例；无控制台报错 | ✅ 完成（实际伺服路径为 `/plugin-dist/`，import map 共享 Vue） |
| **M10** | **GitHub 一键安装**：插件页输入仓库 URL → clone 进 `plugins/` → 复用现有 install API；升级 = 拉取更新 + 重装（沿用「需重启」语义提示） | 输入公开 GitHub 仓库 URL 可完成安装并出现在 dock | ⬜ |
| **M11** | **任意文件夹即应用**：无 plugin.json 的目录降级探测静态入口（index.html/dist）→ page 类应用（`/app/<目录名>`、默认图标、iframe 同源加载、可直接 fetch 内核 API）；不支持自动 npm build（作者提交 dist） | 丢入纯 HTML 目录与 dist 产物目录均自动出现在 dock 并可浏览/交互；dev/prod 双态一致；控制台无报错 | ✅ 完成 |
| **M13** | **TokenHub 真实模型接入**：13 模型 ID 全走同一 OpenAI 兼容端点（Bearer）；对话页下拉切换、设置页配 Key（脱敏 + 只写存储）；SSE 流式 + 工具调用全程可视 | 配置 Key 后对话走真实模型；无 Key 回退 Echo；切换模型即时生效且服务端持久 | ✅ 完成 |
| **M14** | **Harness 自我插件开发**：Agent 经工具读/写 `plugins/` → 脚手架 → 隔离试载校验 → 无重启安装/重载 → 回滚；护栏限可写区仅 `plugins/`；会话日志 append-only 权威事件源 | scaffold→verify→install→reload→uninstall 全链路通过；越界写入被护栏拦截；日志可投影模型历史 | ✅ 完成 |
| **M15** | **对话 UI 真实化**：真会话列表（`/api/sessions` 日志投影）、多轮上下文（`derive_messages`）、SSE 有序 blocks（文本+工具卡）、**可终止**（`AbortController` + 后端 `cancel`）、删除会话；移除全部 Mock | 侧栏会话可新建/切换/删除并持久；同一对话多轮记忆；发送中可一键终止且 UI 即时解锁；无硬编码消息/兜底回声 | ✅ 完成 |

> M2 与 M1 可并行：后端移植不依赖前端壳。

## 6. 验收清单（M1 用）

- [ ] `npm run build` 后产物含 `manifest.webmanifest` 与 `sw.js`
- [ ] 桌面 Chrome 出现安装按钮，安装后独立窗口启动
- [ ] 手机视口下 dock 贴底且不被手势条遮挡（安全区生效）
- [ ] 手机端 TopBar 为 iOS 大标题导航：页面顶部大标题，滚动时平滑收缩为小标题
- [ ] 断网刷新仍有 App Shell
- [ ] 窗口从 1440 拖到 400，布局切换不残留、无闪烁
- [ ] 桌面视口下主窗口下方居中显示「笔记 / 对话 / 探索」dock，与侧边栏互不遮挡
- [ ] 控制台无报错，`/api/health` 返回 ok

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| cordis-mini 是同步实现，FastAPI 是异步 | 统一 `asyncio.Lock` 串行 + `asyncio.to_thread` 执行，禁止在事件循环直调内核 |
| 卸载后重名服务注册冲突（`reflect.provide` 抛 duplicate） | `PluginManager.enable` 先清理已 DISPOSED 的 fiber 记录，再按拓扑序重建 |
| 页面堆积成「占位页坟场」 | 每个占位页至少 4 个真实区块，且先在 `PROJECT.md` 定义用途再实现 |
| Service Worker 缓存导致改动不生效 | 开发态 `devOptions.enabled` + autoUpdate，生产明确缓存策略 |

## 8. 待定的产品问题

- ~~桌面端两组入口的分工~~ **已解决（M6）**：dock 切换主窗口应用，左栏 = 当前 App 自己的工作栏
- 网络 / 工作区的真实用途尚未定义（以 App 插件形态回归时定义）
- 系统插件的「禁用」语义（M6 仅实现不可卸载；禁用列入 backlog）
- 长按 dock 进入抖动编辑模式（排序/卸载）——backlog
- 是否需要引入状态管理库 Pinia（目前 composable 够用）
