/**
 * M17.11：控制台设置项注册表（声明式 master-detail 一级菜单）。
 *
 * 新增设置项 = 注册表加一行 + 一个 section 组件，SettingsView 零改动；
 * 未来 agent / mcp / skills 乃至插件（经 uiCtx 贡献）同此入口。
 */
import type { Component } from 'vue'
import { Blocks, Info, Moon, Smartphone, Zap } from 'lucide-vue-next'
import PluginsManagerView from '../plugins-manager/PluginsManagerView.vue'
import AboutSection from './sections/AboutSection.vue'
import AppearanceSection from './sections/AppearanceSection.vue'
import ClientSection from './sections/ClientSection.vue'
import ModelSection from './sections/ModelSection.vue'

export interface SettingsSection {
  id: string
  title: string
  desc: string
  icon: Component
  /** 侧栏分组名；'' = 不分组（排在最后的独立项，如「关于」） */
  group: string
  component: Component
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'appearance', title: '外观', desc: '主题与显示', icon: Moon, group: '通用', component: AppearanceSection },
  { id: 'client', title: '客户端', desc: '安装与版本更新', icon: Smartphone, group: '通用', component: ClientSection },
  { id: 'model', title: '模型服务', desc: 'TokenHub 凭据与默认模型', icon: Zap, group: '服务', component: ModelSection },
  { id: 'plugins', title: '插件管理', desc: '依赖、启停、安装与卸载', icon: Blocks, group: '集成', component: PluginsManagerView },
  { id: 'about', title: '关于', desc: '版本与架构', icon: Info, group: '', component: AboutSection },
]

export const DEFAULT_SECTION = 'appearance'

export function findSection(id: unknown): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id)
}
