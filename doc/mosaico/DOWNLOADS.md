# 本地下载状态

2026-10-28。已验证 `git@github_vitcou:esp-mosaico/esp-mosaico-vibe.git` 能连接，HEAD 为 `1872fd88c01d7807556d01fd2a19864e40a307c9`。当前无需要用户手动补下的仓库。

| 仓库/资料 | 固定版本 | 本地位置 |
|---|---|---|
| esp-mosaico/esp-mosaico-vibe | `1872fd88c01d7807556d01fd2a19864e40a307c9` | `upstream/esp-mosaico-vibe` |
| esp-mosaico/esp-mosaico-bsp | `5f88b91e1be055d1d3674364123b2779a1758377` | 上述 submodule；固件 `.deps/bsp` |
| esp-mosaico/esp-mosaico-utils | `be151ae047014e79a9c7ae0092dd203844499003` | 上述 submodule；固件 `.deps/utils` |
| espressif/esp-idf | `7b9cc1ac79f865983f59bb8ff3ff43eb74ff1dbe` | 固件 `.sdk/esp-idf` |
| dlbeer/quirc | `927d680904dc95fdff4cd9d022eb374b438ff8f2` | 固件 `.deps/quirc` |
| 官方网站、PDF、S31资料与恢复镜像 | 见 SOURCES 的日期/哈希 | `sources/` |
| RISC-V GCC/GDB、OpenOCD、ROM ELF、clangd/configdep | SDK tools.json 精确版本及哈希 | 固件 `.sdk/tools` |
| ESP 组件注册表依赖 | `device/esp32/dependencies.lock` | 固件 `managed_components/`，已下载与校验 |

Git 仓库遇到网络波动时可用 `--github-host github_vitcou`；HTTPS 组件和 release 二进制不走 SSH，可在命令前按需设置 `HTTPS_PROXY=http://127.0.0.1:7890`。不要把个人代理地址写成产品运行要求。

复现入口：`device/esp32/tools/bootstrap.py`；详细资料与许可见 [SOURCES.md](SOURCES.md)。
