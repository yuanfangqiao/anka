# 纯手柄界面与跳跃连接指示设计图

日期：2026-10-28。工具：内置 image_gen 图像编辑。

- 最终图：[anka-controller-controls-only-v3.png](anka-controller-controls-only-v3.png)
- 编辑底图：[anka-controller-real-devices-v2.png](anka-controller-real-devices-v2.png)
- 保持真实设备外观与已确认功能；仅修改屏幕内容和连接状态表达。
- Mosaico屏幕只留九宫格；手机保留双主键、四灯与九宫格。
- 两端删除应用标题/Logo/连接文字，手机删除生命/弹药HUD。
- 跳跃圆环绿色表示已连接，红色表示未连接；主图展示绿色，图外另示红色状态。
- 功能代码未开发，图中保留界面效果示意。

## 最终提示词

```text
Use case: precise-object-edit / product UI correction.
Asset type: final updated ANKA controller product presentation.

INPUT ROLES:
Image 1, anka-controller-real-devices-v2.png, is the clean EDIT TARGET and the authoritative layout/real-device rendering to preserve.
Image 2, codex-clipboard-eb2688ce-fc68-4386-aedc-5a46fbc4f48c.png, is the user's ANNOTATED CHANGE REFERENCE ONLY. Its red rectangular boxes identify things to DELETE; they are not new UI elements. Do NOT reproduce the red annotation rectangles. Do NOT copy that reference's older duplicated buttons inside the Mosaico screen.

Apply these exact UI corrections while preserving all actual hardware, typography style, page composition and approved functions:

1. LEFT MOSAICO DISPLAY — FUNCTION BUTTONS ONLY.
Delete the entire tiny header row inside its glass screen: the logo, "ANKA", "前线对决", online dot, "已连接", and any title/status chip. Absolutely no app branding or header inside this display.
Do not put virtual "瞄准 / 开火" keys or a virtual four-light row inside this display; the two main keys and four real lights already exist above the physical screen.
Expand the existing 3×3 function pad to occupy the display with comfortable edge margins. Preserve exactly eight surrounding tiles and the circular central jump control:
top row 换弹 | 切换武器 | 手雷
middle row 护盾 | circular 跳跃 | 治疗
bottom row 翻滚 | 交互拾取 | 蹲伏
There must be no extra text, health, ammunition, player name or status bar inside the Mosaico screen.

2. RIGHT IPHONE SCREEN — CONTROLLER ONLY.
Delete the app header/logo row "ANKA | 前线对决", green dot and "已连接" chip.
Keep the real phone's top Dynamic Island and normal iOS time/signal/battery status area.
Keep TWO large virtual main keys: blue-accent "瞄准" with L, gold-accent "开火" with R.
Keep FOUR virtual light indicators under the two main keys.
Keep the same 3×3 functional pad beneath them, with the nine labels/positions above.
Delete the ENTIRE bottom HUD panel with the heart icon, "生命", 120, bullet icon, "弹药", and 28 / 196. No replacement game metrics or telemetry, no health/ammo/cooldown readouts.
Redistribute the controller blocks vertically to use the freed space elegantly; the 3×3 pad can grow. It must look like a dedicated game controller, not a game HUD.

3. CONNECTION STATUS IS THE JUMP BUTTON OUTLINE ON BOTH DEVICES.
Change ONLY the circular outline/rim of the CENTER "跳跃" control from gold to bright, clean GREEN to indicate connected. Keep its interior dark navy, its jump pictogram and readable Chinese "跳跃".
Both main device renders are CONNECTED, so BOTH center jump buttons have a green ring, not a gold ring. Do not color the entire grid green, and do not add an online chip.
The OFFLINE state uses the exact same jump button outline in RED. Explain that in one small clean EXTERNAL legend in the spare background area to the right of the phone, without overlapping the devices or bottom instruction strip. Legend heading "连接状态"; two tiny matching circular jump-button samples side by side: green-outline example labeled "已连接", red-outline example labeled "未连接". These samples are outside the devices, not additional touch buttons on their screens. No other large red rectangles anywhere.

PRESERVE INVARIANTS:
Same recognizable user-reference ESP-Mosaico: narrow tall cream modular frame, translucent PIR dome, photoresistor, TWO blank ivory physical keycaps, perforated grille, FOUR real light indicators, black rounded screen glass, orange-red camera module.
Same real iPhone 17 in its dark protective case with gold/amber side-button details.
Same external headline "ANKA 自定义游戏手柄" and subtitle "ESP-Mosaico × iPhone 17"; global page title may contain ANKA, only the device-screen app headers are deleted.
Keep top text "扫码即连接 · 一人一台" and small "界面效果示意".
Keep device captions "ESP32-S31 实体手柄" and "iPhone 17 网页手柄".
Keep left callouts "双主键 / 瞄准 / 开火", "四灯反馈 / 状态清晰".
Preserve bottom three instruction panels and gestures, with exact readable text "滑动＝移动", "单击＝功能", "转动＝视角", and their existing short explanation lines.

STYLE / OUTPUT:
Same premium dark-navy studio presentation with warm gold icons and faithful real-device rendering; green ring for online and red ring for offline are the only connection-state language inside the controls. Clean professional Chinese typography, high legibility, no screenshot chrome, no user annotation boxes, no watermarks. Landscape approximately 3:2 at highest native resolution available.
Final self-check: no ANKA/game-name/online text inside either device UI; no Mosaico virtual dual keys; no health/ammo anywhere on phone UI; both actual center jump rings GREEN; external legend has a RED offline ring; nine function labels remain correct and complete.
```

