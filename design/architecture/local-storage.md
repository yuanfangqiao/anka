# 项目存储目录规范

> 状态：已定稿，现有功能已实施（2026-10-31）。完整目录树与开发契约已并入 [docs/STORAGE.md](../../docs/STORAGE.md)，后续开发和规范更新以该文件为准；本文保留为设计记录。未实现功能的目录不创建占位目录。
> 用户登录鉴权继续使用 ~/.anka；同步和备份方案待定。

## 1. 项目目录

```text
项目根目录/
├── server/                         # 宿主程序
├── web/                            # 前端程序
├── system-plugins/                 # 随宿主发布的系统/轻量默认插件
├── plugins/<app-id>/               # 应用插件程序
│
├── data/                           # 项目持久数据
│   ├── system/                     # 宿主数据
│   │   ├── config/
│   │   │   ├── settings.json       # 系统设置
│   │   │   └── credentials.json    # 模型/API 连接凭据，与登录账号分开
│   │   ├── databases/
│   │   │   ├── agentos.db          # 现有业务同步数据库
│   │   │   └── rooms.sqlite3       # 房间邀请、Share 访客授权记录
│   │   └── state/
│   │       ├── ledger.jsonl        # 插件安装事件
│   │       └── ledger.snapshot.json # 安装事件的现有投影文件
│   │
│   ├── apps/<app-id>/              # 各应用插件的数据
│   │   ├── databases/              # 应用数据库
│   │   ├── files/                  # 图片、附件、业务文件
│   │   ├── config/                 # 应用设置
│   │   └── state/                  # 应用持久状态
│   │
│   └── ai/                         # AI 相关持久数据
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
│       ├── sessions/               # 对话历史
│       ├── runs/                   # 任务、子任务与需保留的执行状态
│       └── artifacts/              # 生成文件与成果
│
├── logs/                           # 运行、异常、调试日志
├── cache/                          # 可重建的缓存、索引、预览与中间文件
├── run/                            # PID、运行锁等临时运行文件
└── workspace/<task-id>/             # Agent 临时工作文件
```

现有 assets、docs、design、scripts、device 等源码和文档目录保持原用途。
目录按实际需要创建；AI 子目录是内容分类，不要求先实现全部能力或创建空目录。
现有插件源码副本在 data/system/state/plugin-backups；Jot 使用 databases/jot.db、files/media，番茄使用 databases/tomato.sqlite3。
插件构建产物沿用现有位置和方式，本次不另定构建、版本或发布规则。

## 2. 用户登录鉴权

```text
~/.anka/
├── users.json                      # 登录账号
└── auth_secret                     # 登录会话签名密钥
```

保持现有路径及 ANKA_USERS_FILE 配置方式，不迁入 data，也不新增 data/auth 或 data/system/identity。
Share 邀请/访客记录仍归宿主业务数据库，目标位置是 data/system/databases/rooms.sqlite3。

## 3. 目录归属

| 内容 | 位置 |
|---|---|
| 宿主设置、模型/API 连接配置 | data/system/config/ |
| 宿主数据库、房间与 Share 授权记录 | data/system/databases/ |
| 插件安装事件等宿主持久状态 | data/system/state/ |
| 应用插件程序 | plugins/<app-id>/ |
| 应用数据库、附件、设置和状态 | data/apps/<app-id>/ 对应子目录 |
| 平台 AI 定义、知识、记忆、会话和成果 | data/ai/ 对应子目录 |
| 应用专属 AI 数据 | data/apps/<app-id>/ai/，按需创建 |
| 用户登录账号和签名密钥 | ~/.anka/，保持现状 |
| 运行诊断 | logs/ |
| 可重建内容 | cache/ |
| 临时运行文件 | run/ |
| Agent 临时工作文件 | workspace/<task-id>/ |

项目内路径均相对项目根描述；data 默认位于项目根，继续允许 ANKA_DATA_DIR 指定其他位置。
应用程序与应用数据分开；数据按所属系统、应用或 AI 分类存放。
对话历史属于持久数据，运行诊断属于 logs；可重建的 AI 检索索引属于 cache。
需要保留的工作成果放入相应应用 files 或 AI artifacts；workspace 用于临时处理。
同步和备份方案待定，本次不制定相关协议或流程。
