<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { useDockContext } from './dockContext'
import DockIndicator from './DockIndicator.vue'
const { apps, dockApps, resolveIcon, appTileStyle, maxVisible, maxWidthPx, capacity, pillWidth, paged, pages, pageCount, scroller, pageIndex, onScroll, goPage, isActive, open, expanded, minimized, allApps, expandedHeight, gridCols, gridRows, gridPages, gridPageCount, gridScroller, gridPageIndex, onGridScroll, goGridPage, openFromGrid, restoreIfMinimized, onTrackClick, onNavClick, gestureStart, gestureMove, headerGestureMove, menu } = useDockContext()
const { computerDock, desktopSpacing } = useDockContext()
</script>

<template>
<!-- 桌面端：58px 基准胶囊，由 DockBar 统一缩放。 -->
  <div
    class="relative z-40 w-full transition-[height] duration-300 ease-out"
    :style="{ height: minimized ? '22px' : '74px' }"
    @click="restoreIfMinimized"
  >
    <!-- 收窄态：iOS 式白线，点白线或 dock 区任意空白恢复 -->
    <Transition name="dock-line">
      <button
        v-if="minimized"
        type="button"
        class="group absolute bottom-[7px] left-0 right-0 mx-auto flex h-5 w-[150px] cursor-pointer items-center justify-center"
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
        class="glass-panel absolute bottom-2 left-1/2 -translate-x-1/2 rounded-[22px] shadow-card transition-[height] duration-300 ease-out"
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
        <!-- 电脑加宽图标间距与两端留白，iPad 保留原尺寸。 -->
        <div v-if="!paged" class="flex h-full items-center gap-1.5 px-2.5 py-1.5"
          :style="computerDock ? { gap: desktopSpacing.gap + 'px', paddingInline: desktopSpacing.padding + 'px' } : undefined">
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
                  @contextmenu.prevent.stop="menu.show(app.id, $event)"
                  @pointerdown="menu.startPress(app.id, $event)" @pointerup="menu.endPress" @pointercancel="menu.endPress" @pointermove="menu.movePress"
                  @keydown.shift.f10.prevent="menu.show(app.id, $event)"
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
            <DockIndicator :app-id="app.id" :active="isActive(app.route)" class="mt-[3px]" />
          </div>
        </div>

        <!-- 超容量：58px 总高不变，顶轨圆点 + snap 整页（py 微调挤出顶轨） -->
        <div v-else class="flex h-full flex-col px-2 py-1"
          :style="computerDock ? { paddingInline: desktopSpacing.padding + 'px' } : undefined">
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
              :style="{
                gridTemplateColumns: `repeat(${capacity}, ${computerDock ? desktopSpacing.icon + 'px' : '1fr'})`,
                columnGap: computerDock ? desktopSpacing.gap + 'px' : undefined,
                justifyContent: computerDock ? 'center' : undefined,
              }"
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
                  @contextmenu.prevent.stop="menu.show(app.id, $event)"
                  @pointerdown="menu.startPress(app.id, $event)" @pointerup="menu.endPress" @pointercancel="menu.endPress" @pointermove="menu.movePress"
                  @keydown.shift.f10.prevent="menu.show(app.id, $event)"
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
                <DockIndicator :app-id="app.id" :active="isActive(app.route)" class="mt-[3px]" />
              </div>
            </div>
          </div>
        </div>

        <!-- 收窄触发区：dock 内部下方，悬停浮现向下箭头提示 -->
        <div
          class="group/minzone absolute inset-x-0 bottom-0 flex h-3 cursor-pointer items-end justify-center"
          title="收起 Dock"
          @click.stop="minimized = true"
        >
          <ChevronDown :size="12" class="mb-px text-ink-2 opacity-0 transition-opacity duration-200 group-hover/minzone:opacity-100" />
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
