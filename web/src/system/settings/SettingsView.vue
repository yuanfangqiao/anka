<script setup lang="ts">
/**
 * M17.11：控制台 —— master-detail 容器。
 * - 桌面：左侧一级菜单（分组侧栏）+ 右侧二级内容
 * - 移动：一级整页菜单 → iOS 钻取二级（自带返回，壳层 chrome 不参与）
 * - URL 即事实源：/settings/:section?，深链/刷新直达；桌面裸 /settings 重定向默认项
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import ThemeToggle from '../../components/ThemeToggle.vue'
import { useBreakpoint } from '../../composables/useBreakpoint'
import { DEFAULT_SECTION, SETTINGS_SECTIONS, findSection, type SettingsSection } from './sections'

const route = useRoute()
const router = useRouter()
const { isMobile } = useBreakpoint()

const sectionParam = computed(() => {
  const p = route.params.section
  return (Array.isArray(p) ? p[0] : p) || ''
})
const active = computed(() => findSection(sectionParam.value))

// 非法 section 回菜单；桌面裸 /settings 落默认项
onMounted(normalize)
watch([sectionParam, isMobile], normalize)
function normalize() {
  if (!sectionParam.value) {
    if (!isMobile.value) router.replace(`/settings/${DEFAULT_SECTION}`)
  } else if (!active.value) {
    router.replace('/settings')
  }
}

function select(id: string) {
  router.push(`/settings/${id}`)
}
function back() {
  router.push('/settings')
}

const groups = computed(() => {
  const out: { name: string; items: SettingsSection[] }[] = []
  for (const s of SETTINGS_SECTIONS) {
    const g = out.find((x) => x.name === s.group)
    if (g) g.items.push(s)
    else out.push({ name: s.group, items: [s] })
  }
  return out
})

const sectionProps = (s: SettingsSection) => (s.id === 'plugins' ? { bare: true } : {})
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-4 pb-6">
    <!-- ═══ 桌面：侧栏 + 内容 ═══ -->
    <div v-if="!isMobile" class="flex gap-6">
      <aside class="w-60 shrink-0">
        <h1 class="px-3 pt-2 text-[26px] font-bold tracking-tight">控制台</h1>
        <p class="mb-2 mt-1 px-3 text-xs text-ink-2">外观、账号、服务与集成</p>
        <div v-for="g in groups" :key="g.name" class="mt-4">
          <p v-if="g.name" class="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-ink-2">{{ g.name }}</p>
          <button
            v-for="s in g.items"
            :key="s.id"
            type="button"
            class="flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left text-[13.5px] transition-all duration-micro"
            :class="active?.id === s.id
              ? 'bg-brand/15 font-medium text-ink-0 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.25)]'
              : 'text-ink-1 hover:bg-glass hover:text-ink-0'"
            @click="select(s.id)"
          >
            <span
              class="flex h-[26px] w-[26px] items-center justify-center rounded-lg"
              :class="active?.id === s.id
                ? 'bg-gradient-to-br from-brand to-brand-cyan text-white'
                : 'bg-bg-2 text-ink-1'"
            >
              <component :is="s.icon" :size="14" />
            </span>
            {{ s.title }}
          </button>
        </div>
      </aside>

      <main v-if="active" class="min-w-0 flex-1">
        <header class="flex items-start justify-between gap-3 pt-2">
          <div>
            <h2 class="text-[22px] font-bold tracking-tight">{{ active.title }}</h2>
            <p class="mt-0.5 text-xs text-ink-2">{{ active.desc }}</p>
          </div>
          <ThemeToggle />
        </header>
        <div class="mt-4">
          <component :is="active.component" v-bind="sectionProps(active)" />
        </div>
      </main>
    </div>

    <!-- ═══ 移动端：菜单 ↔ 钻取 ═══ -->
    <Transition v-else name="page" mode="out-in">
      <div v-if="!active" key="menu" class="pt-2">
        <header class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-[30px] font-bold tracking-tight">控制台</h1>
            <p class="mt-1 text-sm text-ink-2">外观、账号、服务与集成</p>
          </div>
          <ThemeToggle class="mt-1.5" />
        </header>
        <div v-for="g in groups" :key="g.name" class="mt-5">
          <p v-if="g.name" class="px-1 pb-2 text-xs font-medium text-ink-2">{{ g.name }}</p>
          <div class="overflow-hidden rounded-2xl border border-line bg-glass">
            <button
              v-for="(s, i) in g.items"
              :key="s.id"
              type="button"
              class="flex h-12 w-full cursor-pointer items-center gap-3 px-3.5 text-left text-[14.5px] text-ink-0 transition-colors duration-micro active:bg-bg-2"
              :class="i > 0 ? 'border-t border-line' : ''"
              @click="select(s.id)"
            >
              <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-2 text-ink-1">
                <component :is="s.icon" :size="16" />
              </span>
              {{ s.title }}
              <ChevronRight :size="15" class="ml-auto text-ink-2" />
            </button>
          </div>
        </div>
      </div>

      <div v-else :key="active.id" class="pt-2">
        <div class="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="返回"
            class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-glass text-ink-0 transition-all duration-micro active:scale-90"
            @click="back"
          >
            <ChevronLeft :size="16" />
          </button>
          <div>
            <h2 class="text-xl font-bold tracking-tight">{{ active.title }}</h2>
            <p class="text-[11px] text-ink-2">{{ active.desc }}</p>
          </div>
        </div>
        <div class="mt-4">
          <component :is="active.component" v-bind="sectionProps(active)" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateX(14px);
}
.page-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
