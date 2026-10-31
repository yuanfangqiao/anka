# 插件契约（Plugin Spec）

更新：2026-10-31。本文件是插件体系的**正典契约**：manifest 字段、kind 判定、
生命周期状态、错误码。代码与本文件冲突时，以本文件为准并同步修订代码。

相关：`ARCHITECTURE.md` §8（App 插件模型）、`AGENT.md`（开发红线）、
`docs/NAVIGATION.md`（`uiCtx.navigation` 契约）。

应用存储遵循 `docs/STORAGE.md`：后端通过 `app.settings.app_data_dir(name)` 取得 `data/apps/<id>/`，按实际使用创建 `databases/files/config/state`，禁止向插件源码内写业务数据。
附件使用登录保护的 `GET/HEAD /api/apps/<id>/files/<相对路径>`，与插件程序静态资源分开。

---

## 1. 三种 kind

| kind | 位置 | 后端 | 前端 | 可装卸 |
|------|------|------|------|--------|
| `infra` | `server/app/plugins/*.py`（扁平文件） | 是 | 无 | 否（启停受 `PLUGIN_CONFIG` 控制） |
| `app` | `plugins/<id>/` | 可选 | `setup(uiCtx)` 原生渲染 | 是 |
| `page` | `plugins/<id>/`（可无 `plugin.json`） | 无 | 静态页，iframe 加载 | 是 |

### 1.1 判定优先级

扫描 `plugins/<name>/` 时按顺序判定，命中即停：

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | 目录含 `plugin.json` 且 `kind` 合法 | 以 `kind` 为准 |
| 2 | 目录含 `plugin.json`，有 `ui.entry` | `app` |
| 3 | 目录含 `plugin.json`，有 `page.entry` 或 `build.output.entry` | `page` |
| 4 | 目录含 `plugin.json`，仅有 `backend.entry` | `app`（无 UI 的后端插件） |
| 5 | 无 `plugin.json`，命中 `PAGE_ENTRIES` | `page`（自动发现，M11） |
| 6 | 其余 | 忽略并告警 |

`infra` 不走目录扫描：`server/app/plugins/` 下的扁平 `.py` 由 cordis `Loader`
直接加载，不出现在「可安装」清单里。

`PAGE_ENTRIES`（按优先级）：`index.html`、`dist/index.html`、`web/index.html`。

**兼容红线**：无 `plugin.json` 的静态页目录必须永远可用。quickdraw 这类
「自带源码、提交 dist」的插件依赖这条通道，不能要求它补 manifest。

---

## 2. manifest v2 字段表

文件固定为插件根目录下的 `plugin.json`，UTF-8 JSON。**不引入第二个清单文件**
（`manifest.json` / `package.json` 均不承担此职责）。

### 2.1 顶层

| 字段 | 类型 | 必填 | 缺省 | 说明 |
|------|------|------|------|------|
| `manifest_version` | int | 否 | `1` | `2` 启用本节全部字段；`1` 行为与旧版完全一致 |
| `id` | string | 是 | — | 必须等于目录名（`E_ID_MISMATCH`） |
| `name` | string | 是 | — | 展示名 |
| `version` | string | 是 | — | 语义化版本 |
| `icon` | string | 否 | `package` | lucide 图标名 |
| `description` | string | 否 | `""` | 一句话说明 |
| `system` | bool | 否 | `false` | 系统插件标记（UI 静态捆入内核） |
| `kind` | string | 否 | 推断 | `infra` / `app` / `page`（见 §1.1） |
| `backend` | object | 否 | — | 见 §2.2 |
| `ui` | object | 否 | — | 见 §2.3 |
| `page` | object | 否 | — | 见 §2.4 |
| `build` | object | 否 | — | 见 §2.5，app / page 安装与更新时执行 |
| `runtime` | object | 否 | `{}` | 前端运行策略：keepAlive / preload / background，见 [应用运行时](APP-RUNTIME.md) |
| `permissions` | list[string] | 否 | `[]` | 安装授权声明，仅展示，不参与鉴权（P2 落地） |

**`icon` 的优先级**：app 类插件优先用本字段——宿主在 `setup(uiCtx)` 返回后用该值覆盖
`registerApp({ icon })` 传进来的**字符串**，因此插件代码里写旧了不影响显示（两处仍应
一致，见 `plugins/README.md` §6）。两种情况保留插件自己的图标：本字段不是合法 lucide 名
（如 emoji `🍅`），或插件注册的是自绘组件（`Component`，如 anka-pomodoro 的番茄）——
清单里的字符串无法表达它们。`page` 类应用与「插件市场」可用列表读的始终是本字段。

### 2.2 `backend`

| 字段 | 类型 | 说明 |
|------|------|------|
| `entry` | string | 相对插件根目录，如 `server/main.py`；必须存在（`E_ENTRY_MISSING`） |

模块必须导出 `apply(ctx, config)` 或 `Service` 子类，且 `meta.name == id`。
`page` 类不得声明 `backend`（`E_MANIFEST_FIELD`）。

### 2.3 `ui`

| 字段 | 类型 | 缺省 | 说明 |
|------|------|------|------|
| `entry` | string | — | 前端入口（`.ts/.js/.vue`），必须存在 |
| `dock.order` | int | `100` | dock 排序 |
| `sidebar` | bool | `false` | 是否注册侧栏（已废弃，保留兼容） |
| `route` | string | `/<id>` | 前端路由；page 类固定 `/app/<id>`（见 §2.4） |

`page` 类不得声明 `ui`。

### 2.4 `page`

| 字段 | 类型 | 说明 |
|------|------|------|
| `entry` | string | 静态页入口（相对插件根目录），必须存在 |

page 类**不得声明 `ui`**，因此无法自定义路由：路由固定为 `/app/<id>`，与无
`plugin.json` 的自动发现（§1.1 优先级 5）完全一致——补 manifest 不会改变既有深链。

### 2.5 `build`（recipe，安装/更新时执行）

| 字段 | 类型 | 缺省 | 说明 |
|------|------|------|------|
| `cwd` | string | `"."` | 命令工作目录，不得逃出插件根目录 |
| `requires` | list[string] | `[]` | 如 `node>=18` 或 `node>=22.12.0`；缺失时安装前判定失败 |
| `steps` | list[object] | `[]` | `[{"run": "npm ci --ignore-scripts"}]` |
| `output.entry` | string | — | 构建产物入口，供 `page` 类回填 `page_entry` |
| `timeout` | int | `600` | 单步超时（秒） |

执行时机（P2 / M19，`page` 与 `app` 类源码插件）：

- `dist/` **不入库**（插件仓库 `.gitignore` 忽略），宿主拉取源码后现场构建；
- 安装（`POST /api/plugins/{id}/install`）与插件管理页的「加载更新」
  （`POST /api/plugins/{id}/build`）都执行 `build.steps`；
- 执行前先校验 `requires`（如 `node>=18`），不满足直接失败、不执行任何步骤；
- 每步独立超时（`timeout`），失败返回 `E_BUILD_FAILED`，消息含出错步骤与日志尾；
- 全部步骤成功后必须存在 `build.output.entry`，否则同样判失败；
- 扫描/体检允许产物暂时缺失（刚拉下源码）：`doctor` 输出 `build_pending: true`，
  不算问题；
- 构建成功后宿主清单的 page 入口带产物 mtime（`?v=<mtime>`），前端重挂 iframe
  即加载新构建，不依赖浏览器缓存失效。

`app` 的 `build` 用于编译独立运行时（例如游戏的 `dist/index.html`），
不代替 `ui.entry`。安装依次执行 recipe → 原生入口构建 → 后端加载 → ledger；
任一构建失败不激活新安装。原生入口使用暂存目录，失败保留上一完整产物。
有活跃房间时禁止更新；游戏自身也应将暂存构建成功后再替换 `dist`。
源码型 app 同样不提交 `dist/`；房间接入见 [ROOMS.md](ROOMS.md)。

**版本号规则（必须遵守）**：`version` 是宿主判断「是否有更新」的唯一依据。

1. 代码提交后必须同步 bump `plugin.json` 的 `version`（与源码同一提交，或紧随其后
   的提交）——即「先提交源码，再写版本号」；
2. 语义化：修复 `patch`、向后兼容的新能力 `minor`、破坏性变更 `major`；
3. 不 bump 版本 → 宿主与插件管理页视为同一版本，用户点「加载更新」也无法分辨新旧；
4. ledger 记录的是安装时的 `version`；重新安装或构建后写入新值。

`build.steps[].run` 的静态校验规则（`verify` 与执行前都会校验）：

- 只允许 `shlex.split` 后直接 `exec`，**不使用 shell**；
- 命令白名单：`npm`、`node`、`npx`、`pnpm`、`yarn`、`bun`、`python`、`python3`、`pip`；
- 禁止元字符 `; & | $ \` > < ( ) { } * ? ~` 与换行；
- 禁止 `..` 路径穿越。

无法用 JSON 表达的复杂构建，写 `scripts/build.sh` 并在 `steps` 里只留一行调用，
授权弹窗会展示脚本全部内容。

### 2.6 `permissions`（P1 仅展示）

| 值 | 含义 |
|----|------|
| `net` | 出站网络访问 |
| `fs:write:<path>` | 写插件目录下的指定路径 |
| `fs:read:<path>` | 读插件目录外的路径 |
| `exec` | 运行 `build.steps` 之外的子进程 |

P1 只把 `permissions` 透出给 `AvailablePlugin`，安装接口不做授权弹窗（P2）。

---

## 3. 目录布局

### 3.1 `app`

```
plugins/<id>/
├── plugin.json
├── server/main.py        # 可选
└── web/index.ts          # 或 web/index.js / *.vue（由 build-plugin.mjs 编译）
```

生产态安装时由 `plugin_builder.build_web(id)` 编译到 `.plugin-dist/<id>/index.js`；
开发态由 vite 中间件即时编译源码。作者**不需要**自带 `build` 配方。

同时产出 `.plugin-dist/<id>/index.css`（插件自带样式）：SFC 里 `<style>` 与源码 import 的
CSS 被抽出合并进来，另按插件源码单独跑一遍 Tailwind 生成**它用到的工具类**，主题取自
`web/tailwind.preset.js`（与宿主同源）。宿主 `pluginHost` 在导入插件模块前先注入这个
`<link>`，`/api/apps` 通过 `style` 字段下发地址。

要点：**不要假设宿主 CSS 里有某个工具类**。宿主 CSS 在宿主构建时生成，运行时安装的插件、
动态拼接的类名（`class="h-" + n`）都不在扫描范围；漏掉的类会让元素变成 0×0 静默消失。
靠本次机制插件自带工具类即可，但「错了就看不见」的几何/可见性样式仍建议写成
`ui.css.ts` 这类语义类自注入（`anka-jot` 的做法），双保险。

### 3.2 `page`

两种形态，按是否声明 `build` 区分：

```
# A. 自带产物（dist 随仓库提交）
plugins/<id>/
├── plugin.json           # 可选
└── dist/index.html

# B. 源码构建（dist 不入库，安装/更新时现场构建）
plugins/<id>/
├── plugin.json           # kind: page + build.output.entry: dist/index.html
├── package.json
└── src/ …                # 构建后产出 dist/index.html
```

无 `plugin.json` 时，`id = name = 目录名`，`icon = package`，`route = /app/<id>`。
写 `plugin.json` 时只改变元数据（展示名/图标/描述），路由仍是 `/app/<id>`。
`page` 不加载 Python、不编译前端，宿主以 iframe 伺服 `entry`。

形态 B 的 `dist/` 必须写进插件仓库 `.gitignore`：拉取源码后在插件管理页点
「加载更新」（或首次「构建并安装」），宿主重跑 `build.steps` 并重挂 iframe。

### 3.3 `infra`

```
server/app/plugins/<name>.py
```

扁平文件，`name = 文件名`，由 `settings.PLUGIN_CONFIG` 决定是否启用。

### 3.4 官方示例

`plugins/demo/` 是唯一官方样本，覆盖 `app` 类全链路（manifest v2 + Python
Service + Vue SFC）。新建插件的方式是**复制整个目录改名**，再修改 `id` /
`name` / `ui.route`，然后跑 `python -m app.cli verify <id>`。

page 类参照 `plugins/anka-quickdraw/`：上游 monorepo 原样保留，只补一份
`plugin.json`（`kind: page` + `build` 配方，产物 `dist/index.html` 不入库）。
该插件是独立 git 仓库，接入约定与版本号规则见其 `PLUGIN.md`。

作者上手、命名规范与提交前自检见 [`plugins/README.md`](../plugins/README.md)。

---

## 4. 生命周期状态机

本节记录安装/后端生命周期。前端“未打开 / 前台 / 后台保留 / 已关闭 / 异常”
另由应用运行时管理，不写入安装 ledger。切应用不卸载插件，不调用插件 setup 的 teardown。


```
DISCOVERED → AVAILABLE → INSTALLED ─┬→ DISABLED → INSTALLED
                                    ├→ FAILED → UNINSTALLED
                                    └→ UNINSTALLED
```

| manifest 状态 | 触发 | 持久化（ledger） | 对应 FiberState |
|---------------|------|------------------|-----------------|
| `DISCOVERED` | 扫描到目录 | 不写 | — |
| `AVAILABLE` | 未安装 | 无记录 | — |
| `INSTALLED` | `install` 成功 | `installed` 事件 | `ACTIVE` |
| `DISABLED` | `disable` 成功 | 沿用 `installed`（内存态） | `DISPOSED` |
| `FAILED` | 加载/构建失败 | `failed` 事件 | `FAILED` |
| `UNINSTALLED` | `uninstall` 成功 | `uninstalled` 事件 | 无 fiber |

- `page` 类无 fiber，安装后状态直接是 `PAGE`，`enable` / `disable` 返回
  「不支持启停」且不改变状态。
- 同名重装（进程内曾加载过）返回 `requires_restart: true`，不做模块卸载。
- 启停是**进程内状态**，不写入 ledger（重启后按 `PLUGIN_CONFIG` / 安装集恢复）。

### 4.1 ledger 是唯一事实来源

`data/system/state/ledger.jsonl` 为 append-only 事件流，启动时投影出已安装集合：

| 事件 | 含义 | 投影效果 |
|------|------|----------|
| `installed` | 安装成功 | 状态 = `installed` |
| `uninstalled` | 卸载成功 | 记录移除 |
| `failed` | 安装失败 | 状态 = `failed` |
| `approved` | 用户授权安装（P2） | 仅审计，不改投影 |
| `legacy_import` | 从 `installed.json` 一次性导入 | 状态 = `installed` |

- 事件行固定字段：`v` / `ts` / `event` / `id` / `version` / `kind` / `source` / `detail`。
- 单行写入 + `O_APPEND`，损坏行跳过并告警，不阻塞启动。
- 超过 `LEDGER_COMPACT_EVERY`（500）行时压缩为 `ledger.snapshot.json`（tmp + rename 原子写）。
- **禁止**再引入第二个安装状态文件；`installed.json` 只作为迁移来源，导入后改名为
  `installed.json.bak`。

---

## 5. 错误码

稳定字符串，API 放在 `detail.code`，CLI 输出到 stderr / JSON。

| 码 | 含义 | HTTP | 触发条件 |
|----|------|------|----------|
| `E_MANIFEST_PARSE` | JSON 无法解析 | 422 | `json.loads` 失败 |
| `E_MANIFEST_FIELD` | 字段缺失/类型错误/kind 非法 | 422 | 必填缺失、类型不符、`kind` 不在枚举 |
| `E_ID_MISMATCH` | `id` 与目录名不一致 | 422 | 扫描 `plugin.json` |
| `E_ENTRY_MISSING` | 入口文件不存在 | 422 | `backend` / `ui` / `page` 校验 |
| `E_BUILD_STEP_INVALID` | steps 语法或命令不在白名单 | 422 | `verify` / 扫描静态校验 |
| `E_NOT_FOUND` | 插件未发现 | 404 | `install` 未知 id |
| `E_NOT_INSTALLED` | 插件未安装 | 404 | `uninstall` / `enable` / `disable` |
| `E_ALREADY_INSTALLED` | 重复安装 | 409 | 幂等安装以外的语义（当前返回成功） |
| `E_RESTART_REQUIRED` | 同名重装需重启 | 409 | 进程内已加载过该模块 |
| `E_LOAD_FAILED` | import / apply 失败 | 500 | `folder_loader` 或 cordis 抛错 |
| `E_LEDGER_CORRUPT` | ledger 不可读且无可用快照 | 500 | 启动投影失败 |

错误响应对齐既有结构，只增不改：

```json
{ "detail": { "error": "manifest_invalid", "code": "E_ENTRY_MISSING",
              "message": "后端入口不存在: server/main.py", "plugin": "demo" } }
```

`error` 保留旧值（`plugin_not_found` / `manifest_invalid` …），`code` 是新增字段。

---

## 6. CLI

```sh
python -m app.cli doctor [--all] [--fix] [--json]
python -m app.cli verify <id> [--json]
python -m app.cli pack <id> [--out dist-packages] [--json]
```

- 全部离线，不启动 HTTP 服务；工作目录为 `server/`。
- 退出码：`0` 通过、`1` 发现问题、`2` 用法或环境错误。
- `doctor`：扫描 + ledger 投影交叉校验，报告「已装但目录缺失」「page 类缺 dist」。
- `doctor --fix`：把「ledger 为 installed 但目录已不存在」的记录追加一条
  `uninstalled`（`detail.reason = missing_dir`）后清理，只做卸载方向修正，
  绝不反向自动安装。
- `verify`：字段/入口/`build.steps` 白名单校验；`backend.entry` 在子进程中
  import 冒烟（不污染主进程 `sys.modules`）。
- `pack`：先 `verify`，再打 `.anka`（tar.gz，排除 `node_modules/.git/__pycache__/.plugin-backup`），
  输出 sha256。

---

## 7. v1 → v2 兼容

| v1 写法 | v2 行为 |
|---------|---------|
| 无 `manifest_version` | 按 1 处理：只读 `id/name/version/icon/system/description/backend/ui`，忽略其余 |
| 无 `kind` | 按 §1.1 推断 |
| 无 `build` | 不执行任何构建；`app` 类走 `plugin_builder`，`page` 类要求提交 `dist/` |
| 无 `permissions` | 视为 `[]` |
| `ui.entry` 指向 `.vue` | v1 即支持（`build-plugin.mjs` 编译），v2 不变 |

新增字段对旧插件**静默无影响**；`manifest_version: 2` 只影响校验严格度与 CLI 输出。
