# CHANGELOG

记录每次核心修改。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，最新在上。

## [M12] 移动端壳 UI 全面优化（顶部空栏 / dock 重做）· 2026-10-04

**背景**：手机上打开 quickdraw 等 page 类应用，连出四个体验问题，顺带把 dock 整体重做。

### 修复（四连）
1. **顶部空白条**：`TopBar` 在 page 应用页是永久空白（无返回键、标题只在滚动后出现，而 iframe 页永不滚动）。修复：`AppMeta` 新增 `fullscreen` 标记（page 类注册时置真，首页空态同理）→ `MobileShell` 对 fullscreen 路由**不渲染 TopBar、不留任何顶部空位（含 safe-area）**，dock 之上整块区域完全归应用自己。
2. **iPad 与 Mac/Win 显示不一致**：iPad 竖屏（768px，含 mini 744px）原命中移动壳。修复：`useBreakpoint` 移动壳阈值改为 `max-width: 639px`（仅手机竖屏）→ **iPad 一律走桌面壳，与 Mac/Win 完全一致**，移动壳的 TopBar/模糊问题在 iPad 上不复存在。
3. **dock 不对齐 + 触发 iOS Home 白线手势**：旧 dock `h-[46px]` 定高里塞 `safe-bottom` 内边距（border-box 把内容挤到 ~12px），且 `bottom-2` 贴着 Home 指示条手势区。修复：dock 改为 64px 胶囊、**整体抬到 `safe-area-inset-bottom + 10px` 之上**。
4. **iOS 拖动 dock 导致整页变形**：`overflow-x-auto` 的 iOS 弹性滚动发生滚动链传导。修复：分页 + `scroll-snap` + `overscroll-behavior: contain` + `touch-action: pan-x` 三件套锁死。

### 追加（同日）
- **顶栏按需渲染**：dock 应用（对话/设置等，自带页头）与全屏页一律不渲染 TopBar、不留 `pt-14` 空位——只有非 dock 系统页（如插件管理，需要返回键）才出现顶栏
- **iOS「莫名出现浏览器栏」定性**：那不是页面触发的（全仓无 `navigator.share`/`window.open` 调用）——顶部 X+域名、底部分享/刷新工具栏是**宿主浏览器**（Safari / 各 App 内置浏览器）画的 UI，页面代码无法去除。两张截图的真实差异是**启动方式**：主屏图标启动 = standalone（无浏览器栏，对话那张）；通过链接在浏览器内打开 = 带栏（设置那张）。代码侧兜底：非 standalone 时 toast 提示一次正确打开方式（每会话一次）

### dock 重做（设计拍板）
- **三行同轴布局**：翻页点（顶轨）/ 图标（中行）/ 当前应用指示（底轨）。两条轨道与图标滚动区**同宽同轴**，指示点按槽位百分比定位、切换时平滑滑动——翻页进度与选中指示天然上下对齐
- **分页吸附**：每页 `maxVisible` 槽位（内核 `/api/config` 下发），横向 snap 翻页，圆点可点击跳页
- **全部应用 = dock 上滑拉伸展开**（拍板，取代独立抽屉）：从翻页点/图标区**手势上滑**，整个胶囊向上拉伸成**半屏**应用网格（含未进 dock 的系统页）；装不下时**上下翻页**，**左侧竖向进度点**指示/跳页。无标题、无 X、无九宫格按钮——手势即全部交互；把手下滑 / 点遮罩 / Esc / 打开应用均可收起
- **更大底部安全边距**：`safe-area-inset-bottom + 16px`，远离 iOS Home 白线手势区
- **应用专属色相**：page 类应用图标全是 package 蓝方块 → 按 id 哈希映射 HSL 色相，每个应用一枚专属渐变瓷贴；系统插件保留品牌渐变

### 经验
- 移动壳的"空白/模糊"先怀疑**空 glass 面板**（backdrop-blur 会糊掉一切）
- iOS 上任何底部固定元素都要把 `safe-area-inset-bottom` 当**定位偏移**而不是**内边距**用，否则定高元素被挤变形
- iOS 弹性滚动链条：`overflow` 容器不戴 `overscroll-behavior: contain`，整页都会跟着 rubber-band

## [M11.1] excalidraw 接入踩坑实录（page 类插件三大坑）· 2026-10-01

**背景**：把 excalidraw 0.18.1 官方 dist（完整 React SPA 构建产物，含 monorepo 源码 35MB tarball）直接丢进 `plugins/excalidraw/`。无 `plugin.json` → M11 page 降级自动识别 OK，但从「能识别」到「PWA 里能用」连踩三坑。构建本身不慢（壳前端每次 ~1.8s），耗时全在逐层定位。

### 坑 1：构建产物绝对路径 vs 挂载前缀（白屏）
- **症状**：iframe 打开了，但全白。直接访问 `/plugins/excalidraw/dist/index.html` 也白。
- **根因**：excalidraw 构建时 `base="/"`，`index.html` 里写的是 `src="/assets/index-*.js"`。挂上 `/plugins/excalidraw/` 后浏览器去**站点根** `/assets/` 找——而站点根 `/assets` 已被主应用挂载（main.py），插件的 JS 拿到 404。
- **修复**：伺服 page 类插件的 `.html` 时**改写 HTML**——注入 `<base href="/plugins/<id>/<dir>/">` + 把 `src="/X" href="/X"` 改写为 `/plugins/<id>/<dir>/X`（跳过 `/plugins/`、`/api/`、`http(s)`）。
- **关键点**：**dev 和 prod 是两套伺服，要各修一遍**——prod 是 FastAPI（`main.py serve_plugin_html` 路由，先于 `mount('/plugins')` 匹配），dev 是 vite 中间件（`vite.config.ts serveAppPlugins`）。只修一边会出现「8000 能开、5173 白屏」或反之。

### 坑 2：iframe sandbox 同源下零收益还拦功能（白屏）
- **症状**：路径改写后直连 URL 能渲染，但 PWA 壳里 iframe 仍白。
- **根因**：`WebViewPage` 的 `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"` 拦掉了 excalidraw 启动需要的能力（SW 注册/剪贴板/弹窗等）。
- **认知**：iframe 与宿主**同源**（`/plugins/...` 同端口）时，`allow-scripts + allow-same-origin` 组合**安全收益为零**（里面脚本本就能摸 parent DOM），sandbox 只剩兼容性破坏。
- **修复**：`WebViewPage.vue` 去掉 `sandbox`。iframe 保留——对 excalidraw 这种完整第三方 SPA（自带路由/全局 CSS/挂载 `#root`/自带 SW），iframe 是必须隔离，不能「直接套进壳 DOM」（挂载点冲突、全局 CSS 污染壳、SW 抢 scope、无法卸载）。

### 坑 3：SW navigateFallback 截胡 iframe navigation（多层内嵌，最隐蔽）
- **症状**：点几次插件图标，页面变成壳套壳套壳（每层一个 dock）。
- **根因**：workbox `navigateFallback: '/index.html'` 生成的 `NavigationRoute` 在 sw.js 里**注册顺序排第一**且无 denylist。iframe 加载就是 navigation 请求（`mode: 'navigate'`）→ 请求 `/plugins/snake/dist/index.html` 被它截胡，返回**壳的 index.html** → 壳在 iframe 里递归启动 → 在嵌套壳里点 dock → iframe 导航 `/app/snake` → 再嵌一层。
- **修复**：`vite.config.ts` workbox 加 `navigateFallbackDenylist: [/^\/api\//, /^\/plugins\//, /^\/plugin-dist\//]`。
- **注意**：旧 SW 仍在用户浏览器里跑，`autoUpdate` 换装需刷新一次（必要时强刷）。

### 经验（page 类插件接入 checklist）
1. 第三方 dist 丢进 `plugins/` 后，先 curl 其 `index.html` 看资源路径是相对（`./x.js`，免改）还是绝对（`/x.js`，依赖我们的改写）
2. 验证必须**双态**：dev（5173，vite 中间件）+ prod（8000，FastAPI）
3. PWA 异常先怀疑 SW：iframe 白屏/嵌套/旧内容，多半是 `navigateFallback` 或旧 SW 缓存，不是插件本身
4. 同源 iframe 不要加 sandbox；跨源 iframe（trendshift 类）才用 sandbox 白名单（见 M10.8）

## [M11] 任意文件夹即应用（page 降级形态）· 2026-10-01

### 新增
- **plugins/ 下无 plugin.json 的目录自动成为应用**：`FolderScanner` 降级探测 `index.html` / `dist/index.html` / `web/index.html` → page 类 manifest（id=name=目录名、icon=package、route=`/app/<目录名>`、order=100）；三种入口都没有则忽略
- 内核通用组件 **`WebViewPage.vue`**：page 类应用无 `setup(uiCtx)`，`pluginHost` 按 `AppInfo.kind='page'` 直接注册 WebViewPage（同源 iframe + §8.7 sandbox 约定）指向静态入口
- **同源红利**：page 页面可直接 `fetch('/api/...')` 调内核能力（clock 样例实测：显示「内核在线 · 插件 11/11 运行中」）
- **不支持自动 npm build**（拍板）：要求自包含静态页或作者提交 dist；需要构建的项目作者自行 build 后放入
- 样例：`plugins/clock`（单文件时钟）、`plugins/snake/dist`（分离资源贪吃蛇，演示 dist 形态）

### 变更
- `AppInfo` 增加 `kind: 'app' | 'page'`；`plugin_manager` 的 bootstrap/install/uninstall/enable/disable 增加 page 分支（page 无 fiber/meta：无启停语义、卸载即移出 installed）
- prod 新增 `mount('/plugins')` 伺服插件目录静态文件——page 类 **dev/prod URL 一致**（`/plugins/<id>/...`），无需 `.plugin-dist`

### 修复
- vite 插件中间件 mime 表缺 `.html`（返回 octet-stream 导致 iframe 不渲染）→ 补 `.html/.htm/.webmanifest/.ico`

### 验证
- `/api/apps`：clock/snake `kind=page`、route=`/app/<name>`、entry=静态路径 ✅
- dev（vite）+ prod（8001 --prod，FastAPI mount）双态渲染 clock（实时时间 + 内核 API 状态）与 snake（canvas+CSS 分离资源）✅；dock 图标默认 package ✅
- 注意：生产验证若见双 dock/路由错乱，为测试 profile 的 SW 旧缓存污染（换新 profile 即正常），非代码问题

## [M10.8] trendshift 防跳出（iframe sandbox 白名单）· 2026-10-01

### 变更
- trendshift iframe 加 `sandbox="allow-scripts allow-same-origin allow-forms"`——不给 `allow-popups`（拦截 target=_blank / window.open 新开页）、不给 `allow-top-navigation`（顶层 PWA 窗口永不可被导航走）
- 保留 iframe 自导航：trendshift 站内详情（/repositories/xxx）作为「当前应用」在 iframe 内打开；需要外链时右键新标签或工具条「新窗口打开」

### 验证（playwright）
- 站点在 sandbox 下正常渲染（body 7.5KB）；GitHub 外链点击 NO_POPUP、顶层 URL 不变；站内详情 iframe 内打开且渲染 Repository Details 页 ✅
- 实测备注：trendshift.io 页面内嵌 Google Ads/recaptcha 子 frame（站点自身行为）

## [M10.7] baidu「纯净」默认模式（后端代理去热搜）· 2026-10-01

### 新增
- **baidu 插件补后端**（`server/main.py`，零依赖用 urllib）：请求预置 `Cookie: hide_hotsearch=1`（百度「关闭热搜」的服务端开关）→ 删全部 `<script>`（广告/弹层/统计靠 JS 渲染，搜索表单是纯 HTML 不受影响）→ 注入 `<base href>` + 兜底 CSS；首页缓存 10 分钟，经 `GET /api/apps/baidu/state` 下发
- **改抓 m.baidu.com（手机版，iPhone UA）**：尺寸天然适配手机视口（390=390 无溢出）；百度对匿名请求时 SSR 时 CSR 渲染 feed，兜底 CSS 两种都盖住（`#wise-index-feed`/`[class*="index-banner"]`/`#s-hotsearch-wrapper`）
- 前端按用户要求**删除全部工具条**，只剩满屏纯净搜索 iframe（后端不可用时显示提示与新窗口链接）
- plugin.json 从「无后端」变为挂 backend——同名重装需重启后端（符合既有语义）

### 验证
- 后端 snapshot：626KB、`<script>` 0 个、base/CSS 已注入
- 浏览器：默认纯净模式热搜 `display:none`、搜索框/导航/logo 正常；提交搜索后 iframe 成功跳转百度结果页（contentDocument 变 null 证明跨域导航）；控制台 0 报错

### 安全说明
- 删除 script 的另一个目的：srcdoc 与宿主同源，若保留百度 JS 会拿到宿主页面权限——删脚本既纯净又隔离

## [M10.6] trendshift 插件 + 百度简洁模式 · 2026-10-01

### 新增
- **trendshift 插件**（`plugins/trendshift/`，第 7 个 App）：iframe 内嵌 TrendShift——GitHub 趋势/热榜聚合站（Live trending repositories，Daily/Weekly/Monthly/Yearly），实测允许内嵌（无 XFO/frame-ancestors）
- **baidu 简洁模式**：加「简洁/完整」切换，简洁 = `m.baidu.com`（百度移动版，天然无热搜榜与大广告位，实测可嵌）

### 边界说明
- 跨域 iframe 受同源策略限制，**无法直接删除对方页面里的广告/热搜节点**；「简洁模式」是换用百度自己更干净的移动版。要逐条剔除需插件后端代理重写 HTML（后续增强，也正是插件后端的价值场景）

### 验证
- playwright：/trendshift 完整渲染趋势榜、/baidu 简洁模式渲染移动版首页，dock 7 个应用，控制台 0 报错

## [M10.5] baidu 插件（iframe 内嵌 · 无后端插件首例）· 2026-10-01

### 新增
- **baidu 插件**：iframe 内嵌百度搜索（实测百度未设 `X-Frame-Options`/`frame-ancestors`，可嵌；其破框 JS 被跨域策略拦住）；工具条含「返回首页」（key 重建 iframe）/「新窗口打开」；**无 backend 字段**——验证纯前端插件也能走完整安装链
- 内嵌可行性实测结论（真实浏览器 iframe 探针）：百度 ✅；小红书 ❌（空白/登录墙）；github.com 全部页面 ❌（`frame-ancestors 'none'`）；可嵌的 GitHub 趋势替代站：**hellogithub.com ✅**、trendshift.io ✅、github.org.cn ❌

### 验证
- playwright：/baidu 页 iframe 完整渲染百度首页（搜索框/热搜可用），dock 第 6 个图标 ✅

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
