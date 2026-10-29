# 扫码配对、WebSocket 协议与断线语义

> 草案修订｜2026-10-28｜按用户意见简化为「扫码 → WSS → 自动绑定」。
> 本版取代此前的 hello / descriptor / profile / WS ticket / 游戏端二次批准方案；已批准实施，最终接口与验证见 [Device v1](../../../docs/DEVICES.md) 与 [实施记录](../IMPLEMENTATION.md)。

## 1. 最小闭环

当前玩家点击「手柄设备接入」→ 服务端生成短期连接码 → 手机或 ESP 扫码 →
设备建立 WebSocket → 服务端通过 bindKey 查到本人游戏目标并校验 token → 原子绑定 → 返回 bound。
打开设备接入并生成二维码就是玩家的授权动作，扫码连接后不再弹一次批准。
一个玩家一台手柄；已绑定时显示设备状态与解除按钮，不再签发第二个配对码。

User / Share / Device 三套鉴权保持独立，绑定信息只在服务端查，不放进每条控制 JSON。
手机无需登录；ESP 先启动 `device/esp32` 手柄应用，点击「扫码连接」再扫描游戏二维码。
ESP 本期直接扫码需要摄像头模块；无摄像头的反向扫码移到后续可选项，不占本期主流程。

## 2. 二维码与地址

设备连接地址保留用户提出的形式：

```text
wss://domain:port/v1/device/join?bindKey=xxx&token=xxxx
```

推荐实际二维码统一编码为：

```text
https://domain:port/v1/device/join?bindKey=xxx&token=xxxx
```

同一路径支持普通 HTTPS GET 与 WebSocket upgrade：

- 手机扫码：普通 GET 返回独立手机手柄页，页面转为 WSS 地址连接。
- ESP 扫码：应用将 scheme 换成 wss，保留 host / port / path / query 后连接。
- 调试工具：直接使用 WSS 地址；不需要手机或 ESP 实机。
- 只给 ESP 使用时也可直接生成 WSS 二维码；手机主入口使用 HTTPS。
- 普通 GET 不消耗配对凭证，预览/预取不会占用手柄；成功 WSS 接入才原子消耗。
- `/v1` 表示协议大版本，暂不重复传 protocol / profile；不增加含义不明的 more。
- 生产链接使用配置的公网地址，默认443可省端口，不把内网localhost放入公网二维码。

| 参数 | 定义 | 建议 |
|---|---|---|
| bindKey | 本次绑定请求的随机索引 | 128位随机；只定位，不单独授权 |
| token | 本次配对的随机秘密 | 256位随机；Base64URL；服务端存哈希 |
| 有效期 | 由服务器保存 | 120秒；重新生成立即作废旧码 |

服务端记录 `bindKey → 授权来源(User/Share)、player_key、app_id、room_id(可选)、runtime_id、expires_at`。
二维码不需要 userId / playerId / gameId，更不传 User Cookie 或 Share 邀请凭证。
token 是短期设备配对凭证，不是用户登录 token；持有该码可连接其目标，成功后即失效。
此选择省掉二次批准，接受「二维码持有者就是待绑定设备」的产品语义。

普通 GET 返回 no-store、Referrer-Policy:no-referrer；手机读取参数后清除地址栏敏感query。
反向代理/应用访问日志和错误日志对 join / reconnect 的 token 脱敏；不接第三方追踪脚本。

## 3. 成功绑定，无必填 hello

服务端校验 bindKey、token、期限、原授权仍有效、玩家尚无绑定、目标游戏仍在线。
验证和占用在同一原子操作中完成：两设备同时扫码只允许一台成功。
连接建立后服务端首先返回：

```json
{
  "type": "bound",
  "deviceId": "dev_7x2",
  "playerName": "当前角色",
  "inputHz": 60,
  "inputTimeoutMs": 150,
  "resumeToken": "<device-session-secret>"
}
```

这就是绑定完成；设备不再发送 hello / descriptor / profile 或申请额外 WS ticket。
deviceId 由服务器生成，表示当前逻辑设备会话，不承诺识别某块物理主板的永久身份。
需要诊断时可选发 `{type:'info',model:'mosaico-esp32s31',firmware:'0.1.0'}`，不影响绑定。
不要求 capabilities 协商；两类手柄使用固定输入语义，输出按本地能力处理。

resumeToken 是独立 Device 会话凭证，只用于短暂断网重连，不获得 User/Share 身份。
本期与活跃绑定同寿命：最长12小时，且不超过父授权；离房/退出/解绑立即失效。
不做30天设备注册、持久凭证轮换或应用重启后自动接管。
手机/ESP在当前页面/应用内存保存 resumeToken；刷新页面/重启应用可重新扫码。
手机随后请求陀螺仪权限是浏览器要求的用户交互，与游戏端批准绑定无关。

## 4. 连续输入：input

```json
{
  "type": "input",
  "seq": 1,
  "move": {"x": 0.4, "y": 0.8},
  "look": {"yaw": 1.2, "pitch": -0.3},
  "buttons": {"fire": false, "aim": true}
}
```

| 字段 | 含义 | 约束 |
|---|---|---|
| type | 消息类型 | 固定 input |
| seq | 当前连接内输入/动作递增序号 | 正整数；重连从1开始；不带身份权限 |
| move.x | 左右移动 | -1左、0停止、+1右 |
| move.y | 前后移动 | -1后退、0停止、+1前进；向量模长≤1 |
| look.yaw | 自上一发送帧以来视角水平增量 | 单位度；正数向右，负数向左 |
| look.pitch | 自上一发送帧以来视角垂直增量 | 单位度；正数向上，负数向下 |
| buttons.fire | 开火是否按住 | boolean |
| buttons.aim | 瞄准是否按住 | boolean |

input 带完整 move / look / buttons，缺字段/NaN/越界类型拒绝。
持续前进重复发送move.y=1，松手发0；look=0是不再转动，不是镜头归正。
look 是每帧角度增量，不是角速度或世界绝对朝向；游戏保留第一/第三人称pitch限制。
ESP/手机在本地处理陀螺仪积分、单位与屏幕方向，游戏将度转为内部弧度。
建议单帧look各轴限制±45°，异常大值拒绝并记诊断；以实际采样率验证后调整。
seq用于调试、关联动作结果和拒绝重复，不是游戏帧号，不要求跨设备同步时钟。

中立/松手帧仍用 input，无需单独release：

```json
{"type":"input","seq":2,"move":{"x":0,"y":0},"look":{"yaw":0,"pitch":0},"buttons":{"fire":false,"aim":false}}
```

## 5. 单次功能：action

```json
{"type":"action","seq":3,"action":"jump"}
```

| action | 功能 | action | 功能 |
|---|---|---|---|
| jump | 中心跳跃 | reload | 换弹 |
| next_weapon | 切换下一把武器 | grenade | 手雷 |
| shield | 护盾 | heal | 治疗 |
| roll | 翻滚 | interact | 交互拾取 |
| toggle_crouch | 蹲伏切换 | — | — |

单击识别完成才发送一次；滑动不发 action。开火/瞄准是held状态，不用action连发。
input/action共用当前连接内递增seq，不增加event_id / grant_epoch / connection_epoch字段。
同连接重复seq不重复执行；action不自动重发，断线后不重放历史动作。
游戏执行后可回 `{type:'ack',seq:3,status:'applied'}` 或 `status:'rejected',reason:'cooldown'`。
Hub仅转发不能标成applied；调试日志分别显示收到、转发和实际执行结果。

## 6. 游戏反馈

游戏回传真实状态，5–10Hz，例如：

```json
{"type":"state","hp":120,"shield":30,"weapon":"rifle","ammo":28,"reserve":196,"phase":"playing"}
```

需要时增加grenades、medkits、shieldCharges、reloading等明确字段，不使用任意方法反射。
反馈事件即时发，例如 `{type:'feedback',event:'damage',strength:0.4,durationMs:50}`。
ESP转为马达/灯，手机按本地能力显示；无马达忽略触觉字段，不影响输入。
事件属于当前连接，立即处理并设置短队列期限，重连不补播旧反馈。
只发本人状态，不给其他玩家坐标、完整房间对象或账号资料。

## 7. 频率、合并与心跳

| 项目 | 初始设计值 |
|---|---|
| 正常input | 60Hz上限；弱网时30Hz |
| 中立空闲input | 20Hz，满足150ms watchdog；ping不能代替输入保鲜 |
| 主键按下/松开、触屏抬手 | 立即发送，不等待下一空闲周期 |
| action | 每次真实单击一次 |
| state | 5–10Hz |
| ping/pong | 3秒一次，仅测RTT和连接存活 |
| 入站上限 | 建议120条/秒、单帧4KiB，超过限流或关闭 |

应用心跳：`{type:'ping',id:1,t:12345}` → `{type:'pong',id:1,t:12345}`，t原样回显。
浏览器/工具用自己的单调时钟算RTT，不比较两设备的Date.now。

WSS同连接已有序传输，本期不加输入重发/补包协议。
待消费move/buttons保留最新状态，look增量必须求和后应用，不能丢旧帧造成少转。
短开火按下/松开需保留边沿，防止一帧内按下又抬起被合并吞掉。
action用独立有限队列（最多32条，约200ms队列期限），不被连续状态覆盖。
上下文失效、watchdog触发、断线或拥塞重置时清空look累计与动作，不补历史。
客户端监测发送积压，持续拥塞停控重连；已入WebSocket/TCP缓冲的数据不能撤回。
参考：[WebSockets标准](https://websockets.spec.whatwg.org/)。

## 8. 断线和重连

游戏端超过150ms未收到有效input：归零移动、释放开火/瞄准、冻结体感，不等待ping超时。
页面隐藏/锁屏、ESP模块拔出/休眠、游戏失焦时主动发中立帧，watchdog兜底。
本地断线不暂停其他玩家比赛；单人可暂停。

短暂断网使用：

```text
wss://domain:port/v1/device/reconnect?deviceId=dev_7x2&token=<resumeToken>
```

服务器只接受有效绑定与Device会话，先停用旧连接，同设备不同时保留两条控制连接。
成功返回bound；客户端先发全中立input，重设体感基线，所有键松开后才恢复控制。
旧join二维码已经消费，不能用于重连；超期/解绑/换房/实例结束须重新扫码。
若最初bound回包尚未收到就断线，未取得resumeToken则刷新配对码重扫，不增加恢复协议。
服务器重启结束内存绑定，重新扫码；本期不做持久设备注册或跨重启比赛恢复。

## 9. 错误与内部边界

错误：`{type:'error',code:'pair_expired',message:'二维码已过期，请重新扫码'}`。
保留pair_expired、pair_used、invalid_token、player_already_bound、binding_revoked、
game_unavailable、invalid_message、rate_limited。升级前失败用适当HTTP/关闭码，不回显token。
不对授权失败无限重连。浏览器校验Origin；无Origin调试工具/ESP仍须正确凭证。
玩家目标、授权来源、当前连接身份保存在服务端，不在每条JSON中重传。
游戏接收端按User/Share本人权限订阅，Device凭证不能进入room WS或订阅其他玩家输入。
Share离房/被踢、User退出、目标结束、插件停用均立即撤销并停输入，不仅首次连接时检查。
