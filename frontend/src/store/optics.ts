import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface ExpParams {
  wavelength: number
  slitWidth: number
  slitSeparation: number
  screenDistance: number
}

export interface Preset {
  id: string
  name: string
  params: ExpParams
  createdAt: number
}

export const PARAM_RANGES: Record<keyof ExpParams, { min: number; max: number; label: string; unit: string }> = {
  wavelength: { min: 380, max: 780, label: '波长 λ', unit: 'nm' },
  slitWidth: { min: 10, max: 200, label: '缝宽/间距 d', unit: 'μm' },
  slitSeparation: { min: 50, max: 500, label: '缝间距 D', unit: 'μm' },
  screenDistance: { min: 100, max: 2000, label: '屏幕距离 L', unit: 'mm' },
}

const DEFAULT_PARAMS: ExpParams = { wavelength: 550, slitWidth: 50, slitSeparation: 200, screenDistance: 1000 }

const STORAGE_KEYS = {
  presets: 'optics-presets',
  activePreset: 'optics-active-preset',
  lastParams: 'optics-last-params',
}

export const useOpticsStore = defineStore('optics', () => {
  const currentExperiment = ref('double')
  const params = ref<ExpParams>({ ...DEFAULT_PARAMS })
  const intensityData = ref<number[]>([])
  const result = ref<{ fringe?: number; centralWidth?: number }>({})

  // 参数预设
  const presets = ref<Preset[]>([])
  const activePresetId = ref<string | null>(null)
  // 上一组可用状态：删除在用预设 / 恢复失效参数 / 连续切换等操作取消时用于回滚
  const lastValidState = ref<{ params: ExpParams; presetId: string | null }>({
    params: { ...DEFAULT_PARAMS },
    presetId: null,
  })

  function setExperiment(id: string) { currentExperiment.value = id; compute() }

  /** 校验参数，返回失效字段列表（空数组 = 全部合法） */
  function validateParams(p: Partial<ExpParams>): (keyof ExpParams)[] {
    return (Object.keys(PARAM_RANGES) as (keyof ExpParams)[]).filter(k => {
      const v = p[k]
      const r = PARAM_RANGES[k]
      return typeof v !== 'number' || !isFinite(v) || v < r.min || v > r.max
    })
  }

  /** 将参数修正到合法范围（失效字段回退默认值） */
  function clampParams(p: Partial<ExpParams>): ExpParams {
    const out = { ...DEFAULT_PARAMS }
    for (const k of Object.keys(PARAM_RANGES) as (keyof ExpParams)[]) {
      const v = p[k]
      const r = PARAM_RANGES[k]
      out[k] = typeof v === 'number' && isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : DEFAULT_PARAMS[k]
    }
    return out
  }

  /** 保存当前参数组合为预设，并设为当前预设 */
  function savePreset(name: string): Preset {
    const preset: Preset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || `预设 ${presets.value.length + 1}`,
      params: { ...params.value },
      createdAt: Date.now(),
    }
    presets.value.push(preset)
    activePresetId.value = preset.id
    compute()
    return preset
  }

  /** 应用预设；fixInvalid 为 true 时把失效参数修正到合法范围后应用 */
  function applyPreset(id: string, fixInvalid = false): boolean {
    const preset = presets.value.find(p => p.id === id)
    if (!preset) return false
    if (validateParams(preset.params).length && !fixInvalid) return false
    params.value = fixInvalid ? clampParams(preset.params) : { ...preset.params }
    activePresetId.value = id
    compute()
    return true
  }

  /** 删除预设；若删除的正在使用，保留当前参数为手动状态 */
  function deletePreset(id: string) {
    const idx = presets.value.findIndex(p => p.id === id)
    if (idx === -1) return
    presets.value.splice(idx, 1)
    if (activePresetId.value === id) {
      activePresetId.value = null
      compute() // 参数不变，仅解除关联并刷新可用状态
    }
  }

  /** 回滚到上一组可用状态 */
  function restoreLastValidState() {
    params.value = { ...lastValidState.value.params }
    activePresetId.value = lastValidState.value.presetId
    compute()
  }

  /** 手动调参：解除预设关联并即时重算（原有即时反馈不变） */
  function onManualParams() {
    if (activePresetId.value) activePresetId.value = null
    compute()
  }

  function compute() {
    const { wavelength: lam, slitWidth: a, slitSeparation: d, screenDistance: L } = params.value
    const lambda = lam * 1e-9
    const aM = a * 1e-6
    const dM = d * 1e-6
    const LM = L * 1e-3
    const N = 800
    const data: number[] = []
    const xMax = 20e-3

    if (currentExperiment.value === 'double') {
      result.value.fringe = Math.round(lambda * LM / dM * 1e3 * 100) / 100
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const delta = Math.PI * dM * x / (lambda * LM)
        const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
        const single = Math.sin(beta) / beta
        const intensity = Math.cos(delta) ** 2 * single ** 2
        data.push(Math.max(0, intensity))
      }
    } else if (currentExperiment.value === 'single') {
      result.value.centralWidth = Math.round(2 * lambda * LM / aM * 1e3 * 100) / 100
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
        const intensity = (Math.sin(beta) / beta) ** 2
        data.push(Math.max(0, intensity))
      }
    } else { // newton
      const R = 1.0
      for (let i = 0; i < N; i++) {
        const r = (i / N) * 5e-3
        const path = r * r / (2 * R)
        const phi = 2 * Math.PI * path / lambda + Math.PI
        const intensity = 0.5 * (1 - Math.cos(phi))
        data.push(Math.max(0, intensity))
      }
    }

    intensityData.value = data
    // 每次成功计算后，当前状态即为最新的可用状态
    lastValidState.value = { params: { ...params.value }, presetId: activePresetId.value }
  }

  // ---- 持久化：重新进入实验时恢复最近选择 ----
  watch([presets, activePresetId, params], () => {
    try {
      localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(presets.value))
      if (activePresetId.value) localStorage.setItem(STORAGE_KEYS.activePreset, activePresetId.value)
      else localStorage.removeItem(STORAGE_KEYS.activePreset)
      localStorage.setItem(STORAGE_KEYS.lastParams, JSON.stringify(params.value))
    } catch { /* 存储不可用时静默失败 */ }
  }, { deep: true })

  /** 初始化：优先恢复最近选择的有效预设，否则恢复上次手动参数 */
  function init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.presets)
      if (raw) {
        const list = JSON.parse(raw)
        if (Array.isArray(list)) presets.value = list.filter(p => p && p.id && p.params)
      }
    } catch { presets.value = [] }

    const activeId = localStorage.getItem(STORAGE_KEYS.activePreset)
    const active = activeId ? presets.value.find(p => p.id === activeId) : null
    if (active && !validateParams(active.params).length) {
      params.value = { ...active.params }
      activePresetId.value = active.id
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.lastParams)
        if (raw) {
          const p = JSON.parse(raw)
          if (!validateParams(p).length) params.value = clampParams(p)
        }
      } catch { /* 忽略损坏数据 */ }
    }
    compute()
  }

  return {
    currentExperiment, params, intensityData, result,
    presets, activePresetId, lastValidState,
    setExperiment, compute, init,
    validateParams, clampParams,
    savePreset, applyPreset, deletePreset, restoreLastValidState, onManualParams,
  }
})
