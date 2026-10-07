<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Blocks, Download, Lock, Package, RefreshCw, Trash2 } from 'lucide-vue-next'
import AppFrame from '../../components/AppFrame.vue'
import BaseButton from '../../components/ui/BaseButton.vue'
import BaseCard from '../../components/ui/BaseCard.vue'
import BaseSwitch from '../../components/ui/BaseSwitch.vue'
import StateBadge from '../../components/ui/StateBadge.vue'
import { api, type AvailablePlugin, type PluginInfo } from '../../services/api'
import { syncInstalled, unloadApp } from '../../services/pluginHost'
import { useToast } from '../../composables/useToast'
import { isMobile } from '../../composables/useBreakpoint'
import BasePanel from '../../components/ui/BasePanel.vue'
import PluginsManagerSidebar from './PluginsManagerSidebar.vue'
import { pmState } from './store'

const router = useRouter()
const toast = useToast()

const plugins = ref<PluginInfo[]>([])
const available = ref<AvailablePlugin[]>([])
const online = ref(false)
const busy = ref('')
const confirming = ref<PluginInfo | null>(null)

const systemApps = [
  { id: 'chat', name: '对话', desc: '与插件化 Agent 对话' },
  { id: 'plugins-manager', name: '插件管理', desc: '管理插件的插件（self-hosting）' },
  { id: 'settings', name: '控制台', desc: '主题、安装状态与关于' },
]

const total = computed(() => plugins.value.length)
const activeCount = computed(() => plugins.value.filter((p) => p.state === 'ACTIVE').length)
const failedCount = computed(() => plugins.value.filter((p) => p.state === 'FAILED').length)
const show = (s: string) => pmState.section === 'all' || pmState.section === s

async function refresh() {
  try {
    const [ps, av] = await Promise.all([api.plugins(), api.availablePlugins()])
    plugins.value = ps
    available.value = av
    online.value = true
  } catch (e) {
    console.error(e)
    toast.err('无法连接后端')
  }
}

onMounted(refresh)

async function togglePlugin(p: PluginInfo, next: boolean) {
  if (busy.value) return
  busy.value = p.name
  try {
    const res = next ? await api.enablePlugin(p.name) : await api.disablePlugin(p.name)
    if (res.cascaded.length) {
      toast.warn(`${p.name} 已${next ? '启用' : '禁用'}，级联：${res.cascaded.join('、')}`)
    } else {
      toast.ok(`${p.name} 已${next ? '启用' : '禁用'}`)
    }
    await syncInstalled()
    await refresh()
  } catch (e) {
    console.error(e)
    toast.err('操作失败')
  } finally {
    busy.value = ''
  }
}

async function install(a: AvailablePlugin) {
  if (busy.value) return
  busy.value = a.id
  try {
    const res = await api.installPlugin(a.id)
    if (res.requires_restart) {
      toast.warn(res.message ?? '需重启后端后再安装')
    } else if (res.ok) {
      toast.ok(`${a.name} 已安装`)
      await syncInstalled()
      await refresh()
    } else {
      toast.err(res.message ?? '安装失败')
    }
  } catch (e) {
    console.error(e)
    toast.err('安装失败')
  } finally {
    busy.value = ''
  }
}

async function uninstall() {
  const p = confirming.value
  if (!p) return
  confirming.value = null
  busy.value = p.name
  try {
    const res = await api.uninstallPlugin(p.name)
    unloadApp(p.name)
    if (router.currentRoute.value.meta.appId === p.name) router.push('/')
    toast.ok(`${p.name} 已卸载${res.cascaded.length ? `，级联：${res.cascaded.join('、')}` : ''}；刷新后彻底移除`)
    await refresh()
  } catch (e) {
    console.error(e)
    toast.err('卸载失败')
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <!-- 单一根节点：Transition out-in 要求子组件单元素根，Fragment 会导致切页永久空白 -->
  <div class="h-full">
    <div class="flex h-full gap-3 p-3">
    <!-- 分类栏由 App 自绘（桌面左栏 / 手机 chips） -->
    <aside v-if="!isMobile" class="w-56 shrink-0">
      <BasePanel title="插件管理">
        <PluginsManagerSidebar />
      </BasePanel>
    </aside>

    <div class="min-w-0 flex-1 overflow-y-auto">
      <AppFrame>
        <div class="flex flex-col gap-4 pb-2">
          <div v-if="isMobile" class="flex gap-2 pt-1">
            <PluginsManagerSidebar compact />
          </div>
          <header class="flex items-end justify-between pt-1">
        <div>
          <h1 class="text-[30px] font-bold tracking-tight">插件管理</h1>
          <p class="mt-1 text-sm text-ink-2">一切皆插件——包括这个页面自己</p>
        </div>
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-glass text-ink-1 border border-line transition-all duration-micro hover:text-ink-0 active:scale-90 cursor-pointer"
          aria-label="刷新"
          @click="refresh"
        >
          <RefreshCw :size="15" />
        </button>
      </header>

      <BaseCard class="flex items-center gap-4 !p-3.5">
        <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <Blocks :size="19" />
        </span>
        <div class="flex flex-1 items-center gap-5 text-sm">
          <span>总数 <b class="text-ink-0">{{ total }}</b></span>
          <span>活跃 <b class="text-ok">{{ activeCount }}</b></span>
          <span>失败 <b :class="failedCount ? 'text-err' : 'text-ink-0'">{{ failedCount }}</b></span>
        </div>
        <span
          class="rounded-full px-2.5 py-1 text-[11px] border border-line"
          :class="online ? 'text-ok bg-ok/10' : 'text-warn bg-warn/10'"
        >{{ online ? '已连接内核' : '离线' }}</span>
      </BaseCard>

      <section v-if="show('running')" class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">运行中 · {{ plugins.length }}</p>
        <div class="stagger space-y-2">
          <BaseCard v-for="p in plugins" :key="p.name" class="!p-4">
            <div class="flex items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-bg-2 text-ink-1">
                <Package :size="18" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="truncate text-[15px] font-semibold">{{ p.name }}</h3>
                  <StateBadge :state="p.state" />
                  <span v-if="p.source === 'app'" class="rounded-md bg-brand-cyan/15 px-1.5 py-0.5 text-[10px] text-brand-cyan">App</span>
                </div>
                <p class="mt-0.5 text-[11px] text-ink-2">
                  {{ p.is_service ? 'Service 类插件' : '函数插件' }} · 副作用 {{ p.effects }}
                </p>
              </div>
              <button
                v-if="p.source === 'app'"
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink-2 transition-all duration-micro hover:bg-err/15 hover:text-err active:scale-90 cursor-pointer"
                aria-label="卸载"
                @click="confirming = p"
              >
                <Trash2 :size="15" />
              </button>
              <BaseSwitch
                :model-value="p.state === 'ACTIVE'"
                :disabled="busy === p.name"
                @update:model-value="(v: boolean) => togglePlugin(p, v)"
              />
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
              <template v-if="p.inject.length">
                <span class="text-ink-2">inject</span>
                <span v-for="d in p.inject" :key="d" class="rounded-md bg-warn/15 px-2 py-0.5 font-mono text-warn">{{ d }}</span>
                <ArrowRight :size="12" class="text-ink-2" />
              </template>
              <template v-if="p.provide.length">
                <span class="text-ink-2">provide</span>
                <span v-for="s in p.provide" :key="s" class="rounded-md bg-brand/15 px-2 py-0.5 font-mono text-brand">{{ s }}</span>
              </template>
              <span v-if="!p.inject.length && !p.provide.length" class="text-ink-2">无依赖声明</span>
            </div>
          </BaseCard>
        </div>
      </section>

      <section v-if="show('available')" class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">可安装 · {{ available.length }}</p>
        <BaseCard v-if="!available.length" class="border-dashed !p-6 text-center text-sm text-ink-2">
          plugins/ 目录下没有待安装的插件——把插件文件夹放进去就会出现
        </BaseCard>
        <div v-else class="stagger space-y-2">
          <BaseCard v-for="a in available" :key="a.id" class="flex items-center gap-3 !p-4">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-brand">
              <Download :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="text-[15px] font-semibold">{{ a.name }} <span class="font-mono text-[11px] text-ink-2">v{{ a.version }}</span></h3>
              <p class="mt-0.5 truncate text-[12px] text-ink-1">{{ a.description }}</p>
              <p v-if="a.errors.length" class="mt-0.5 text-[11px] text-err">{{ a.errors.join('；') }}</p>
            </div>
            <BaseButton size="sm" :disabled="busy === a.id || a.errors.length > 0" @click="install(a)">
              安装
            </BaseButton>
          </BaseCard>
        </div>
      </section>

      <section v-if="show('system')" class="space-y-2">
        <p class="px-1 text-xs font-medium text-ink-2">系统 · {{ systemApps.length }}</p>
        <div class="stagger space-y-2">
          <BaseCard v-for="s in systemApps" :key="s.id" class="flex items-center gap-3 !p-4">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-cyan text-white">
              <Lock :size="16" />
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="text-[15px] font-semibold">{{ s.name }}</h3>
              <p class="mt-0.5 text-[12px] text-ink-1">{{ s.desc }}</p>
            </div>
            <span class="rounded-full bg-bg-2 px-2.5 py-1 text-[10px] text-ink-2">不可卸载</span>
          </BaseCard>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="confirming"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
        @click.self="confirming = null"
      >
        <BaseCard class="w-full max-w-sm !p-5">
          <h3 class="text-[16px] font-semibold">卸载「{{ confirming.name }}」？</h3>
          <p class="mt-2 text-sm leading-relaxed text-ink-1">
            将停止该插件的所有服务并执行 teardown（逆序回收副作用）。
            若有其他插件依赖它，会被级联卸载并在结果中列出。
          </p>
          <p class="mt-2 text-[12px] text-ink-2">卸载后 dock 图标立即消失；刷新页面后彻底移除。同名再装需重启后端。</p>
          <div class="mt-4 flex justify-end gap-2">
            <BaseButton variant="ghost" size="sm" @click="confirming = null">取消</BaseButton>
            <BaseButton variant="danger" size="sm" @click="uninstall">确认卸载</BaseButton>
          </div>
        </BaseCard>
      </div>
    </Teleport>
      </AppFrame>
    </div>
    </div>
  </div>
</template>
