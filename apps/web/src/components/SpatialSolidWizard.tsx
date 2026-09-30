import { useEffect, useRef } from "react"

import type { SolidPreset, SolidWizardDraft } from "../spatialSolidWizardModel"

import { CoordinateField, Field, Vector3Fields } from "./inspectorFields"

export interface SpatialSolidWizardProps {
  draft: SolidWizardDraft
  selectedFaceLabel?: string
  error?: string | null
  onChange: (draft: SolidWizardDraft) => void
  onConfirm: () => void
  onCancel: () => void
}

const presets: Array<{ value: SolidPreset; label: string }> = [
  { value: "box", label: "长方体" },
  { value: "cube", label: "正方体" },
  { value: "tri-prism", label: "三棱柱 / 斜三棱柱" },
  { value: "quad-prism", label: "四棱柱 / 斜四棱柱" },
  { value: "tri-pyramid", label: "三棱锥" },
  { value: "quad-pyramid", label: "四棱锥" }
]

export function SpatialSolidWizard({ draft, selectedFaceLabel, error, onChange, onConfirm, onCancel }: SpatialSolidWizardProps) {
  const presetRef = useRef<HTMLSelectElement>(null)
  useEffect(() => { presetRef.current?.focus() }, [])
  const isBox = draft.preset === "box" || draft.preset === "cube"
  const isCube = draft.preset === "cube"
  const isPrism = draft.preset.endsWith("-prism")
  const setDimension = (key: "width" | "depth" | "height" | "offsetX" | "offsetY", value: number) => onChange({ ...draft, [key]: value })

  return <section className="three-solid-wizard" role="dialog" aria-modal="false" aria-label="常用立体">
    <div className="three-solid-wizard-heading"><div><span className="toolbar-kicker">立体几何</span><h2>常用立体</h2></div><button type="button" aria-label="关闭常用立体" onClick={onCancel}>×</button></div>
    <p className="three-solid-wizard-help">先调参数，画布实时预览；确认后才写入文档，可一步撤销。</p>
    <div className="three-solid-wizard-fields">
      <Field label="立体类型"><select ref={presetRef} aria-label="立体类型" value={draft.preset} onChange={(event) => onChange({ ...draft, preset: event.target.value as SolidPreset, useSelectedBase: false })}>{presets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></Field>
      {!isBox && selectedFaceLabel && <label className="three-solid-wizard-base"><input type="checkbox" checked={draft.useSelectedBase} onChange={(event) => onChange({ ...draft, useSelectedBase: event.target.checked })} />使用选中面「{selectedFaceLabel}」作为底面</label>}
      {!draft.useSelectedBase && <Vector3Fields prefix="底面起点" value={draft.origin} disabled={false} onChange={(axis, value) => onChange({ ...draft, origin: { ...draft.origin, [axis]: value } })} />}
      {isCube ? <CoordinateField label="棱长" value={draft.width} onChange={(value) => setDimension("width", value)} /> : <>
        {!draft.useSelectedBase && <><CoordinateField label="底面宽" value={draft.width} onChange={(value) => setDimension("width", value)} /><CoordinateField label="底面深" value={draft.depth} onChange={(value) => setDimension("depth", value)} /></>}
        <CoordinateField label={isPrism ? "拉伸向量 Z" : isBox ? "高度" : "法向高度"} value={draft.height} onChange={(value) => setDimension("height", value)} />
      </>}
      {!isBox && <><CoordinateField label={isPrism ? "倾斜 X" : "顶点偏移 X"} value={draft.offsetX} onChange={(value) => setDimension("offsetX", value)} /><CoordinateField label={isPrism ? "倾斜 Y" : "顶点偏移 Y"} value={draft.offsetY} onChange={(value) => setDimension("offsetY", value)} /></>}
    </div>
    {draft.useSelectedBase && <p className="three-solid-wizard-help">新实体按选中面的顶点坐标创建独立拓扑；修改原面不会自动修改新实体。</p>}
    {error && <p className="three-solid-wizard-error" role="alert">{error}</p>}
    <div className="three-solid-wizard-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={Boolean(error)} onClick={onConfirm}>确认创建</button></div>
  </section>
}