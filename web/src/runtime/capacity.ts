import type { AppRun } from './contracts'

export const MAX_RUNNING_APPS = 10
export class AppCapacityError extends Error {
  constructor() { super(`已达到 ${MAX_RUNNING_APPS} 个运行应用上限，请先保存或关闭后台应用`); this.name = 'AppCapacityError' }
}

/** Serialize admission, including the first placeholder, so concurrent launches cannot exceed the cap. */
export function createCapacityManager(options: {
  runs: Map<string, AppRun>
  background: (id: string) => 'pause' | 'continue'
  validate: (id: string) => Promise<void>
  remove: (id: string) => void
}) {
  let tail = Promise.resolve()
  function group(id: string): AppRun[] {
    const result: AppRun[] = []
    const collect = (parent: string) => {
      const run = options.runs.get(parent)
      if (run) result.push(run)
      for (const child of options.runs.values()) if (child.parentId === parent) collect(child.id)
    }
    collect(id)
    return result
  }
  function eligible(run: AppRun, parentId?: string) {
    if (run.parentId || run.visible || run.focused || run.status === 'loading') return false
    const members = group(run.id)
    return !members.some(child => child.id === parentId || child.visible || child.focused
      || child.status === 'loading' || options.background(child.id) === 'continue')
  }
  async function validate(id: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([options.validate(id), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('后台应用未及时确认可关闭')), 2000)
      })])
    } finally { clearTimeout(timer) }
  }
  return {
    reserve(id: string, create: () => AppRun, settings: { preload?: boolean; parentId?: string } = {}) {
      let result: AppRun
      const task = tail.then(async () => {
        const existing = options.runs.get(id)
        if (existing) { result = existing; return }
        if (settings.parentId && !options.runs.has(settings.parentId)) throw new Error('父应用已关闭')
        if (options.runs.size >= MAX_RUNNING_APPS) {
          // Speculative work never evicts an application opened by the user.
          if (settings.preload) throw new AppCapacityError()
          const candidates = [...options.runs.values()].filter(run => eligible(run, settings.parentId))
            .sort((a, b) => a.lastUsed - b.lastUsed || a.key - b.key)
          for (const candidate of candidates) {
            const lastUsed = candidate.lastUsed
            try { await validate(candidate.id) } catch { continue }
            if (options.runs.get(candidate.id) === candidate && candidate.lastUsed === lastUsed
              && eligible(candidate, settings.parentId)) options.remove(candidate.id)
            if (options.runs.size < MAX_RUNNING_APPS) break
          }
          if (options.runs.size >= MAX_RUNNING_APPS) throw new AppCapacityError()
        }
        result = create()
        options.runs.set(id, result)
      })
      tail = task.catch(() => {})
      return task.then(() => result!)
    },
  }
}
