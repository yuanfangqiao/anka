# ARCHITECTURE.md · 技术架构

> 最后更新：2026-10-31 ｜ M21 应用运行时（保活 / 按需加载 / SDK / 分屏与嵌套），与 `PROJECT.md` 对齐

## 1. 总览

```
┌────────────────────── web (Vue 3 + Vite, PWA) ──────────────────────┐
│ App.vue ── AppShell → ApplicationWorkspace（按 appId 常驻窗口）          │
│              └── useBreakpoint ── <640px: 手机顶栏 + 内容 + Dock     │
│                                  ≥640px: 圆角主窗口 + 居中 Dock      │
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

技术选型：**Python 3.11+ / FastAPI / Uvicorn**（后端，承载 AgentOS 内核）、**Vue 3 + TypeScript + Vite 5 + Tailwind 3.4**（前端壳）、**vite-plugin-pwa（Workbox）**（前端的 PWA 交付形态：安装 + 离线）。

命名约定：**Anka** 是项目名，**AgentOS** 指这套「插件即单元」的操作系统实现方式，**PWA** 只是前端的当前交付形态；换掉前端壳不改变 AgentOS 的内核模型。

## 2. 目录结构（目标态）

持久数据、日志、缓存与运行目录的完整结构见 [存储目录规范](docs/STORAGE.md#目录结构)。
涉及存储的实现必须遵循该规范；本节主要描述程序源码结构。

```
anka/
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
        ├── layouts/              # AppShell.vue（双端共用，RouterView 常驻）
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
- 启动诊断：`start_all.sh` 复用 `scripts/startup-common.sh`，并行直连本机健康检查，
  记录阶段/总耗时到 `logs/startup.log`；探测绕过代理、有单次超时且检查进程存活。
  `startup_trace.py` 记录导入、内核锁和初始化耗时；`plugin_startup.py` 承担已安装
  插件启动，记录每个插件加载、产物复用或重建的原因；长构建每 5 秒输出耗时。

## 4. 前端：布局壳

### 4.1 布局与页面生命周期

`App.vue` 初始化 `useBreakpoint()`，常驻一个 `AppShell`。`isMobile` 由
`matchMedia('(max-width: 639px)')` 驱动，`isWide` 以 1280px 为断点。

- **手机形态**：非 dock、非全屏应用显示 `TopBar`；独立滚动内容区 + 带安全区的底部 dock。
- **桌面形态**：圆角玻璃主窗口 + 居中 dock；应用自己的工作栏由应用渲染。
- `ApplicationWorkspace → ApplicationSurface` 按 appId 保留独立界面与路由上下文；跨断点只改
  容器样式、顶栏显隐与 Dock 的 `desktop` 属性，不移动已创建的 iframe 节点。
  Android 游戏请求全屏并锁横屏时，也必须保留 iframe 元素、文档和运行中状态。
- 应用切换仅显隐；主动关闭或插件卸载销毁界面。具体见 §8.16 与 `docs/APP-RUNTIME.md`。

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

> 正典：**[`docs/PLUGIN-SPEC.md`](docs/PLUGIN-SPEC.md)**（manifest v2 字段表、kind 判定、
> 状态机、错误码、build 白名单）。本节只保留最小示意；两者冲突以 spec 为准。

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

- 分层：`PluginService`（扫描 / 安装决策 / ledger / 前端清单）+ `PluginManager`（装载 / 启停 / 重载），
  后者保留同名 facade；`docs/PLUGIN-SPEC.md` §1.1 是唯一的 kind 判定规则
- 发现：`FolderScanner` 扫描 `plugins/*/plugin.json` → 可安装清单（Service 缓存，装卸后失效重建）
- 持久化：`data/system/state/ledger.jsonl`（append-only 事件 + `ledger.snapshot.json` 投影，
  默认首次运行导入 `["notes","explore"]`）；`installed.json` 仅在迁移时读取，之后改名 `.json.bak`
- 安装：校验 → import → `extract_plugin_meta` → 注册进 `_plugin_metas` → `_load` → 追加 `installed` 事件；**同名曾加载过 → `requires_restart: true`**（in-memory `_ever_loaded` 判定，重启后清零）
- 卸载：`disable`（含级联记录）→ 摘除 meta 与 fiber（`remove_fiber` + `discard_fiber`）→ 追加 `uninstalled` 事件；前端 `unregisterApp`（removeRoute + 注册表摘除），**刷新后彻底干净**
- 离线工具：`cd server && python -m app.cli doctor|verify|pack`（不启服务，退出码 0/1/2）
- 启停（enable/disable）语义对 app 插件不变（保留 meta 仅 fiber 状态切换）

### 8.4 前端宿主启动链

```
main.ts → 静态注册系统插件（同一 uiCtx，dogfooding）
  → GET /api/apps → 注册轻量路由/图标 → 目标应用首次打开时 import(entry) → setup(scopedUiCtx)
  → registerApp: 注册表 + router.addRoute；registerSidebar: 工作栏组件
  → '/' 路由：有 app 插件 → 重定向首个 dock 应用；无 → EmptyHome 空态
```

### 8.5 壳层渲染模型（M7 修订：布局权下放）

内核提供 **Dock + 应用运行管理 + 主窗口/桌面分屏**，业务布局仍由 App 自绘。

- **DockBar（macOS 化）**：悬浮玻璃胶囊，图标为 44px 渐变圆角方块；悬停放大 1.35/相邻 1.18/次相邻 1.06（transform-origin: bottom，160ms cubic-bezier）；图标下方运行/活动指示点；桌面 hover tooltip；>5 个横滑 + 渐隐；手机端无 hover，保留文字标签与安全区
- **AppShell**：手机为可选 `TopBar` + 内容区 + 带安全区的 dock；桌面为圆角玻璃主窗口
  + 居中 dock。两种布局共用同一 `RouterView`，窗口缩放、横竖屏和全屏切换不重建应用。
- **App 自绘约定**：uiCtx 注入 `layout: { isMobile, isWide }`（共享 matchMedia）与 `components.BasePanel`（左栏统一容器）；手机端需要面板时由 App 内部 Teleport 自绘（复用 `.glass-panel` + 200ms 过渡）
- **已废弃**：内核 per-app 工作栏、`registerSidebar` API、WorkDrawer 组件；`/api/apps` 的 `has_sidebar` 字段保留标废弃
- catch-all → 首个 dock 应用；卸载当前所在 App → 先跳转再摘除

### 8.6 PWA 缓存（M8 修订）

- **SW 仅生产构建启用**（`devOptions.enabled: false`）——dev SW 缓存旧壳会导致已安装 PWA 切换应用「加载失败」；安装请走 `http://localhost:8000`（FastAPI 托管 dist，深链由 SPA 回退兜底）
- `cleanupOutdatedCaches: true` 清理旧版本缓存
- `globIgnores: ['**/plugins/**']`；`/plugins/.*` 与 `/api/.*` GET 均 NetworkFirst——避免 SW 预缓存导致装卸后拿到旧 bundle
- manifest `display_override: [window-controls-overlay, standalone]`

### 8.7 git 插件目录与设置项约定（M8）

- **git 插件**：第三方插件是独立 git 仓库，clone 进 `plugins/<name>/`，内含 `server/`（python）+ `web/`（vue/ts 源码）；启动时按 ledger 投影的已安装集合自动加载（生产管线见 §8.8）
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
- 启停：page 类无 fiber，enable/disable 为 no-op；卸载 = 追加 `uninstalled` 事件（ledger）
- 样例：`plugins/clock`（单文件时钟，演示同源调 API）、`plugins/snake/dist`（分离资源贪吃蛇，演示 dist 形态）、`plugins/excalidraw/dist`（完整第三方 React SPA，演示绝对路径改写；接入实录见 CHANGELOG M11.1）

### 8.10 应用导航与系统返回（2026-10-17）

- `router/appHistory.ts` 维护底部边界与当前应用两条记录，原生返回以 go 恢复已有 active 后分发给插件，禁止 pop 后 push 触发 Chromium 历史跳过。跨应用路由完成后同步边界 URL；恢复期间写入合并，保留 Vue Router 状态。
- `services/navigation.ts` 维护每个 `appId` 的逻辑路由栈与返回处理器；`uiCtx.navigation` 提供 `switchApp / push / replace / back / register / setHash`。切应用恢复其栈顶；根页面不回到其他插件。
- 壳层弹层优先，再处理当前插件的内部栈，最后处理本插件路由栈。未接入自绘导航的插件保持当前应用。
- Jot 接入内部栈；控制台接入手机二级返回；Dock/后台任务/创造模式统一切应用。插件宿主等待异步 setup，并在卸载时执行 teardown、清理导航。
- 导航位置保存于页面内存，刷新依当前 URL 恢复。SDK v1 提供 iframe 虚拟路由/返回桥；未接入 SDK 的任意第三方页面仍不承诺联合历史行为。
- 具体协议、插件示例、生命周期与验证方式见 [`docs/NAVIGATION.md`](docs/NAVIGATION.md)。此节取代旧章节中基于全局浏览器历史的应用切换说明。

### 8.11 Jot 媒体恢复与同步（2026-10-17）

- 插件 `useMedia.ts` / `MediaPreview.vue` 仅用 480px JPEG 展示图片/视频列表，接近视口时加载；点击后才加载原文件，URL 替换/卸载后释放。`thumbnails.ts` 本地补图，服务端 `ensure_thumbnail` 使用 FFmpeg 补生成历史/不可解码封面，秒传也返回小图路径。封面内容哈希命名、原子落盘，修复更新附件 rev。
- `visibilitychange` / `pageshow` / 联网 / 冷启动与下拉刷新触发媒体重建和元数据全量对账，不依赖 note rev 变化。
- Jot 单一 outbox 写路径，媒体先上传，失败队列保留；相同 rev 也修复匹配附件的缺失路径，不覆盖本地待传正文。
- `api.callApp` 增加可选第四参数 `{ signal }`，插件同步调用可设超时，防挂起请求阻塞后续同步；现有调用兼容。

### 8.12 插件房间、受限访客与独立运行时（M19）

- `plugins/rooms.py` 注册可逆的 `rooms` infra Service；实现拆分在 `rooms/` 的
  store/service/lobby/transport/security 模块中。游戏 App 通过 `fiber.effect`
  注册定义（编译入口、构建号、协议、地图、角色和角色消息白名单），卸载即注销。
- `api/rooms` 为薄适配层；最小 `/join` 页面兑换邀请，`/play` 只加载受保护的游戏产物。
  受限访客不进入账号壳、不获得通用 App 调用或文档同步权限；所有身份由服务端推导。
- 邀请 600 秒、一个客人席位、SQL 事务加服务锁原子兑换；凭证只存哈希。
  `anka_guest_session` 从兑换起有效 86400 秒，独立于邀请期限，Cookie 使用 HttpOnly、
  SameSite=Lax，HTTPS 下 Secure。创建/兑换限流、Origin 与 WS 消息权限均由宿主执行。
- 房间状态和连接在单 worker 内存中，能力存储在 `DATA_DIR/system/databases/rooms.sqlite3`；
  房间结束/插件停用撤销权限，服务器重启不恢复活跃比赛。API/访客入口绕过 SW 离线回退。
- App 自定义构建 recipe 在后端激活前执行；原生入口暂存构建后替换，失败保留旧版本。
  游戏运行时由插件独立 Vite 编译，iframe 只承载渲染和依赖，服务端承担权限边界。
  活跃房间禁止重建；`plugin_catalog.py` 与 `plugin_reloader.py` 分离清单与重载事务。
- 接口、生命周期、部署变量与验收边界见 [`docs/ROOMS.md`](docs/ROOMS.md)。

## 9. 模型接入与自我插件开发（M13/M14）

### 9.1 真实模型（M13：TokenHub）

- **端点**：13 模型 ID 全走同一 OpenAI 兼容端点 `POST {TOKENHUB_BASE_URL}/chat/completions`，`stream:true` + `tools`，Bearer 认证
- **adapter seam**：`llm-tokenhub` 逐 chunk 解析 SSE（`delta.content`→`text_delta`、`delta.tool_calls`→`tool_call`），yield 不物化；模型 ID 前缀注册进 `ctx.llm`
- **凭据 seam**：`get_api_key()` 每次请求解析（env 优先、`credentials.json` 兜底）；`GET /api/settings` 只回脱敏 `sk-tp-***`，`POST` 只写不回读——轮换即时生效，Key 永不回传/入日志
- **默认模型**：`DEFAULT_MODEL`（`tc-code-latest`）服务端持久于 `settings.json`；前端下拉 localStorage 即时 + `POST /api/settings` 持久
- **function calling**：`ctx.tools.defs()` 返回 OpenAI 工具定义传给 `stream(tools=...)`；assistant 消息含 `tool_calls`，tool 结果带 `tool_call_id`

### 9.2 自我插件开发（M14：Harness）

- **工具集**（`harness-tools`）：`fs_list/fs_read/fs_write`（写前保存在 `data/system/state/plugin-backups/<id>/<ts>/`）、`plugin_scaffold/verify/install/uninstall/reload/list`；`plugin_verify` 在**子进程 + 一次性上下文**里 `apply()` 跑 smoke，通过才允许 install（隔离试载，不污染主进程）
- **护栏**（`harness-guard`，挂 `tools/pre-execute` 单调守卫）：路径 containment 限制写区仅 `plugins/`；拒绝 `server/app/plugins/`（infra）与护栏/日志/审批源码；bash 危险命令黑名单——**一旦 denied 不可被后续放行**
- **无重启 reload**：`folder_loader.evict_module()` 驱逐模块 + `PluginManager.reload_plugin()` 备份→级联卸载→摘 meta/fiber→重载→失败回滚；`deps.kernel_rlock`（`threading.RLock`）跨线程串行化
- **会话日志**（`session-log`）：append-only JSONL（`data/ai/sessions/`），hook `llm/stream` 与 `tools/post-execute`；`derive_messages()` 投影模型历史——「模型可见即已记录」的权威事件源
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

## M20 · Device 手柄能力

`server/app/plugins/devices.py` 通过可逆 infra 服务提供 `ctx.devices`；`server/app/devices/` 分离授权、绑定、JSON 校验、队列、WS 和公开手柄页。User / Share / Device 分别鉴权，App 用 fiber effect 注册接入能力；一玩家一个设备。手机页位于 `web/controller/`，独立固件位于 `device/esp32/`，研究与设计位于用户指定的 `doc/mosaico/`。
扫码为同域 HTTPS 链接，WSS join 原子消费 bindKey/token，不需要 hello。输入经 Cookie 验证的游戏 receiver 桥接；150ms watchdog、neutral 恢复、有限队列和撤权避免失控。当前绑定为单 worker 内存状态，重启重扫。完整契约、部署及验证见 [docs/DEVICES.md](docs/DEVICES.md)。

ESP 应用通过官方 `mosaico_shared` 只读复用系统 Wi-Fi，启动即打开摄像头，服务器地址从二维码取得；没有独立 AP 配网或 host 输入。LVGL 界面仅图标，功能区拖动移动/短点动作，绑定后取消上下边缘导航，AI单击也不退出；未绑定时AI键经官方Recovery API返回Vibe Mode。官方 Iris USB 提供非敏感诊断、指针和屏幕帧读取，用于区分真实硬件状态与主机模拟测试。

摄像头路径对 DVP DMA 帧执行缓存同步：640×640中心亮度供 quirc，PPA将同一范围转为360×360 RGB565预览，方向与官方样例一致。构建阶段强制核对 SC101IOT PCLK 与 DVP 官方补丁，缺失即失败。滑动轨迹由不拦截输入的 LVGL 绘制层提供。设备重连在 await 接收后再次检查 channel 归属；手机缓存恢复使用内存 Device 凭证重连。完整 review 记录见 `doc/mosaico/REVIEW.md`。

Mosaico 0.2.8 将取帧/PPA预览与 quirc 解码拆为独立任务，解码使用320px快速路径、480px整数盒式采样和640px旋转回退、单精度FPU及1024区域。所有 LVGL 画布操作留在 UI 任务，摄像头只写最新帧邮箱；扫码时隐藏手柄图层。翻开镜头使用90度旋转且不镜像。识别、连接、成功和错误按代次隔离，只有绑定成功反馈后显示手柄，0.2.10绑定后进入握姿校准页，屏幕多点或实体A+B同时按住并稳定采样，松手后开放输入。绑定锁阻止重新扫码；断线保留手柄与校准，使用原设备凭证持续重连。

对外地址沿用 `ANKA_PUBLIC_URL`（含协议/主机/端口）；根 `.env` 启动读取，Shell环境优先，`HOST`/`PORT` 仍是后端监听。开发环境允许保持同源localhost页面并向设备提供LAN二维码；生产来源校验不放宽。

Mosaico交互修订将`imu_calibration.c`纯C握姿算法、线程安全会话包装和LVGL校准页分离。以重力和屏幕法线建立视角基准，单独计算偏置；配置前、校准中及双键未松开时均保持neutral。实体Interaction模块显式GPIO检测、去抖和短开火沿锁存，真实按压计数与Wi-Fi输入对应。按钮下灯实际顺序右LED4/左LED5，当前0.3.0为左fire/右aim，输入位按用户实际组装方向交换。

0.2.11校准页面通过LVGL容器顺时针90°变换显示，CST9220全点快照采用逆变换命中，普通手柄输入坐标保持不变。800ms握姿校准允许15°调整和150ms触点缺失，静态去偏与握姿通过条件解耦；长时间松开/明显转动仍重试，成功后必须释放双键才开放输入。

Device v1补充完整相对四元数pose（latest-wins）；接收端临时断线仅释放输入，同身份重新接管后rearm，父授权/明确解绑仍撤权。手机体感要求可信HTTPS，可配置ANKA_DEV_TLS_CERT/KEY；公开地址仍复用ANKA_PUBLIC_URL。

0.3.0取消旧版立起/静止门槛，A+B约800ms后松开确定实际握姿。`orientation.c`以独立200Hz IMU任务进行六轴融合，发送参考相对四元数，游戏用最新姿态与相机基准求目标角，避免增量丢失和pitch限幅回正偏移；无磁北绝对航向，仍有长期传感器漂移边界。触摸/物理左右与同侧LED对应，统一左开火、右瞄准。

0.3.1使用共享controller_layout.h将校准页/手柄页旋转、触点逆变换、命中和轨迹统一到正常握持坐标。ESP在输出边界校正水平航向、保留俯仰；手机协议语义不变。游戏完整姿态用相邻连续YXZ分支求角、垂直临界点保留航向，首次姿态不重设零点；显式键鼠交还保留对齐当前握姿的行为。LAN HTTP继续保留，TLS配置为可选。

0.4.0手势按起点分流：中央圆移动、顶排超过一格横滑转身、其余仅短点。C/JS同规则、门槛反馈和单指所有权。input.turn为归一化累计转角快照，持久于抬手/重连，队列取最新值；neutral不将其当保持输入。游戏对最新turn取圆周差值并更新体感观察基准，重连/暂停后首个neutral仅重建基线，避免重复或回放转身。

0.4.1将C/JS顶排手势统一为半格激活、门槛后每格180°；激活锚点在本次按住期间锁定，反向滑动不重复死区。新增可选turnTotal未取模累计快照，宿主校验并保留最新值，游戏1.4.1优先求完整角度差，避免快滑跨180°反向混叠；旧turn客户端继续兼容。两端功能与平台差异见doc/mosaico/design/10-controller-parity-and-live-turn.md，蓝牙直连现已在独立工程实施，见下文。

### 静态资源传输（2026-10-30）

宿主和插件静态资源默认协商 Brotli/Gzip，构建预压缩、缺省动态 Gzip；保留原鉴权、Range 和实时接口行为。带内容哈希的资源使用浏览器私有不可变缓存，入口继续检查更新。开发 Vite 与生产 FastAPI 均覆盖，结构与验证见 `docs/STATIC-ASSETS.md`。

### BLE GATT 独立应用（2026-10-30）

`device/anka-gatt-gamepad` 是独立ESP32-S31原生Idea，保留原 `device/esp32` WS应用；编译时复用校准、控制状态与姿态核心，独立 NimBLE/sensors/wire 适配。SDK/BSP使用原固定版本缓存，新增 BLE gitlink 锁版，不引入Arduino。设备不启动Wi-Fi，系统Wi-Fi/NVS保持；蓝牙配对密钥独立保存，游戏Device凭证仅RAM。

浏览器共享模块 `web/controller/gatt-{client,codec}.js` 由游戏运行时导入；显式用户点击选择设备。原devices infra插件新增GATT授权适配，经已有User/Share receiver控制通道绑定/续约/撤权；精确玩家、单设备、传输类型与Device秘密验证保持独立。输入/反馈直接走本机BLE，复用游戏原InputRouter；服务不转发其高频数据。150ms游戏watchdog、1500ms设备租约、断线/隐藏释放、原页退避重连和重启重新连接规则见 [GATT协议](docs/GATT-GAMEPAD.md)。

BLE接入按用户最新要求不扫码：页面已有User/Share身份，显式选择外设后创建Device绑定；设备不启动摄像头，启动即显示蓝牙等待页。加密Control Read提供应用内随机配对证明，首次bound校验，绑定后不再公开。手机和原WS路线保留二维码。


### 8.16 应用运行时（M21，2026-10-31）

- `runtime/appRuntime.ts` 是前端实例与前后台状态的唯一来源；安装事实仍属于服务端 ledger。
- `ApplicationWorkspace` 按 appId 创建稳定窗口，只改变显示；`ApplicationSurface` 提供每个应用自己的 Vue Router 上下文、异常兜底与重新启动。iframe 不分离、不改父节点。
- `pluginHost` 发现与 setup 解耦：启动只注册元数据/占位路由，首次打开才加载；后台预热按 manifest.runtime 选择资源预取或预执行。新产物不强制替换运行中界面。
- `UiCtx.forApp` 绑定注册身份，提供生命周期、前后台状态、关闭保护、事件、命令、按用户和 appId 分区的存储及主题。组件作用域结束自动注销订阅，卸载兜底撤销模块注册。
- Dock 图标下当前应用为长线、后台为小点；`components/dock/` 拆分双端渲染、手势、指示和图标菜单，右键/长按提供关闭、重启、桌面分屏；手机单窗口。每个 appId 当前只有一个实例。`AppEmbed` 支持不同应用嵌套，拒绝循环与重复占用，父级关闭级联子级。
- `frameBridge` 校验 origin/source/nonce 后建立专属 MessageChannel；`public/anka-sdk.js` 提供 page 应用的路由、事件、存储、命令、主题和生命周期。SDK 不直接操纵 iframe 物理历史。
- `frameNavigation` 维护虚拟栈，将根应用位置镜像到宿主 `__app` 参数；嵌套应用不覆写父级 URL，系统返回按焦点交给子应用。
- `AppPortal` 让 body 弹层随应用隐藏。旧插件直接 Teleport 到 body 的弹层需接入该组件或生命周期。后台 pause 是协作式策略，不是强制冻结 JS。
- UI 关闭不等于 Python 后端停用，也不能驱逐浏览器原生 ESM 缓存；持久草稿由插件经存储接口保存。当前同源插件是受信任代码，未引入恶意代码沙箱或后台常驻保证。
- 契约与示例：[`docs/APP-RUNTIME.md`](docs/APP-RUNTIME.md)；设计取舍：[`design/architecture/app-runtime.md`](design/architecture/app-runtime.md)。


### 8.17 Dock 状态与 10 个实例上限（2026-10-31）

- `DockBar` 仅在电脑桌面布局按 2/3 缩放，并同步压缩布局占位；手机和平板使用原始尺寸。设备平台沿用 `detectPlatform()`（含桌面 UA 的 iPad），不以布局宽度代替设备判断；全屏展开遮罩与图标菜单位于缩放层外。
- 电脑折叠 Dock 的可见图标仍为 24px，图标净间距 8px、两端留白 10px；分页沿用相同间距，并按图标、间距、留白和边框一起计算容量。iPad/手机沿用原间距。
- 删除数量徽标/运行列表入口，应用操作收敛到图标菜单；保留 Dock 翻页、展开和收窄手势。
- `runtime/capacity.ts` 串行预留实例，上限 10，含系统应用、加载、分屏、嵌套和预执行；路由提交前完成准入，满额失败不离开当前应用。
- 后台根窗口按 lastUsed/key 排序，按整组检查关闭保护后回收；可见窗口、继续运行策略、加载中的实例、新子应用的父级和检查期间重新使用的窗口跳过。全部受保护则拒绝新增，预执行满额直接跳过。
- 回收使用现有界面销毁与清理路径；保留插件安装/原生模块注册和逻辑导航位置，不承诺未持久化内存或后端任务的资源上限。

## 项目存储目录（现有功能已实施，2026-10-31）

- 完整目录树、内容归属与开发契约统一见 [docs/STORAGE.md](docs/STORAGE.md)，后续开发均按此规范存储，只创建已启用功能需要的目录。[原设计稿](design/architecture/local-storage.md) 保留为决策记录；存储规范变更统一更新 docs/STORAGE.md。
- `settings` 统一解析默认项目根 data 和可覆盖的 ANKA_DATA_DIR/ANKA_PLUGINS_DIR。宿主 config/databases/state、AI sessions 分别有明确路径常量；应用用 `settings.app_data_dir(id)`。
- Jot 业务库迁至 data/apps/anka-jot/databases，媒体迁至 files/media；番茄库迁至 data/apps/anka-pomodoro/databases。应用代码与数据分离。
- `/api/apps/<id>/files/<相对路径>` 为登录用户提供媒体 GET/HEAD/Range，限制在 files 内。Jot 的逻辑媒体引用不变，访问由前端映射到该接口。
- 日志仍在 logs，启动 PID 移至 run；插件源码副本在 data/system/state/plugin-backups。cache/workspace 和未来 AI 目录尚无对应写入时不创建。
- 用户登录账号和签名密钥继续使用 ~/.anka/users.json 与 ~/.anka/auth_secret，原有覆盖方式保持现状。同步和备份方案待定，插件构建机制保持现状。
