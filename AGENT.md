# AGENT.md · AI Agent 工作守则

> 本仓库的使用者是人 + AI Agent。修改代码前先读这份文件，再读 `ARCHITECTURE.md` 与 `PROJECT.md`。
> 最后更新：2026-10-31（新增本地存储目录开发规范，登录鉴权保持原路径）

## 1. 仓库真相表（Ground Truth）
| 路径 | 性质 | 说明 |
|------|------|------|
| `IDEA.md` | 需求源头 | 原始想法 + 已确认决策；**不得改写「一、原始想法」原文** |
| `PROJECT.md` | 范围与里程碑 | 决定「做什么 / 不做什么」的唯一依据 |
| `ARCHITECTURE.md` | 技术方案 | 决定「怎么做」的唯一依据（含依赖版本与目录约定） |
| [`docs/STORAGE.md`](docs/STORAGE.md) | 存储规范 | 完整目录树、内容归属和路径用法；涉及存储的开发必读 |
| `CHANGELOG.md` | 变更记录 | 每次核心修改追加一条，最新在上 |
| `README.md` | 启动方式 | 命令以它为准 |
| `AGENT.md` | 本文件 | Agent 行为规范 |
| `reference/**` | **只读** | 参考资料（`cordis-mini` / `ComfyUI` / `ComfyUI_frontend`），禁止修改，禁止运行时 import |
| `plugins/**` | **独立仓库** | 每个插件自带 `.git`（如 `anka-jot`、`anka-quickdraw`），独立提交与远程；核心仓库已忽略，不纳入核心提交 |
| `design/**` | 设计过程 | 方案草案 / UI 线框 / 交互原型的**已提交**目录（`design/README.md` 为索引）；**非事实来源**，定稿后并入 `ARCHITECTURE.md` / `docs/`；**临时/未定稿的设计方案一律写 `design/tmp-design/`**，该目录已被忽略、不入库 |
| `data/**` | 运行数据 | 宿主/应用/AI 持久数据，不入库；规范见 `docs/STORAGE.md` |
| `server/**` | 后端 | FastAPI + 移植的 cordis 内核 |
| `web/**` | 前端 | Vue 3（PWA 交付形态） |

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
10. **应用导航统一归宿主**：切应用用 `uiCtx.navigation.switchApp(appId)`；内部路由用 `push/replace`，已有内部栈注册 `canGoBack/back`。禁止插件监听顶层 `popstate` 或直接改顶层 history；系统返回不得切回其他插件，根页保持当前应用。完整接口见 `docs/NAVIGATION.md`。
11. **提交边界**：核心仓库（本仓库）只提交核心服务本身——`server/**`、`web/**`、`docs/**`、`design/**`、`scripts/**` 与根目录文档。`plugins/**` 已被 `.gitignore` 忽略，每个插件是**独立 git 仓库**，各自提交、各自推送：
    - 禁止在核心仓库里 `git add plugins/...` / `git add -f`，也不要把插件目录变成 submodule；
    - 禁止在插件目录内替用户执行 `commit` / `push` / `reset` 等写操作（需要时代码改完即止，由用户在插件仓库提交）；
    - 插件改动不计入核心仓库的 `CHANGELOG.md`；核心仓库的变更记录只描述内核与宿主服务。
    - 排查注意：插件目录的 `git status` 要看**独立仓库**的状态，不要因为核心仓库 `git status` 干净就认为插件也已提交。
    - `design/**` 属于核心仓库，**照常提交与推送**（设计稿是决策记录，需要进远程）；
    - **临时设计方案写到 `design/tmp-design/`**（本机目录，已在 `.gitignore` 忽略）：不得提交、不得 `git add -f`、
      不得改名搬到别处绕过；定稿后移到 `design/<主题>/` 再提交。

## 3. 标准工作流

### 3.1 开工前
1. 读 `PROJECT.md` 确认当前里程碑与验收清单
2. 读 `ARCHITECTURE.md` 确认目录、接口契约、依赖版本
3. 涉及数据、文件、数据库或运行目录，先读 [`docs/STORAGE.md`](docs/STORAGE.md) 的目录树和开发用法；新增路径同时更新该规范
4. 有歧义先问人，不要靠猜；猜了也要在总结里明确说出假设

### 3.2 实现中
- 后端先：内核/插件 → `PluginManager` → 路由 → 验收脚本
- 前端先：token/样式 → 组件 → 布局壳 → 页面
- 每完成一个可验证单元，立刻运行验证命令（见 `README.md`），别攒着一起跑

### 3.3 收尾前（必须）
- 若新增/修改了**跨多个文件的结构**，更新 `ARCHITECTURE.md` 对应章节
- 若改变了**范围或里程碑状态**，更新 `PROJECT.md` 表格
- 若新增了**命令或依赖**，更新 `README.md`
- 在总结中说明：改了哪些文件、验证方式、遗留风险
- **提交前**确认 `git status` 里没有 `plugins/` 内容（红线 #11）；核心提交只含核心服务
- **临时设计方案写 `design/tmp-design/`**（未定稿草案、试做原型、一次性草图都放这里，不入库、不推送）；定稿后再按 `design/README.md` 的命名规则移入 `design/architecture|ui|assets/` 并提交

### 3.4 截图与视觉验证（本地评审用）

修 UI / 排查渲染问题常需要截图对比，统一按下面约定走，**截图永不入库**：

- **目录**：`.screenshots/<范围>/<日期>-<说明>.png`，例如
  `.screenshots/dock/2026-10-17-win-fixed.png`（`<范围>` 用 `dock` / `web` / `plugin-xxx`）；
- **禁止**把截图写到仓库根目录或 `web/` 源码目录（根目录 `dock-fixed.png` 就是反例）；
- `.screenshots/` 与根目录 `*.png` 已在 `.gitignore` 里忽略，可随时 `rm -rf .screenshots/`，不视为数据丢失；
- **需要长期留存**的对比图放 `docs/assets/` 并在文档里引用（属于文档资产，不走 `.screenshots/`）；
- 生成方式：`agent-browser screenshot <url> .screenshots/dock/xxx.png`，或项目内的 playwright 脚本；
- `playwright-cli snapshot` 产出的 aria 树（`*.yaml`）属同类临时产物，同样写进 `.screenshots/`，**不要 dump 到根目录**（根目录 `calc.yaml` / `calc2.yaml` / `chat-snap.yaml` / `login.yaml` / `mob-min.yml` 就是反例）；
- 回复用户时只描述「看了什么、结论是什么」，不要贴本地绝对路径；截图不随提交进入远程。

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
复制 `plugins/demo/`（唯一官方样本）改名最快。manifest 写 `"manifest_version": 2`
与 `"kind": "app"`；完整字段、kind 判定与错误码见 `docs/PLUGIN-SPEC.md`。
新增/修改后跑 `cd server && python -m app.cli verify <id>`（离线，退出码非 0 即有问题）。
前端用 `uiCtx.vue`（h/ref/computed…）、`uiCtx.components`、`uiCtx.icons`、`uiCtx.api` 写 UI；
后端数据经通用通道暴露：`snapshot()` → `GET /api/apps/<id>/state`，公开方法 → `POST /api/apps/<id>/call`。
放好后在插件管理页「可安装」区点安装即可，不用改任何内核代码。

**Page 源码型插件**（自带构建，`dist` 不入库）：
```
plugins/<name>/
├── plugin.json    # kind: page + build.output.entry；不写 page.entry
└── <源码>          # 构建后产出 dist/index.html
```
`plugin.json` 声明 `build.steps`（`npm ci` / `npm run build`），宿主在
「构建并安装」与「加载更新」时现场执行，产物留在插件目录内由 `/plugins` 伺服。
`dist/` 必须写进**插件仓库**的 `.gitignore`。
**每次提交源码后必须 bump `version`**——它是宿主判断插件新旧的唯一依据，
不 bump 则视为同版本；语义化规则见 `docs/PLUGIN-SPEC.md` §2.5。

### 4.2 新增一个前端页面/入口（M6+：以 App 插件形式）
1. 在 `plugins/<name>/web/index.js` 写 `setup(uiCtx)` 注册（见 4.1 App 插件）；系统插件放 `web/src/system/<name>/`
2. **页面组件必须单一元素根**（红线 #8）：需要 Teleport 时包进唯一根 div
3. **不要给路由过渡加 `mode="out-in"`**（红线 #9）
4. 不要手改 `DockBar.vue` / 壳层布局文件

### 4.3 改 cordis 内核
1. 改 `server/app/cordis/*.py`
2. 在 `server/app/cordis/PATCHES.md` 追加一行：改了什么、为什么要改、相对 `reference/cordis-mini` 的差异
3. 不允许「顺手重构」未经讨论的内核代码

### 4.4 插件内部导航与返回
1. 阅读 `docs/NAVIGATION.md`，在 `setup(uiCtx)` 或页面组件中注册本插件的返回处理器
2. 弹层处理器优先级高于内部页面；只操作本插件栈，不调用 `history.back()`
3. URL 镜像用 `navigation.setHash(appId, hash)`；深链解析只接受自己的应用路径
4. 注册返回的注销函数须在组件卸载/插件 teardown 调用；宿主卸载也会兜底清理
5. 检查 A→B 后返回仍为 B、B 内返回、根页连续返回、深链刷新、切回恢复位置
6. 原生返回后复用已有历史记录（go 恢复），禁止在 popstate 后 pushState 重建哨兵；Chrome 会跳过无新用户激活的记录。切应用须同步底部边界 URL，不留旧插件路径。
7. iframe 内部返回需专门消息桥；本次接口不能自动适配任意第三方页面

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
- 导航改动：运行 `web/scripts/check-navigation.mjs`（可选 Playwright，详见导航文档）；Android/iOS 已安装 PWA 系统手势须另做真机验证，不得把浏览器自动化写成真机通过
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


## 8. 应用运行时开发（2026-10-31）

- 应用切换必须保留 ApplicationWorkspace 的稳定父节点与实例键，不能通过 v-if 重建活跃 iframe。
- 原生后台组件须使用自己的路由上下文；跨应用打开经 switchApp/apps.open，不能改写别的应用内部栈。
- 先读 docs/APP-RUNTIME.md；关闭/重启遵循 beforeClose，父级关闭同时检查嵌套子级。
- body 弹层使用 AppPortal 或主动响应生命周期；后台暂停是协作式契约。
- 验证增加 npm run typecheck、check-app-runtime（dev/prod）与原有导航回归，截图遵循第 3.4 节。
- 本次用户显式允许在 reference/ 添加新的参考材料；既有上游项目继续只读，禁止运行时 import。

## 9. 存储目录开发规范（2026-10-31）

- 先读 [`docs/STORAGE.md`](docs/STORAGE.md)。完整目录树和开发契约统一以该文件为准；`design/architecture/local-storage.md` 保留为设计记录。所有新功能和现有插件改动必须按该规范存储；同步和备份方案仍待定。
- 宿主设置/API 凭据放 `data/system/config/`，宿主数据库放 `data/system/databases/`，安装事件等状态放 `data/system/state/`。
- 应用用 `settings.app_data_dir(name)` 取得 `data/apps/<app-id>/`，按实际使用创建 `databases/files/config/state`；禁止在插件源码目录内写业务数据。
- 平台 AI 历史与资源放 `data/ai/<类别>/`；当前只有 `sessions/`，未实现的能力不建空目录。
- 路径从 `app.settings` 获取，不能按 cwd 或插件 `__file__` 拼业务数据位置；`ANKA_DATA_DIR` 和 `ANKA_PLUGINS_DIR` 相对项目根解析。
- 媒体放应用 `files/`，通过 `/api/apps/<id>/files/<相对路径>` 读取；禁止通过插件静态目录暴露数据库或业务文件。
- 诊断放 `logs/`，PID/运行锁放 `run/`，可重建内容放 `cache/`，临时工作放 `workspace/`；只在功能实际写入时创建目录。
- 登录账号和会话签名密钥继续使用 `~/.anka/` 及原有 `ANKA_USERS_FILE`，不得随项目数据迁移。
