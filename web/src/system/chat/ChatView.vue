<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Bot, ImagePlus, Loader2, PanelLeftOpen, Plus, Send, Square, User, X } from 'lucide-vue-next'
import BaseCard from '../../components/ui/BaseCard.vue'
import BasePanel from '../../components/ui/BasePanel.vue'
import ChatSidebar from './ChatSidebar.vue'
import ToolGroup from './ToolGroup.vue'
import { useChat, type Block, type ChatMsg } from './useChat'
import { isMobile } from '../../composables/useBreakpoint'
import { downscaleImage } from '../../services/screenCapture'
import type { ToolCard } from '../../services/api'

const {
  sending, tick, models, currentModel, displayMessages,
  loadModels, selectModel, refreshSessions, restoreRuns, send, stop,
} = useChat()

const draft = ref('')
const listEl = ref<HTMLElement>()
const panelOpen = ref(false)

// M17.1：displayMessages（历史 + 活动 run 实时气泡）由 useChat 共享导出，
// 与创造模式浮窗同源渲染

// M17：离开页面不再终止——run 在服务端常驻执行，过程面板全程可见；
// 刷新页面后 restoreRuns 重挂活动 run 并重放事件重建现场
onMounted(() => { loadModels(); refreshSessions(); restoreRuns() })

watch(tick, scrollBottom)

async function scrollBottom() {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
}

function submit() {
  const text = draft.value.trim()
  if ((!text && !pendingImages.value.length) || sending.value) return
  draft.value = ''
  const images = [...pendingImages.value]
  pendingImages.value = []
  send(text || '请根据这些图片进行修改', images)
}

// ─── 图片输入（M17.9 支持多张）：粘贴 / 「+」号选择，同一 vision 链路 ──
const pendingImages = ref<string[]>([])
const pasting = ref(false)

async function addImageFile(file: File) {
  pasting.value = true
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    pendingImages.value.push(await downscaleImage(dataUrl))
    scrollBottom()
  } catch (err) {
    console.error('[chat] 图片处理失败', err)
  } finally {
    pasting.value = false
  }
}

async function onPaste(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/'))
  if (!items.length) return
  e.preventDefault()
  const files = items.map((i) => i.getAsFile()).filter((f): f is File => Boolean(f))
  for (const f of files) await addImageFile(f)
}

function removeImage(i: number) {
  pendingImages.value.splice(i, 1)
}

/** 「+」号附件：唤起系统文件选择器（移动端 = 相册/相机），图片压缩后进预览条 */
const fileEl = ref<HTMLInputElement>()

function pickImage() {
  fileEl.value?.click()
}

async function onFilePick(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  ;(e.target as HTMLInputElement).value = ''    // 允许连续选择同一文件
  for (const file of files) {
    if (file.type.startsWith('image/')) await addImageFile(file)
  }
}

function textOf(b: Block): string {
  return b.kind === 'text' ? b.text : ''
}

/** 截屏修改消息解析：元信息（插件/选区）与指令分层显示（M17.5）。
 *  兼容历史消息：剥离旧版附带的整屏 DOM 摘要（无价值噪音）。 */
function parseShotMsg(text: string): { meta: string; body: string } | null {
  if (!text.startsWith('[截屏修改')) return null
  const end = text.indexOf(']')
  if (end < 0) return null
  let body = text.slice(end + 1).trim()
  for (const marker of ['\n\n整屏 DOM 结构：', '\n\n选区 DOM 结构：']) {
    const i = body.indexOf(marker)
    if (i >= 0) body = body.slice(0, i).trim()
  }
  return { meta: text.slice(1, end), body }
}

// M17.3：连续工具块折叠为过程摘要组（对齐 DeepSeek Harness：
// 中间过程收纳一行，点开看明细；最终回答正常气泡展示）
type Seg = { kind: 'text'; text: string } | { kind: 'tools'; tools: ToolCard[] }

function segmentsOf(m: ChatMsg): Seg[] {
  const segs: Seg[] = []
  for (const b of m.blocks) {
    if (b.kind === 'text') {
      segs.push({ kind: 'text', text: b.text })
    } else {
      const last = segs[segs.length - 1]
      if (last && last.kind === 'tools') last.tools.push(b.tool)
      else segs.push({ kind: 'tools', tools: [b.tool] })
    }
  }
  return segs
}
</script>

<template>
  <!-- 单一根节点：Transition out-in 要求子组件单元素根，Fragment 会导致切页永久空白 -->
  <div class="h-full">
    <div class="flex h-full gap-3 p-3">
    <!-- 左栏由 App 自己画（内核不再渲染工作栏） -->
    <aside v-if="!isMobile" class="w-60 shrink-0">
      <BasePanel title="会话">
        <ChatSidebar />
      </BasePanel>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <header v-if="isMobile" class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-glass text-ink-1 border border-line transition-all duration-micro active:scale-90 cursor-pointer"
          aria-label="打开会话栏"
          @click="panelOpen = true"
        >
          <PanelLeftOpen :size="17" />
        </button>
        <h1 class="text-[22px] font-bold tracking-tight">对话</h1>
      </header>

      <!-- 头部：右上角紧凑模型选择（M17.6：删标题/契约文案，宽度 1/3、高度压缩） -->
      <div class="flex shrink-0 justify-end">
        <BaseCard class="!rounded-full !p-1">
          <select
            v-model="currentModel"
            class="h-8 max-w-[220px] cursor-pointer rounded-full border-0 bg-transparent px-3 text-[11px] text-ink-1 outline-none transition-all duration-micro hover:text-ink-0"
            aria-label="选择模型"
            @change="selectModel(currentModel)"
          >
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </BaseCard>
      </div>

      <div ref="listEl" class="stagger flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <div
          v-if="!displayMessages.length"
          class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-2"
        >
          <Bot :size="26" class="opacity-60" />
          <p class="text-sm">开始一段新对话吧</p>
        </div>

        <div
          v-for="m in displayMessages"
          :key="m.id"
          class="flex gap-2.5"
          :class="m.role === 'user' ? 'flex-row-reverse' : ''"
        >
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
            :class="m.role === 'user' ? 'bg-bg-2 text-ink-1' : 'bg-brand/15 text-brand'"
          >
            <User v-if="m.role === 'user'" :size="15" />
            <Bot v-else :size="15" />
          </span>
          <div class="max-w-[78%] space-y-2">
            <div v-if="m.images?.length" class="flex flex-wrap gap-1.5">
              <img
                v-for="(img, gi) in m.images"
                :key="gi"
                :src="img"
                alt="图片"
                class="max-h-44 rounded-xl border border-line"
              />
            </div>
            <p
              v-if="!m.blocks.length && m.role === 'assistant' && sending"
              class="rounded-2xl rounded-tl-md glass-panel px-3.5 py-2.5 text-sm text-ink-2"
            >
              …
            </p>

            <template v-for="(seg, i) in segmentsOf(m)" :key="i">
              <!-- 截屏修改消息（M17.5）：插件信息小字 + 指令气泡分层 -->
              <template v-if="seg.kind === 'text' && seg.text && m.role === 'user' && parseShotMsg(seg.text)">
                <p class="truncate text-right text-[10px] font-mono text-ink-2">
                  {{ parseShotMsg(seg.text)?.meta }}
                </p>
                <div
                  class="rounded-2xl rounded-tr-md bg-gradient-to-r from-brand to-brand-cyan px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white"
                >
                  {{ parseShotMsg(seg.text)?.body }}
                </div>
              </template>
              <div
                v-else-if="seg.kind === 'text' && seg.text"
                class="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                :class="
                  m.role === 'user'
                    ? 'rounded-tr-md bg-gradient-to-r from-brand to-brand-cyan text-white'
                    : 'rounded-tl-md glass-panel text-ink-0'
                "
              >
                {{ seg.text }}
              </div>
              <ToolGroup v-else-if="seg.kind === 'tools'" :tools="seg.tools" />
            </template>

            <p v-if="m.stopped" class="text-right text-[11px] text-ink-2">已终止</p>
          </div>
        </div>
      </div>

      <div class="shrink-0 space-y-1.5">
        <!-- 图片预览条（支持多张） -->
        <div v-if="pasting || pendingImages.length" class="flex flex-wrap items-center gap-2 px-1">
          <Loader2 v-if="pasting" :size="13" class="animate-spin text-brand" />
          <template v-else>
            <span
              v-for="(img, i) in pendingImages"
              :key="i"
              class="relative inline-block"
            >
              <img
                :src="img"
                :alt="`待发送图片 ${i + 1}`"
                class="h-10 w-16 rounded-md border border-line object-cover"
              />
              <button
                type="button"
                class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg-2 text-ink-1 shadow-card transition-all duration-micro hover:text-err active:scale-90 cursor-pointer"
                :aria-label="`移除图片 ${i + 1}`"
                @click="removeImage(i)"
              >
                <X :size="9" />
              </button>
            </span>
          </template>
          <span class="flex-1 truncate text-[11px] text-ink-2">
            {{ pasting ? '处理图片…' : `已添加 ${pendingImages.length} 张图片，将随下一条消息发送` }}
          </span>
        </div>

        <form
          class="glass-panel flex items-center gap-2 rounded-2xl p-2 shadow-card"
          @submit.prevent="submit"
        >
          <!-- 「+」号附件（M17.8）：桌面/移动通用，移动端唤起相册/相机 -->
          <button
            type="button"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-2 text-ink-1 transition-all duration-micro hover:text-brand active:scale-90 cursor-pointer disabled:opacity-40"
            :disabled="sending"
            aria-label="添加图片"
            title="添加图片"
            @click="pickImage"
          >
            <Plus :size="18" />
          </button>
          <input
            ref="fileEl"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            aria-hidden="true"
            tabindex="-1"
            @change="onFilePick"
          />
          <ImagePlus v-if="pendingImages.length" :size="15" class="shrink-0 text-brand" />
          <input
            v-model="draft"
            type="text"
            :placeholder="pendingImages.length ? '描述对这些图片的修改要求…' : '给 Agent 发条消息…（可粘贴或 + 添加图片）'"
            class="h-10 flex-1 bg-transparent px-3 text-sm text-ink-0 placeholder:text-ink-2 border-0 outline-none shadow-none focus:ring-0"
            @paste="onPaste"
          />
          <button
            v-if="sending"
            type="button"
            class="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-2 text-ink-0 transition-all duration-micro hover:brightness-110 active:scale-90 cursor-pointer"
            aria-label="终止"
            @click="stop"
          >
            <Square :size="15" fill="currentColor" />
          </button>
          <button
            v-else
            type="submit"
            :disabled="!draft.trim() && !pendingImages.length"
            class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow transition-all duration-micro hover:brightness-110 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-label="发送"
          >
            <Send :size="17" />
          </button>
        </form>
      </div>
    </div>
  </div>

  <!-- 手机端：App 自绘的内部面板（内核不再提供公共抽屉） -->
  <Teleport to="body">
    <Transition name="drawer-overlay">
      <div
        v-if="panelOpen"
        class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
        @click="panelOpen = false"
      ></div>
    </Transition>
    <Transition name="drawer">
      <aside
        v-if="panelOpen"
        class="glass-panel fixed inset-y-0 left-0 z-50 flex w-[80%] max-w-[320px] flex-col border-y-0 border-l-0 shadow-card"
        role="dialog"
        aria-label="会话栏"
      >
        <div class="safe-top flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <p class="flex-1 text-[15px] font-semibold">会话</p>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-full text-ink-1 transition-all duration-micro hover:bg-glass active:scale-90 cursor-pointer"
            aria-label="收起"
            @click="panelOpen = false"
          >
            <X :size="17" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <ChatSidebar @select="panelOpen = false" />
        </div>
      </aside>
    </Transition>
  </Teleport>
  </div>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(-100%);
}
.drawer-overlay-enter-active,
.drawer-overlay-leave-active {
  transition: opacity 200ms ease;
}
.drawer-overlay-enter-from,
.drawer-overlay-leave-to {
  opacity: 0;
}
</style>
