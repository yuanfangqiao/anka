# IDEA · PWA Agent 样例项目

> 最后更新：2026-09-30 ｜ 当前阶段：想法补全（M0，尚无业务代码）

---

## 一、原始想法（原文保留，不改写）

```
我当要做个PWA项目，是一个Agent项目的样例
实现以下功能点
1. 支持手机和电脑（mac和win）
2. 就是里面的web页面参照手机界面有dock栏和主应用
3. 项目先使用Python 和 vue 实现
4. 尽可能参照deepseek harness 的 everything is plugin 和 comfyui 启动加载插件单独参见的UI
5. 参考项目在 reference 文件夹下
```

配套素材：`agent-architecture.drawio.png`，界面事实如下——
- **手机视口**：顶部左「返回」、右「设置」；主内容区空白待填充；底部一行三个按钮「笔记 / 对话 / 探索」（dock）
- **桌面视口**：左侧竖向圆角胶囊侧边栏，从上到下排列「插件 / 任务 / 网络 / 工作区」；右侧为大圆角主窗口（当前承载「对话框」）；**主窗口下方底部居中同样保留「笔记 / 对话 / 探索」三个 dock 按钮**（与手机共用同一组应用入口）

---

## 二、已确认的补充决策（2026-09-30）

| # | 议题 | 决策 | 理由 |
|---|------|------|------|
| 1 | LLM 接入 | **先用 Fake LLM**：移植 Echo Adapter 跑通架构，LLM 能力抽象为 adapter 注册接口，之后可直接挂载真实模型 | 先把「插件机制」这个主角讲清楚，不引入 Key/网络/计费等噪声 |
| 2 | 前端插件页面 | **查看 + 启停**：插件列表、状态、inject/provide 依赖关系、副作用数；支持启用/禁用（热卸载，含级联提示） | ~~不做本地文件动态安装~~ ⚠️ **2026-09-30 修订**：升级为 App 插件模型，支持动态安装/卸载，见 3.9 |
| 3 | 后端框架 | **FastAPI**（+ Uvicorn） | 异步原生，SSE/WebSocket 一站到位，后续流式对话零改动 |
| 4 | MVP 里程碑 | **M1 = 双布局壳 + PWA**：手机 dock / 桌面侧边栏 + manifest + Service Worker + 可安装 | 先让「可安装的手机 OS 壳」跑起来，其余能力以占位页预留 |

---

## 三、需要补充进来的想法（原 IDEA 未覆盖但必须明确）

### 3.1 PWA 是本项目的一半，不能只写在标题里
- `manifest.webmanifest`：`name / short_name / icons(192/512/maskable) / start_url="/" / scope="/" / display="standalone" / theme_color`
- Service Worker：App Shell 预缓存 + 离线可用；`/api` GET 走 NetworkFirst（5s 超时兜底缓存）
- 可安装目标：mac / Win（Chrome、Edge 安装到桌面）、iOS Safari 添加到主屏幕、Android 添加到主屏
- 移动端细节：`viewport-fit=cover` + `env(safe-area-inset-bottom)`（dock 不被手势条遮挡）、独立图标、启动动画、暗色优先

### 3.2 双布局不是两套页面，而是一个壳两种形态
- 断点 ≤768px：手机形态（TopBar + AppFrame + 底部 DockBar）
- 断点 >768px：桌面形态（左侧 SideBar + 主窗口），>1280px 侧栏展开为全标签态
- 页面组件（View）两端复用，切换的只是外壳（Shell）——这是 `App.vue` 里唯一的分支

### 3.3 前后端都要「一切皆插件」
- 后端：Agent 全部能力由插件组成（`llm-runtime` / `llm-echo` / `tools-runtime` / `tool-bash` / `agent-loop` / `llm-logger`），按 inject 自动拓扑排序
- 前端：dock 与侧边栏都从**应用注册表**渲染（`id / title / icon / route / showOn`），新增一个应用 = 注册一条元数据，不改壳层代码

### 3.4 通信方式要先定死
- 管理类接口 RESTful JSON（`/api/health`、`/api/plugins`）
- 对话走 **SSE**（`/api/chat`），不用轮询；WebSocket 暂不需要
- 开发态 Vite dev server proxy `/api` → `http://localhost:8000`；生产态单进程 uvicorn 直接托管 `web/dist`

### 3.5 导航地图（先占位，后填充）
| 入口 | 形态 | MVP(M1) | 后续 |
|------|------|---------|------|
| 对话 Agent | 手机 dock + 桌面主窗口 | 占位页 | SSE 流式对话（M4）；调用链可视化（M5） |
| 笔记 Notes | 手机 dock | 占位页 | 对话→笔记联动（M5，应用间服务通信） |
| 探索 Explore | 手机 dock | 占位页 | M5+ |
| 插件 Plugins | 桌面侧栏 + 手机设置入口 | 占位 | 列表/依赖/启停（M3） |
| 任务 Tasks | 桌面侧栏 | 占位页 | 后台任务插件（M5，parallel 分发 + fiber 生命周期） |
| 网络 Network | 桌面侧栏 | 占位页 | M5+ |
| 工作区 Workspace | 桌面侧栏 | 占位页 | M5+ |
| 设置 Settings | 顶栏齿轮 | 主题/关于/安装状态 | — |

### 3.6 数据持久化
- MVP **不引入数据库**，状态只在内存（插件 fiber 快照）
- 后续若持久化：SQLite + SQLAlchemy 亦以「插件」形式接入，不写进内核

### 3.7 视觉取向
暗色优先的「移动 OS 壳 + 玻璃拟态」：毛玻璃 dock / 侧边栏、霓虹渐变点缀、200ms 级微动效（缩放 + 位移 + 透明度）。设计 token 见 `ARCHITECTURE.md`。

### 3.8 已采纳的扩展 IDEA（2026-09-30，排期 M5+）
| IDEA | 演示的机制 | 落点 |
|------|-----------|------|
| **调用链可视化** | waterfall 洋葱模型 | 对话页内嵌：每次 LLM 调用展开调用链，展示被哪些 listener 包裹、各层耗时 |
| **后台任务插件** | parallel 分发 + fiber 生命周期 | 「任务」页：长任务注册为后台 fiber，显示进度/状态；禁用任务插件 = 任务全部 teardown 回收 |
| **对话 → 笔记联动** | 应用间服务通信（前端注册表 + 后端 notes 服务） | 对话中 Agent 产出的内容一键「存为笔记」，直接在笔记页打开 |

设计规范补充（并入 M1，不占里程碑）：**手机端 TopBar 采用 iOS 大标题导航（Large Title）**——页面顶部大标题，滚动时收缩为小标题。

排期决策：以上功能项均在 M4 之后进入 M5+，M1–M4 范围不变。未采纳候选（实时事件流、工具确认、人机共享笔记、Adapter 热切换、工作区文件工具、Plan/Act 双模式、记忆插件、Dock 角标、左滑操作、底部 Sheet、inset grouped 设置页等）暂存 backlog。

### 3.9 App 插件模型（M6 重构，2026-09-30 拍板）

**核心转变**：插件从「后端能力单元」升级为「前后端一体的 App」。主系统空壳化——不装插件就是空系统（设计过的空态页，非白屏）。

| # | 议题 | 决策 |
|---|------|------|
| 1 | 系统插件 | 对话 + 插件管理 + 设置（self-hosting，标记 `system: true`，可禁用不可卸载） |
| 2 | dock 溢出 | 手机 dock 最多显示 5 个，超出纯横向滑动；安装管理全在插件页 |
| 3 | 热重装语义 | 首次安装即时生效；重装同名插件提示「需重启后端」；前端卸载后刷新彻底干净（对齐 ComfyUI/Koishi，不做 module eviction） |
| 4 | 手机工作栏 | TopBar 左侧按钮上下文化：当前 App 有工作栏 → 面板图标滑出左侧抽屉；无 → 返回 |

设计要点：
- **三层架构**：内核（不可卸载）→ system-plugins → `plugins/` 应用插件（可装卸）
- **插件包**：`plugins/<name>/` 含 `plugin.json` + `server/`（Python Service，复用 cordis）+ `web/index.ts`（TS 入口 + Vue SFC 界面，`setup(uiCtx)` 注册路由/dock）+ `assets/`（技术栈细节见 §3.10）
- **dock = 已安装的应用**（双端共用，手机贴底、桌面底部居中不变）
- **桌面左栏 = 当前 App 自己的工作栏**（顶部 App 图标+名称，切换 200ms 过渡；无声明 → 左栏隐藏、主窗口变宽）
- **插件页三分区**：运行中 / 可安装（扫描 `plugins/` 目录发现）/ 系统（锁标识）
- **卸载**：确认弹窗列出将停止的服务与级联影响；dock 图标即时消失；刷新后彻底干净
- **信任模型**：本地 `plugins/` 目录安装（M6 已实现）；后续支持 GitHub 仓库 URL 安装（= clone 进目录 + 复用 install，见 §3.10，M10）
- backlog：长按 dock 抖动编辑模式、边滑手势、系统插件禁用（M6 仅保证不可卸载）

### 3.10 插件前端技术栈与编译策略（2026-09-30 拍板）

**ComfyUI 式插件模型**：文件夹放进 `plugins/` 即被发现（manifest 校验），安装 = 文件到位 + install API；「GitHub 连接即安装」天然成立（M10 实现：clone 进目录 → 复用现有 install）。

**技术栈**：前端 **Vue 3 SFC + TypeScript**（入口 `web/index.ts`，界面 `.vue`），后端 **Python** Service。插件**不 import 任何 npm 依赖**——vue/components/icons/api/toast/layout 全部经 `uiCtx` 注入；`vue` 经内核 vite alias 解析到同一份依赖，保证单实例。

**两态编译**（关键决策）：

| 形态 | 方案 | 状态 |
|------|------|------|
| 开发态 | vite 中间件 `transformRequest` 按需编译 `.vue/.ts`（绝对路径 + 保留 SFC query），带 HMR | ✅ 已实现（demo 插件验证通过） |
| 生产态 | **安装时编译**：install hook 用 esbuild 构建插件 `web/` → 缓存产物；FastAPI mount `/plugins` 静态伺服；`import 'vue'` external 映射到宿主模块 URL，避免双 Vue 实例 | ✅ 已实现（M9，实际路径 `/plugin-dist/`，import map 共享 Vue） |

弃选方案：浏览器运行时编译（带 compiler、包大、慢、缓存差）；要求作者预编译 dist（ComfyUI 前端实质做法，插件作者门槛高）。

---

## 四、参考来源与本项目对应关系

| reference 目录 | 借鉴什么 | 落到哪里 |
|----------------|----------|----------|
| `reference/cordis-mini` | 五种插件机制的最小 Python 实现（~600 行，零依赖） | `server/app/cordis/`（内核）+ `server/app/plugins/`（插件） |
| `reference/ComfyUI_frontend` | 侧栏/面板/图标/主题分层与大量 Vue 组件组织方式 | `web/src/layouts`、`web/src/components`、UI 分层 |
| `reference/ComfyUI` | Python 端插件注册、节点/插件元信息暴露 | `server/app/plugin_manager.py` 的元数据构建思路 |

**约束**：`reference/` 只读，任何情况下不修改、不作为运行依赖被 import。

---

## 五、暂不做（明确边界，避免想太多）

- ~~本地插件文件动态安装（像 ComfyUI 装节点那样）~~ **已实现（M6）**：`plugins/` 目录扫描 + 动态装卸
- 真实 LLM API 调用（M4 之后预留接口再接）
- 多用户 / 鉴权 / 云数据库
- 单元测试全覆盖（只保证关键机制有可跑的验证脚本）

---

## 六、待定事项（不阻塞 M1）

1. 笔记/探索/任务/网络/工作区的具体功能定义（先占位）
2. 是否引入 Pinia（MVP 可用 composable 顶住）
3. 图标方案：lucide-vue-next 是否够用，是否需要自制 SVG 图标集
4. 是否需要 `.env` 配置（端口、后续 API Key）

---

## 七、文档索引

| 文件 | 作用 |
|------|------|
| `README.md` | 依赖清单与启动/验证命令 |
| `PROJECT.md` | 产品范围、里程碑、验收标准 |
| `ARCHITECTURE.md` | 技术实现方案与移植要点 |
| `AGENT.md` | AI Agent 在本仓库工作的约束与流程 |
