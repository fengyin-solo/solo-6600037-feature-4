<template>
  <div class="mt-1 grid grid-cols-2 gap-1.5 text-xs">
    <div v-for="f in PARAM_FIELDS" :key="f.key"
      :class="['rounded border px-2 py-1', highlight.includes(f.key)
        ? 'border-yellow-500/60 bg-yellow-900/20 text-yellow-300'
        : 'border-slate-700 bg-slate-900 text-slate-300']">
      <span class="text-slate-500">{{ f.label }}</span>
      <span class="ml-1 font-bold">{{ format(params[f.key]) }}</span>
      <span class="text-slate-500">{{ f.unit }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PARAM_FIELDS } from '../store/optics'
import type { OpticsParams } from '../store/optics'

withDefaults(
  defineProps<{
    params: OpticsParams
    highlight?: Array<keyof OpticsParams>
  }>(),
  { highlight: () => [] },
)

function format(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
</script>
