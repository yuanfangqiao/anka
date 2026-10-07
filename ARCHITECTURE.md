# ARCHITECTURE.md · 技术架构

> 最后更新：2026-10-04 ｜ 对应阶段 M15（对话真实化：多会话 / 多轮 / 可终止）｜ 与 `PROJECT.md` 里程碑对齐

## 1. 总览

```
┌────────────────────── web (Vue 3 + Vite, PWA) ──────────────────────┐
│ App.vue 布局调度 ── useBreakpoint ──┬── ≤768px: MobileShell         │
│                                     │      TopBar + AppFrame + Dock  │
│                                     └── >768px: DesktopShell         │
│                               SideBar + MainWindow + BottomDock      │
│ useAppRegistry（应用元数据）── 驱动 dock（双端共用）与 sidebar        │
│ services/api.ts ── fetch ──▶ /api                                    │
└───────────────────────────────┬──────────────────────────────────────┘
                     JSON (REST) │  SSE (对话, M4)
┌───────────────────────────────▼──────────────────────────────────────┐
│ server (FastAPI + Uvicorn)                                           │
│  api/  health.py  plugins.py  chat.py(M4)                            │
│  PluginManager ── asyncio.Lock + asyncio.to_thread ──┐ 并发串行化     │
│  cordis/  Loader · Fiber · Context · Events · Service · Registry     │
│  plugins/ llm-runtime · llm-echo · llm-tokenhub · tools-runtime ·    │
│           tool-bash · agent-loop · llm-logger · harness-tools ·      │
│           harness-guard · session-log                                │
└──────────────────────────────────────────────────────────────────────┘
```

技术选型：**Python 3.11+ / FastAPI / Uvicorn**（后端）、**Vue 3 + TypeScript + Vite 5 + Tailwind 3.4**（前端）、**vite-plugin-pwa（Workbox）**（PWA）。

## 2. 目录结构（目标态）

```
pwa-demo/
├── IDEA.md  PROJECT.md  ARCHITECTURE.md  AGENT.md  README.md
├── agent-architecture.drawio.png
├── reference/                    # 只读参考资料（禁止修改）
└── server/                       # 后端
    ├── requirements.txt
    ├── run_dev.py                # 本地开发入口（uvicorn --reload）
    └── app/
        ├── main.py               # FastAPI 入口：lifespan bootstrap、挂载 dist、SPA 回退
        ├── settings.py           # 插件启用表（对应 cordis.yml）+ 端口/静态目录
        ├── deps.py               # 依赖注入：PluginManager 单例 + asyncio.Lock
        ├── plugin_manager.py     # Loader 封装：list/status/enable/disable + 级联记录
        ├── schemas.py            # Pydantic：PluginInfo / PluginActionResult / Health
        ├── logging_conf.py
        ├── cordis/               # 移植自 reference/cordis-mini/cordis
        │   ├── context.py  service.py  fiber.py  events.py  loader.py  registry.py
        │   └── PATCHES.md        # 相对原版的每处改动
        ├── plugins/              # 十个 infra 插件（llm-tokenhub 为真实模型，Echo 为兜底）
        └── api/  health.py  plugins.py  chat.py
└── web/                          # 前端
    ├── package.json  vite.config.ts  tsconfig.json  index.html
    ├── public/icons/             # 192/512/maskable/apple-touch-icon/favicon
    └── src/
        ├── main.ts  App.vue
        ├── styles/               # tokens.css + base.css
        ├── router/index.ts
        ├── composables/          # useBreakpoint / useTheme / useAppRegistry
        ├── layouts/              # MobileShell.vue / DesktopShell.vue
        ├── components/           # DockBar / SideBar / TopBar / AppFrame / ui/*
        ├── services/api.ts
        └── views/                # Chat / Notes / Explore / Plugins / Tasks /
                                  # Network / Workspace / Settings
```

## 3. 后端：插件内核

### 3.1 内核来源

`server/app/cordis/` 由 `reference/cordis-mini/cordis/` **整体复制（vendor）**而来，而非跨目录 import。理由：`reference/` 是只读资料，跨目录 import 需污染 `sys.path`，且无法随服务端演进。

### 3.2 五种机制（原样保留）

| 机制 | 实现位置 | 要点 |
|------|----------|------|
| 一切皆插件 | `registry.py:extract_plugin_meta` | Service 子类 → `is_service=True`，`provide` 默认 `[name]`；函数插件需 `name` + `apply` |
| Context 是服务仓库 | `context.py:ProxyContext.__getattr__` | 查 fiber 本地 store → 沿 `parent_fiber` 上溯 → 全局 `reflect._store` → 抛 `AttributeError`；`ctx.get(name)` 返回 None 表示可选 |
| inject 声明依赖 | `loader.py:_topo_sort` | Kahn 算法；`provide_map` 建立「服务 → 提供者」，配置书写顺序无关 |
| 五种事件分发 | `events.py` | `emit`（广播）/ `parallel`（ThreadPool + `ExceptionGroup`）/ `serial`/`bail`（短路）/ `waterfall`（洋葱，listener 必须调 `next_fn()`） |
| 可逆副作用 | `fiber.py:effect` + `_run_disposers` | setup 返回 teardown 入栈，卸载时**逆序**执行，等同事务 ROLLBACK |

状态机：`PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`（另有 `FAILED`），见 `fiber.py:21-27`。

### 3.3 移植时必须修改的点

| 位置 | 现状 | 改法 |
|------|------|------|
| `loader.py:41` | `mod_name = f'plugins.{filename[:-3]}'` 硬编码包名 | `bootstrap(config, package='app.plugins', plugins_dir=...)` 参数化 |
| `loader.py:48` | `print(f'  ! scan failed ...')` | 改标准库 `logging` |
| `fiber.py:147` | teardown 异常 `print` | 改 `logging.exception` |
| `loader.py:127` | `unload_plugin` 只置 `DISPOSED`，无恢复路径，且不记录级联者 | 由 `PluginManager` 在外层补齐（见 3.5） |
| `events.py:127` | `on()` 兜底取「最后一个 active fiber」 | 多线程下不可靠，调用方必须显式走 `ctx.events`（`BoundEventsProxy` 自动带 fiber） |
| 全局状态 | `reflect._store` / `registry['fibers']` 全同步 | 统一串行化，见 3.4 |

### 3.4 同步内核 ↔ 异步服务

`Loader.bootstrap / unload_plugin / fiber._refresh` 均同步且改全局状态。约定：

```python
async with _lock:                      # asyncio.Lock，串行化所有内核变更
    await asyncio.to_thread(manager.disable, name)   # 不阻塞事件循环
```

MVP 阶段插件只在 `lifespan` 启动时 bootstrap 一次，热路径无 to_thread 开销。

### 3.5 PluginManager 需要补齐的能力

`disable(name)`：调 `Loader.unload_plugin`，并**返回被级联卸载的依赖者名单**（`Fiber.unload` 会卸载所有 inject 了该插件 provide 服务的 fiber，见 `fiber.py:162-167`），供前端提示。

`enable(name)`： cordis-mini 原生没有反向路径，需按序实现：
1. 从 `Loader._plugin_metas` 取回 `PluginMeta`
2. 清理 `registry['fibers']` 与 `reflect._all_fibers` 中该插件及其级联者的 `DISPOSED` 记录（否则 `ReflectService.provide` 会抛 `service "x" already registered`，见 `context.py:88-92`）
3. 按 `_topo_sort` 顺序重建 fiber（依赖者自动重载）
4. 失败时状态置 `FAILED` 并返回错误信息

`list()`：读取 fiber 快照（`name / state / inject / provide / is_service / len(_disposables)`），拓扑排序仅在变更时计算，GET 不重复算。

### 3.6 插件清单（MVP）

| 插件 | 类型 | inject | provide |
|------|------|--------|---------|
| `llm-runtime` | Service | — | `llm` |
| `llm-echo` | 函数 | `llm` | —（注册 echo adapter，兜底） |
| `llm-tokenhub` | 函数 | `llm` | —（注册 13 模型真实 adapter） |
| `tools-runtime` | Service | — | `tools` |
| `tool-bash` | 函数 | `tools` | —（注册 bash 工具） |
| `agent-loop` | Service | `llm`, `tools` | `agents` |
| `llm-logger` | 函数 | `llm` | —（waterfall 惰性包裹 stream） |
| `harness-tools` | 函数 | `tools` | —（fs 读写/脚手架/校验/装卸） |
| `harness-guard` | 函数 | `tools` | —（`tools/pre-execute` 单调护栏） |
| `session-log` | 函数 | `tools` | —（append-only 会话日志） |

Fake LLM：`llm-echo` 提供 Echo Adapter，可返回 text 或 tool_call。**新增真实模型只需加一个 `llm-xxx` 插件调 `ctx.llm.register_adapter([...], Adapter())`**，内核零改动——这是「预留 LLM Adapter 接口」的落点（`llm-tokenhub` 即首个实例）。

### 3.7 API 契约

```http
GET /api/health
→ { "status": "ok", "plugins_total": 15, "plugins_active": 15 }

GET /api/plugins
→ [ { "name": "llm-runtime", "state": "ACTIVE",
      "inject": [], "provide": ["llm"], "is_service": true, "effects": 1 } ]

POST /api/plugins/{name}/disable
→ { "name": "llm-runtime", "ok": true, "state": "DISPOSED",
    "cascaded": ["llm-echo", "agent-loop", "llm-logger"] }

POST /api/plugins/{name}/enable
→ { "name": "llm-runtime", "ok": true, "state": "ACTIVE", "cascaded": [...] }

POST /api/chat            # M17：启动 run，立即返回 { run_id, session_id }
# body: { message, model, max_turns, session_id?, image? }   # image: 截屏 data URL
GET  /api/runs                    # M17：run 摘要（active 供刷新后重挂）
GET  /api/runs/{id}/stream?after=N  # M17：SSE 重放 after 之后的事件 + 现场续传
# 事件序：(status.thinking | text_delta | tool_call | tool_result)* → done
# 断连不取消（后台续跑），重连带 after=游标无重无漏；仅 stop 终止
POST /api/runs/{id}/stop          # M17：置 cancel，worker 在下一 chunk 处停下

GET  /api/sessions              # M15：会话摘要 [{id,title,updated_at,count}]（日志投影）
GET  /api/sessions/{id}         # M15：会话气泡历史 [{role,text,tools[]}]
DELETE /api/sessions/{id}       # M15：删除会话日志文件
```

### 3.8 部署形态

- 开发：Vite dev server（5173）proxy `/api` → FastAPI（8000），双进程
- 生产：`npm run build` → uvicorn 单进程托管 `web/dist`：`/assets` 走 `StaticFiles`，其余非 `/api` 请求回退 `index.html`（支持 SPA 深链）

## 4. 前端：布局壳

### 4.1 布局调度（与 agent-architecture.drawio.png 对齐）

`App.vue` 内**唯一分支**：

```ts
const { isMobile } = useBreakpoint()   // matchMedia('(max-width: 768px)') + ResizeObserver 兜底
// isMobile ? <MobileShell> : <DesktopShell>，两者内部都是 <RouterView>
```

- **手机形态**：顶部「返回」（左）+「设置」（右）；`TopBar` 采用 **iOS 大标题导航（Large Title）**——页面顶部大标题，内容滚动时平滑收缩为小标题（滚动监听 + transform/opacity 过渡）；中间 `AppFrame` 内容卡；底部 `DockBar`（笔记 / 对话 / 探索），毛玻璃 + 安全区
- **桌面形态**：左侧竖向圆角胶囊 `SideBar`（插件 / 任务 / 网络 / 工作区）+ 右侧大圆角主窗口；**主窗口下方底部居中同样渲染 `DockBar`（笔记 / 对话 / 探索）**——dock 与手机共用同一组件，仅容器样式不同（无安全区、间距更松）
```

不做两套页面，避免重复实现。

### 4.2 应用注册表（前端版「一切皆插件」）

```ts
export interface AppMeta {
  id: string; title: string; icon: string
  route: string; order: number
  showOn: 'mobile' | 'desktop' | 'both'
}
```

注册表分组（与架构图一致）：
- **dock 组**（笔记 / 对话 / 探索，`showOn: 'both'`）：`DockBar` 在手机端贴底、桌面端**主窗口下方居中**，两种壳共用同一组件，只差容器样式（桌面无安全区 padding）
- **sidebar 组**（插件 / 任务 / 网络 / 工作区，`showOn: 'desktop'`）：桌面 `SideBar` 竖向胶囊排列；手机端从设置页进入
- 设置（`showOn: 'both'`，不进 dock）：手机在 TopBar 右上角齿轮；桌面在窗口工具条

新增页面 = push 一条元数据，`DockBar.vue` / `SideBar.vue` 零改动。

### 4.3 路由

`/chat` `/notes` `/explore` `/plugins` `/tasks` `/network` `/workspace` `/settings`，默认重定向 `/chat`。

### 4.4 依赖清单（`web/package.json`）

```
vue ^3.4   vue-router ^4.3   typescript ^5.5   vite ^5.4
@vitejs/plugin-vue ^5.1
tailwindcss 3.4.17   postcss ^8.5   autoprefixer ^10.4   tailwindcss-animate ^1.0.7
vite-plugin-pwa ^0.20   lucide-vue-next ^0.4   @vueuse/core ^11
```

> 图标统一用 `lucide-vue-next`；如需品牌图标再引入 `@fortawesome/vue-fontawesome`。

### 4.5 依赖清单（`server/requirements.txt`）

```
fastapi>=0.112
uvicorn[standard]>=0.30
httpx>=0.27        # 后续接真实 LLM
```

## 5. PWA 配置要点

- `vite-plugin-pwa`：`registerType: 'autoUpdate'`、`injectRegister: 'auto'`、`devOptions.enabled: true`（本机 http 调试）
- manifest：`name / short_name / start_url "/" / scope "/" / display "standalone" / theme_color "#0B0E14" / background_color "#0B0E14"`，图标 192/512 + maskable + apple-touch-icon
- Workbox：App Shell 与静态资源预缓存；`/api` GET → `NetworkFirst`（`networkTimeoutSeconds: 5`）并兜底缓存
- 移动端：`index.html` 加 `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`；dock 用 `pb-[env(safe-area-inset-bottom)]`
- 安装前提：https 或 localhost（本机开发用 localhost）

## 6. 设计 token

```
primary    #5B8CFF / #7AA7FF / #3DDAD7        background  #0B0E14 / #151A24 / #1E2634
text       #F2F5FA / #A7B0C0 / #6B7488        functional  #35C88A(ok) #F5B84D(warn) #FF5A6A(err)
字体       PingFang SC；标题 22/600，副标题 16/500，正文 14/400
卡片       radius 18px + 1px 半透明描边 + 双层柔和阴影
毛玻璃     backdrop-filter: blur(20px)（dock / sidebar）
动效       200ms 级：缩放 0.96→1 + 位移 8px + 透明度
```

## 8. App 插件模型（M6 重构，2026-09-30）

> 本节优先级高于第 2/4 节中与之冲突的描述（静态注册表、固定侧边栏等已废弃）。

### 8.1 三层插件模型

```
内核（不可卸载）：cordis / PluginManager + FolderScanner / FastAPI / PWA 壳 + 前端宿主
  ├─ infra 插件（server/app/plugins/，扁平 .py，无 UI）：llm-runtime 等 6 个，不动
  ├─ system-plugins（system-plugins/<name>/plugin.json，UI 静态捆入内核 web/src/system/）：
  │   chat / plugins-manager / settings —— system: true，可禁用(backlog)不可卸载
  └─ app 插件（plugins/<name>/，前后端一体，可动态装卸）：notes / explore / …
```

infra 扁平插件与 folder 插件是两类插件源，共存于同一个 `_plugin_metas`。

### 8.2 插件包契约

```jsonc
// plugins/notes/plugin.json
{
  "id": "notes", "name": "笔记", "icon": "notebook-pen",
  "system": false, "version": "0.1.0",
  "backend": { "entry": "server/main.py" },        // apply(ctx)/Service，extract_plugin_meta 原样复用
  "ui": { "entry": "web/index.js", "dock": { "order": 10 }, "sidebar": true }
}
```

- 后端加载：`importlib.util.spec_from_file_location(f'app_plugins.{id}', entry)`；`meta.name` 必须等于 `id`
- 前端加载：`import(entry)`（`@vite-ignore`）——开发态 entry 为 `/plugins/<id>/web/index.ts`（vite 中间件即时编译）；生产态 entry 为 `/plugin-dist/<id>/index.js`（安装时编译产物，见 §8.8）
- **uiCtx 依赖注入**：插件不 import 任何 npm 包，`setup(uiCtx)` 从 `uiCtx.vue`（h/ref/computed…）、`uiCtx.components`（BaseCard 等设计系统组件）、`uiCtx.api`、`uiCtx.toast` 取一切——这是无构建器插件 UI 的关键决策
- **页面组件必须单一元素根**（Teleport 包进唯一根 div）；路由过渡禁用 `mode="out-in"`（详见 AGENT.md 红线 #8/#9 与 CHANGELOG M8.1）
- 后端数据通道（通用契约，非插件私有路由）：Service 实现 `snapshot()` → `GET /api/apps/{id}/state`；`POST /api/apps/{id}/call {method,args}` → 调 Service 公开方法（`_` 开头拒绝）

### 8.3 安装 / 卸载 / 热语义

- 发现：`FolderScanner` 扫描 `plugins/*/plugin.json` → 可安装清单（启动缓存，装卸后失效重建）
- 持久化：`server/data/installed.json`（已安装 id 列表，默认 `["notes","explore"]`）
- 安装：校验 → import → `extract_plugin_meta` → 注册进 `_plugin_metas` → `_load` → 写 installed.json；**同名曾加载过 → `requires_restart: true`**（in-memory `_ever_loaded` 判定，重启后清零）
- 卸载：`disable`（含级联记录）→ 摘除 meta 与 fiber（`remove_fiber` + `discard_fiber`）→ 移出 installed.json；前端 `unregisterApp`（removeRoute + 注册表摘除），**刷新后彻底干净**
- 启停（enable/disable）语义对 app 插件不变（保留 meta 仅 fiber 状态切换）

### 8.4 前端宿主启动链

```
main.ts → 静态注册系统插件（同一 uiCtx，dogfooding）
  → GET /api/apps → 逐个 import(entry) → setup(uiCtx)
  → registerApp: 注册表 + router.addRoute；registerSidebar: 工作栏组件
  → '/' 路由：有 app 插件 → 重定向首个 dock 应用；无 → EmptyHome 空态
```

### 8.5 壳层渲染模型（M7 修订：布局权下放）

内核壳层只提供两样东西：**macOS 风格 dock + 主窗口**，其余全部由 App 自绘。

- **DockBar（macOS 化）**：悬浮玻璃胶囊，图标为 44px 渐变圆角方块；悬停放大 1.35/相邻 1.18/次相邻 1.06（transform-origin: bottom，160ms cubic-bezier）；图标下方运行/活动指示点；桌面 hover tooltip；>5 个横滑 + 渐隐；手机端无 hover，保留文字标签与安全区
- **DesktopShell**：深色桌面 + 大圆角玻璃主窗口（极简标题条：当前 App 图标+名称+「插件管理」入口）；标题条以下整块交给当前 App 组件——左右分栏或全屏由 App 自己决定（内核不再渲染任何工作栏）
- **MobileShell**：TopBar（左「返回」仅非 dock 系统页 / 右「设置」）+ 内容区（整块归 App）+ 底部 dock
- **App 自绘约定**：uiCtx 注入 `layout: { isMobile, isWide }`（共享 matchMedia）与 `components.BasePanel`（左栏统一容器）；手机端需要面板时由 App 内部 Teleport 自绘（复用 `.glass-panel` + 200ms 过渡）
- **已废弃**：内核 per-app 工作栏、`registerSidebar` API、WorkDrawer 组件；`/api/apps` 的 `has_sidebar` 字段保留标废弃
- catch-all → 首个 dock 应用；卸载当前所在 App → 先跳转再摘除

### 8.6 PWA 缓存（M8 修订）

- **SW 仅生产构建启用**（`devOptions.enabled: false`）——dev SW 缓存旧壳会导致已安装 PWA 切换应用「加载失败」；安装请走 `http://localhost:8000`（FastAPI 托管 dist，深链由 SPA 回退兜底）
- `cleanupOutdatedCaches: true` 清理旧版本缓存
- `globIgnores: ['**/plugins/**']`；`/plugins/.*` 与 `/api/.*` GET 均 NetworkFirst——避免 SW 预缓存导致装卸后拿到旧 bundle
- manifest `display_override: [window-controls-overlay, standalone]`

### 8.7 git 插件目录与设置项约定（M8）

- **git 插件**：第三方插件是独立 git 仓库，clone 进 `plugins/<name>/`，内含 `server/`（python）+ `web/`（vue/ts 源码）；启动时按 `installed.json` 自动加载（生产管线见 §8.8）
- **设置项归处**：全局设置集中在 dock「设置」应用；插件设置推荐以声明式 schema 注册进设置应用的插件分区（iOS 风格，后续实现），当前阶段放插件自己页面内
- **iframe 插件约定（M10.8 拍板）**：内嵌第三方站点的 iframe 一律加 `sandbox="allow-scripts allow-same-origin allow-forms"`——不给 `allow-popups`（外链新开页被拦截，不脱离 PWA）、不给 `allow-top-navigation`（顶层不可被导航走）。跨域 iframe 是黑盒，无法把外链改道进 iframe（对方 `target` 不可改 + 外站 XFO 双重锁），故「外链在应用内浏览」仅后端代理可解（暂不做）；站内自导航不受影响。工具条提供「新窗口打开」作为外链出口

### 8.8 插件前端生产管线（M9：安装时编译）

**目标**：插件前端可写 Vue SFC + TypeScript，生产态无需插件作者预编译。

```
开发态（run_dev.py 默认，AGENTOS_DEV=1）
  entry = /plugins/<id>/web/<entry>   ← vite 中间件 transformRequest 即时编译（含 HMR）

生产态（run_dev.py --prod / uvicorn 直跑）
  bootstrap/install → plugin_builder.build_web(id)
    → node web/scripts/build-plugin.mjs <id>（vite 程序化构建，内部 esbuild）
    → .plugin-dist/<id>/index.js（单文件 ESM，'vue' external）
  entry = /plugin-dist/<id>/index.js   ← FastAPI mount /plugin-dist 伺服
```

**单 Vue 实例保证（微前端标准解法）**：
- 宿主 `vite build` 对 `vue` 做 `rollupOptions.external`（chunk 保留裸 import）
- `web/shared/vue.ts`（`export * from 'vue'`）构建为 `dist/shared/vue.js`（`build` 脚本前置 `build-shared.mjs`）
- `index.html` 注入 import map：`{"imports":{"vue":"/shared/vue.js"}}` —— 宿主 chunk 与插件 bundle 的裸 `import 'vue'` 解析到同一模块
- 弃选：浏览器运行时编译（带 compiler、慢）；要求作者预编译 dist（门槛高）

**其他**：卸载时同步删除 `.plugin-dist/<id>/`；workbox 对 `/plugin-dist/` NetworkFirst（不预缓存，装卸后拿最新）；`/shared/vue.js` 随主构建预缓存（离线可用）。

### 8.9 任意文件夹即应用（M11：page 降级形态）

**定位**：AI Agent OS 的核心承诺——`plugins/` 下**任意可伺服的静态页面目录**，即使完全没有 `plugin.json`，也自动成为一个应用。

**发现规则**（`FolderScanner`）：
- 有 `plugin.json` → 一等公民 App（现行链路：`setup(uiCtx)` 原生渲染）
- 无 `plugin.json` → 降级探测 `index.html` / `dist/index.html` / `web/index.html`（按优先级）→ **page 类 manifest**：
  - `id = name = 目录名`，`icon = package`（默认），`route = /app/<目录名>`（无声明时），`order = 100`
  - 无后端、无编译（要求自包含：单 HTML 或带相对资源的静态产物；**不支持自动 npm build**——作者提交 dist）
  - 三者皆无 → 忽略并打日志

**运行时**：
- `AppInfo.kind: 'app' | 'page'` 下发；`pluginHost` 对 page 类不 `import(entry)`，直接注册内核通用组件 `WebViewPage.vue`（同源 iframe，**不加 sandbox**：同源下 `allow-scripts+allow-same-origin` 零隔离收益，只会拦掉第三方 SPA 的 SW 注册/剪贴板等能力 → 白屏；跨源 iframe 才用 sandbox 白名单，见 M10.8）
- **同源红利**：page 页面内可直接 `fetch('/api/...')` 调内核能力（无需 uiCtx）
- 伺服：dev 由 vite 中间件（mime 表含 `.html`）；prod 由 FastAPI `mount('/plugins')`——**两态 URL 一致**，page 类不需要 `.plugin-dist`
- **绝对路径改写（M11.1）**：第三方构建产物常 `base="/"`（如 excalidraw dist 引用 `/assets/x.js`），挂上 `/plugins/<id>/` 后会去站点根找 → 404。两态伺服都对 `.html` 做改写：注入 `<base href="/plugins/<id>/<dir>/">` + `src|href="/X"` → `/plugins/<id>/<dir>/X`。FastAPI 侧是 `serve_plugin_html` 路由（须先于 `mount('/plugins')` 注册），vite 侧在 `serveAppPlugins` 中间件——**改一边不算修完**
- **PWA 红线（M11.1）**：workbox `navigateFallback` 生成的 `NavigationRoute` 在 sw.js 里注册最前，会截胡 iframe 的 navigation 请求 → 插件页拿到壳的 index.html → 壳在 iframe 里递归嵌套。必须配 `navigateFallbackDenylist: [/^\/api\//, /^\/plugins\//, /^\/plugin-dist\//]`
- 启停：page 类无 fiber，enable/disable 为 no-op；卸载 = 移出 installed.json
- 样例：`plugins/clock`（单文件时钟，演示同源调 API）、`plugins/snake/dist`（分离资源贪吃蛇，演示 dist 形态）、`plugins/excalidraw/dist`（完整第三方 React SPA，演示绝对路径改写；接入实录见 CHANGELOG M11.1）

## 9. 模型接入与自我插件开发（M13/M14）

### 9.1 真实模型（M13：TokenHub）

- **端点**：13 模型 ID 全走同一 OpenAI 兼容端点 `POST {TOKENHUB_BASE_URL}/chat/completions`，`stream:true` + `tools`，Bearer 认证
- **adapter seam**：`llm-tokenhub` 逐 chunk 解析 SSE（`delta.content`→`text_delta`、`delta.tool_calls`→`tool_call`），yield 不物化；模型 ID 前缀注册进 `ctx.llm`
- **凭据 seam**：`get_api_key()` 每次请求解析（env 优先、`credentials.json` 兜底）；`GET /api/settings` 只回脱敏 `sk-tp-***`，`POST` 只写不回读——轮换即时生效，Key 永不回传/入日志
- **默认模型**：`DEFAULT_MODEL`（`tc-code-latest`）服务端持久于 `settings.json`；前端下拉 localStorage 即时 + `POST /api/settings` 持久
- **function calling**：`ctx.tools.defs()` 返回 OpenAI 工具定义传给 `stream(tools=...)`；assistant 消息含 `tool_calls`，tool 结果带 `tool_call_id`

### 9.2 自我插件开发（M14：Harness）

- **工具集**（`harness-tools`）：`fs_list/fs_read/fs_write`（写前备份 `.plugin-backup/<id>/<ts>/`）、`plugin_scaffold/verify/install/uninstall/reload/list`；`plugin_verify` 在**子进程 + 一次性上下文**里 `apply()` 跑 smoke，通过才允许 install（隔离试载，不污染主进程）
- **护栏**（`harness-guard`，挂 `tools/pre-execute` 单调守卫）：路径 containment 限制写区仅 `plugins/`；拒绝 `server/app/plugins/`（infra）与护栏/日志/审批源码；bash 危险命令黑名单——**一旦 denied 不可被后续放行**
- **无重启 reload**：`folder_loader.evict_module()` 驱逐模块 + `PluginManager.reload_plugin()` 备份→级联卸载→摘 meta/fiber→重载→失败回滚；`deps.kernel_rlock`（`threading.RLock`）跨线程串行化
- **会话日志**（`session-log`）：append-only JSONL（`server/data/sessions/`），hook `llm/stream` 与 `tools/post-execute`；`derive_messages()` 投影模型历史——「模型可见即已记录」的权威事件源
- **可编辑边界**：可编辑 = `plugins/`（app 插件）；不可编辑 = 评估器/审批/日志/护栏/回归集（`server/app/`）

### 9.3 对话真实化与终止（M15）

- **多会话**：前端持 `session_id`（首轮为空，后端在 `session` 事件下发）；chat worker 起跑前 `session_log.bind()`，同一对话所有轮次写入同一 `sessions/<id>.jsonl`
- **多轮上下文**：`derive_messages(session_id)` 取最后一条 `request` 的权威 messages，补上其后最终 assistant 回复 → 交给 `agent_loop.run(history=...)`（system 由本轮重新注入，避免重复）
- **投影**：`session_messages()` 把 OpenAI 格式 messages 转成 UI 气泡（user/assistant 文本 + 工具卡，tool 结果回填到对应 tool_call）
- **终止**：`cancel`（`threading.Event`）由 chat 层创建；客户端断连时 SSE 生成器 `finally` 置位 → `agent_loop` 在下一 chunk / 下一轮开头返回已产出文本并 emit `stopped`。前端 `AbortController` 断开连接并即时解锁 UI
- **单写者**：日志 append-only，只追加不修改；删除即移除整份文件

## 7. 关键约束（写代码时必须遵守）

1. `reference/` 只读，不得修改、不得作为运行时 import 路径
2. 业务能力必须写成插件，禁止在 `main.py` 里塞业务逻辑
3. 内核（同步）与 FastAPI（异步）之间只允许通过 `PluginManager` + `asyncio.Lock` + `to_thread` 交互
4. 所有副作用注册到 `fiber.effect`，禁止裸改全局状态
5. 任何 talk to LLM 的代码都走 `ctx.llm` 服务，不出现具体 provider SDK 调用
6. 单个文件不超过 300 行，超出即拆分
