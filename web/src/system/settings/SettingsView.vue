<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Blocks, Download, Info, Key, Moon, Sun, Waves, Zap } from 'lucide-vue-next'
import AppFrame from '../../components/AppFrame.vue'
import BaseCard from '../../components/ui/BaseCard.vue'
import BaseSwitch from '../../components/ui/BaseSwitch.vue'
import { useTheme } from '../../composables/useTheme'
import { useBreakpoint } from '../../composables/useBreakpoint'
import { api } from '../../services/api'

const router = useRouter()
const { theme, setTheme } = useTheme()
const { isMobile } = useBreakpoint()

const dark = computed({
  get: () => theme.value === 'dark',
  set: (v: boolean) => setTheme(v ? 'dark' : 'light'),
})

const standalone = ref(false)

// ─── M13 TokenHub 模型服务 ───
const keyInput = ref('')
const keyMasked = ref<string | null>(null)
const hasKey = ref(false)
const testing = ref(false)
const testResult = ref('')

onMounted(async () => {
  standalone.value =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  try {
    const s = await api.settings()
    hasKey.value = s.has_key
    keyMasked.value = s.api_key_masked ?? null
  } catch { /* 后端未连接 */ }
})

async function saveKey() {
  const v = keyInput.value.trim()
  if (!v) return
  try {
    const s = await api.saveSettings({ api_key: v })
    hasKey.value = s.has_key
    keyMasked.value = s.api_key_masked ?? null
    keyInput.value = ''
  } catch (e) {
    alert(`保存失败：${(e as Error).message}`)
  }
}

async function testConn() {
  testing.value = true
  testResult.value = ''
  try {
    const r = await api.testConnection()
    testResult.value = r.ok
      ? `连接成功 · ${r.model ?? ''}${r.sample ? ' · ' + r.sample : ''}`
      : `失败：${r.error}`
  } catch (e) {
    testResult.value = `失败：${(e as Error).message}`
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <AppFrame>
    <div class="flex flex-col gap-4 pb-2">
      <header class="pt-2">
        <h1 class="text-[30px] font-bold tracking-tight">设置</h1>
        <p class="mt-1 text-sm text-ink-2">外观、安装状态与关于</p>
      </header>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">外观</p>
        <BaseCard class="flex items-center gap-3 !p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <Moon v-if="dark" :size="18" />
            <Sun v-else :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">暗色主题</p>
            <p class="mt-0.5 text-[11px] text-ink-2">暗色优先的玻璃拟态，亮色为备选</p>
          </div>
          <BaseSwitch v-model="dark" />
        </BaseCard>
        <BaseCard class="flex items-center gap-3 !p-4 opacity-60">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-bg-2 text-ink-1">
            <Waves :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">外观密度</p>
            <p class="mt-0.5 text-[11px] text-ink-2">紧凑 / 舒适 —— 后续版本提供</p>
          </div>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">管理</p>
        <BaseCard
          class="flex cursor-pointer items-center gap-3 !p-4 transition-all duration-micro hover:border-brand/30"
          @click="router.push('/plugins-manager')"
        >
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-cyan/15 text-brand-cyan">
            <Blocks :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">插件管理</p>
            <p class="mt-0.5 text-[11px] text-ink-2">查看依赖、热启停、安装与卸载</p>
          </div>
          <span class="text-ink-2">›</span>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">模型服务</p>
        <BaseCard class="!p-4">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
              <Key :size="18" />
            </span>
            <div class="flex-1">
              <p class="text-sm font-medium">TokenHub API Key</p>
              <p class="mt-0.5 text-[11px] text-ink-2">
                {{ hasKey ? `已配置（${keyMasked}）· 只写存储，不回读` : '尚未配置 · 填入 sk-tp- 开头的密钥' }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <input
              v-model="keyInput"
              type="password"
              autocomplete="off"
              placeholder="sk-tp-…"
              class="h-9 flex-1 rounded-xl border border-line bg-bg-0 px-3 text-sm text-ink-0 outline-none focus:border-brand/50"
            />
            <button
              type="button"
              :disabled="!keyInput.trim()"
              class="h-9 rounded-xl bg-gradient-to-r from-brand to-brand-cyan px-4 text-sm font-medium text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              @click="saveKey"
            >保存</button>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              :disabled="testing"
              class="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-glass px-4 text-sm text-ink-1 transition-all duration-micro hover:border-brand/40 disabled:opacity-50"
              @click="testConn"
            >
              <Zap :size="14" class="text-brand-cyan" /> {{ testing ? '测试中…' : '连通性测试' }}
            </button>
            <span v-if="testResult" class="min-w-0 truncate text-[11px] text-ink-2">{{ testResult }}</span>
          </div>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">PWA</p>
        <BaseCard class="flex items-center gap-3 !p-4">
          <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-ok/15 text-ok">
            <Download :size="18" />
          </span>
          <div class="flex-1">
            <p class="text-sm font-medium">安装状态</p>
            <p class="mt-0.5 text-[11px] text-ink-2">
              {{ standalone ? '已安装为独立应用' : '浏览器访问中——可从地址栏安装到桌面/主屏幕' }}
            </p>
          </div>
          <span
            class="rounded-full px-2.5 py-1 text-[11px]"
            :class="standalone ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'"
          >
            {{ standalone ? '已安装' : '未安装' }}
          </span>
        </BaseCard>
      </section>

      <section class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">关于</p>
        <BaseCard class="!p-4">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-cyan font-bold text-white shadow-glow">A</span>
            <div>
              <p class="text-sm font-semibold">AgentOS · PWA Agent 样例</p>
              <p class="mt-0.5 text-[11px] text-ink-2">v0.1.0 · M1 双布局壳 + PWA</p>
            </div>
          </div>
          <p class="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-1">
            <Info :size="13" class="mt-0.5 shrink-0 text-brand" />
            一切皆插件的 Agent 演示：后端 cordis 内核（Service 仓库 / inject 拓扑 / 五种事件分发 / 可逆副作用），前端应用注册表驱动的双布局壳。
          </p>
        </BaseCard>
      </section>
    </div>
  </AppFrame>
</template>
