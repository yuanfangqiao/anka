
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { appTileStyle, registry, type AppMeta } from '../../registry/appRegistry'
import { shellConfig } from '../../composables/useShellSync'
import { useAppNavigation } from '../../services/navigation'

import { useDockMenu } from './useDockMenu'
import { useToast } from '../../composables/useToast'
import { detectPlatform } from '../../system/useInstallPrompt'

// 基准图标仍为 36px；电脑缩放后为 24px，图标净间距 8px、两侧留白 10px。
const desktopSpacing = { icon: 36, gap: 12, padding: 15, border: 2 }

export function useDock(props: { readonly desktop?: boolean }) {


const route = useRoute()
const menu = useDockMenu()
const { warn } = useToast()
const navigation = useAppNavigation()
const { apps, dockApps, resolveIcon } = registry
// iPad 使用桌面布局，但继续沿用触屏端的原始尺寸与间距。
const computerDock = computed(() => Boolean(props.desktop) && detectPlatform() === 'desktop')
const dockScale = computed(() => computerDock.value ? 2 / 3 : 1)

// 手机 dock 每页槽位数（内核 /api/config 下发；M17.10 共享态，settings 变更即时生效）
const maxVisible = computed(() => shellConfig.value.mobile_dock_max ?? 5)

// ---- 每页容量：桌面完全按浏览器宽度测算，尽可能多展示 ---------------------------
// 宽度与容量都按同一套间距计算，电脑放宽留白；iPad 保留原来的 42px 槽位。
// 92% 视口宽、1000px 为缩放前的上限，少量应用时胶囊随内容收紧。
const MAX_DOCK_W = 1000
const winWidth = ref(window.innerWidth)
function onResize() {
  winWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', onResize, { passive: true })
})

const maxWidthPx = computed(() => Math.min(Math.round(winWidth.value * 0.92), MAX_DOCK_W))
const capacity = computed(() =>
  props.desktop
    ? Math.max(3, Math.floor(computerDock.value
      ? (maxWidthPx.value - desktopSpacing.padding * 2 - desktopSpacing.border + desktopSpacing.gap)
        / (desktopSpacing.icon + desktopSpacing.gap)
      : (maxWidthPx.value - 24) / 42))
    : maxVisible.value,
)

// 胶囊宽度必须显式计算：内容层全部 absolute inset-0（高度过渡交叉淡化），
// max-content 会塌缩成 0（只剩 2px 边框），图标从中心点向右溢出渲染。
// 非分页电脑态使用实际图标、间距、内边距与边框求和，避免两端裁切。
const pillWidth = computed(() => {
  if (expanded.value || paged.value) return `${maxWidthPx.value}px`
  if (computerDock.value) {
    const count = dockApps.value.length
    return `${count * desktopSpacing.icon + Math.max(0, count - 1) * desktopSpacing.gap
      + desktopSpacing.padding * 2 + desktopSpacing.border}px`
  }
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
  return registry.byId(route.meta.appId as string)?.route === path
}
function open(app: AppMeta) {
  if (menu.consumeLongPress(app.id)) return
  void navigation.switchApp(app.id).catch(error => warn(String(error.message ?? error)))
}

// ---- 全部应用：dock 向上拉伸展开（半屏，竖向分页） ---------------------------
const expanded = ref(false)
const unregisterBack = navigation.registerOverlay({
  canGoBack: () => expanded.value,
  back: () => { expanded.value = false },
})
// 收窄态：dock 缩成一根 iOS 式白线（下滑手势或点底边触发，点白线/空白恢复）
const minimized = ref(false)
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
  if (menu.consumeLongPress(app.id)) return
  void navigation.switchApp(app.id).catch(error => warn(String(error.message ?? error)))
  expanded.value = false
}

// 收窄态恢复：点白线、dock 区任意空白均可
function restoreIfMinimized() {
  if (minimized.value) minimized.value = false
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
  const bounds = el.getBoundingClientRect()
  const x = e.clientX - bounds.left
  if (x < bounds.width * 0.22 && pageIndex.value > 0) goPage(pageIndex.value - 1)
  else if (x > bounds.width * 0.78 && pageIndex.value < pageCount.value - 1) {
    goPage(pageIndex.value + 1)
  }
}

// 手势状态机（移动端）：一次触摸（touchstart→touchend）只允许触发一个状态迁移。
// gestureDone 消费标记是关键——没有它，下滑收起展开态的同一根手指会继续冒泡到
// nav 级手势，造成"展开→dock→收纳线"一次滑动连锁两级跳。
// 链路：dock ⇄ 上滑/下滑 ⇄ 展开应用 / 收纳线
let startY = 0
let gestureDone = false
function gestureStart(e: TouchEvent) {
  startY = e.touches[0].clientY
  gestureDone = false
}
function gestureMove(e: TouchEvent) {
  if (gestureDone) return
  if (expanded.value) return // 展开态的收起只认把手（headerGestureMove），网格滑动归网格
  const dy = e.touches[0].clientY - startY
  if (minimized.value) {
    if (dy < -48) {
      minimized.value = false
      gestureDone = true
    }
    return
  }
  if (dy < -48) {
    expanded.value = true
    gestureDone = true
  } else if (dy > 48) {
    minimized.value = true
    gestureDone = true
  }
}
function headerGestureMove(e: TouchEvent) {
  if (gestureDone || !expanded.value) return
  if (e.touches[0].clientY - startY > 48) {
    expanded.value = false
    gestureDone = true
  }
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
  unregisterBack()
  document.documentElement.style.overflow = ''
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
})

return { computerDock, dockScale, desktopSpacing, apps, dockApps, resolveIcon, appTileStyle, maxVisible, maxWidthPx, capacity, pillWidth, paged, pages, pageCount, scroller, pageIndex, onScroll, goPage, isActive, open, expanded, minimized, allApps, expandedHeight, gridCols, gridRows, gridPages, gridPageCount, gridScroller, gridPageIndex, onGridScroll, goGridPage, openFromGrid, restoreIfMinimized, onTrackClick, onNavClick, gestureStart, gestureMove, headerGestureMove, menu }
}
