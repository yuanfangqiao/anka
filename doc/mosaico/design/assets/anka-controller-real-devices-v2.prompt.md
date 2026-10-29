# 实物参考版手柄发布效果图

日期：2026-10-28。工具：内置 image_gen，两阶段图像编辑。

- 最终图：[anka-controller-real-devices-v2.png](anka-controller-real-devices-v2.png)
- 原设计：[anka-controller-concept-v1.png](anka-controller-concept-v1.png)
- 用户实物参考：[anka-controller-real-devices-reference.png](anka-controller-real-devices-reference.png)
- 保留真实设备的模块化造型、PIR穹顶、双键、孔阵、相机及iPhone深色保护壳；屏幕合成已确认的手柄界面。
- 第二次编辑只去掉ESP屏幕内重复的虚拟双键与灯，扩大九宫格；手机仍使用虚拟双键。
- 图中保留「界面效果示意」，不将生成的屏幕合成图记录为功能运行实拍；本轮未开发功能或发布到外部平台。

## 初次编辑提示词

```text
Use case: precise-object-edit / identity-preserving product compositing.
Asset type: a Chinese product launch presentation image for ANKA custom game controllers.

INPUT ROLES:
Image 1 (anka-controller-concept-v1.png) is the EDIT TARGET. The user has approved all its functions, Chinese explanatory text, 3×3 UI layout and communication. Preserve that visual hierarchy, navy-and-gold art direction, headline and three bottom interaction explanations.
Image 2 (codex-clipboard-14902db7-dcac-4c59-b315-9bbcebdcf120.png) is the AUTHORITATIVE REAL HARDWARE PHOTO REFERENCE, not the canvas to reproduce. It is a 2048×1072 screenshot containing two real device photographs. The real ESP-Mosaico photograph is approximately x589–813, y194–732. The user's real iPhone 17 photograph is approximately x1327–1593, y194–733. Extract these device identities from the photograph regions only. Remove browser chrome, desktop dock, whiteboard, original scribbles and white surroundings completely.

PRIMARY EDIT:
Replace BOTH invented device bodies in Image 1 with faithful, photographic representations of the user's actual ESP-Mosaico and actual iPhone 17 from Image 2. Use the real hardware silhouettes, construction and casing details rather than inventing new industrial design. Make them look like the user's same two physical units photographed professionally for a product announcement, with clean cutout edges, realistic material, controlled studio light, coherent soft floor shadows, and natural frontal perspective. The controller UIs are new screen composites, not claims of unedited real gameplay photographs.

ESP-MOSAICO HARD IDENTITY CONSTRAINTS:
The actual unit is NARROW and TALL, around 2.4 times as high as wide. Preserve three distinct cream/beige modular blocks with horizontal seams and the thin dark straight backing/border, not a wide monolithic curved concept casing. Upper module: preserve the large translucent white PIR dome at its top center, the small circular photoresistor at upper left, and the small electronics detail at upper right. Preserve the exact TWO tall square ivory mechanical keycaps, their modest recessed mounting and subtly textured surfaces. Preserve the broad field of small evenly spaced circular perforations under the keycaps — this perforated grille is a crucial recognizable real-hardware feature. The approved four-light feedback can glow subtly at the module's existing indicator/light-strip region beneath the keys, without drilling four new round holes or replacing the PIR dome/grille. Do not redesign the original keycaps: keep their actual blank ivory faces, explain their actions with the existing external "双主键 / 瞄准 / 开火" callout. Middle module: preserve actual square black glass display with strongly rounded glass corners inside the ivory square frame. Composite the approved nine-function controller UI ONLY inside the active display. Bottom module: preserve the real short cream rectangular camera attachment with the orange-red circular lens surround and small black center lens. Do not replace it with a fictional large cinematic camera. Preserve the real device proportions even if the narrower unit leaves more negative space. No analog sticks, no new grips, no extra physical controls.

IPHONE 17 HARD IDENTITY CONSTRAINTS:
Match the user's exact pictured phone from Image 2: black/dark protective case with a slightly raised rim, rounded rectangular shape, the warm amber/gold side-button accents visible along the right edge, original bezel thickness and top Dynamic Island. Keep the case rather than replacing it with a naked generic metallic iPhone. Remove the white rough wireframe content from its screen and insert the approved ANKA controller webpage from Image 1, fitted accurately within the real screen corners and island safe area. Preserve the TWO large virtual main keys "瞄准" (L) and "开火" (R), FOUR virtual status lights, the square 3×3 pad and lower life/ammo status. No fictional extra hardware.

UI INVARIANTS ON BOTH SCREENS:
Dark navy tactical interface, restrained gold pictograms, clearly readable Chinese.
Exact nine positions:
Top row "换弹" | "切换武器" | "手雷".
Middle row "护盾" | one large circular center "跳跃" | "治疗".
Bottom row "翻滚" | "交互拾取" | "蹲伏".
Exactly eight peripheral functions and a circular jump center, no omissions, no duplicated functions. The ESP screen may use more compact text than the phone but labels must stay readable. Do not rotate the UI sideways, even though the old demo in the reference photo was sideways.

BOARD / TEXT:
Preserve title "ANKA 自定义游戏手柄".
Update subtitle to "ESP-Mosaico × iPhone 17".
Preserve the quiet line "扫码即连接 · 一人一台".
Small top-right badge should read "界面效果示意" rather than "概念设计".
Keep left label "ESP32-S31 实体手柄"; right device label "iPhone 17 网页手柄".
Keep external callouts "双主键" with "瞄准 / 开火", and "四灯反馈" with "状态清晰", pointing to the corresponding real hardware regions.
Preserve the three bottom teaching panels with readable exact copy:
"滑动＝移动" / "在九宫格内滑动控制角色移动"
"单击＝功能" / "点击任意功能区域触发对应动作"
"转动＝视角" / "转动设备控制游戏视角"
Preserve small diagrams showing drag, tap and gyroscope turn. No dense technical protocol, no URLs/tokens, no working QR code.

OUTPUT:
One polished, high-resolution landscape launch-ready presentation image, same approximately 3:2 aspect ratio as Image 1, highest native resolution available, sufficient breathing room and sharp type. Image 2's real physical hardware identities take priority over Image 1's fictional body design. Improve photographic cleanup without erasing real distinctive construction or changing the devices into unrelated product renders. Keep the actual dark case on the phone and the PIR dome, perforated grille and narrow modular form on Mosaico. No browser screenshot elements, no watermark, no extra products, no hands obscuring the devices.
```

## 屏幕校正提示词

```text
Use case: precise-object-edit.
Input image is the current photographic ANKA controller presentation and is the EDIT TARGET.
Make ONE local correction ONLY: replace the display content inside the LEFT ESP-Mosaico's middle black glass screen. Everything else must remain unchanged: the iPhone and its complete UI, all headline and explanatory text, background, exact real Mosaico casing/PIR dome/blank physical keycaps/perforated grille/four physical LEDs/camera module, device proportions, shadows, all labels, and bottom interaction strip.

The problem: the LEFT ESP physical device already has two real mechanical keys and four real lights above its display, but the current display unnecessarily duplicates two virtual main keys and a virtual four-light row, shrinking its nine-function pad.
Correction: REMOVE the virtual "瞄准 L" / "开火 R" buttons and the virtual four-light row from INSIDE the Mosaico display ONLY. The real physical keys and lights above the screen MUST remain unchanged.
Fill the actual left display with a large, readable square 3×3 function grid, using the existing dark navy / warm gold icon style. Optional tiny ANKA / 已连接 header can remain only if the grid still takes nearly the entire display. Do not change the size or shape of the real glass display or enlarge the device body.

EXACT left screen grid:
top row: 换弹 | 切换武器 | 手雷
middle row: 护盾 | large circular 跳跃 | 治疗
bottom row: 翻滚 | 交互拾取 | 蹲伏
Exactly eight surrounding rectangular tiles and one central circular jump button, aligned cleanly, with larger legible labels and crisp pictograms. No permanent joystick or directional pad on top of the grid.
The physical Mosaico should have ONLY the TWO original physical main keys, and its screen ONLY the nine-function pad; the smartphone MUST retain its virtual main keys and four virtual lights exactly as currently shown.

Keep all other pixels/composition as close to the input image as possible. Same landscape aspect ratio and highest native resolution available. No new features, no added text or watermarks.
```

