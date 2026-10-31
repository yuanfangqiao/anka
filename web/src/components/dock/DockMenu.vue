<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDockContext } from './dockContext'
import { appRuntime } from '../../runtime/appRuntime'
import { registry } from '../../registry/appRegistry'
import { isMobile } from '../../composables/useBreakpoint'
import { useToast } from '../../composables/useToast'
import { applyPendingUpdate, pendingUpdates } from '../../services/pluginHost'

const { menu, expanded } = useDockContext()
const { selected, position } = menu
const element = ref<HTMLElement>()
const busy = ref(false)
const app = computed(() => registry.byId(selected.value))
const run = computed(() => appRuntime.runs.get(selected.value))
const { warn } = useToast()
watch(selected, async id => { if (id) { await nextTick(); element.value?.querySelector<HTMLButtonElement>('button')?.focus() } })
async function perform(action: 'open' | 'close' | 'restart' | 'splitWith') {
  const id = selected.value
  busy.value = true
  try {
    if (action === 'restart' && pendingUpdates.has(id)) {
      await appRuntime.close(id)
      applyPendingUpdate(id)
      await appRuntime.open(id)
    } else await appRuntime[action](id)
    if (action === 'open' || action === 'splitWith') expanded.value = false
    menu.hide()
  } catch (error) { warn(error instanceof Error ? error.message : String(error)) }
  finally { busy.value = false }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); menu.hide(); return }
  if (!['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) return
  const buttons = [...(element.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const delta = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1
  event.preventDefault(); buttons[(index + delta + buttons.length) % buttons.length]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="app" class="fixed inset-0 z-[100]" @pointerdown.self="menu.hide()" @contextmenu.prevent.self="menu.hide()">
      <section ref="element" class="glass-panel fixed w-56 -translate-y-full rounded-2xl border border-line p-2 text-ink-0 shadow-card"
        :style="{ left: position.left + 'px', top: position.top + 'px' }" role="menu" :aria-label="`${app.title}操作`"
        :data-app-menu="app.id" @keydown="keyboard">
        <div class="border-b border-line px-3 py-2">
          <p class="text-sm font-medium">{{ app.title }}</p>
          <p class="mt-0.5 text-[11px] text-ink-2">{{ !run ? '尚未运行' : run.status === 'error' ? '运行异常' : run.focused ? '当前应用' : '后台保留' }}{{ pendingUpdates.has(app.id) ? ' · 有更新' : '' }}</p>
        </div>
        <button role="menuitem" class="dock-action" :disabled="busy" @click="perform('open')">{{ run ? '显示应用' : '打开应用' }}</button>
        <button v-if="run && !isMobile && app.id !== appRuntime.state.focusedId && !run.parentId" role="menuitem" class="dock-action"
          :disabled="busy" :aria-label="`分屏显示${app.title}`" @click="perform('splitWith')">分屏显示</button>
        <button v-if="appRuntime.state.split" role="menuitem" class="dock-action" :disabled="busy"
          @click="appRuntime.single(); menu.hide()">结束分屏</button>
        <button v-if="run" role="menuitem" class="dock-action" :disabled="busy" :aria-label="`重新启动${app.title}`"
          @click="perform('restart')">{{ pendingUpdates.has(app.id) ? '更新并重新启动' : '重新启动' }}</button>
        <button v-if="run" role="menuitem" class="dock-action" :disabled="busy" :aria-label="`关闭${app.title}`"
          @click="perform('close')">关闭应用</button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dock-action { display: block; width: 100%; border-radius: 10px; padding: 9px 12px; text-align: left; font-size: 13px; }
.dock-action:hover, .dock-action:focus-visible { background: var(--bg-2); outline: none; }
.dock-action:disabled { opacity: .5; }
</style>
