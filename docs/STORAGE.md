# 项目存储目录规范

现有功能已于 2026-10-31 按此规范落地。目录只在实际使用时创建，不为未来功能创建占位目录。

本文件是存储目录的正式开发规范，完整目录树、内容归属与代码用法统一在此维护。
`AGENT.md` 要求涉及存储的开发先读本文件，`ARCHITECTURE.md` 引用本规范；设计稿保留为决策记录。

## 目录结构

以下是目录分类约定，包含后续功能的位置；不代表这些目录当前都已创建。

```text
项目根目录/
├── server/                         # 宿主程序
├── web/                            # 前端程序
├── system-plugins/                 # 随宿主发布的系统/轻量默认插件
├── plugins/<app-id>/               # 应用插件程序，可独立外挂
│
├── data/                           # 有保留价值的持久数据
│   ├── system/                     # 宿主数据
│   │   ├── config/
│   │   │   ├── settings.json       # 系统设置
│   │   │   └── credentials.json    # 模型/API 凭据，与登录账号分开
│   │   ├── databases/
│   │   │   ├── agentos.db          # 业务同步数据库
│   │   │   └── rooms.sqlite3       # 房间邀请、Share 访客授权
│   │   └── state/
│   │       ├── ledger.jsonl        # 插件安装事件
│   │       ├── ledger.snapshot.json # 安装事件投影
│   │       └── plugin-backups/     # 插件修改前的源码副本
│   │
│   ├── apps/<app-id>/              # 各应用插件的持久数据
│   │   ├── databases/              # 应用数据库
│   │   ├── files/                  # 图片、附件、业务文件
│   │   ├── config/                 # 应用设置
│   │   ├── state/                  # 应用持久状态
│   │   └── ai/                     # 应用专属 AI 内容，按需创建
│   │
│   └── ai/                         # 平台 AI 持久数据
│       ├── agents/                 # Agent、subagent 定义
│       ├── skills/                 # 技能及其私有脚本、参考资料
│       ├── scripts/                # 独立复用脚本
│       ├── tools/                  # 工具定义
│       ├── prompts/                # 提示模板
│       ├── workflows/              # 工作流定义
│       ├── model-profiles/         # 模型配置
│       ├── mcp/                    # MCP 连接配置
│       ├── knowledge/              # 知识原件
│       ├── memory/                 # 长期记忆
│       ├── sessions/               # 对话历史（当前已使用）
│       ├── runs/                   # 任务、子任务与需保留的执行状态
│       └── artifacts/              # 生成文件与成果
│
├── logs/                           # 运行、异常、调试日志
├── cache/                          # 可重建的缓存、索引、预览与中间文件
├── run/                            # PID、运行锁等临时运行文件
└── workspace/<task-id>/             # Agent 临时工作文件

~/.anka/                            # 独立于项目，登录鉴权保持现状
├── users.json                      # 登录账号
└── auth_secret                     # 登录会话签名密钥
```

现有 assets、docs、design、scripts、device 等源码和文档目录保持原用途。
对话历史属于持久数据；诊断日志放 logs，可重建的 AI 检索索引放 cache。
需要保留的工作成果放入相应应用 files 或 AI artifacts，workspace 只用于临时处理。

## 宿主与应用

| 内容 | 默认位置 | 代码入口 |
|---|---|---|
| 系统设置 | data/system/config/settings.json | settings.USER_SETTINGS_FILE |
| 模型/API 凭据 | data/system/config/credentials.json | settings.CREDENTIALS_FILE |
| 业务同步库 | data/system/databases/agentos.db | settings.SYNC_DB |
| 房间邀请与 Share 访客授权 | data/system/databases/rooms.sqlite3 | settings.ROOMS_DB |
| 插件安装事件及已有投影 | data/system/state/ledger* | settings.LEDGER_FILE / LEDGER_SNAPSHOT |
| 插件修改前的源码副本 | data/system/state/plugin-backups/ | settings.PLUGIN_BACKUP_DIR |
| 对话历史 | data/ai/sessions/ | settings.SESSIONS_DIR |
| 应用数据根 | data/apps/<app-id>/ | settings.app_data_dir(app_id) |
| Jot 数据库 | data/apps/anka-jot/databases/jot.db | 应用数据根 / databases |
| Jot 原件及已有缩略图 | data/apps/anka-jot/files/media/ | 应用数据根 / files |
| 番茄数据库 | data/apps/anka-pomodoro/databases/tomato.sqlite3 | 应用数据根 / databases |
| 登录账号、会话签名密钥 | ~/.anka/users.json、auth_secret | 现有 auth 配置，保持原状 |

插件程序继续放在 plugins/<app-id>，业务数据不得存入其源码目录。
插件前端构建产物与构建方式沿用现有机制，本次未变更。

## 开发用法

```python
from app import settings

app_root = settings.app_data_dir(name)  # name 与 plugin.json 的 id 一致
database_dir = app_root / 'databases'
files_dir = app_root / 'files'
# 只有实际读写该功能时才由存储代码创建对应目录。
```

应用配置放 config，必要持久状态放 state；应用专属 AI 内容按需要放本应用 ai 子目录。
平台 AI 后续目录约定为 agents、skills、scripts、tools、prompts、workflows、model-profiles、mcp、knowledge、memory、sessions、runs、artifacts。
当前只存在实际使用的 sessions；后续实现对应能力时再创建其他目录。

## 应用文件访问

登录用户通过 GET/HEAD `/api/apps/<app-id>/files/<相对路径>` 读取应用 files 内的文件，支持媒体 Range。
例如 Jot 媒体：`/api/apps/anka-jot/files/media/<分片>/<文件>`。
接口不能访问 databases、其他相邻目录或越界软链接；data 不作为静态目录整体公开。
Jot 数据库和客户端保留的 `data/media/...` 是逻辑媒体引用，前端转换为上述接口地址，不再对应源码内的物理 data 目录。

## 路径与其他运行目录

DATA_DIR 默认是项目根的 data；ANKA_DATA_DIR 可覆盖。
APP_PLUGINS_DIR 默认是项目根的 plugins；ANKA_PLUGINS_DIR 可覆盖，后端、Vite 与插件构建脚本均读取该配置。
相对值基于项目根解析，不随启动 cwd 改变。设置路径本身不会创建目录。
日志在 logs，PID 在 run；可重建缓存在 cache，临时工作在 workspace，后两者有实际功能使用时再创建。
用户鉴权路径和覆盖方式保持原状，不新增 data/auth、data/system/identity 或未来功能占位目录。

本规范只管理本地目录与内容归属。同步、备份方案待定。
