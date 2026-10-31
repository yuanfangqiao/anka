import type { Ref } from 'vue'
import { api, type AvailablePlugin, type PluginInfo } from '../../services/api'
import { syncInstalled } from '../../services/pluginHost'
import { useToast } from '../../composables/useToast'

export function usePluginInstall(busy: Ref<string>, refresh: () => Promise<void>) {
  const toast = useToast()
  async function install(app: AvailablePlugin) {
    if (busy.value) return
    busy.value = app.id
    try {
      const result = await api.installPlugin(app.id)
      if (result.requires_restart) toast.warn(result.message ?? '需重启后端后再安装')
      else if (result.ok) {
        toast.ok(`${app.name} 已安装`)
        await syncInstalled()
        await refresh()
      } else toast.err(result.message ?? '安装失败')
    } catch (error) { console.error(error); toast.err('安装失败') }
    finally { busy.value = '' }
  }
  async function rebuild(app: PluginInfo) {
    if (busy.value) return
    busy.value = app.name
    try {
      await api.buildPlugin(app.name)
      await syncInstalled()
      await refresh()
      toast.ok(`${app.name} 已构建更新；运行中的应用可保存后重新启动`)
    } catch (error) {
      console.error(error)
      toast.err(error instanceof Error ? `构建失败：${error.message}` : '构建失败')
    } finally { busy.value = '' }
  }
  return { install, rebuild }
}
