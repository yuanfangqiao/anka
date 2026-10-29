# Anka Handpad · ESP32-S31

ESP-Mosaico 的独立原生手柄应用，目标 **ESP32-S31**。当前开发版0.4.1。采用官方 retained Vibe/Recovery ABI 2 分区：手柄位于 `main_app`，保留 `vibe_mode` 和系统设置 `sysmeta`。

两实体键（左开火、右瞄准）、四灯、480×480 九宫格、BMI270 体感与摄像头扫码，共用 Anka Device JSON/WSS 协议。一个玩家只连接一个设备。ESP 屏幕仅显示图标，中心跳跃绿框表示在线、红框表示离线。

## 日常使用：打开应用，直接扫码

1. Mosaico 系统已配置 Wi-Fi 后，打开 Anka Handpad，自动使用系统保存的网络，同时打开摄像头扫码。
2. 游戏中点击“手柄设备接入”，将设备摄像头对准二维码。二维码包含服务器地址和一次性绑定凭证，不需要输入 host。
3. 识别成功先显示绿色勾和 QR FOUND，再显示 CONNECTING；绑定成功后进入校准页。按实际游戏姿势拿稳设备，同时按住屏幕 A+B（或实体双键）约1秒，提示 RELEASE A+B 后松开，才进入纯图标手柄。单按、先后点按不能完成校准；允许正常手抖和约15°握姿调整，只有明显转动或平放才提示重试。
4. 左实体键瞄准、右实体键开火；双键采用官方显式 GPIO 模式。键下左灯随瞄准、右灯随开火；实际 WS2812 顺序为右键 LED4、左键 LED5。短开火按压锁存至下一次网络提交。
5. 功能区滑动移动，短点执行功能；移动时显示轨迹。所有上下边缘手势均已取消，绑定后不能通过手势或中心按钮重新扫码。
6. 绑定和握姿基准锁定于本次应用会话，短断线保留手柄页、停止游戏输入并自动重连，红框显示离线；重连不重复校准。只有关机/退出应用后再次扫码。AI单击仅在尚未绑定时返回 Vibe，已绑定时忽略，避免意外退出。开发调试可通过仅USB的0x1300/method6主动返回 Vibe。

应用没有配网热点、手机配置页或服务器地址输入框。Wi-Fi 从官方 `mosaico_shared` 读取；旧系统可回退读取系统 `sysmeta/wifi` 或已有 station 记录。应用不修改系统凭证，连接配置只设为 RAM。设备尚未配置网络时，返回 Vibe Mode 的系统设置连接一次即可。

扫码接受 HTTPS/WSS、精确的 `/v1/device/join` 和有效 bindKey/token，自动取得 host/端口。生产启用 CA 证书校验及网络校时；当前开发包按用户要求启用了 HTTP/WS；生产 HTTPS/WSS 继续校验证书。localhost/127.0.0.1 会显示 LOCALHOST 提示，必须由游戏二维码提供可访问的电脑局域网地址。Device 绑定和重连凭证只保存在内存，应用重启重新扫码；短断线尝试重连并释放输入。同一会话绑定后不再开相机，使用内存设备凭证自动重连；应用重启后仍需新二维码。二维码和网络密码不输出日志，反向代理应脱敏 token 查询参数。

## 安装已有应用包

设备已有兼容 Vibe Mode 时，用官方 Iris 安装预编译包，无需重新下载 SDK 或编译。以下命令在 Anka 根目录执行：

```bash
python3 device/esp32/mosaico.py iris list --details
python3 device/esp32/mosaico.py iris system-update \
  --bundle device/esp32/build/anka_handpad-system-update.irisfw
python3 device/esp32/mosaico.py iris device-status
```

本工程 `.mosaico.json` 已设置默认应用；`mosaico.py` 转发固定版本官方 CLI，解决没有默认 project 的错误。多台设备时给命令加 `--device-id <实际ID>`。

`system-update` 是官方命令名称，实际范围以包内清单为准。本包只含分区表与 `main_app`，没有 bootloader、Vibe Mode 或用户 NVS 镜像。会替换当前主应用；保留其他未保存的应用前，应先在 Vibe Mode **Develop > Save Current Build** 保存。安装手柄后也可在此保存到本地 My Ideas，之后在设备中直接打开。

当前是原生手柄 Idea 的本地 Iris 开发包，未发布商城 ZIP 或取得六位安装编号，也不是 Mosaico-Claw 的 Lua 技能。官方资料：[入门指南](https://mosaico.ai/zh-hans/guide)、[CLI](https://github.com/esp-mosaico/esp-mosaico-vibe/blob/main/docs/mosaico-cli_CN.md)。

## 独立开发环境与构建

Python3.10+、Node/npm 和 Git。源码、工具链与依赖放在工程忽略目录，运行固件不引用 `doc/mosaico` 缓存。

```bash
cd device/esp32
python3 tools/bootstrap.py --idf --tools --archive-submodules --github-host github_vitcou
# 可选：体感轴符号、本地明文调试等；没有 Wi-Fi/host 配置项
./tools/idf.sh menuconfig
./tools/idf.sh build
python3 tools/check_host.py
# 只打包，不安装
python3 tools/package_firmware.py
```

`--github-host` 是可选 SSH 别名，只影响本工程 SDK checkout；也可用 `ANKA_GITHUB_HOST`。已校验的依赖不会重复下载。SDK 在 `.sdk/esp-idf`、工具在 `.sdk/tools`、库在 `.deps`。`idf.sh` 为子进程激活这些路径，不修改电脑其他 SDK。

`dependencies.json` 锁定 SDK/BSP/utils/quirc 和工具，`dependencies.lock` 锁定 Component Manager 组件。应用使用 LVGL 原生矢量图标，无中文字库或字体生成步骤。构建会运行 `tools/check_camera_patches.py`，强制核对官方 SC101IOT PCLK=0ns 和 DVP frame-tail 补丁实际写入源码，避免嵌套 Git 导致补丁被静默跳过。

## 模块

- `controller.c`：输入快照、neutral 恢复、动作队列。
- `gesture.c`：10px 拖动阈值、350ms短点、取消与归一化。
- `navigation.c` / `controller_system.c`：边缘退出、AI 键、释放输入、摄像头清理、官方 Recovery 返回接口。
- `controller_ui.c` / `controller_icons.c`：纯图标九宫格、红绿连接框、相机预览与取消。
- `controller_scan.c` / `camera_pixels.c`：开机持续扫码、640×640中心亮度裁切；预览与解码任务独立，灰度帧采用最新帧替换。
- `controller_camera.c`：按官方样例同步DMA/PPA缓存，将同一裁切区域转为360×360彩色预览；翻开镜头使用90度旋转、不加镜像。
- `controller_decode.c`：低优先级解码，320px快速检测加640px回退，单精度 FPU 和1024区域上限。
- `controller_scan_ui.c`：相机线程只写帧邮箱，LVGL线程独占画布刷新，避免跨线程图像缓存阻塞。
- `pairing.c`：识别/连接/成功/失败状态与会话代次，阻止旧帧和旧连接覆盖重新扫码。
- `controller_trace.c`：触点、移动轨迹和抬手淡出；绘制层不截获输入。
- `controller_sensors.c`：模块发现、双键防抖、角速度、静止校准、灯光与限时马达。
- `controller_wifi.c`：只读复用系统网络、STA 自动重连、SNTP。
- `controller_link.c` / `controller_url.c`：扫码取得 TLS origin、JSON、分片、心跳、重连。
- `controller_debug.c`：官方 Iris USB 指针和真实屏幕帧读取，用于实机自动化；诊断仅返回非敏感状态。

接口以 [Device v1](../../docs/DEVICES.md) 为准。Iris 诊断 service `0x1300` 的 method1读取状态（含实际显示帧、解码时间和光学识别次数）、2重新扫码、3暂停扫码；method4仅在USB握手后注入解码结果，供无线连接测试，不算光学扫码验证。不返回 SSID、密码、token 或二维码内容。截屏复制已输出的 RGB565 帧，不从 USB worker 重新驱动 LVGL 渲染。

## 安装与验收边界

工程引入官方 `system_update.cmake`，生成 `build/anka_handpad-system-update.irisfw`。完整构建、官方包校验与真实安装已执行；不采用原生 `idf.py flash` 或恢复出厂安装流程。构建时对所有 app 分区做大小比较会提示较小的 `vibe_mode` 放不下主应用，实际安装目标是官方打包验证过的 `main_app`。

主机 C 测试验证实际手势/边缘分类、扫码 URL 和 quirc 解码。实机安装、系统 Wi-Fi、相机采集、屏幕截图与导航结果见 [实施记录](../../doc/mosaico/IMPLEMENTATION.md)；USB 注入的触摸事件不能替代物理触摸手感、实际双键、体感轴向、相机对准真实二维码或马达体验验收。

继续验收：按住双键同时滑动、断网150ms释放、体感方向/漂移、相机弱光/方向、15分钟堆栈/温度、断电重开、手机与 ESP 更换绑定、退出/登出撤权。

## 第三方许可

ESP-Mosaico BSP/utils 和 ESP-IDF：Apache-2.0/各组件许可；quirc：ISC。缓存保留源码与许可证；分发固件时保留依赖许可和通知。旧字体工具未参与当前固件构建。

## 拍屏识别与 USB 帧诊断

0.2.8在320px快速路径失败且出现二维码候选时，立即尝试480px整数盒式采样，最后回退640px旋转采样，减少LCD/传感器栅格引起的网格尺寸误判。原始取景和显示方向不受解码回退影响。`qr_pixels.c` 与主机测试共享真实预处理代码。

USB诊断0x1300/method5接受4字节小端灰度偏移，首次offset=0占用最新完整640×640灰度帧，顺序读取至409600字节后释放；没有可用帧则重试。仅允许已建立的USB会话，不经网络输出摄像头数据。SDK RPC注册容量固定为12并在编译时检查。

## 0.2.10 实体交互修订

绑定后校准屏幕由 CST9220 完整多点快照判定 A+B，LVGL常规单指输入仍保持原样。校准记录当前重力方向、屏幕横向和陀螺仪偏置，在横握、竖握、反向握持时按基准投影视角增量，采样前和松手前不发送游戏动作。`imu_calibration.c`是与主机测试共用的纯C算法；握姿明显变化或屏幕平放时拒绝校准。

USB诊断0x1300/method1附加 sessionLocked、calibration、模块在线/错误、真实按压计数、aim/fire等；method7是本应用双指QA输入，12字节第二字节为指针0/1。标准0x1001 pointer/v1仍严格要求第二字节为0。

本次参考官方 interaction_board_demo，并下载完整BSP master到 `doc/mosaico/upstream/esp-mosaico-bsp-latest`，参考提交7cbfb390638dcb93522fc3cde094b2d43cf907c2；固件现有依赖锁保持原版本。

0.2.11校准页整体顺时针90°，触摸快照使用相应逆变换，A/B有效触区额外扩展10px。按住约800ms并采集至少40个样本即可完成，容许15°姿态调整和150ms短暂接触丢帧；完成时仍要求A+B同时接触，提前松开不会误过。静态陀螺仪去偏改为机会式独立估计，手抖方差不会阻塞握姿校准，也不会被写成固定漂移。

## 0.3.0 当前交互与姿态

校准页保持顺时针90°。A/B或实体双键按住约800ms后，提示 RELEASE TO SET GRIP，松开全部键时记录当前实际握姿；不检查必须立起、不拒绝自然手抖。屏幕左A对应实体左，右B对应实体右；实际游戏左开火、右瞄准，LED5/4随同对应。

BMI270独立任务200Hz，完整相对四元数以pose.id/q发送，网络约60Hz；服务端保留最新姿态，游戏相对校准视角求目标角，避免delta丢包、三维路径和pitch限幅的累积误差。六轴没有磁北参考，长期航向漂移不能靠绝对包格式消除。机会式静态偏置与重力倾斜校正仍保留。

绑定期间不再响应边缘重扫/退出，普通断线保留握姿与内存凭证持续重连；明确撤权或凭证失效仍需要重新扫码。四位小数归一化溢出导致的invalid_message已修为六位小数，服务端对1e-4内舍入误差归一化；真实斜向滑动和跳跃回归通过。USB诊断新增pose.id/q/gaps和linkError，方便区分网络与IMU采样问题。

0.3.1统一手柄页与校准页的正常握持方向，功能命中/滑动/轨迹共享90°逆变换；输出四元数对水平航向和roll作约定转换，保持俯仰方向。游戏接收端需同时更新到1.3.1，以修正大角度俯仰折返和首包吞角度。

## 0.4.1 中心移动 / 顶排实时转身

中央圆起手拖动移动，顶排起手横滑严格超过76逻辑像素激活；门槛后每152像素180°，1/3格60°。同次按住锁定激活锚点，反向回滑不重复死区。短点功能保留，其他格拖动不移动/不误发功能；纵向离开半格取消转向。轨迹显示半格门槛和金色旋转提示，与手机使用相同比例。

turn保留兼容圆周角，新增double保存的turnTotal完整累计快照，普通松手/输入释放/重连保留；neutral携带当前值。游戏1.4.1优先应用完整角度差，避免快速跨180°反向混叠。零增量不重复处理，不做10°阶梯量化；连续输入约60Hz携带最新状态。体感叠加及单指规则保持。实现说明见[两端对齐与实时转身](../../doc/mosaico/design/10-controller-parity-and-live-turn.md)。
