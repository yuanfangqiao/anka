# AGENT.md · AI Agent 工作守则

> 本仓库的使用者是人 + AI Agent。修改代码前先读这份文件，再读 `ARCHITECTURE.md` 与 `PROJECT.md`。
> 最后更新：2026-09-30（M0 文档阶段）

## 1. 仓库真相表（Ground Truth）

| 路径 | 性质 | 说明 |
|------|------|------|
| `IDEA.md` | 需求源头 | 原始想法 + 已确认决策；**不得改写「一、原始想法」原文** |
| `PROJECT.md` | 范围与里程碑 | 决定「做什么 / 不做什么」的唯一依据 |
| `ARCHITECTURE.md` | 技术方案 | 决定「怎么做」的唯一依据（含依赖版本与目录约定） |
| `CHANGELOG.md` | 变更记录 | 每次核心修改追加一条，最新在上 |
| `README.md` | 启动方式 | 命令以它为准 |
| `AGENT.md` | 本文件 | Agent 行为规范 |
| `reference/**` | **只读** | 参考资料（`cordis-mini` / `ComfyUI` / `ComfyUI_frontend`），禁止修改，禁止运行时 import |
| `server/**` | 后端 | FastAPI + 移植的 cordis 内核 |
| `web/**` | 前端 | Vue 3 PWA |

文档冲突时的优先级：`IDEA.md`（需求）> `PROJECT.md`（范围）> `ARCHITECTURE.md`（实现）> 本文件（流程）。

## 2. 不可违反的红线

1. **不动 `reference/`**：不修改、不格式化、不以它为 import 路径。需要它的代码时**复制到 `server/app/cordis/`** 并在 `PATCHES.md` 记录改动。
2. **业务能力必须写成插件**：新增能力放到 `server/app/plugins/`，用 `name / inject / provide / apply` 声明，禁止把逻辑塞进 `main.py` 或路由文件。
3. **同步内核只能在受控环境**调用：必须经 `PluginManager` + `asyncio.Lock` + `asyncio.to_thread`，禁止在协程里直接调 `Loader` / `Fiber`。
4. **副作用必须可逆**：注册服务、事件、工具一律走 `fiber.effect`（返回 teardown），保证卸载干净。
5. **UI 也要插件化**：新增前端入口走 `useAppRegistry` 元数据注册，不要在 `DockBar.vue` / `SideBar.vue` 里硬编码列表。
6. **大文件禁令**：单文件 ≤300 行，超过就拆。
7. **局部修改优先**：已有文件用最小 diff 改，禁止为了加一个小功能重写整个文件。
8. **页面组件必须单一元素根**：壳层 `<RouterView>` 外套了 `<Transition>`，Fragment 根（如「布局 div + Teleport」两个根）会导致切换页面永久空白。需要 Teleport 时，把它包进唯一根 div 里。
9. **路由过渡禁用 `mode="out-in"`**：本项目路由组件为动态注册 + 跨模块 plain object，out-in 的 enter 会被永久卡住（leave 移除后只剩注释占位）。统一用默认模式，leave 元素已由 `.page-leave-active { position:absolute; inset:0 }` 兜底防堆叠。

## 3. 标准工作流

### 3.1 开工前
1. 读 `PROJECT.md` 确认当前里程碑与验收清单
2. 读 `ARCHITECTURE.md` 确认目录、接口契约、依赖版本
3. 有歧义先问人，不要靠猜；猜了也要在总结里明确说出假设

### 3.2 实现中
- 后端先：内核/插件 → `PluginManager` → 路由 → 验收脚本
- 前端先：token/样式 → 组件 → 布局壳 → 页面
- 每完成一个可验证单元，立刻运行验证命令（见 `README.md`），别攒着一起跑

### 3.3 收尾前（必须）
- 若新增/修改了**跨多个文件的结构**，更新 `ARCHITECTURE.md` 对应章节
- 若改变了**范围或里程碑状态**，更新 `PROJECT.md` 表格
- 若新增了**命令或依赖**，更新 `README.md`
- 在总结中说明：改了哪些文件、验证方式、遗留风险

## 4. 常见任务配方

### 4.1 新增一个插件

**infra 能力插件**（无 UI，后端能力）：
```
server/app/plugins/<name>.py   # Service 类或 name+inject+apply 函数形态
```
然后在 `settings.py` 的 PLUGIN_CONFIG 启用表加入 → 重启 → `GET /api/plugins` 可见。

**App 插件**（前后端一体，可装卸，推荐）：
```
plugins/<name>/
├── plugin.json      # id 必须等于目录名；backend.entry + ui.entry 必须存在
├── server/main.py   # from app.cordis import Service；provide 默认 [id]
└── web/index.js     # export function setup(uiCtx)，零 npm 导入
```
前端用 `uiCtx.vue`（h/ref/computed…）、`uiCtx.components`、`uiCtx.icons`、`uiCtx.api` 写 UI；
后端数据经通用通道暴露：`snapshot()` → `GET /api/apps/<id>/state`，公开方法 → `POST /api/apps/<id>/call`。
放好后在插件管理页「可安装」区点安装即可，不用改任何内核代码。

### 4.2 新增一个前端页面/入口（M6+：以 App 插件形式）
1. 在 `plugins/<name>/web/index.js` 写 `setup(uiCtx)` 注册（见 4.1 App 插件）；系统插件放 `web/src/system/<name>/`
2. **页面组件必须单一元素根**（红线 #8）：需要 Teleport 时包进唯一根 div
3. **不要给路由过渡加 `mode="out-in"`**（红线 #9）
4. 不要手改 `DockBar.vue` / 壳层布局文件

### 4.3 改 cordis 内核
1. 改 `server/app/cordis/*.py`
2. 在 `server/app/cordis/PATCHES.md` 追加一行：改了什么、为什么要改、相对 `reference/cordis-mini` 的差异
3. 不允许「顺手重构」未经讨论的内核代码

## 5. 命令速查（详细见 README）

```bash
# 后端
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
python server/run_dev.py                # http://localhost:8000

# 前端
cd web && npm install && npm run dev    # http://localhost:5173
npm run build                           # 产出 web/dist（含 manifest + sw）
```

## 6. 验证要求

- 前端改动：至少确保 `npm run build` 通过 + 桌面/手机两个视口各看一眼（1440×900 / 390×844）
- 后端改动：至少一个真实调用链路验证（curl 或脚本），不能只靠「看起来对」
- PWA 相关改动：检查 Service Worker 注册与 manifest 可读
- 不允许把「未验证」写成「已完成」

## 7. 术语对照（避免沟通歧义）

| 术语 | 含义 |
|------|------|
| Service 类插件 | 继承 `Service`，`super().__init__(ctx, name)` 后自动成为 `ctx.<name>`，默认 `provide=[name]` |
| 函数插件 | 模块含 `name` + `apply`，用 `inject` 声明依赖 |
| fiber | 一个插件实例的「事务边界」，持有 effect/teardown，状态 PENDING/LOADING/ACTIVE/FAILED/UNLOADING/DISPOSED |
| inject / provide | 依赖声明 / 提供的服务名，Loader 据此拓扑排序 |
| 级联卸载 | 卸载某插件时，所有 inject 其 provide 服务的插件被一起卸载 |
| dock / sidebar | 手机底部栏 / 桌面左侧栏，均由应用注册表驱动 |
