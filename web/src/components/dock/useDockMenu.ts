import { onBeforeUnmount, ref } from 'vue'
import { useAppNavigation } from '../../services/navigation'

export function useDockMenu() {
  const selected = ref('')
  const position = ref({ left: 12, top: 240 })
  let timer: ReturnType<typeof setTimeout> | undefined
  let press: { id: string; x: number; y: number } | undefined
  let suppress: { id: string; until: number } | undefined
  const hide = () => { selected.value = '' }
  function show(id: string, event: MouseEvent | KeyboardEvent | PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const x = 'clientX' in event && event.clientX ? event.clientX : rect.left + rect.width / 2
    const y = 'clientY' in event && event.clientY ? event.clientY : rect.top
    position.value = { left: Math.max(12, Math.min(x - 100, window.innerWidth - 236)),
      top: Math.max(240, Math.min(y - 10, window.innerHeight - 12)) }
    selected.value = id
  }
  function endPress() { clearTimeout(timer); press = undefined }
  function startPress(id: string, event: PointerEvent) {
    endPress()
    if (event.pointerType !== 'touch') return
    press = { id, x: event.clientX, y: event.clientY }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    timer = setTimeout(() => {
      position.value = { left: Math.max(12, Math.min(rect.left, window.innerWidth - 236)), top: Math.max(240, rect.top - 10) }
      selected.value = id
      suppress = { id, until: Date.now() + 1000 }
    }, 550)
  }
  function movePress(event: PointerEvent) {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) endPress()
  }
  function consumeLongPress(id: string) {
    if (suppress?.id === id && Date.now() < suppress.until) { suppress = undefined; return true }
    return false
  }
  const stop = useAppNavigation().registerOverlay({ canGoBack: () => Boolean(selected.value), back: hide })
  onBeforeUnmount(() => { endPress(); stop() })
  return { selected, position, show, hide, startPress, movePress, endPress, consumeLongPress }
}
