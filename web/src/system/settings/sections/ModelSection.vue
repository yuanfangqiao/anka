<script setup lang="ts">
/**
 * M17.11：模型服务设置 —— TokenHub Key（自原 SettingsView 抽取）
 * + 默认模型下拉（后端 POST /api/settings default_model 的前端入口）。
 */
import { onMounted, ref } from 'vue'
import { Bot, Key, Zap } from 'lucide-vue-next'
import BaseCard from '../../../components/ui/BaseCard.vue'
import { useToast } from '../../../composables/useToast'
import { api } from '../../../services/api'

const toast = useToast()

const keyInput = ref('')
const keyMasked = ref<string | null>(null)
const hasKey = ref(false)
const testing = ref(false)
const testResult = ref('')
const models = ref<{ id: string; name: string }[]>([])
const defaultModel = ref('')
const savingModel = ref(false)

onMounted(async () => {
  try {
    const s = await api.settings()
    hasKey.value = s.has_key
    keyMasked.value = s.api_key_masked ?? null
    models.value = s.models
    defaultModel.value = s.default_model
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
    toast.ok('API Key 已保存')
  } catch (e) {
    toast.err(`保存失败：${(e as Error).message}`)
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

async function saveDefaultModel() {
  if (savingModel.value || !defaultModel.value) return
  savingModel.value = true
  try {
    await api.saveSettings({ default_model: defaultModel.value })
    toast.ok('默认模型已更新')
  } catch (e) {
    toast.err(`保存失败：${(e as Error).message}`)
  } finally {
    savingModel.value = false
  }
}
</script>

<template>
  <section class="space-y-2">
    <p class="px-1 text-xs font-medium text-ink-2">TokenHub</p>
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
    <BaseCard class="flex items-center gap-3 !p-4">
      <span class="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-cyan/15 text-brand-cyan">
        <Bot :size="18" />
      </span>
      <div class="flex-1">
        <p class="text-sm font-medium">默认模型</p>
        <p class="mt-0.5 text-[11px] text-ink-2">对话页未选择时使用的模型</p>
      </div>
      <select
        v-model="defaultModel"
        :disabled="savingModel || !models.length"
        class="h-9 cursor-pointer rounded-xl border border-line bg-bg-0 px-3 text-sm text-ink-0 outline-none transition-all duration-micro focus:border-brand/50 disabled:opacity-50"
        @change="saveDefaultModel"
      >
        <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </BaseCard>
  </section>
</template>
