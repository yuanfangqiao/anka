<script setup lang="ts">
/**
 * CreateModeOverlay —— 创造模式全屏浮层（M17.2，v2）。
 *
 * 恢复上一版形态并增强：进入即整屏截图（dom-to-image，浏览器原生绘制、
 * 零权限）→ 截图铺满浮层（顶部 X 关闭）→ 可在截图上拖拽框选裁剪
 * （对已有 canvas 裁剪，无二次捕获）→ 底部指令输入 →
 * 截图 + 选区 DOM 结构摘要 + 指令一次性发给 Agent。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ImageOff, Loader2, Send, Sparkles, X } from 'lucide-vue-next'
import { useCreateMode } from '../composables/useCreateMode'
import { cropRegion } from '../services/screenCapture'
import { useChat } from '../system/chat/useChat'
import { registry } from '../registry/appRegistry'

const { state, isActive, shot, selection, close, setSelection } = useCreateMode()
const { send, sending } = useChat()
const router = useRouter()
const route = useRoute()

const draft = ref('')

// ─── 截图展示几何：以 <img> 元素矩形为基准（max-h/max-w 下元素框即图像框）──
const stageEl = ref<HTMLElement>()
const imgEl = ref<HTMLImageElement>()

function imgRect(): DOMRect | null {
  return imgEl.value?.getBoundingClientRect() ?? null
}

// ─── 框选（相对图像的显示坐标，松手按比例换算为页面 client 坐标）──
const dragStart = ref<{ x: number; y: number } | null>(null)
const dragNow = ref<{ x: number; y: number } | null>(null)

const dragRect = computed(() => {
  const a = dragStart.value
  const b = dragNow.value
  if (!a || !b) return null
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
  }
})

function stagePoint(e: PointerEvent) {
  const r = stageEl.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onPointerDown(e: PointerEvent) {
  if (!shot.value || !imgRect()) return
  dragStart.value = stagePoint(e)
  dragNow.value = dragStart.value
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}
function onPointerMove(e: PointerEvent) {
  if (!dragStart.value) return
  dragNow.value = stagePoint(e)
}
function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  const img = imgRect()
  const stage = stageEl.value!.getBoundingClientRect()
  const r = dragRect.value
  dragStart.value = null
  dragNow.value = null
  if (!img || !r || r.w < 12 || r.h < 12) return
  // 选框（stage 坐标）与图像框求交 → 按图像显示比例换算为页面 client 坐标
  const ix = Math.max(r.x, img.left - stage.left)
  const iy = Math.max(r.y, img.top - stage.top)
  const iw = Math.min(r.x + r.w, img.right - stage.left) - ix
  const ih = Math.min(r.y + r.h, img.bottom - stage.top) - iy
  if (iw < 12 || ih < 12) return
  const kx = window.innerWidth / img.width
  const ky = window.innerHeight / img.height
  setSelection({
    x: (ix - (img.left - stage.left)) * kx,
    y: (iy - (img.top - stage.top)) * ky,
    w: iw * kx,
    h: ih * ky,
  })
}

/** 已确认选区的显示坐标（回显在截图上，stage 坐标系） */
const selRect = computed(() => {
  const img = imgRect()
  const stage = stageEl.value?.getBoundingClientRect()
  const sel = selection.value
  if (!img || !stage || !sel) return null
  const kx = img.width / window.innerWidth
  const ky = img.height / window.innerHeight
  return {
    x: img.left - stage.left + sel.x * kx,
    y: img.top - stage.top + sel.y * ky,
    w: sel.w * kx,
    h: sel.h * ky,
  }
})

// ─── 发送：截图（裁剪）+ DOM 摘要 + 指令 ───────────────
const busy = ref(false)

async function submit() {
  const text = draft.value.trim()
  if (!text || busy.value || sending.value) return
  busy.value = true
  try {
    const sel = selection.value
    let image: string | undefined
    if (shot.value) {
      image = sel ? await cropRegion(shot.value, sel) : shot.value.dataUrl
    }
    const loc = sel
      ? `选区(${Math.round(sel.x)},${Math.round(sel.y)},${Math.round(sel.w)}×${Math.round(sel.h)})`
      : '整屏'
    // 上下文只带「这是哪个插件、文件在哪」——整屏 DOM 摘要无价值（meta/div 噪音），已废弃
    const app = registry.apps.find((a) => a.route === route.path)
      ?? registry.apps.find((a) => a.route !== '/' && route.path.startsWith(a.route + '/'))
    const target = app
      ? `插件 ${app.id}（${app.title}）· 文件根目录 plugins/${app.id}/`
      : `界面 ${route.path}（非 app 插件——如需修改请先让 Agent 做成 plugins/ 下的应用插件）`
    const msg = `[截屏修改 · ${target} · ${loc}] ${text}`
    send(msg, image)
    draft.value = ''
    close()
    if (route.path !== '/chat') router.push('/chat')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="create">
      <div
        v-if="isActive"
        data-capture-overlay
        class="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-md"
        role="dialog"
        aria-label="创造模式"
      >
        <!-- 顶栏：图标 + 标题 + 关闭 X（保留） -->
        <header class="safe-top flex h-14 shrink-0 items-center gap-3 px-4">
          <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-cyan text-white">
            <Sparkles :size="15" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-semibold text-white">创造模式</p>
            <p class="text-[11px] text-white/50">
              {{ state === 'capturing' ? '正在截取当前界面…' : '可在截图上框选要修改的区域，不框选默认整屏' }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition-all duration-micro hover:bg-white/10 active:scale-90 cursor-pointer"
            aria-label="退出创造模式"
            @click="close"
          >
            <X :size="18" />
          </button>
        </header>

        <!-- 截图区（框选舞台） -->
        <div
          ref="stageEl"
          class="relative flex min-h-0 flex-1 items-center justify-center p-4 select-none"
          :class="shot ? 'cursor-crosshair' : ''"
          @pointerdown="onPointerDown"
        >
          <Loader2 v-if="state === 'capturing'" :size="28" class="animate-spin text-brand" />

          <template v-else-if="shot">
            <img
              ref="imgEl"
              :src="shot.dataUrl"
              alt="当前界面截屏"
              class="max-h-full max-w-full rounded-2xl border border-white/15 object-contain shadow-card pointer-events-none"
              draggable="false"
            />
            <!-- 拖拽中的选框 -->
            <div
              v-if="dragRect"
              class="pointer-events-none absolute border-2 border-dashed border-brand shadow-glow"
              :style="{ left: `${dragRect.x}px`, top: `${dragRect.y}px`, width: `${dragRect.w}px`, height: `${dragRect.h}px` }"
            >
              <div class="absolute inset-0 bg-gradient-to-br from-brand/10 to-brand-cyan/10"></div>
              <span class="absolute -top-7 left-0 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                {{ Math.round(dragRect.w) }} × {{ Math.round(dragRect.h) }}
              </span>
            </div>
            <!-- 已确认的选区（可点 X 清除） -->
            <div
              v-else-if="selRect"
              class="absolute border-2 border-brand shadow-glow"
              :style="{ left: `${selRect.x}px`, top: `${selRect.y}px`, width: `${selRect.w}px`, height: `${selRect.h}px` }"
              @pointerdown.stop
            >
              <div class="pointer-events-none absolute inset-0 bg-brand/10"></div>
              <button
                type="button"
                class="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-err text-white shadow-card transition-all duration-micro active:scale-90 cursor-pointer"
                aria-label="清除选区"
                @click="setSelection(null)"
              >
                <X :size="11" />
              </button>
            </div>
          </template>

          <div v-else class="flex flex-col items-center gap-2 text-white/50">
            <ImageOff :size="26" />
            <p class="text-xs">未能截取画面（将以界面结构摘要代替）</p>
          </div>
        </div>

        <!-- 指令输入 -->
        <form
          class="safe-bottom mx-4 mb-4 flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 p-2 backdrop-blur-xl"
          @submit.prevent="submit"
        >
          <input
            v-model="draft"
            type="text"
            :placeholder="selection ? '描述框选区域要改成什么样…' : '例如：把标题改成「我的工具箱」，图标换成火箭…'"
            class="h-10 flex-1 bg-transparent px-3 text-sm text-white placeholder:text-white/40 border-0 outline-none shadow-none focus:ring-0"
          />
          <button
            type="submit"
            :disabled="!draft.trim() || sending || busy || state === 'capturing'"
            class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-label="发送修改指令"
          >
            <Loader2 v-if="sending || busy" :size="16" class="animate-spin" />
            <Send v-else :size="16" />
          </button>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.create-enter-active,
.create-leave-active {
  transition: opacity 240ms ease;
}
.create-enter-from,
.create-leave-to {
  opacity: 0;
}
</style>
