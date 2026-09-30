<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', disabled: false },
)
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all duration-micro active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    :class="[
      size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
      variant === 'primary' && 'bg-gradient-to-r from-brand to-brand-cyan text-white shadow-glow hover:brightness-110',
      variant === 'ghost' && 'bg-glass text-ink-1 hover:text-ink-0 border border-line',
      variant === 'danger' && 'bg-err/15 text-err border border-err/30 hover:bg-err/25',
      disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
    ]"
  >
    <slot />
  </button>
</template>
