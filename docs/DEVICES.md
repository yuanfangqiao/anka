# Device v1：扫码手柄

Anka 的 `devices` 是可装卸的 infra 服务，App 用 `ctx.devices.register(appId)` 注册接入能力。
当前唯一设备类型为手柄；每个游戏中的每位玩家最多绑定一个手机或 ESP 手柄。
设备状态保存在单进程内存中。部署使用一个应用 worker；服务重启会使内存凭证失效，需要重新扫码；接收端短暂断线保留有效绑定并自动重连。

## 身份和授权边界

| 身份 | 凭证 | 可以做什么 |
|---|---|---|
| User | `anka_session` | 为自己的单机玩家或自己房间的房主创建配对 |
| Share | 指定房间的 `anka_guest_session` | 仅为该房间中自己的访客玩家创建配对 |
| Device | QR 的 bindKey/token；绑定后的独立 resumeToken | 只向已绑定玩家发送控制消息 |

三个入口分别校验，不会相互回退。手柄页面无需登录，不读取 User/Share 凭证。
设备 WS 只接收查询参数凭证，Cookie 不产生设备权限。游戏规则、伤害和补给判定仍由原游戏执行。
用户登出、访客失效/离开、房间关闭、插件卸载均撤销手柄绑定。游戏接收端断线立即释放输入，保留绑定直到原授权失效或明确解绑。

## 配对与接口

游戏先打开接收端，然后创建二维码。`principal` 必须为 `user` 或 `share`。
`runtime` 是当前游戏接收页生成的随机实例 ID，`room` 单机时为空。

| 方法 | 路径 | 用途 |
|---|---|---|
| WS | `/api/devices/{principal}/{app}/receiver/ws?runtime=...&room=...` | Cookie 验证游戏接收端 |
| POST | `/api/devices/{principal}/{app}/pairings` | `{runtime,room}` → `{url,wsUrl,expiresAt}` |
| POST | `/api/devices/{principal}/{app}/unbind` | `{runtime,room}`，解除当前玩家设备 |
| GET | `/v1/device/join?bindKey=...&token=...` | 打开公开手机手柄页，不消耗配对 |
| WS | `/v1/device/join?bindKey=...&token=...` | 原子绑定；无 hello、二次 ticket 或批准步骤 |
| WS | `/v1/device/reconnect?deviceId=...&token=...` | 使用 resumeToken 恢复同一设备会话 |
| GET | `/controller?debug=1` | 无实机 JSON 调试页，粘贴配对链接 |

二维码为 `https://域名/v1/device/join?bindKey=...&token=...`。
手机扫码直接打开；ESP 应用扫码后校验预设服务器域名和端口，再将 scheme 改为 `wss`。
服务端用 bindKey 查出游戏、玩家和实例。二维码 120 秒单次有效；重新生成立即废弃旧码。
同一玩家已绑定时必须先解除。连接成功直接返回：

```json
{"type":"bound","deviceId":"dev_xxx","playerName":"玩家","inputHz":60,"inputTimeoutMs":150,"resumeToken":"独立随机凭证"}
```

resumeToken 只保存在当前页面/固件运行内存，绑定最多 12 小时且不超过父授权期限。
有效绑定下不设重试次数上限，最长5秒退避重连；撤权/无效设备凭证停止重试。重连时seq 从 1 重新开始，旧连接被替换。刷新/重启手柄应用后重新扫码。
凭证不写 localStorage、Cookie 或 NVS；二维码地址从手机地址栏移除。
服务端相关日志对 token 参数脱敏；反向代理也须关闭或脱敏该路径的查询参数日志。

## JSON 控制协议

活跃时 60Hz、空闲时约 20Hz；按键变化、抬手立即发送完整状态。无需二进制协议。

```json
{"type":"input","seq":1,"move":{"x":0,"y":0},"look":{"yaw":0,"pitch":0},"buttons":{"fire":false,"aim":false}}
{"type":"input","seq":2,"move":{"x":0.4,"y":0.8},"look":{"yaw":1.2,"pitch":-0.3},"buttons":{"fire":false,"aim":true}}
{"type":"action","seq":3,"action":"jump"}
{"type":"ping","id":1}
```

- `seq` 是此连接内 input/action 共享的递增正整数，重复或倒序输入忽略。
- `move`：x 右正、y 前正，分量 [-1,1]，向量长度 ≤1。
- `look`：触控观察/旧客户端的本帧角度增量，单位度；yaw 右正、pitch 上正，每轴 ±45°。
- `pose`（可选）：`{"id":1,"q":[1,0,0,0],"gain":1}`，相对本次校准的完整单位四元数，顺序w/x/y/z；id为校准世代正整数，gain范围0.25–3。ESP和手机体感使用此字段，look保持零。姿态取最新值，不叠加；中间帧丢失不丢失累计旋转。
- `turn`（可选）：归一化到[-180,180]的累计屏幕转身偏移（度，右正），默认0；为绝对快照，合并时取最新值，抬手/重连保留，不因非零阻塞neutral。游戏应用其圆周差值到观察基准，停手不连续转动。
- `turnTotal`（可选，ESP0.4.1/游戏1.4.1）：未取模的完整累计屏幕转角，单位度，右正，有限数值且绝对值≤1e9；快照合并取最新值，松手/重连保留。游戏优先应用总角度差值，避免快速跨180°/完整圈数被误判方向；恢复首个neutral只重建基线。旧客户端缺省时继续使用turn圆周差值。
- `buttons`：fire/aim 是布尔保持状态；完整 input 不允许省略字段。
- action：`reload / next_weapon / grenade / shield / jump / heal / roll / interact / toggle_crouch`。
- 动作结果：`{"type":"ack","seq":3,"status":"applied","reason":""}`。
  status 为 `applied / submitted / rejected`。访客向房主提交权威判定操作时返回 submitted，
  不把网络提交冒充最终生效。无资源、跳跃条件不满足或过期会 rejected。
- 反馈：`{"type":"feedback","event":"shot","strength":0.2,"durationMs":25}`。
  event 支持 shot/damage/reload_complete/death/win；仅控制灯光/短震动，不下发 HUD。
- 单帧上限 4KiB、每秒 120 条，非法类型、NaN/Infinity、越界值断开。连接失败返回 error/closed 后关闭。

接收页以 `{"type":"receiver","active":true}` 报告状态，至少每秒一次；收到 input/action/release 后送入游戏输入路由。
输入队列合并移动/按键/turn最新值，累加触控视角增量、替换完整pose，保留极短开火上升沿。动作队列有界且最多保留 200ms。

## 松手、暂停与接管

绑定/重连、150ms 没有 input、手柄失焦/隐藏、触摸取消、游戏暂停/死亡/隐藏都会清空保持输入。
ping 不延长开火或移动。恢复输入必须先出现按键/移动/look全零的neutral input（完整pose不影响neutral判断）；断线动作不重放。
键鼠/游戏本机触控操作会释放并挂起设备输入。游戏点击手柄入口后“继续游戏”恢复设备，避免两套输入互相抢占。
网络 watchdog 在服务端和游戏帧循环各执行一次；游戏本身的技能/弹药/射速规则继续适用。

## 手机与 ESP 交互

手机：上方左开火、右瞄准双键、四灯、九宫格。ESP：左实体键开火、右实体键瞄准及四灯，480×480 屏只有九宫格。
中心跳跃绿框在线、红框离线。没有应用标题条、在线标签、生命和弹药。
0.4.1两端按起手位置锁定：中央圆拖动移动；顶排横滑严格超过半列间距激活，门槛后的位移每格180°、1/3格60°。同次按住只激活一次，反向回滑立即跟随，不重复死区；停手停止、松手保留方向。顶排短拖不误触功能，纵向偏移超过半格取消转向。其余格只点按。触控区只跟踪首指，主键仍独立并发。实现见[两端对齐与实时转身](../doc/mosaico/design/10-controller-parity-and-live-turn.md)。

手机体感需要可信HTTPS和用户点击授权；首次连接弹出引导。优先使用浏览器完整方向姿态，缺失时使用六轴融合备用；屏幕转向或重新校准建立新基准，普通抬手/断线不会重置基准。可调灵敏度和仅瞄准启用，拒绝/无传感器可切换触控观察。支持Vibration API的浏览器在收到伤害等反馈时震动；iOS Safari未提供该接口时明确显示限制并保留灯光反馈，不能承诺网页调用iPhone马达。

ESP使用BMI270，以独立200Hz任务融合六轴姿态、约60Hz发送完整姿态；0.3.1在设备边界校正水平航向符号、保持俯仰符号，手机体感符号不变。正常握持时手柄页和校准页统一顺时针90°，触点用相同逆变换，拖动轨迹跟随实际触点。游戏解算选取连续Euler分支，避免超过90°的俯仰折返与垂直姿态的水平翻转；首个姿态按校准基准完整应用。重力校正倾斜，航向仍是相对值，没有磁北绝对参考，长期存在传感器漂移边界。应用只读复用系统Wi-Fi，host/端口从二维码取得。流程为扫码→绑定→按A+B约800ms→松开全部键确定当前握姿→手柄。平放/竖握/倾斜均接受，不再强制立起或拒绝自然抖动。静止去偏只在有可靠静止数据时估计。实体左右及屏幕A/B按用户实际组装方向对应。

绑定后上下边缘和AI单击均不重扫/退出；断线保留页面、姿态及有效Device凭证，持续重连。正常关机或应用重启重新扫码。独立工程和官方Iris安装说明见 `device/esp32/README.md`。

## 接入与部署

```python
# App Service：声明 inject = ['devices', ...]
ctx.fiber.effect(lambda: ctx.devices.register('your-app-id'))
```

游戏端按 `game/input-router.js` 与 `game/device-receiver.js` 模式桥接自己的引擎，无需修改 Device 凭证协议。
设置 `ANKA_PUBLIC_URL=https://你的域名`，或局域网开发用 `http://电脑局域网IP:5173`（协议和端口必须完整，不能填localhost）；反向代理对 `/api/devices/` 和 `/v1/device/` 启用 WebSocket Upgrade，
提供同域 HTTPS/WSS，保留请求 Origin。手机和设备须能访问同一域名；localhost 二维码仅用于本机自动化。
单独公开的 `/controller` 是能力受限的设备页面，不加载账号壳。Service Worker 不缓存配对、设备接口和手柄页。

## 验证

```bash
PYTHONPATH=server .venv/bin/python -m unittest discover -s server/tests -v
node web/scripts/check-controller-input.mjs
node web/scripts/check-controller-lifecycle.mjs
node web/scripts/check-controller-pose.mjs
cd web && npm run build
# 游戏独立仓库
cd plugins/anka-outpost-strike
npm run test:controller
npm run test:game
npm run test:online
npm run test:fps
```

真实浏览器验收：终端 A 启动 `PYTHONPATH=server .venv/bin/python server/tests/device_browser_server.py`，
终端 B 执行 `node web/scripts/check-controller-browser.mjs`。需要本机 Playwright + Chrome；可用
`ANKA_PLAYWRIGHT_MODULE=/绝对路径/playwright/index.mjs` 指定包。测试创建隔离临时账号/数据，不更改现有用户。
双人访客验收另运行 `node web/scripts/check-controller-share.mjs`，PWA 缓存验收运行 `node web/scripts/check-controller-pwa.mjs`。
脚本连接真实服务、实际生产游戏产物和匿名手柄页，检查自动配对、滑动不误触、跳跃、射击、断线释放及两个视口。
浏览器自动化不替代实机陀螺仪、摄像头、灯光、马达和 Wi-Fi 时延验收。

### 本地手机体感HTTPS

已有反向代理时使用可信HTTPS同域入口，更新 `ANKA_PUBLIC_URL` 后重启后端。需要Vite直接终止TLS时，设置 `ANKA_DEV_TLS_CERT` / `ANKA_DEV_TLS_KEY` 为手机已信任的证书/私钥路径，并将 `ANKA_PUBLIC_URL=https://证书域名:5173` 后重启前后端。普通自签证书或点击忽略证书错误不等同于可信安全上下文。当前没有证书时保留HTTP触控和ESP扫码链路，界面明确说明体感不可用。
