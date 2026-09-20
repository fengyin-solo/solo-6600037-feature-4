<template>
  <Teleport to="body">
    <div v-if="action" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog" aria-modal="true" aria-labelledby="confirm-title" @keydown.esc="store.cancelPending()">
      <div class="w-full max-w-md rounded-lg border border-slate-600 bg-slate-800 p-5 shadow-2xl" @keydown.enter.stop.prevent="confirm">
        <h4 id="confirm-title" class="text-base font-bold" :class="titleColor">{{ title }}</h4>

        <!-- 保存当前参数组合 -->
        <template v-if="action.kind === 'save'">
          <p class="mt-2 text-sm text-slate-300">将当前参数调节面板中的波长、缝宽、缝间距和屏幕距离保存为一组预设。</p>
          <label class="mt-3 block text-xs text-slate-500">预设名称</label>
          <input ref="nameInput" v-model="presetName" type="text" maxlength="40"
            class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-500" />
          <ParamGrid :params="store.params" />
        </template>

        <!-- 切换预设 -->
        <template v-else-if="action.kind === 'switch'">
          <p class="mt-2 text-sm text-slate-300">
            <span class="font-bold text-cyan-400">{{ action.presetName }}</span>
            <template v-if="action.issues.length">中的部分参数已失效，切换将按下表修正后的值应用；</template>
            <template v-else>将替换当前实验条件，</template>
            三类图样与计算结果将同步到同一组参数。
          </p>
          <IssueList v-if="action.issues.length" :issues="action.issues" />
          <div class="mt-3 space-y-3">
            <div>
              <div class="text-xs text-slate-500">当前参数（取消后保留）</div>
              <ParamGrid :params="action.snapshot" />
            </div>
            <div>
              <div class="text-xs text-slate-500">预设参数（确认后应用）</div>
              <ParamGrid :params="action.normalized" :highlight="action.issues.map(i => i.key)" />
            </div>
          </div>
        </template>

        <!-- 删除正在使用的预设 -->
        <template v-else-if="action.kind === 'delete'">
          <p class="mt-2 text-sm text-slate-300">
            <span class="font-bold text-red-400">{{ action.presetName }}</span>
            正在使用中。删除后该预设不可恢复，但当前波长、缝宽、缝间距和屏幕距离，以及三类图样与计算结果都会保持不变。
          </p>
        </template>

        <!-- 恢复已失效参数 -->
        <template v-else>
          <p class="mt-2 text-sm text-slate-300">
            上次实验保存的参数已超出当前允许范围或不再有效。确认后按修正值恢复；取消则保留默认的可用实验条件。
          </p>
          <IssueList :issues="action.issues" />
          <div class="mt-3 space-y-3">
            <div>
              <div class="text-xs text-slate-500">取消后保留的可用状态</div>
              <ParamGrid :params="action.fallback" />
            </div>
            <div>
              <div class="text-xs text-slate-500">确认后恢复的修正值</div>
              <ParamGrid :params="action.normalized" :highlight="action.issues.map(i => i.key)" />
            </div>
          </div>
        </template>

        <div class="mt-5 flex justify-end gap-2">
          <button @click="store.cancelPending()"
            class="rounded border border-slate-600 px-4 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-400">
            取消
          </button>
          <button @click="confirm"
            :class="['rounded px-4 py-1.5 text-sm font-bold transition-colors', confirmClass]">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useOpticsStore } from '../store/optics'
import type { FieldIssue, OpticsParams } from '../store/optics'
import ParamGrid from './ParamGrid.vue'
import IssueList from './IssueList.vue'

const store = useOpticsStore()
const action = computed(() => store.pendingAction)

const presetName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

watch(
  () => action.value?.kind,
  async (kind) => {
    if (kind === 'save') {
      // 打开时名称为空，由 store 在确认时回退到默认名
      await nextTick()
      nameInput.value?.focus()
    }
  },
  { immediate: true },
)

const title = computed(() => {
  switch (action.value?.kind) {
    case 'save':
      return '保存参数预设'
    case 'switch':
      return action.value.issues.length ? '预设参数已失效，确认切换？' : '确认切换预设？'
    case 'delete':
      return '删除正在使用的预设？'
    case 'restore':
      return '恢复上次实验参数？'
    default:
      return '请确认'
  }
})

const titleColor = computed(() => {
  const kind = action.value?.kind
  return kind === 'delete' ? 'text-red-400' : 'text-cyan-400'
})

const confirmText = computed(() => {
  switch (action.value?.kind) {
    case 'save':
      return '保存'
    case 'switch':
      return '应用预设'
    case 'delete':
      return '删除预设'
    case 'restore':
      return '按修正值恢复'
    default:
      return '确认'
  }
})

const confirmClass = computed(() => {
  return action.value?.kind === 'delete'
    ? 'bg-red-600 text-white hover:bg-red-500'
    : 'bg-cyan-600 text-white hover:bg-cyan-500'
})

function confirm() {
  store.confirmPending(presetName.value)
  presetName.value = ''
}
</script>
