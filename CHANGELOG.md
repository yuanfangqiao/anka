# CHANGELOG

记录每次核心修改。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，最新在上。

## [M8.1] 切页白屏根因修复 · 2026-09-30

### 修复
- **切页永久空白**：根因有二——① `ChatView`/`PluginsManagerView` 是 Fragment 根（布局 div + Teleport），`<Transition>` 无法动画；② `mode="out-in"` 在本项目「动态路由 + 跨模块 plain object 组件」组合下 enter 被永久卡住（leave 移除后只剩注释占位，复现脚本：首次 `router.push` 后 RouterView 恒空）
- 处理：两个组件包单一根 div；路由过渡统一为**默认模式**（进出同时进行），`.page-leave-active` 绝对定位防堆叠；两条规则写入 AGENT.md 红线 #8/#9
- dock 移除悬停放大特效，选中仅显示指示点（未选中透明占位）；tooltip 改纯 CSS hover
- dev 模式 `main.ts` 自动注销残留 SW 并清缓存（修 dev SW 导致的旧壳混搭）；生产包重新构建
- 验证：playwright 12 连切 + 真实 dock 点击 + 手机视口全部正常，控制台 0 报错

## [M8] 壳层精修与 PWA 修复 · 2026-09-30（已完成）

### 变更
- **移除主窗口标题条**：主界面 = 应用区 + dock 上下两部分；主窗口圆角 28px → 16px；「插件管理」入口移入「设置」应用
- **「设置」进 dock**（首位，像手机设置 App）；手机 TopBar 右侧齿轮移除（仅保留非 dock 页的返回）
- **dock 缩小**：图标 44→36px（桌面）/26→22px（手机），高度 74→58px / 64→56px，指示点缩小
- **PWA「切换应用加载失败」修复**：根因是 dev SW 缓存旧壳——`devOptions.enabled` 关闭（SW 仅生产构建启用），Workbox 增加 `cleanupOutdatedCaches`；manifest 增加 `display_override: [window-controls-overlay, standalone]`。**已安装的旧 PWA 请卸载后从 http://localhost:8000 重新安装**（生产构建）

### 新增
- **git 插件目录约定**：第三方插件（如 comfyui/deepseek-harness 系）以独立 git 仓库放入 `plugins/`，内含 `server/`（python）+ `web/`（vue/ts 源码）；开发态 vite 中间件对 `.vue/.ts` 即时编译（transformRequest），生产态要求插件自带构建产物（`web/index.js` 纯 ESM）；启动时按 `installed.json` 自动加载
- **设置项归处约定**：全局设置集中在 dock「设置」应用；插件设置推荐后续以声明式 schema 注册进设置应用的插件分区（iOS 风格），当前阶段插件设置放插件自己页面内

## [M7] macOS 风格壳层重构 · 2026-09-30（已完成）

### 变更（交互模型修订）
- **布局权完全下放**：内核壳层只保留「底部 macOS 风格 dock + 主窗口」，主界面内左右分栏或全屏由各 App 自绘（取代 M6 的「内核渲染 per-app 工作栏」）
- 删除内核 WorkDrawer（手机抽屉）与 `registerSidebar` API、registry.sidebars；App 需要面板时用 Teleport 自绘
- dock 全面 macOS 化：悬浮玻璃胶囊 + 渐变圆角方块图标 + 悬停波浪式放大（1.35/1.18/1.06）+ 运行/活动指示点 + 桌面 tooltip + 超 5 横滑渐隐
- 主窗口：大圆角玻璃容器 + 极简标题条（App 图标+名称+插件管理入口），标题条以下整块归 App

### 新增
- `uiCtx.layout: { isMobile, isWide }`（内核共享 matchMedia 注入，插件零依赖判断形态）
- `uiCtx.components.BasePanel`（App 自绘左栏的统一玻璃容器）
- 各 App 自绘布局：对话（左会话栏/手机内部面板按钮+Teleport 面板）、插件管理（左分类栏/手机 chips）、笔记（左标签栏/手机 chips）、探索（左类型栏/手机 chips）、设置（全屏）

### 移除
- `components/WorkDrawer.vue`、`registry.sidebarOf/addSidebar`、各插件对 `registerSidebar` 的调用

## [M6] App 插件模型重构 · 2026-09-30（已完成）

### 变更（决策修订）
- **推翻** M0 决策「不做本地插件文件动态安装」——升级为支持动态安装/卸载的 App 插件模型
- 插件形态：扁平后端 `.py` → `plugins/<name>/` 前后端一体文件夹（`plugin.json` + `server/` + `web/` + `assets/`）
- 主系统空壳化：系统插件仅 对话 / 插件管理 / 设置（`system: true`，不可卸载）；不装应用插件 → EmptyHome 空态页
- dock = 已安装的应用；手机 dock 最多显示 5 个，超出横向滑动
- 桌面左栏重新设计：静态四条目侧边栏废弃 → 当前 App 自己的工作栏（无声明则隐藏）
- 手机工作栏：TopBar 左侧按钮触发的左侧抽屉（可收纳）

### 新增
- 后端：`folder_scanner.py` / `folder_loader.py` / `server/data/installed.json`；PluginManager 增加 discover/install/uninstall；`GET /api/apps`、`GET /api/apps/{id}/state`、`POST /api/apps/{id}/call`、`POST /api/plugins/{name}/install|uninstall`
- 前端：uiCtx 插件契约（vue/components/api 依赖注入，插件零 npm 导入）、运行时注册表、pluginHost 动态 import、动态路由、WorkDrawer、EmptyHome
- 首批 App 插件：notes（笔记）、explore（探索）
- 热语义：首次安装即时生效；重装同名插件返回 `requires_restart`；前端卸载后刷新彻底干净
- 本 CHANGELOG

### 移除
- 静态四视图 tasks / network / workspace（M5 以 App 插件形态回归）与旧版 notes/explore 内核视图
- 静态 `useAppRegistry` 注册表与 `SideBar.vue`（逻辑并入壳层工作栏容器）

## [M1–M4] 双布局壳 + PWA + 插件内核 + 对话流式 · 2026-09-30

### 新增
- 前端：Vue 3 + Vite 5 + Tailwind 双壳（MobileShell/DesktopShell）、应用注册表、8 个视图、iOS 大标题导航、暗色玻璃拟态设计系统
- PWA：vite-plugin-pwa（manifest + Workbox + NetworkFirst /api）、AI 生成图标（192/512/maskable/apple-touch）、localhost 可安装、离线 App Shell
- 后端：cordis 内核 vendor 移植（`server/app/cordis/`，8 处补丁记录于 PATCHES.md）、6 个 infra 插件、PluginManager（启停 + 级联记录 + DISPOSED 重建）
- API：`/api/health`、`/api/plugins`（启停）、SSE `/api/chat`（worker 线程 + queue + to_thread 桥接）
- 验证：`scripts/smoke.py` 19 项断言；playwright 双视口截图；启停级联端到端点击验证

## [M0] 文档奠基 · 2026-09-30

### 新增
- IDEA.md（原始想法 + 四项已确认决策 + 补充想法）、PROJECT.md（范围与里程碑）、ARCHITECTURE.md（技术方案与移植要点）、AGENT.md（AI 工作守则）、README.md（依赖与启动）
- 关键决策：Fake LLM 优先、插件页查看+启停、FastAPI、MVP = 双布局壳 + PWA
- 已采纳扩展 IDEA（M5+）：调用链可视化、后台任务插件、对话→笔记联动；iOS 大标题导航并入 M1 设计规范
