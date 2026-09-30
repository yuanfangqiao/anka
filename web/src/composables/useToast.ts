import { reactive } from 'vue'

export interface ToastItem {
  id: number
  kind: 'ok' | 'warn' | 'err'
  text: string
}

const items = reactive<ToastItem[]>([])
let seq = 0

function push(kind: ToastItem['kind'], text: string) {
  const id = ++seq
  items.push({ id, kind, text })
  window.setTimeout(() => {
    const i = items.findIndex((t) => t.id === id)
    if (i >= 0) items.splice(i, 1)
  }, 3200)
}

export function useToast() {
  return {
    items,
    ok: (text: string) => push('ok', text),
    warn: (text: string) => push('warn', text),
    err: (text: string) => push('err', text),
  }
}
