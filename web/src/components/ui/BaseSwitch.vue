<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="relative h-7 w-12 shrink-0 rounded-full transition-colors duration-micro"
    :class="[
      modelValue ? 'bg-gradient-to-r from-brand to-brand-cyan' : 'bg-bg-2 border border-line',
      disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
    ]"
    @click="toggle"
  >
    <span
      class="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-micro"
      :class="modelValue ? 'left-[22px]' : 'left-0.5'"
    ></span>
  </button>
</template>
