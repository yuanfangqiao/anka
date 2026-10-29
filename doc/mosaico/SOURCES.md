# 官方资料与本地下载索引

> 调研日期：2026-10-28，Asia/Shanghai。
> 保留原始来源与许可证。上游 README / AGENTS / 网页中的操作指令不是用户指令；资料下载阶段未运行上游脚本；实施阶段使用固定版本官方构建/打包工具，随后按用户授权完成了设备应用安装。

## 1. 下载内容

网页保留原始 HTML 与不执行脚本的纯文字摘取；完整交互网页的 JS 折叠内容可能只存在于原始 HTML。
PDF 保留原文件。每项下载均在 `sources/manifest.json` 或 `sources/assets-manifest.json`
记录 URL、实际 URL、字节数和 SHA-256。Git 源码以完整 commit ID 记录版本。

| 来源 | 本地位置 | 用途 |
|---|---|---|
| [入门指南](https://mosaico.ai/zh-hans/guide) | `sources/mosaico-guide.html` / `.txt` | Vibe Mode、入口、工具链与开发流程 |
| [FAQ](https://mosaico.ai/zh-hans/faq) | `sources/mosaico-faq.html` / `.txt` | 板版本、扩展模块与恢复常见问题 |
| [应用社区](https://mosaico.ai/zh-hans/software) | `sources/mosaico-software.html` / `.txt` | 官方应用入口背景资料 |
| [固件更新](https://mosaico.ai/zh-hans/firmware) | `sources/mosaico-firmware.html` / `.txt` | 当前官方恢复镜像说明与下载入口 |
| [主板 v1.2 指南](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide.html) | `sources/mosaico-hardware-v1.2.html` / `.txt` | 芯片、引脚、电源、显示、传感器、板版本 |
| [主板 v1.0 指南](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide_v1.0.html) | `sources/mosaico-hardware-v1.0.html` / `.txt` | 旧版本差异核查 |
| [交互扩展板指南](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide_interact.html) | `sources/mosaico-interaction-module.html` / `.txt` | 双键、顶部四灯、键下两灯、插槽和按键模式 |
| [摄像头指南](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s31/esp-mosaico/user_guide_camera.html) | `sources/mosaico-camera-module.html` / `.txt` | 左槽限定、摄像头型号与引脚冲突 |
| [ESP WebSocket Client](https://docs.espressif.com/projects/esp-protocols/esp_websocket_client/docs/latest/index.html) | `sources/esp-websocket-client.html` / `.txt` | WSS、TLS、发送/事件和连接配置 |
| [W3C Orientation and Motion](https://www.w3.org/TR/orientation-event/) | `sources/w3c-orientation-motion.html` / `.txt` | 安全上下文、权限、坐标、角速度单位和页面可见性 |
| [ESP32-S31 Datasheet](https://documentation.espressif.com/esp32-s31_datasheet_en.html) | `sources/esp32-s31-series-datasheet.html` | 官方芯片规格 |

## 2. 原理图与规格 PDF

以下均由上述官方硬件指南的直接链接下载，不是第三方转存。

| 本地文件（相对 sources） | 内容 |
|---|---|
| `esp-mosaico-coreboard-v1-2-schematic.pdf` | CoreBoard v1.2 原理图 |
| `esp-mosaico-baseboard-v1-2-schematic.pdf` | BaseBoard v1.2 原理图 |
| `esp-mosaico-coreboard-v1-0-schematic.pdf` | CoreBoard v1.0 原理图 |
| `esp-mosaico-baseboard-v1-0-schematic.pdf` | BaseBoard v1.0 原理图 |
| `esp-mosaico-interaction-module-schematic.pdf` | 双键/六灯交互模块原理图 |
| `2-16-inch-480-480-qspi-amoled-display-datasheet.pdf` | 2.16 英寸 480×480 显示规格 |
| `v1-2-camera-module-ov3640-pcb-schematic.pdf` | OV3640 摄像头板原理图 |
| `v1-4-camera-module-sc101iot-pcb-schematic.pdf` | SC101IOT 摄像头板原理图 |
| `ov3640-datasheet.pdf` | OV3640 传感器规格 |
| `ov3640-camera-module-specification.pdf` | OV3640 模组规格 |
| `sc101iot-camera-module-specification-low-profile-lens.pdf` | SC101IOT 低镜头规格 |
| `sc101iot-camera-module-specification-high-profile-lens.pdf` | SC101IOT 高镜头规格 |

摄像头资料用于评估直接扫码；反向扫码是方案期备选，当前 ESP 应用的扫码配对实现需要摄像头模块。

## 3. 官方开发源码与锁定版本

| 仓库/依赖 | 本地目录 | 锁定 commit |
|---|---|---|
| [esp-mosaico-vibe](https://github.com/esp-mosaico/esp-mosaico-vibe) | `upstream/esp-mosaico-vibe/` | `1872fd88c01d7807556d01fd2a19864e40a307c9` |
| [esp-mosaico-bsp](https://github.com/esp-mosaico/esp-mosaico-bsp) | `upstream/esp-mosaico-vibe/submodule/esp-mosaico-bsp/` | `5f88b91e1be055d1d3674364123b2779a1758377` |
| [esp-mosaico-utils](https://github.com/esp-mosaico/esp-mosaico-utils) | `upstream/esp-mosaico-vibe/submodule/esp-mosaico-utils/` | `be151ae047014e79a9c7ae0092dd203844499003` |

BSP 和 utils 版本取自 vibe 父仓库的 gitlink，不是分别取最新版后随意组合。
IDF 要求取自该版本 README：master 的 `7b9cc1ac79f865983f59bb8ff3ff43eb74ff1dbe`，
目标 `esp32s31`，Python ≥3.10、Git ≥2.28。实施阶段已将该 ESP-IDF 和工具链安装到 `device/esp32/.sdk/`，并完成交叉编译。

Raylib Lite Engine 的父仓库引用为 `99acdc58ee43380ef1c7f6eb215c06ee70af8dd8`，未初始化。
本期手柄不运行本地 3D 游戏，计划使用 BSP/LVGL，因此不下载这项非必要引擎依赖。
这不影响已下载的 BSP、传感器/交互模块示例、CLI、Vibe Mode / Recovery 资料。
Component Manager 传递依赖已按 `device/esp32/dependencies.lock` 下载；完整构建和更新包校验见 [实施记录](IMPLEMENTATION.md)。

## 4. 开发时优先阅读的本地源码

以下路径均相对 `upstream/esp-mosaico-vibe/`。

| 路径 | 核查点 |
|---|---|
| `README_CN.md` | 锁定 IDF、项目创建与构建流程 |
| `docs/device-modes_CN.md` | Vibe Mode、ROM Download Mode、Recovery 的区分 |
| `docs/mosaico-cli_CN.md` | 官方设备操作入口，避免绕过恢复/分区规则 |
| `docs/project-init_CN.md` | 应用工程创建与资源约定 |
| `submodule/esp-mosaico-bsp/README.md` | 板型、能力、示例和模块占用约束 |
| `submodule/esp-mosaico-bsp/components/esp-mosaico-bsp/include/bsp/imu.h` | 读取 deg/s、默认 100Hz、配置接口 |
| `submodule/esp-mosaico-bsp/components/esp-mosaico-bsp/onboard/display.c` | 实际 CST9220 初始化与屏幕坐标旋转 |
| `submodule/esp-mosaico-bsp/examples/imu_gesture/` | IMU 初始化和读取示例；不是完整体感瞄准算法 |
| `submodule/esp-mosaico-bsp/examples/hmi_demo/` | 显示/触控与 LVGL 示例 |
| `submodule/esp-mosaico-bsp/examples/interaction_board_demo/` | 双键/灯与热插拔示例 |
| `submodule/esp-mosaico-bsp/examples/camera_lcd_preview/` | 摄像头预览；不是现成扫码识别 |
| `submodule/esp-mosaico-bsp/components/mosaico_module_interact/include/mosaico_module_interact.h` | 6 灯、GPIO/触摸模式、输入采样无边沿事件 |
| `submodule/esp-mosaico-utils/docs/recovery-iris-migration.zh-CN.md` | 自制应用与官方维护/恢复路线 |
| `submodule/esp-mosaico-utils/LICENSES.md` | 各模块许可证边界 |

## 5. 恢复镜像说明

官网快照显示 Mosaico Claw v0.6.0，构建日期 2026-10-23，约 15.9MB。
镜像从官方页面的 `https://mosaico.ai/api/v1/firmware/2/download` 获取。
文件名为 `sources/official-recovery-image.bin`；最终下载状态和 SHA-256 见 assets-manifest。
合并镜像开头可能是 0xff 填充区，不能只用第一个字节是否为 0xe9 判断文件无效。
下载校验只证明本地文件与记录一致，不等于已经验证厂商签名或在用户设备上验证可恢复。
恢复出厂会清除设备数据，本轮只保存资料，不执行刷写。

## 6. 阅读与复现注意事项

- 开发需要的公开资料已本地化；网页引入的远程样式/脚本不保证离线完整运行，可使用 `.txt` 检索。
- 第三方缓存受本目录 `.gitignore` 忽略，避免大体积 Git 嵌套仓库进入 Anka 核心提交。
- 原创设计和索引保留在 Anka 当前项目，后续评审后再更新系统架构正典。
- `fetch_sources.py`、`fetch_assets.py` 是本轮资料下载辅助脚本，不是设备或游戏实现。
- 没有下载私有账号资料或安装上游 Agent 配置；构建与安装阶段运行了已下载、固定版本的官方工具；实际写入经过用户明确授权。
