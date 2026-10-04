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

// ---- 每页容量：桌面完全按浏览器宽度测算，尽可能多展示 ---------------------------
// 胶囊最大宽 = 92% 视口宽（1000px 兜底防超宽屏）；槽位 = 瓷贴 36 + 间距 6 = 42px。
// 注意：上限只约束「分页态」的胶囊宽度——应用数 ≤ 容量时胶囊始终按内容收紧（42n+14），
// 所以放大上限不会让少量应用的应用栏变成长条
const MAX_DOCK_W = 1000
const winWidth = ref(window.innerWidth)
function onResize() {
  winWidth.value = window.innerWidth
}

onMounted(async () => {
  window.addEventListener('resize', onResize, { passive: true })
  try {
    maxVisible.value = (await api.config()).mobile_dock_max ?? 5
  } catch { /* 后端离线时用默认值 */ }
})

const maxWidthPx = computed(() => Math.min(Math.round(winWidth.value * 0.92), MAX_DOCK_W))
const capacity = computed(() =>
  props.desktop
    ? Math.max(3, Math.floor((maxWidthPx.value - 24) / 42))
    : maxVisible.value,
)

// 胶囊宽度必须显式计算：内容层全部 absolute inset-0（高度过渡交叉淡化），
// max-content 会塌缩成 0（只剩 2px 边框），图标从中心点向右溢出渲染。
// 非分页折叠态 = n×(瓷贴36+间距6) − 末位间距 + px-2.5×2 = 42n + 14
const pillWidth = computed(() => {
  if (expanded.value || paged.value) return `${maxWidthPx.value}px`
  return `${dockApps.value.length * 42 + 14}px`
})

// ---- dock 分页（横滑） -----------------------------------------------------
const paged = computed(() => dockApps.value.length > capacity.value)
const pages = computed<AppMeta[][]>(() => {
  const out: AppMeta[][] = []
  for (let i = 0; i < dockApps.value.length; i += capacity.value) {
    out.push(dockApps.value.slice(i, i + capacity.value))
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

// ---- 当前应用指示（移动端底轨） ----------------------------------------------
// 与翻页点共用同一条水平轴：指示点在底部轨道按「槽位百分比」定位
const activeSlot = computed(() => {
  const page = pages.value[pageIndex.value]
  return page ? page.findIndex((a) => isActive(a.route)) : -1
})
const markerLeft = computed(() =>
  activeSlot.value < 0 ? null : `${((activeSlot.value + 0.5) / capacity.value) * 100}%`,
)

// ---- 全部应用：dock 向上拉伸展开（半屏，竖向分页） ---------------------------
const expanded = ref(false)
const allApps = computed(() => [...apps].sort((a, b) => a.order - b.order))
const expandedHeight = computed(() => Math.min(Math.round(window.innerHeight * 0.5), 520))
const gridCols = computed(() => (props.desktop ? 6 : 5))

// 每页行数由半屏高度推导（行高 ≈ 瓷贴48 + 名称14 + 间距20 = 82，把手+内边距 ≈ 40）
const gridRows = computed(() => Math.max(2, Math.floor((expandedHeight.value - 40) / 82)))
const gridPages = computed<AppMeta[][]>(() => {
  const per = gridRows.value * gridCols.value
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

// 交互（桌面）：顶轨点圆点 = 跳页、点空白 = 展开；点胶囊左右 22% 空白 = 翻页
function onTrackClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  expanded.value = true
}
function onNavClick(e: MouseEvent) {
  if (expanded.value || !paged.value) return
  const t = e.target as HTMLElement
  if (t.closest('button')) return
  const el = e.currentTarget as HTMLElement
  const x = e.clientX - el.getBoundingClientRect().left
  if (x < el.clientWidth * 0.22 && pageIndex.value > 0) goPage(pageIndex.value - 1)
  else if (x > el.clientWidth * 0.78 && pageIndex.value < pageCount.value - 1) {
    goPage(pageIndex.value + 1)
  }
}

// 手势（移动端）：折叠时上滑展开；展开后把手区下滑收起
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
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <!-- ================= 桌面端：原版 58px 胶囊（外观零变更） ================= -->
  <div v-if="desktop" class="relative z-40 h-[58px] w-full">
    <!-- 展开时的遮罩：点空白收起 -->
    <div
      v-if="expanded"
      class="fixed inset-0 -z-10 bg-black/30 backdrop-blur-[2px]"
      @click="expanded = false"
    ></div>

    <nav
      class="glass-panel absolute bottom-0 left-1/2 -translate-x-1/2 rounded-[22px] shadow-card transition-[height] duration-300 ease-out"
      :style="{
        height: expanded ? expandedHeight + 'px' : '58px',
        width: pillWidth,
      }"
      aria-label="应用 Dock"
      @click="onNavClick"
    >
      <!-- 折叠层 -->
      <div
        class="absolute inset-0 transition-opacity duration-200"
        :class="expanded ? 'pointer-events-none opacity-0' : 'opacity-100'"
      >
        <!-- 图标不超容量：原版单行，宽度随内容收缩（像素级原样） -->
        <div v-if="!paged" class="flex h-full items-center gap-1.5 px-2.5 py-1.5">
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
              @click.stop="open(app)"
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

        <!-- 超容量：58px 总高不变，顶轨圆点 + snap 整页（py 微调挤出顶轨） -->
        <div v-else class="flex h-full flex-col px-2 py-1">
          <!-- 顶轨：点圆点跳页，点空白向上展开 -->
          <div
            class="flex h-[7px] cursor-pointer items-start justify-center gap-1.5"
            @click="onTrackClick"
          >
            <button
              v-for="i in pageCount"
              :key="i"
              type="button"
              class="h-1.5 rounded-full transition-all duration-micro cursor-pointer"
              :class="i - 1 === pageIndex ? 'w-4 bg-gradient-to-r from-brand to-brand-cyan' : 'w-1.5 bg-line'"
              :aria-label="`Dock 第 ${i} 页`"
              @click.stop="goPage(i - 1)"
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
              :style="{ gridTemplateColumns: `repeat(${capacity}, 1fr)` }"
            >
              <div
                v-for="app in page"
                :key="app.id"
                class="group relative flex h-full flex-col items-center justify-center"
              >
                <div
                  class="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-bg-2 px-2.5 py-1 text-[11px] text-ink-0 opacity-0 shadow-card transition-opacity duration-micro group-hover:opacity-100"
                >
                  {{ app.title }}
                </div>
                <button
                  type="button"
                  class="flex items-center justify-center transition-transform duration-micro active:scale-90 cursor-pointer"
                  :aria-current="isActive(app.route) ? 'page' : undefined"
                  :aria-label="app.title"
                  @click.stop="open(app)"
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
          </div>
        </div>
      </div>

      <!-- 展开层：全部应用网格（与移动端同款） -->
      <div
        class="absolute inset-0 flex flex-col overflow-hidden rounded-[22px] pb-2 transition-opacity duration-200"
        :class="expanded ? 'opacity-100' : 'pointer-events-none opacity-0'"
      >
        <div
          class="flex h-7 shrink-0 cursor-pointer items-start justify-center pt-2"
          @click="expanded = false"
        >
          <div class="h-1 w-10 rounded-full bg-line" aria-hidden="true"></div>
        </div>

        <div class="relative min-h-0 flex-1 pl-4 pr-3">
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
              @click.stop="goGridPage(i - 1)"
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
              class="grid h-full snap-start content-start gap-x-2 gap-y-5"
              :style="{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }"
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

  <!-- ================= 移动端：三行同轴胶囊（外观/手势零变更） ================= -->
  <div v-else-if="dockApps.length" class="relative z-40 h-[72px] w-full">
    <!-- 展开时的遮罩：点空白收起 -->
    <div
      v-if="expanded"
      class="fixed inset-0 -z-10 bg-black/30 backdrop-blur-[2px]"
      @click="expanded = false"
    ></div>

    <nav
      class="glass-panel absolute inset-x-0 bottom-0 overflow-hidden rounded-[26px] shadow-card transition-[height] duration-300 ease-out"
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
        <!-- 顶轨：点圆点跳页，点空白向上展开（与桌面端一致；触屏另有上滑手势） -->
        <div
          v-if="pageCount > 1"
          class="flex h-[13px] cursor-pointer items-start justify-center gap-1.5 pt-[4px]"
          @click="onTrackClick"
        >
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
            :style="{ gridTemplateColumns: `repeat(${capacity}, 1fr)` }"
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
              class="grid h-full snap-start content-start gap-x-2 gap-y-5"
              :style="{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }"
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
