# CHANGELOG

记录每次核心修改。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，最新在上。

## [M10.4] 手机 dock 瘦身 + 可配置上限 · 2026-10-01

### 变更
- **dock 高度 56→46px，去标签改纯图标**（iOS 风格，图标 32px，激活指示点保留），内容区相应加高（`pb-28→pb-24`）
- **dock 数量上限可配置**：`server/app/settings.py` 新增 `SHELL_CONFIG.mobile_dock_max`（默认 5，环境变量 `MOBILE_DOCK_MAX` 覆盖），经新增 `GET /api/config` 下发；`DockBar` 启动时拉取
- 超上限实现：每个应用槽位 `flex: 1 0 ${100/max}%`——≤N 个时均匀铺满，>N 个时第 N+1 个起横向滑动（右侧渐隐提示）；桌面分支不受影响
- 内容区底部预留与 dock 对齐：`main` 底部预留改为 `pb-[calc(54px+env(safe-area-inset-bottom))]`，精确等于 dock 占位——内容直接贴合 dock（滚动时从玻璃 dock 下方划过，iOS 式），滚到底无废白
- **桌面壳 macOS 化**：主窗口改为占满整个区域，`DockBar` 绝对定位悬浮压在窗口下沿（overlap 66px），消除窗口与 dock 的 flex 间隙——与 macOS「dock 悬浮于应用之上」同构；窗口内容滚动预留 70px 保证滚到底全部可见

### 验证（playwright）
- 390×844：dock 高 46、6 应用槽宽 71px（=1/5）、`scrollable: true`、0 标签；横滑后末位应用完全可见 ✅
- 1024×800：桌面 58px 胶囊居中不回归 ✅
- `GET /api/config` → `{"mobile_dock_max": 5}` ✅

## [M10.3] 笔记页手机端改版 · 2026-10-01

### 变更（仅前端，`plugins/notes/web/index.js`）
- **手机卡片 → 紧凑行**（~70px）：标题 + 单行摘要 + 标签·时间，一屏 5 条以上（原来 2 条）；桌面保持卡片流
- **左滑操作**替代常驻 pin/delete 图标：行左滑露出「置顶(琥珀)/删除(红)」，轴向判定不干扰纵向滚动，松手半程吸附；桌面保留 hover 图标
- **删除撤销**代替确认弹窗：删除后底部浮出「已删除「xx」· 撤销」5 秒，撤销经 `add_note` 恢复内容（无后端改动）
- **筛选吸顶**：搜索框 + 标签 chips 滚动时吸附在 TopBar 下方（`sticky top-14` + 毛玻璃），不再滚丢
- 视觉：tag chip 缩小一号、占位笔记（未命名）标题弱化为 ink-2 斜体、手机列表间距收紧
- 手机/桌面双分支模板拆分（原先共享一个模板混着 `isMobile` 三元）

### 验证（playwright 390×844 与 1440×900）
- 手机：紧凑行渲染、吸顶生效、CDP 真实触摸输入左滑 → `translateX(-116px)` 操作键露出 ✅
- 桌面：卡片流不回归；删除 → 撤销条出现 → 点撤销 → 前后端均恢复 5 条 ✅
- 教训：合成 `TouchEvent` 派发不可靠，触摸手势须用 CDP `Input.dispatchTouchEvent` 验证

## [M10.2] 手机端 dock 定位修复 · 2026-09-30

### 修复
- **手机 dock 布局失效**：`DockBar` 静态类写了 `relative`，移动分支动态类又给 `fixed`——同优先级的 Tailwind 工具类按生成顺序 `relative` 恒胜 `fixed`，导致手机端 dock 退化为文档流元素（`inset-x-4` 变成右移 16px、全宽溢出、失去悬浮）。修复：`relative` 移入 desktop 分支
- 手机 dock 内容 `justify-around` 均匀分布（全宽胶囊内靠左难看）

### 验证
- 390×844：`position: fixed`、x=16、w=358、距底 10px；6 应用均匀分布、标签清晰、当前项高亮（playwright 截图）
- 1024×800（桌面/iPad 分支）：`relative` 保留、胶囊居中（268px 宽居中误差 <2px），tooltip 定位前提未破坏

## [M10.1] calculator 插件 + 通道健壮性 · 2026-09-30

### 新增
- **calculator 插件**（`plugins/calculator/`，第 4 个 App）：前端按键拼接表达式，「=」经 `callApp` 发后端求值；后端 `safe_eval` 用 **AST 白名单**求值（仅数字与 `+ - * / // % **` 括号，拒绝 `eval`/任意代码），保留最近 10 条历史（`snapshot`/`calc`/`clear`）；已加入默认安装集
- Tailwind `content` 纳入 `../plugins/**/*.{vue,ts,js}`——此前插件 UI 类不生成 CSS（按键网格塌成一行即此因）

### 修复（通用通道，惠及所有插件）
- `api/apps.py app_call`：插件抛出的 `ValueError` → **400 + detail.message**（此前 500）
- `api.ts request`：错误优先透出后端 `detail.message`（插件可显示「表达式语法错误」等业务提示）

### 途中发现并修复
- Calc.vue 模板内跨行三元 `:class` 的 `'='` 字符串提前闭合属性引号（Vue Tokenizer `U+0027` 报错）→ 改为 `keyClass(k)` 函数绑定
- `toPy` 原为按键级查表，误用于整串表达式（`7×8` 未转换）→ 改全局替换；插件后端补 `SyntaxError → ValueError`
- 注意：`uvicorn --reload` 只监视 `server/app/`，改 `plugins/*/server/main.py` 需手动重启后端

### 验证
- curl：`1+2*3=7`、`(2+8)/4=2.5`、`2**10=1024`、`__import__("os")` 被 AST 白名单拒绝（400）
- playwright：`7 × 8 =` 全链路 → 显示屏 56、历史 `7*8=56`、dock 第 6 个应用、控制台 0 报错

## [M9] 插件前端生产管线（安装时编译）· 2026-09-30

### 新增
- **安装时编译**：`plugin_builder.py` 调 `web/scripts/build-plugin.mjs`（vite 程序化构建，内部 esbuild）把插件 `web/`（.vue/.ts/.js）编译为单文件 ESM，缓存 `.plugin-dist/<id>/index.js`；FastAPI mount `/plugin-dist` 伺服；`install()` 触发构建，`bootstrap()` 补齐缺失产物，`uninstall()` 同步清理
- **单 Vue 实例保证**：宿主 `vite build` external vue + `web/shared/vue.ts` 构建为 `dist/shared/vue.js`（`build` 前置 `build-shared.mjs`，含 `process.env.NODE_ENV` 与特性开关 define）+ `index.html` import map `"vue": "/shared/vue.js"`——宿主与插件的裸 import 解析到同一模块
- `run_dev.py` 非 `--prod` 时置 `AGENTOS_DEV=1`：开发态 entry 保持源码 URL（vite 中间件即时编译 + HMR），不做安装时构建；生产态 entry 优先 `/plugin-dist/`
- workbox：`/plugin-dist/` NetworkFirst（不预缓存）；`/shared/vue.js` 随主构建预缓存

### 移除
- M8 的 `postbuild: copy-plugin-web.mjs`（源码拷贝方案，无法处理 .vue/.ts）——删除脚本

### 修复
- 共享 Vue 首版构建缺 `process.env.NODE_ENV` define，浏览器报 `process is not defined`——已补并重建

### 验证
- 生产形态（`run_dev.py --prod`，:8001）：bootstrap 自动构建 3 插件；`/api/apps` entries 全部指向 `/plugin-dist/`；demo bundle 含裸 `import ... from "vue"`；浏览器加载 `/demo` 渲染正常、控制台 0 报错（playwright）
- 开发形态（:5173）：entry 保持源码 URL，demo 经 vite 即时编译渲染正常、0 报错

## [M8.2] 插件前端技术栈升级（Vue SFC + TS）· 2026-09-30

### 变更
- 插件前端从「纯 JS + h()」升级为 **Vue SFC + TypeScript**：入口 `web/index.ts`，界面 `.vue`（`<script setup lang="ts">`）。demo 插件为首例，新增 `types.ts`（uiCtx 结构类型）与 `shims-vue.d.ts`
- vite 中间件修复：`transformRequest` 改用**绝对文件路径** + **保留 SFC 子块 query**（`?vue&type=…`），`.vue/.ts` 即时编译真正可用；新增 `resolve.alias.vue`（插件与内核共享同一 Vue 实例）与 `server.fs.allow`（放行项目根）
- `plugin.json` 的 `ui.entry` 指向 `.ts`（scanner 对 `.ts` 入口的存在性校验不变）

### 决策（拍板写入 IDEA.md §3.10）
- 生产态采用**安装时编译**：install hook esbuild 构建插件 `web/` → 缓存产物 + FastAPI mount `/plugins`；弃浏览器运行时编译与作者预编译 dist。排期 **M9**；GitHub URL 安装（clone + 复用 install）排期 **M10**

### 验证
- `GET /plugins/demo/web/index.ts` 与 `Demo.vue` 均即时编译 200（Demo.vue 产物 import 宿主 `node_modules/.vite/deps/vue.js`，单实例）；`/api/apps/demo/state` 数据通道正常

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
