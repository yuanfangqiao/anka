import { ref } from 'vue'

export type ThemeName = 'dark' | 'light'

const STORAGE_KEY = 'agentos-theme'
const theme = ref<ThemeName>('dark')

function apply() {
  const saved = (localStorage.getItem(STORAGE_KEY) as ThemeName | null) ?? 'dark'
  theme.value = saved
  document.documentElement.dataset.theme = saved
}

function setTheme(next: ThemeName) {
  theme.value = next
  localStorage.setItem(STORAGE_KEY, next)
  document.documentElement.dataset.theme = next
}

function toggle() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  return { theme, apply, setTheme, toggle }
}
