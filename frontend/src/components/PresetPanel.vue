<template>
  <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-bold text-slate-400">参数预设</h3>
      <button @click="store.requestSavePreset()" :disabled="store.hasPendingAction"
        class="rounded bg-cyan-600 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
        ＋ 保存当前组合
      </button>
    </div>

    <p v-if="!store.presets.length" class="rounded border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
      暂无预设。调节好波长、缝宽、缝间距和屏幕距离后，点击「保存当前组合」。
    </p>

    <ul v-else class="space-y-1.5">
      <li v-for="preset in store.presets" :key="preset.id"
        :class="['rounded border p-2 transition-all',
          store.activePresetId === preset.id
            ? 'border-cyan-500 bg-cyan-900/20'
            : 'border-slate-700 bg-slate-900/50',
          store.hasPendingAction ? 'opacity-50 pointer-events-none' : '']">
        <button @click="store.requestApplyPreset(preset.id)" class="w-full text-left">
          <div class="flex items-center gap-2">
            <span :class="['truncate text-sm', store.activePresetId === preset.id ? 'text-cyan-400 font-bold' : 'text-slate-200']">
              {{ preset.name }}
            </span>
            <span v-if="store.activePresetId === preset.id"
              class="shrink-0 rounded bg-cyan-600 px-1.5 py-0.5 text-[10px] font-bold text-white">使用中</span>
            <span v-if="store.activePresetId === preset.id && store.isDirty"
              class="shrink-0 rounded bg-yellow-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white"
              title="参数已手动修改，与预设不一致">已修改</span>
          </div>
          <div class="mt-0.5 text-[11px] text-slate-500">
            λ {{ preset.params.wavelength }} nm · 宽 {{ preset.params.slitWidth }} μm ·
            距 {{ preset.params.slitSeparation }} μm · L {{ preset.params.screenDistance }} mm
          </div>
        </button>
        <div class="mt-1.5 flex justify-end gap-1">
          <button v-if="store.activePresetId === preset.id && store.isDirty"
            @click="store.updatePreset(preset.id)"
            class="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:border-cyan-500 hover:text-cyan-400">
            更新预设
          </button>
          <button @click="store.requestDeletePreset(preset.id)"
            class="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-400 hover:border-red-500 hover:text-red-400">
            删除
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useOpticsStore } from '../store/optics'

const store = useOpticsStore()
</script>
