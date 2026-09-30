<script setup lang="ts">
defineProps<{ padded?: boolean }>()
</script>

<template>
  <section
    class="glass-panel rounded-card shadow-card transition-transform duration-micro"
    :class="padded === false ? '' : 'p-4'"
  >
    <slot />
  </section>
</template>
