# 手柄设计图生成记录

日期：2026-10-28。使用内置 image_gen 生图；仅设计效果图，未开发功能代码。

提示词原文见本次生成调用；核心要求：并排展示奶油白模块化 ESP-Mosaico 实体手柄和手机网页手柄；
双主键（左瞄准、右开火）、四颗状态灯、方形九宫格触控区；中心圆跳跃；
外围八功能固定为换弹、切换武器、手雷、护盾、治疗、翻滚、交互拾取、蹲伏。
采用前线对决深蓝灰与暖金 UI，配以「滑动＝移动、单击＝功能、转动＝视角」的交互说明。
扫码即连接，一人一台；不画摇杆，不把手机画成游戏画面，不添加复杂设备协商界面。

设计图：[anka-controller-concept-v1.png](anka-controller-concept-v1.png)。
生成工具：内置 image_gen；输出为概念效果图，不代表已完成硬件制造或功能实现。

## 最终提示词原文

```text
Use case: product-mockup with accurate UI-mockup details.
Asset type: a polished high-resolution landscape product design board for the Anka custom game controller, intended for a Chinese software and embedded hardware design review. This is a conceptual design image, not a screenshot of a working implementation.

Primary request: Show the two agreed controller forms side by side: an ESP-Mosaico ESP32-S31 physical controller on the left, and a universal smartphone displaying the new controller webpage on the right. The two forms must have exactly the same controls and readable Chinese functional labels. Use near-front orthographic product views so every control is clearly visible, with slight physically realistic depth, softly lit materials and clean industrial-design rendering.

Subject — physical controller: A narrow portrait modular device based on the actual ESP-Mosaico arrangement, NOT a conventional wide console gamepad. Warm ivory molded housing with visible clean module seams and dark screen bezel. Upper rectangular interaction module contains exactly two large square mechanical keycaps arranged horizontally, left marked "瞄准", right marked "开火", with small L and R labels. Exactly four discrete RGB status indicator lights in a horizontal line below the keys and above the display; soft under-key illumination can suggest the extra two key lights without adding extra status dots. Middle module has a square glossy 480×480 touch display. Bottom short camera module has a prominent small black camera lens within an orange-red ring, matching the reference hardware concept. No physical analog sticks, no conventional D-pad, no extra face-button cluster, no added grips.

Subject — smartphone: A realistic slim portrait phone with its screen fully visible, not tilted sideways. Its entire webpage is the controller, not a game rendering. Dark navy tactical UI consistent with Anka Outpost Strike and warm restrained gold accents. Small header "ANKA" and "前线对决", status "已连接". Exactly TWO large rounded-square main buttons in one horizontal row near the top: "瞄准" on left and "开火" on right. Directly below them, exactly FOUR small aligned status lights, echoing the physical controller. Below these is a large square 3×3 touch function pad. Small quiet status readouts like "生命 120" and "弹药 28 / 196" may be placed above or below the pad if space permits, but must not shrink the functional grid. No extra shooting or jump button outside the pad.

Invariant — same exact touch display on BOTH devices: A square 3×3 grid, with eight softly separated peripheral function tiles and ONE large circular center jump button. Each peripheral tile has a crisp simple pictogram plus a short Chinese label. The exact positions and labels, read left to right:
Top row: "换弹" | "切换武器" | "手雷"
Middle row: "护盾" | circular center "跳跃" | "治疗"
Bottom row: "翻滚" | "交互拾取" | "蹲伏"
Only the center is circular. Eight other functions occupy the four corners and four edge midpoints; no missing tile, no duplicated function. All nine tile labels must be legible and accurately written. Do not put a joystick graphic permanently over the center; the whole nine-cell pad supports drag-to-move and tap-to-activate.

Composition: Sophisticated restrained editorial board, charcoal/navy background with very subtle technical structure, generous breathing room. At the top, readable title "ANKA 自定义游戏手柄" with small subtitle "ESP-Mosaico × 手机". Under each device, concise label "ESP32-S31 实体手柄" and "手机网页手柄". Products are the main visual focus and take most of the canvas height. Keep devices similarly sized for a direct interaction comparison while preserving real hardware proportions. Add fine unobtrusive annotation leaders for "双主键" and "四灯反馈" only if they stay spacious.

At the bottom, a clean three-part interaction strip, each with a tiny precise gesture illustration and these EXACT short labels: "滑动＝移动", "单击＝功能", "转动＝视角". A quiet fourth phrase "扫码即连接 · 一人一台" can sit below the title or in the footer. Show a short ghost fingertip trail/arrow in the movement illustration, one tap ripple in the function illustration, and modest curved arrows around a small device outline for gyroscope view changes. Do not show a finger touching the main product render or hide any functional tiles.

Style: premium engineering product visualization, believable ivory plastic and mechanical keys, sharply rendered tactical UI, navy/slate/gold palette, subtle cyan/green indicator LEDs, controlled contrast, soft studio edge lighting, elegant Chinese sans-serif typography, no sci-fi holograms, no overdone neon. High resolution suitable for close design inspection. This is one coherent image, not a browser screenshot or desktop screenshot.
Constraints: preserve exactly two main buttons, four status lights, eight surrounding functions and a circular jump center on each controller. No console-brand logos, no Switch/Joy-Con silhouette, no game character artwork, no extra joysticks, no dense architecture diagrams, no WebSocket code or tokens, no actual credential-bearing QR, no watermarks. Include a small unobtrusive "概念设计" label.
```
