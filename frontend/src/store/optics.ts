import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export interface OpticsParams {
  wavelength: number
  slitWidth: number
  slitSeparation: number
  screenDistance: number
}

export interface Preset {
  id: string
  name: string
  params: OpticsParams
  createdAt: number
  updatedAt: number
}

export interface FieldIssue {
  key: keyof OpticsParams
  label: string
  unit: string
  raw: unknown
  fixed: number
  reason: string
}

type PendingAction =
  | {
      kind: 'switch'
      presetId: string
      presetName: string
      normalized: OpticsParams
      issues: FieldIssue[]
      willChange: boolean
      snapshot: OpticsParams
    }
  | { kind: 'delete'; presetId: string; presetName: string }
  | { kind: 'restore'; normalized: OpticsParams; issues: FieldIssue[]; fallback: OpticsParams }
  | { kind: 'save'; name: string }

const STORAGE_KEYS = {
  presets: 'optics.presets.v1',
  active: 'optics.activePreset.v1',
  params: 'optics.params.v1',
  experiment: 'optics.experiment.v1',
}

export const DEFAULT_PARAMS: OpticsParams = {
  wavelength: 550,
  slitWidth: 50,
  slitSeparation: 200,
  screenDistance: 1000,
}

interface FieldSpec {
  key: keyof OpticsParams
  label: string
  min: number
  max: number
  step: number
  unit: string
  fallback: number
}

export const PARAM_FIELDS: FieldSpec[] = [
  { key: 'wavelength', label: '波长', min: 380, max: 780, step: 5, unit: 'nm', fallback: 550 },
  { key: 'slitWidth', label: '缝宽', min: 10, max: 200, step: 5, unit: 'μm', fallback: 50 },
  { key: 'slitSeparation', label: '缝间距', min: 50, max: 500, step: 10, unit: 'μm', fallback: 200 },
  { key: 'screenDistance', label: '屏幕距离', min: 100, max: 2000, step: 50, unit: 'mm', fallback: 1000 },
]

const FIELD_SPECS = Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, f])) as Record<keyof OpticsParams, FieldSpec>

function paramsEqual(a: OpticsParams, b: OpticsParams): boolean {
  return PARAM_FIELDS.every((f) => a[f.key] === b[f.key])
}

/** 校验参数是否仍在当前允许的范围/步进内，并给出吸附修正后的值与失效明细 */
function validateAndNormalize(raw: unknown): { value: OpticsParams; issues: FieldIssue[] } {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const value: OpticsParams = { ...DEFAULT_PARAMS }
  const issues: FieldIssue[] = []

  for (const spec of PARAM_FIELDS) {
    const input = source[spec.key]
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      value[spec.key] = spec.fallback
      issues.push({
        key: spec.key,
        label: spec.label,
        unit: spec.unit,
        raw: input,
        fixed: spec.fallback,
        reason: '参数缺失或无效，已恢复默认值',
      })
      continue
    }

    let v = input
    let reason = ''
    if (v < spec.min || v > spec.max) {
      reason = `超出允许范围 ${spec.min}–${spec.max}，已自动修正`
      v = Math.min(spec.max, Math.max(spec.min, v))
    }
    const snapped = spec.min + Math.round((v - spec.min) / spec.step) * spec.step
    const fixed = Math.min(spec.max, Math.max(spec.min, snapped))
    if (fixed !== input) {
      if (!reason) reason = `不满足步进 ${spec.step}，已吸附到最近有效值`
      issues.push({ key: spec.key, label: spec.label, unit: spec.unit, raw: input, fixed, reason })
    }
    value[spec.key] = fixed
  }

  return { value, issues }
}

function loadJSON<T>(key: string): T | null {
  try {
    const text = localStorage.getItem(key)
    return text ? (JSON.parse(text) as T) : null
  } catch {
    return null
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时静默降级，不影响实验 */
  }
}

function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const useOpticsStore = defineStore('optics', () => {
  const currentExperiment = ref('double')
  const params = ref<OpticsParams>({ ...DEFAULT_PARAMS })
  const intensityData = ref<number[]>([])
  const result = ref<{ fringe?: number; centralWidth?: number }>({})

  const presets = ref<Preset[]>([])
  const activePresetId = ref<string | null>(null)
  const pendingAction = ref<PendingAction | null>(null)
  // 上一组已成功应用的可用参数，用于取消切换/恢复时回滚
  const lastUsableParams = ref<OpticsParams>({ ...DEFAULT_PARAMS })

  const activePreset = computed<Preset | null>(
    () => presets.value.find((p) => p.id === activePresetId.value) ?? null,
  )
  // 当前参数相对于正在使用的预设是否已被手动修改
  const isDirty = computed(() => {
    const p = activePreset.value
    return !!p && !paramsEqual(p.params, params.value)
  })
  const hasPendingAction = computed(() => pendingAction.value !== null)

  function setExperiment(id: string) {
    currentExperiment.value = id
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
      result.value.fringe = Math.round((lambda * LM) / dM * 1e3 * 100) / 100
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const delta = (Math.PI * dM * x) / (lambda * LM)
        const beta = (Math.PI * aM * x) / (lambda * LM) || 1e-10
        const single = Math.sin(beta) / beta
        const intensity = Math.cos(delta) ** 2 * single ** 2
        data.push(Math.max(0, intensity))
      }
    } else if (currentExperiment.value === 'single') {
      result.value.centralWidth = Math.round((2 * lambda * LM) / aM * 1e3 * 100) / 100
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const beta = (Math.PI * aM * x) / (lambda * LM) || 1e-10
        const intensity = (Math.sin(beta) / beta) ** 2
        data.push(Math.max(0, intensity))
      }
    } else {
      // newton
      const R = 1.0
      for (let i = 0; i < N; i++) {
        const r = (i / N) * 5e-3
        const path = (r * r) / (2 * R)
        const phi = (2 * Math.PI * path) / lambda + Math.PI
        const intensity = 0.5 * (1 - Math.cos(phi))
        data.push(Math.max(0, intensity))
      }
    }

    intensityData.value = data
    // compute 只会被滑块（取值恒有效）或成功应用预设调用，成功后刷新可用快照
    lastUsableParams.value = { ...params.value }
  }

  // ---------- 预设管理 ----------

  function defaultPresetName(): string {
    return `预设 ${presets.value.length + 1} · ${params.value.wavelength}nm`
  }

  function persistPreset(p: Preset) {
    presets.value.push(p)
    activePresetId.value = p.id
    params.value = { ...p.params }
    compute()
  }

  function requestSavePreset() {
    if (pendingAction.value) return
    pendingAction.value = { kind: 'save', name: defaultPresetName() }
  }

  function requestApplyPreset(id: string) {
    if (pendingAction.value) return // 确认弹窗打开期间锁定，防止连续切换造成中间态
    const preset = presets.value.find((p) => p.id === id)
    if (!preset) return

    const { value: normalized, issues } = validateAndNormalize(preset.params)
    if (id === activePresetId.value && paramsEqual(preset.params, params.value) && issues.length === 0) return
    if (!issues.length && paramsEqual(params.value, normalized)) {
      // 参数本就一致：仅切换归属，无需确认
      activePresetId.value = id
      return
    }

    pendingAction.value = {
      kind: 'switch',
      presetId: preset.id,
      presetName: preset.name,
      normalized,
      issues,
      willChange: !paramsEqual(params.value, normalized),
      snapshot: { ...params.value },
    }
  }

  function updatePreset(id: string) {
    if (pendingAction.value) return
    const idx = presets.value.findIndex((p) => p.id === id)
    if (idx < 0) return
    const { value } = validateAndNormalize(params.value)
    presets.value[idx] = { ...presets.value[idx], params: value, updatedAt: Date.now() }
    activePresetId.value = id
    params.value = { ...value }
    compute()
  }

  function requestDeletePreset(id: string) {
    if (pendingAction.value) return
    const preset = presets.value.find((p) => p.id === id)
    if (!preset) return
    // 正在使用的预设需先确认；删除后保留当前可用参数与图样
    if (id === activePresetId.value) {
      pendingAction.value = { kind: 'delete', presetId: id, presetName: preset.name }
    } else {
      presets.value = presets.value.filter((p) => p.id !== id)
    }
  }

  function confirmPending(name?: string) {
    const action = pendingAction.value
    if (!action) return

    if (action.kind === 'switch') {
      activePresetId.value = action.presetId
      params.value = { ...action.normalized }
      compute()
    } else if (action.kind === 'delete') {
      presets.value = presets.value.filter((p) => p.id !== action.presetId)
      if (action.presetId === activePresetId.value) {
        activePresetId.value = null
        // 不修改 params：上一组可用状态（参数与图样）继续保留
        lastUsableParams.value = { ...params.value }
      }
    } else if (action.kind === 'restore') {
      // activePresetId 在 restore() 中已按仍存在的最近预设设定，此处保持不变
      params.value = { ...action.normalized }
      compute()
    } else if (action.kind === 'save') {
      const { value } = validateAndNormalize(params.value)
      const now = Date.now()
      persistPreset({
        id: makeId(),
        name: name?.trim() || defaultPresetName(),
        params: value,
        createdAt: now,
        updatedAt: now,
      })
    }

    pendingAction.value = null
  }

  function cancelPending() {
    const action = pendingAction.value
    if (!action) return

    if (action.kind === 'switch') {
      // 回滚到切换前的上一组可用状态
      if (!paramsEqual(params.value, action.snapshot)) {
        params.value = { ...action.snapshot }
        compute()
      }
    } else if (action.kind === 'restore') {
      activePresetId.value = null
      if (!paramsEqual(params.value, action.fallback)) {
        params.value = { ...action.fallback }
        compute()
      }
    }
    pendingAction.value = null
  }

  // ---------- 重新进入实验时恢复最近选择 ----------

  function restore() {
    const savedPresets = loadJSON<unknown[]>(STORAGE_KEYS.presets)
    if (Array.isArray(savedPresets)) {
      presets.value = savedPresets
        .filter(
          (p): p is Preset =>
            !!p &&
            typeof p === 'object' &&
            typeof (p as Preset).id === 'string' &&
            typeof (p as Preset).name === 'string' &&
            !!(p as Preset).params &&
            typeof (p as Preset).params === 'object',
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          // 保留原始数值：失效（越界/不满足步进）参数在应用时才确认与修正
          params: p.params,
          createdAt: Number(p.createdAt) || Date.now(),
          updatedAt: Number(p.updatedAt) || Date.now(),
        }))
    }

    const savedExperiment = loadJSON<string>(STORAGE_KEYS.experiment)
    if (savedExperiment === 'double' || savedExperiment === 'single' || savedExperiment === 'newton') {
      currentExperiment.value = savedExperiment
    }

    const savedActiveId = loadJSON<string>(STORAGE_KEYS.active)
    const active = savedActiveId ? presets.value.find((p) => p.id === savedActiveId) ?? null : null
    activePresetId.value = active ? active.id : null

    // 优先恢复上次屏幕上的实际参数，其次是最近选中预设的参数
    const savedParams = loadJSON<OpticsParams>(STORAGE_KEYS.params)
    const candidate: unknown = savedParams ?? (active ? active.params : DEFAULT_PARAMS)
    const { value, issues } = validateAndNormalize(candidate)

    if (issues.length) {
      // 先落到内置默认（可用状态），再请用户确认是否按修正值恢复
      params.value = { ...DEFAULT_PARAMS }
      pendingAction.value = {
        kind: 'restore',
        normalized: value,
        issues,
        fallback: { ...DEFAULT_PARAMS },
      }
    } else {
      params.value = value
    }

    compute()
  }

  // ---------- 持久化（滑块拖动频繁，做轻量防抖） ----------

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function flushSave() {
    saveTimer = null
    saveJSON(STORAGE_KEYS.presets, presets.value)
    saveJSON(STORAGE_KEYS.active, activePresetId.value)
    saveJSON(STORAGE_KEYS.params, params.value)
    saveJSON(STORAGE_KEYS.experiment, currentExperiment.value)
  }
  watch([presets, activePresetId, params, currentExperiment], () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, 150)
  }, { deep: true })

  restore()

  return {
    currentExperiment,
    params,
    intensityData,
    result,
    presets,
    activePresetId,
    activePreset,
    isDirty,
    pendingAction,
    hasPendingAction,
    lastUsableParams,
    setExperiment,
    compute,
    requestSavePreset,
    requestApplyPreset,
    updatePreset,
    requestDeletePreset,
    confirmPending,
    cancelPending,
  }
})
