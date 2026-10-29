/** Keep an active controller awake where the browser supports Screen Wake Lock. */
export class ScreenLock {
  constructor() {
    this.active = false; this.lock = null; this.pending = false;
    this.visible = () => { if (!document.hidden && this.active) this.acquire(); };
    document.addEventListener('visibilitychange', this.visible);
  }
  async acquire() {
    if (this.lock || this.pending || !this.active || document.hidden || !navigator.wakeLock) return;
    this.pending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!this.active || document.hidden) { await lock.release(); return; }
      this.lock = lock; lock.addEventListener('release', () => { if (this.lock === lock) this.lock = null; });
    } catch { /* Unsupported power-saving/permission states keep controls usable. */ }
    finally { this.pending = false; }
  }
  set(active) { this.active = active; if (active) this.acquire(); else { this.lock?.release(); this.lock = null; } }
  close() { this.set(false); document.removeEventListener('visibilitychange', this.visible); }
}
