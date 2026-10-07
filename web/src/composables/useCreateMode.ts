/**
 * useCreateMode —— 创造模式状态机（M17.2，v2）。
 *
 * 形态（恢复上一版 + 增强）：手势进入 → 立即 dom-to-image 整屏截屏（零权限）
 * → 全屏浮层展示截图（顶部 X 关闭）→ 可选在截图上拖拽框选裁剪 →
 * 底部指令输入 → 截图 + DOM 结构摘要 + 指令一次性发给 Agent →
 * 关闭浮层跳对话页，Agent 当场改写插件。
 *
 * 三态：off（关闭）→ capturing（截屏中）→ window（浮层）
 * 进入手势（M17 已验证，保持不变）：
 *  - 移动端：双指同时按住「左下角」与「右上角」
 *  - 桌面端：Ctrl + 点击左下角
 */

import { computed, ref } from 'vue'
import { captureScreen, type Region, type ScreenShot } from '../services/screenCapture'
import { useToast } from './useToast'

export type CreateModeState = 'off' | 'capturing' | 'window'

const { warn } = useToast()

const state = ref<CreateModeState>('off')
const shot = ref<ScreenShot | null>(null)      // 整屏截图（截屏失败为 null → 降级纯 DOM 摘要）
const selection = ref<Region | null>(null)     // 截图上的框选区域（页面 client 坐标）

const isActive = computed(() => state.value !== 'off')

async function enter() {
  if (isActive.value) return
  state.value = 'capturing'
  shot.value = null
  selection.value = null
  // 先截屏再开浮层：避免把浮层自身截进去
  try {
    shot.value = await captureScreen()
  } catch (e) {
    // 真实原因上屏（dev 预构建 504 / canvas 污染 / 指纹保护等环境差异可诊断）
    const reason = e instanceof Error ? e.message : String(e)
    console.error('[create-mode] 截屏失败', e)
    warn(`截屏失败：${reason.slice(0, 80)}，将以界面结构摘要代替`)
  }
  state.value = 'window'
}

function close() {
  state.value = 'off'
  shot.value = null
  selection.value = null
}

function setSelection(region: Region | null) {
  selection.value = region
}

// ─── 进入手势（保持 M17 已验证行为）────────────────────

let bound = false

/** 角区命中判定：左下 / 右上（30% 宽高的对角区域） */
function inBottomLeft(x: number, y: number): boolean {
  return x < window.innerWidth * 0.3 && y > window.innerHeight * 0.7
}
function inTopRight(x: number, y: number): boolean {
  return x > window.innerWidth * 0.7 && y < window.innerHeight * 0.3
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length < 2) return
  let bl = false
  let tr = false
  for (const t of Array.from(e.touches)) {
    if (inBottomLeft(t.clientX, t.clientY)) bl = true
    if (inTopRight(t.clientX, t.clientY)) tr = true
  }
  if (bl && tr) {
    e.preventDefault()
    void enter()
  }
}

function onMouseDown(e: MouseEvent) {
  if (!e.ctrlKey) return
  if (e.clientX < 96 && e.clientY > window.innerHeight - 96) {
    e.preventDefault()
    void enter()
  }
}

export function bindCreateModeGestures() {
  if (bound) return
  bound = true
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
  window.addEventListener('mousedown', onMouseDown, { capture: true })
}

export function useCreateMode() {
  return {
    state, isActive, shot, selection,
    enter, close, setSelection,
  }
}
