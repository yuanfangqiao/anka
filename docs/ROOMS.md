# 插件房间与访客鉴权

2026-10-26。适用于带后端的游戏 App 插件，首个接入为 `anka-outpost-strike`。

## 身份与期限

- 房主使用现有 `anka_session` 账号会话。
- 邀请是 256 位随机 capability，URL fragment 中传递，服务端只存 SHA-256。
- 邀请创建后 **10 分钟内可兑换、一个客人席位、原子兑换**。GET 落地页不消耗邀请。
- 兑换后签发独立 `anka_guest_session` Cookie：**从兑换成功起 24 小时**，
  HttpOnly / SameSite=Lax；HTTPS 下 Secure。邀请到期、重新生成邀请都不会缩短已兑换会话。
- 刷新与临时重连继续使用 Cookie，不重新兑换邀请；重复兑换不滑动延长原期限。
- 会话只允许指定插件的编译资源和指定房间；账号级 `/api/apps`、设置、笔记、
  聊天、插件管理和现有文档同步通道仍要求完整账号。
- 显式离开、移除玩家、关闭房间或停用插件会提前撤销相应房间权限。
  当前一个浏览器保存一个访客房间 Cookie。

## 插件接入

插件 `backend.entry` 声明 `inject=['rooms']`，在 `fiber.effect` 中调用
`ctx.rooms.register(app_id, definition_factory)`，返回注销函数。
definition 提供 `root / entry / build / protocol / maps / characters` 及
`host_events / guest_events`。游戏规则与战斗实现留在插件。

`rooms` infra 插件提供能力存储、房间状态机与有界 WebSocket 转发；
HTTP 适配器只校验请求并调用服务。身份从 Cookie 推导，JSON 不能指定自己的角色。
房间操作与游戏消息不走通用 App 的公开方法调用通道。

## 入口与接口

| 路径 | 用途 / 权限 |
|---|---|
| `/join/{app}/{room}#invite=...` | 公开的最小邀请落地页，本地脚本读取 fragment |
| `/play/{app}` | 已登录账号打开游戏；有效访客跳转自身房间 |
| `/play/{app}/{room}` | 房间成员打开同一份编译游戏 |
| `POST /api/rooms/{app}` | 已登录账号创建房间 |
| `POST /api/rooms/{app}/{room}/redeem` | 凭邀请兑换访客 Cookie |
| `GET /api/rooms/{app}/{room}` | 房间成员读取状态与会话期限 |
| `POST .../invite` | 房主生成新邀请，旧的未兑换邀请失效 |
| `POST .../command` | character / map / ready / start / loaded / finished / lobby / kick / leave / close |
| `WS .../ws` | 校验 Origin、身份、成员关系、构建号、协议及逐消息角色权限 |

WS 首帧为 `{type:'hello', build, protocol:1, round}`。大厅快照由服务端定序；
战斗帧绑定当前 round 与服务端确定的发送玩家。心跳、最大消息 32 KiB、
每连接每秒 90 条、最多 64 条待发消息和发送超时防止无界堆积。
新邀请与访客凭证不进入日志；兑换和创建接口另有限流。

## 房间生命周期

`lobby → loading → countdown → playing → finished → lobby`。
两人在线并准备后才能开始；修改地图取消双方准备。双方确认相同轮次资源加载后，
以服务端时间倒计时。加载超过 60 秒回大厅。

临时断线保留席位 30 秒，比赛等待连接恢复并扣除等待时间。
刷新页面不复原整场物理世界，双方回大厅重新准备。房主离线超时关闭房间；
客人离线超时释放席位并撤销其授权。移除客人后需房主生成新邀请。

邀请与访客凭证持久化在 `data/system/databases/rooms.sqlite3`（`ANKA_DATA_DIR` 指定 data 根）；
活跃房间与连接在内存中，当前按**单实例、单 worker**运行。
服务器重启后旧房间不可恢复，需要重新建房；不把旧凭证升级为站点账号。

## 部署

设置 `ANKA_PUBLIC_URL=https://你的域名`，生成可被好友访问的规范链接。
省略时使用请求来源，开发通过 Anka Vite 时 `/api`、`/join`、`/play` 保留 Host。
生产应使用 HTTPS + WSS，反向代理须支持 WebSocket upgrade。
访客入口与房间 API 不使用 Service Worker 的壳页面回退或 API 离线缓存。

插件自带 `build` 配方：安装时依次构建游戏、构建 Anka 原生入口、加载后端。
构建失败不激活新安装；原生入口和游戏各自使用暂存目录再替换完整产物。
已有活跃房间时禁止更新，避免同房间混用版本。

## 验证

在 Anka 根目录运行：

```sh
PYTHONPATH=server .venv/bin/python -m unittest discover -s server/tests -v
```

游戏仓库的 `test:online` 验证伤害/弹药/复活/成绩权限；
`scripts/verify-room-browser.mjs` 使用 Playwright 的两个独立浏览器上下文，
验证桌面与手机尺寸的邀请、大厅、真实 WS 状态、移动、刷新与撤权。
本地浏览器验证不等同于 iOS/Android 真机或跨公网延迟验收。
