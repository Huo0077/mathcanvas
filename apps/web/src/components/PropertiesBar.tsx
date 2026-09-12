import type { ChangeEvent } from "react"

interface PropertiesBarProps { value: number; min: number; max: number; step: number; onChange: (value: number) => void }

export function PropertiesBar({ value, min, max, step, onChange }: PropertiesBarProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))
  return <section className="panel-section properties"><h2 className="panel-title">Properties Bar</h2><label className="properties-label" htmlFor="slope-slider"><span>直线斜率</span><strong className="metric">{value.toFixed(2)}</strong></label><input id="slope-slider" aria-label="直线斜率" type="range" min={min} max={max} step={step} value={value} onChange={handleChange} /><p className="footer-note">拖动滑块，交点会通过 DAG 自动重算。</p></section>
}
