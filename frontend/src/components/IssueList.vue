<template>
  <ul class="mt-3 space-y-1.5">
    <li v-for="issue in issues" :key="issue.key"
      class="flex items-start gap-2 rounded border border-yellow-500/40 bg-yellow-900/15 px-2 py-1.5 text-xs text-yellow-200">
      <span class="mt-px">⚠</span>
      <span>
        <span class="font-bold">{{ issue.label }}</span>
        {{ issue.reason }}：
        <span class="line-through text-slate-400">{{ formatRaw(issue.raw) }}{{ issue.unit }}</span>
        <span class="text-yellow-300"> → {{ issue.fixed }}{{ issue.unit }}</span>
      </span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { FieldIssue } from '../store/optics'

defineProps<{ issues: FieldIssue[] }>()

function formatRaw(raw: unknown): string {
  if (typeof raw === 'number') return String(raw)
  if (raw === undefined || raw === null) return '未设置'
  return '无效值'
}
</script>
