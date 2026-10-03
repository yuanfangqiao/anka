<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { appTileStyle, registry, type AppMeta } from '../registry/appRegistry'
import { api } from '../services/api'

const props = defineProps<{ desktop?: boolean }>()

const route = useRoute()
const router = useRouter()
const { apps, dockApps, resolveIcon } = registry

// 手机 dock 每页槽位数（内核 /api/config 下发）
const maxVisible = ref(5)
onMounted(async () => {
  try {
    maxVisible.value = (await api.config()).mobile_dock_max ?? 5
  } catch { /* 后端离线时用默认值 */ }
})

// ---- dock 分页（横滑） -----------------------------------------------------
const paged = computed(() => !props.desktop && dockApps.value.length > maxVisible.value)
const pages = computed<AppMeta[][]>(() => {
  const out: AppMeta[][] = []
  for (let i = 0; i < dockApps.value.length; i += maxVisible.value) {
    out.push(dockApps.value.slice(i, i + maxVisible.value))
  }
  return out
})
const pageCount = computed(() => pages.value.length)

const scroller = ref<HTMLElement | null>(null)
const pageIndex = ref(0)
watch(pageCount, () => {
  pageIndex.value = 0
  scroller.value?.scrollTo({ left: 0 })
})

function onScroll() {
  const el = scroller.value
  if (!el?.clientWidth) return
  pageIndex.value = Math.round(el.scrollLeft / el.clientWidth)
}
function goPage(i: number) {
  const el = scroller.value
  el?.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
}

function isActive(path: string) {
  return route.path === path
}
function open(app: AppMeta) {
  router.push(app.route)
}

// ---- 当前应用指示 ---------------------------------------------------------
// 与翻页点共用同一条水平轴：指示点在底部轨道按「槽位百分比」定位，
// 轨道与图标滚动区等宽 → 顶轨（翻页点）与底轨（选中指示）天然上下对齐。
const activeSlot = computed(() => {
  const page = pages.value[pageIndex.value]
  return page ? page.findIndex((a) => isActive(a.route)) : -1
})
const markerLeft = computed(() =>
  activeSlot.value < 0 ? null : `${((activeSlot.value + 0.5) / maxVisible.value) * 100}%`,
)

// ---- 全部应用：dock 上滑拉伸展开（半屏，竖向分页） ---------------------------
const expanded = ref(false)
const allApps = computed(() => [...apps].sort((a, b) => a.order - b.order))
// 展开高度 = 屏幕的一半
const expandedHeight = computed(() => Math.round(window.innerHeight * 0.5))

// 每页行数由半屏高度推导（行高 ≈ 瓷贴48 + 名称14 + 间距20 = 82，把手+内边距 ≈ 40）
const gridRows = computed(() => Math.max(2, Math.floor((expandedHeight.value - 40) / 82)))
const gridPages = computed<AppMeta[][]>(() => {
  const per = gridRows.value * 4
  const out: AppMeta[][] = []
  for (let i = 0; i < allApps.value.length; i += per) {
    out.push(allApps.value.slice(i, i + per))
  }
  return out
})
const gridPageCount = computed(() => gridPages.value.length)

const gridScroller = ref<HTMLElement | null>(null)
const gridPageIndex = ref(0)
watch(gridPageCount, () => {
  gridPageIndex.value = 0
  gridScroller.value?.scrollTo({ top: 0 })
})

function onGridScroll() {
  const el = gridScroller.value
  if (!el?.clientHeight) return
  gridPageIndex.value = Math.round(el.scrollTop / el.clientHeight)
}
function goGridPage(i: number) {
  const el = gridScroller.value
  el?.scrollTo({ top: i * el.clientHeight, behavior: 'smooth' })
}

function openFromGrid(app: AppMeta) {
  router.push(app.route)
  expanded.value = false
}

// 手势：折叠时从翻页点/图标区上滑 → 展开；展开后从把手区下滑 → 收起
let startY = 0
function gestureStart(e: TouchEvent) {
  startY = e.touches[0].clientY
}
function gestureMove(e: TouchEvent) {
  if (!expanded.value && e.touches[0].clientY - startY < -48) expanded.value = true
}
function headerGestureMove(e: TouchEvent) {
  if (expanded.value && e.touches[0].clientY - startY > 48) expanded.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') expanded.value = false
}
watch(expanded, (v) => {
  document.documentElement.style.overflow = v ? 'hidden' : ''
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.documentElement.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <!-- 桌面端：macOS 式自由横排 dock -->
  <nav
    v-if="desktop"
    class="glass-panel relative z-40 h-[58px] rounded-[22px] px-2.5 py-1.5 shadow-card"
    aria-label="应用 Dock"
  >
    <div class="dock-scroll flex h-full max-w-[460px] items-center gap-1.5 overflow-x-auto overscroll-contain">
      <div
        v-for="app in dockApps"
        :key="app.id"
        class="group relative flex shrink-0 flex-col items-center"
      >
        <div
          class="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-bg-2 px-2.5 py-1 text-[11px] text-ink-0 opacity-0 shadow-card transition-opacity duration-micro group-hover:opacity-100"
        >
          {{ app.title }}
        </div>

        <button
          type="button"
          class="flex items-center justify-center transition-transform duration-micro active:scale-90 cursor-pointer"
          :aria-current="isActive(app.route) ? 'page' : undefined"
          :aria-label="app.title"
          @click="open(app)"
        >
          <span
            class="flex h-9 w-9 items-center justify-center rounded-[30%] text-white"
            :class="[
              app.system ? 'bg-gradient-to-br from-brand to-brand-cyan shadow-md shadow-brand/25' : '',
              isActive(app.route) ? 'ring-2 ring-brand/70' : '',
            ]"
            :style="appTileStyle(app)"
          >
            <component :is="resolveIcon(app.icon)" :size="18" />
          </span>
        </button>

        <span
          class="pointer-events-none mt-[3px] h-[3px] rounded-full transition-all duration-micro"
          :class="isActive(app.route) ? 'w-3 bg-gradient-to-r from-brand to-brand-cyan' : 'w-[3px] bg-transparent'"
        ></span>
      </div>
    </div>
  </nav>

  <!-- 移动端：悬浮胶囊 dock，整体抬到 Home 指示条手势区之上（更大安全边距） -->
  <div
    v-else-if="dockApps.length"
    class="fixed inset-x-3 bottom-0 z-40"
    :style="{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }"
  >
    <!-- 展开时的遮罩：在胶囊之下、页面之上，点空白收起 -->
    <div
      v-if="expanded"
      class="fixed inset-0 -z-10 bg-black/30 backdrop-blur-[2px]"
      @click="expanded = false"
    ></div>

    <nav
      class="glass-panel relative w-full overflow-hidden rounded-[26px] shadow-card transition-[height] duration-300 ease-out"
      :style="{ height: expanded ? expandedHeight + 'px' : '72px' }"
      aria-label="应用 Dock"
      @touchstart.passive="gestureStart"
      @touchmove.passive="gestureMove"
    >
      <!-- 折叠层：翻页点（顶轨）/ 图标（中行）/ 当前应用指示（底轨），三行同轴对称 -->
      <div
        class="absolute inset-0 flex flex-col px-1.5 transition-opacity duration-200"
        :class="expanded ? 'pointer-events-none opacity-0' : 'opacity-100'"
      >
        <div v-if="pageCount > 1" class="flex h-[13px] items-start justify-center gap-1.5 pt-[4px]">
          <button
            v-for="i in pageCount"
            :key="i"
            type="button"
            class="h-1.5 rounded-full transition-all duration-micro cursor-pointer"
            :class="i - 1 === pageIndex ? 'w-4 bg-gradient-to-r from-brand to-brand-cyan' : 'w-1.5 bg-line'"
            :aria-label="`Dock 第 ${i} 页`"
            @click="goPage(i - 1)"
          ></button>
        </div>

        <div
          ref="scroller"
          class="dock-scroll flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain"
          @scroll.passive="onScroll"
        >
          <div
            v-for="(page, pi) in pages"
            :key="pi"
            class="grid h-full w-full shrink-0 snap-start"
            :style="{ gridTemplateColumns: `repeat(${maxVisible}, 1fr)` }"
          >
            <button
              v-for="app in page"
              :key="app.id"
              type="button"
              class="relative flex items-center justify-center cursor-pointer"
              :aria-current="isActive(app.route) ? 'page' : undefined"
              :aria-label="app.title"
              @click="open(app)"
            >
              <span
                class="flex h-10 w-10 items-center justify-center rounded-[30%] text-white transition-transform duration-micro active:scale-90"
                :class="[
                  app.system ? 'bg-gradient-to-br from-brand to-brand-cyan shadow-md shadow-brand/25' : '',
                  isActive(app.route) ? 'ring-2 ring-brand/70' : '',
                ]"
                :style="appTileStyle(app)"
              >
                <component :is="resolveIcon(app.icon)" :size="19" />
              </span>
            </button>
          </div>
        </div>

        <!-- 当前应用指示轨：与顶轨同宽同轴，按槽位百分比定位，切换时平滑滑动 -->
        <div class="relative h-[13px]">
          <span
            v-if="markerLeft"
            class="absolute top-[3px] h-[3px] w-3 rounded-full bg-gradient-to-r from-brand to-brand-cyan transition-[left] duration-micro"
            :style="{ left: markerLeft, transform: 'translateX(-50%)' }"
          ></span>
        </div>
      </div>

      <!-- 展开层：半屏全部应用网格，装不下时上下翻页（左侧竖向进度点） -->
      <div
        class="absolute inset-0 flex flex-col pb-2 transition-opacity duration-200"
        :class="expanded ? 'opacity-100' : 'pointer-events-none opacity-0'"
      >
        <!-- 把手：下滑收起（无标题、无关闭按钮，手势即全部） -->
        <div
          class="flex h-7 shrink-0 items-start justify-center pt-2"
          @touchstart.passive="gestureStart"
          @touchmove.passive="headerGestureMove"
        >
          <div class="h-1 w-10 rounded-full bg-line" aria-hidden="true"></div>
        </div>

        <div class="relative min-h-0 flex-1 pl-4 pr-3">
          <!-- 竖向翻页进度（左侧）：指示当前页、可点击跳页 -->
          <div
            v-if="gridPageCount > 1"
            class="absolute left-0 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5"
          >
            <button
              v-for="i in gridPageCount"
              :key="i"
              type="button"
              class="w-1.5 rounded-full transition-all duration-micro cursor-pointer"
              :class="i - 1 === gridPageIndex ? 'h-4 bg-gradient-to-b from-brand to-brand-cyan' : 'h-1.5 bg-line'"
              :aria-label="`应用第 ${i} 页`"
              @click="goGridPage(i - 1)"
            ></button>
          </div>

          <div
            ref="gridScroller"
            class="grid-scroll h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
            @scroll.passive="onGridScroll"
          >
            <div
              v-for="(page, pi) in gridPages"
              :key="pi"
              class="grid h-full snap-start grid-cols-4 content-start gap-x-2 gap-y-5"
            >
              <button
                v-for="app in page"
                :key="app.id"
                type="button"
                class="group flex flex-col items-center gap-1.5 cursor-pointer"
                :aria-label="app.title"
                @click="openFromGrid(app)"
              >
                <span
                  class="flex h-12 w-12 items-center justify-center rounded-[26%] text-white shadow-md transition-transform duration-micro group-active:scale-90"
                  :class="[
                    app.system ? 'bg-gradient-to-br from-brand to-brand-cyan shadow-brand/25' : '',
                    isActive(app.route) ? 'ring-2 ring-brand/70' : '',
                  ]"
                  :style="appTileStyle(app)"
                >
                  <component :is="resolveIcon(app.icon)" :size="22" />
                </span>
                <span
                  class="w-full truncate text-center text-[11px] leading-tight"
                  :class="isActive(app.route) ? 'font-medium text-ink-0' : 'text-ink-1'"
                >
                  {{ app.title }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.dock-scroll {
  scrollbar-width: none;
  /* iOS 弹性滚动 + 滚动链传导会带着整页 rubber-band → 视觉变形；
     snap + overscroll-contain + 只放行水平手势，三者一起锁死 */
  overscroll-behavior: contain;
  touch-action: pan-x;
}
.dock-scroll::-webkit-scrollbar,
.grid-scroll::-webkit-scrollbar {
  display: none;
}
.grid-scroll {
  scrollbar-width: none;
  overscroll-behavior: contain;
  touch-action: pan-y;
}
</style>
