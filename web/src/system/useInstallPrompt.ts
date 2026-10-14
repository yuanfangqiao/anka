/**
 * useInstallPrompt —— PWA 安装引导（模块级早注册）。
 *
 * 背景（iOS 授权体验）：网页（非安装态）下 Safari 的摄像头/麦克风授权是「会话级」的，
 * 每次录音/拍照都会重新询问；加入主屏以 standalone 运行时，iOS 按「已安装应用」
 * 记住授权，只需允许一次。故这里统一提供安装态判定与安装引导。
 *
 * 注意：`beforeinstallprompt` 只触发一次且可能在任意早期时刻触发，
 * 因此监听器在模块加载时注册（由 main.ts 首行 import 保证时机）。
 */
import { ref } from 'vue'

export type Platform = 'ios' | 'android' | 'desktop'

/** 是否以独立应用（主屏/桌面安装）形态运行 */
export const standalone = ref(false)
/** 浏览器是否提供了可编程安装入口（Chromium 系） */
export const canPromptInstall = ref(false)

let deferredPrompt: any = null

export function detectStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  // iPadOS 13+ 默认桌面 UA：Mac + 多点触控
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

/** 触发浏览器安装弹窗；返回是否被接受 */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  deferredPrompt.prompt()
  try {
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      deferredPrompt = null
      canPromptInstall.value = false
      return true
    }
  } catch { /* 用户取消或平台不支持 */ }
  return false
}

if (typeof window !== 'undefined') {
  standalone.value = detectStandalone()

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault() // 抑制浏览器自带的迷你提示条，改由设置页按钮显式触发
    deferredPrompt = e
    canPromptInstall.value = true
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    canPromptInstall.value = false
    standalone.value = true
  })

  // standalone 切换（如从浏览器标签切到已安装实例）时同步
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
    standalone.value = detectStandalone()
  })
}
