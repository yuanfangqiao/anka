import { allowed, rectOf, type Surface } from './dom'

const MAX_EDGE = 1280
const MAX_BYTES = 1024 * 1024

export type Picture = { blob: Blob; scope: 'canvas' | 'dom'; source: Element;
  rect: ReturnType<typeof rectOf>; width: number; height: number }

function boundedSize(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))] as const
}

function encode(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.size > MAX_BYTES) reject(Error('图片无法导出或超过大小限制'))
      else resolve(blob)
    }, 'image/jpeg', .88)
  })
}

export function canvasRect(source: HTMLCanvasElement) {
  const box = rectOf(source)
  const css = source.ownerDocument.defaultView!.getComputedStyle(source)
  if (css.objectFit !== 'fill' || !source.offsetWidth || !source.offsetHeight) {
    throw Error('画布布局无法换算到画面坐标')
  }
  const x = box.width / source.offsetWidth
  const y = box.height / source.offsetHeight
  const pl = parseFloat(css.paddingLeft) || 0
  const pr = parseFloat(css.paddingRight) || 0
  const pt = parseFloat(css.paddingTop) || 0
  const pb = parseFloat(css.paddingBottom) || 0
  return { left: box.left + (source.clientLeft + pl) * x, top: box.top + (source.clientTop + pt) * y,
    width: (source.clientWidth - pl - pr) * x, height: (source.clientHeight - pt - pb) * y }
}

export async function capture(view: Surface, scope: unknown, canvasTarget?: Element): Promise<Picture> {
  if (scope === 'canvas') {
    const choices = Array.from(view.root.querySelectorAll('canvas')).filter(el => allowed(view, el) &&
      el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
    const source = (canvasTarget ?? (choices.length === 1 ? choices[0] : undefined)) as HTMLCanvasElement | undefined
    if (!source || source.tagName !== 'CANVAS' || !allowed(view, source) || !source.width || !source.height) {
      throw Error('没有唯一可读画布，请用观察中的画布 ID 指定目标')
    }
    const rect = canvasRect(source)
    const [width, height] = boundedSize(source.width, source.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(source, 0, 0, width, height)
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
    let painted = false
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) { painted = true; break }
    }
    if (!painted) throw Error('画布暂未提供可读画面')
    return { blob: await encode(canvas), scope: 'canvas', source, rect, width, height }
  }

  const source = view.root
  const rect = rectOf(source)
  const clipWidth = Math.floor(Math.min(rect.width, view.doc.documentElement.clientWidth))
  const clipHeight = Math.floor(Math.min(rect.height, view.doc.documentElement.clientHeight))
  if (clipWidth <= 0 || clipHeight <= 0) throw Error('应用没有可导出的可见区域')
  const [width, height] = boundedSize(clipWidth, clipHeight)
  const { toCanvas } = await import('html-to-image')
  const canvas = await toCanvas(source, {
    width: clipWidth, height: clipHeight, canvasWidth: width, canvasHeight: height,
    pixelRatio: 1,
    filter: node => !(node.nodeType === 1 && (node as Element).matches(
      'iframe,[data-web-use-private],input[type=password],[autocomplete="one-time-code"],[autocomplete^="cc-"]')),
  })
  return { blob: await encode(canvas), scope: 'dom', source, rect, width: canvas.width, height: canvas.height }
}
