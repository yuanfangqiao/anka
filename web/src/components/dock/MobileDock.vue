<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { useDockContext } from './dockContext'
import DockIndicator from './DockIndicator.vue'
const { apps, dockApps, resolveIcon, appTileStyle, maxVisible, maxWidthPx, capacity, pillWidth, paged, pages, pageCount, scroller, pageIndex, onScroll, goPage, isActive, open, expanded, minimized, allApps, expandedHeight, gridCols, gridRows, gridPages, gridPageCount, gridScroller, gridPageIndex, onGridScroll, goGridPage, openFromGrid, restoreIfMinimized, onTrackClick, onNavClick, gestureStart, gestureMove, headerGestureMove, menu } = useDockContext()
</script>

<template>
<!-- 移动端：三行同轴胶囊，由 DockBar 统一缩放。 -->
  <div
    v-if="dockApps.length"
    class="relative z-40 w-full transition-[height] duration-300 ease-out"
    :style="{ height: minimized ? '22px' : '72px' }"
    @click="restoreIfMinimized"
    @touchstart.passive="gestureStart"
    @touchmove.passive="gestureMove"
  >
    <!-- 收窄态：iOS 式白线，点白线或 dock 区任意空白恢复 -->
    <Transition name="dock-line">
      <button
        v-if="minimized"
        type="button"
        class="group absolute bottom-[8px] left-0 right-0 mx-auto flex h-5 w-[150px] cursor-pointer items-center justify-center"
        title="恢复 Dock"
        @click="minimized = false"
      >
        <!-- 注意：不能用 bg-ink-0/40（Tailwind 无法给 var() 颜色注入 alpha → 透明），用 opacity 实现 -->
        <span class="h-[5px] w-[136px] rounded-full bg-ink-0 opacity-40 transition-all duration-200 group-hover:w-[160px] group-hover:opacity-70"></span>
      </button>
    </Transition>

    <Transition name="dock-min">
      <nav
        v-show="!minimized"
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
              class="relative flex flex-col items-center justify-center gap-[3px] cursor-pointer"
              :aria-current="isActive(app.route) ? 'page' : undefined"
              :aria-label="app.title"
              @click="open(app)"
              @contextmenu.prevent.stop="menu.show(app.id, $event)"
              @pointerdown="menu.startPress(app.id, $event)" @pointerup="menu.endPress" @pointercancel="menu.endPress" @pointermove="menu.movePress"
              @keydown.shift.f10.prevent="menu.show(app.id, $event)"
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
                <DockIndicator :app-id="app.id" :active="isActive(app.route)" />
            </button>
          </div>
        </div>

        <!-- 底部留白：每个图标的状态指示已随图标一起翻页。 -->
        <div class="h-[13px]"></div>

        <!-- 收窄触发区：dock 内部下方，悬停浮现向下箭头提示 -->
        <div
          class="group/minzone absolute inset-x-0 bottom-0 flex h-3 cursor-pointer items-end justify-center"
          title="收起 Dock"
          @click.stop="minimized = true"
        >
          <ChevronDown :size="12" class="mb-px text-ink-2 opacity-0 transition-opacity duration-200 group-hover/minzone:opacity-100" />
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
                class="group relative flex flex-col items-center gap-1.5 cursor-pointer"
                :aria-label="app.title"
                @click="openFromGrid(app)"
                @contextmenu.prevent.stop="menu.show(app.id, $event)"
                @pointerdown="menu.startPress(app.id, $event)" @pointerup="menu.endPress" @pointercancel="menu.endPress" @pointermove="menu.movePress"
                @keydown.shift.f10.prevent="menu.show(app.id, $event)"
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
                <DockIndicator :app-id="app.id" :active="isActive(app.route)" class="absolute top-[50px] left-1/2 -translate-x-1/2" />
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
    </Transition>
  </div>
</template>

<style scoped src="./dock.css"></style>
