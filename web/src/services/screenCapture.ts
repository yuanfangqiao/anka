/**
 * screenCapture —— 框选区域捕获服务（M17.2，v3）。
 *
 * 截屏引擎：html-to-image（bubkoo 维护，dom-to-image 系列的活跃分叉）。
 * 原理：克隆 DOM → 计算样式全量内联 → 序列化进 SVG <foreignObject> →
 * 交由浏览器原生排版引擎绘制到 canvas。CSS 变量 / 渐变 / 半透明叠层 /
 * 暗色主题全部按真实计算样式合成——根治 html2canvas 白屏
 * （其 JS 自建渲染器丢弃 backdrop-filter 且 fixed 根容器定位错乱）。
 * 纯浏览器内完成，零权限弹窗（getDisplayMedia 路线已废弃）。
 *
 * 已知环境差异与对策：
 *  - dev 模式动态 import 命中 Vite 预构建 504 → vite.config optimizeDeps.include
 *  - 失败不再静默：异常原样抛出，由调用方 toast 真实原因（便于诊断环境差异）
 */


export interface Region {
  x: number   // 页面 client 坐标（CSS 像素）
  y: number
  w: number
  h: number
}

export interface ScreenShot {
  dataUrl: string   // JPEG dataURL
  width: number     // 输出像素宽（≤1600）
  height: number
}

const MAX_WIDTH = 1600

/**
 * 整屏截屏（浮层打开之前调用，避免把浮层自己截进去）。
 * 输出宽度上限 1600，控制 dataURL 体积；失败返回 null（调用方降级 DOM 摘要）。
 *
 * 捕获归一化（截屏期间注入，结束后移除）：
 *  - 该引擎家族序列化计算样式时会丢失 border 宽度（Tailwind 预飞行的
 *    `border: 0 solid rgb(229,231,235)` 退化成 medium 灰边，全元素描边伪影）
 *    → 捕获期禁用 border/outline（卡片靠背景与 box-shadow 分层，观感无损）
 *  - backdrop-filter 在 foreignObject 光栅化下不稳定 → 禁用，
 *    玻璃/描边变量替换为按暗色底合成后的不透明色
 */
const CAPTURE_STYLE_ID = 'cm-capture-normalize'

function injectCaptureStyle(): () => void {
  const style = document.createElement('style')
  style.id = CAPTURE_STYLE_ID
  style.textContent = `
    :root {
      --line: #23262e !important;      /* rgb(255 255 255/.08) 合成于 #0b0e14 */
      --glass: #141924 !important;     /* rgb(255 255 255/.05) 合成于 #0b0e14 */
    }
    * {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      border: none !important;
      outline: none !important;
    }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

export async function captureScreen(): Promise<ScreenShot> {
  const restore = injectCaptureStyle()
  try {
    // 动态导入：~17KB 截屏库只在首次触发手势时加载，不拖累壳层启动
    const { toJpeg } = await import('html-to-image')
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scale = Math.min(1, MAX_WIDTH / vw)
    const dataUrl = await toJpeg(document.body, {
      quality: 0.85,
      backgroundColor: '#0B0E14',
      width: Math.round(vw * scale),
      height: Math.round(vh * scale),
      style: {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: `${vw}px`,
        height: `${vh}px`,
        overflow: 'hidden',
      },
    })
    if (!dataUrl || dataUrl.length < 1000) {
      throw new Error('截屏结果为空（可能命中 canvas 污染或指纹保护）')
    }
    return { dataUrl, width: Math.round(vw * scale), height: Math.round(vh * scale) }
  } finally {
    restore()
  }
}

/** 对已有截图裁剪选区子图（rect 为页面 client 坐标，零二次捕获）。 */
export async function cropRegion(shot: ScreenShot, rect: Region): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = shot.dataUrl
  })
  const sx = shot.width / window.innerWidth
  const sy = shot.height / window.innerHeight
  const cx = Math.max(0, Math.round(rect.x * sx))
  const cy = Math.max(0, Math.round(rect.y * sy))
  const cw = Math.max(1, Math.min(Math.round(rect.w * sx), shot.width - cx))
  const ch = Math.max(1, Math.min(Math.round(rect.h * sy), shot.height - cy))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return shot.dataUrl
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** 粘贴/拖入的图片压缩：宽度超限时按比例缩到 maxW（JPEG 重编码控体积）。 */
export async function downscaleImage(dataUrl: string, maxW = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (img.width <= maxW) return resolve(dataUrl)
      const canvas = document.createElement('canvas')
      canvas.width = maxW
      canvas.height = Math.max(1, Math.round((img.height / img.width) * maxW))
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

