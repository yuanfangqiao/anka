/**
 * M18：登录态（模块级单例）。
 * 路由守卫首次导航时经 `/api/auth/me` 探测一次并缓存；登录/登出即时更新。
 */
import { ref } from 'vue'
import { api } from '../services/api'

export const authUser = ref<string | null>(null)

let probed = false

/** 探测登录态（幂等）：未探测过则请求一次 /api/auth/me */
export async function ensureAuthed(): Promise<boolean> {
  if (probed) return authUser.value !== null
  probed = true
  try {
    authUser.value = (await api.me()).username ?? null
  } catch {
    authUser.value = null
  }
  return authUser.value !== null
}

export function markAuthed(username: string) {
  probed = true
  authUser.value = username
}

/** 登出并回到登录页（整页跳转，清掉内存态） */
export async function logoutAndRedirect() {
  try {
    await api.logout()
  } catch (e) {
    console.error('[auth] logout', e)
  }
  probed = true
  authUser.value = null
  location.assign('/login')
}
