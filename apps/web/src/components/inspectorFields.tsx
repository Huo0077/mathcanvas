import { useState, type ReactNode } from "react"

import type { SolidRotation, Vector3 } from "@draw/dsl"

import { NO_FILL, PLANAR_PALETTE, isActiveColour, normalizeColour } from "../palette"
import { displayDegrees, numberValue, rotationRadians } from "./inspectorMath"

/**
 * **属性检查器的表单骨架**（从 `PropertiesBar.tsx` 拆出）。
 *
 * 这里是"控件层面"的东西：所有面板共用的一小组字段原语。数值换算与度数读写
 * 在 `./inspectorMath`（纯函数，与 React 无关），本文件只放组件 ——
 * 一个文件既导出组件又导出函数时，`react-refresh` 会让整块面板丢掉状态。
 *
 * ## 为什么值得单独一个文件
 *
 * 它们此前散在 `PropertiesBar.tsx`（近千行）的中段，被下面几百行面板 JSX 夹着。
 * 评审方案 2 对 `PropertiesBar` 的要求是"按平面对象、模板实体、点集多面体、测量、工程标注
 * 拆分面板；用图元类型到编辑器的映射控制显示与禁用规则" —— 而**不管怎么拆面板，
 * 这些字段原语的实现只有一份**，所以它们是拆分的第一块地基：先把它拿出来命名，
 * 后面拆面板时才有共用的一层可依赖，而不是每个面板各自再写一个 `CoordinateField`。
 */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>
}

export function InspectorAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return <section className={`inspector-accordion${open ? " is-open" : ""}`}>
    <button className="inspector-accordion-trigger" type="button" aria-expanded={open} onClick={onToggle}>
      <span>{title}</span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="inspector-accordion-content">{children}</div>}
  </section>
}

export function CoordinateField({ label, value, onChange, disabled = false, readOnly = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean; readOnly?: boolean }) {
  return <Field label={label}><input aria-label={label} type="number" step="0.1" value={value} disabled={disabled} readOnly={readOnly} onChange={(event) => onChange(numberValue(event))} /></Field>
}

/**
 * 「创建切线」入口 —— 用户口径 1 的落点：「创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项
 * 是创建一条在这个曲线上的切线。曲线包括抛物线，双曲线，圆，椭圆。」
 *
 * 抽成一个小组件而不是在四个属性面板里各写一遍：按钮文案、禁用条件、可访问名字必须完全一致，
 * 分开写迟早会有一处漏掉（这个项目里"提示与下拉对不上"的教训已经出现过两次）。
 */
export function CurveTangentAction({ sourceId, editable, onCreateCurveTangent }: { sourceId: string; editable: boolean; onCreateCurveTangent?: (sourceId: string) => void }) {
  return <>
    <div className="property-actions" aria-label="曲线切线">
      <button type="button" aria-label="创建切线" disabled={!editable || !onCreateCurveTangent} onClick={() => onCreateCurveTangent?.(sourceId)}>创建切线</button>
    </div>
    <p className="footer-note">创建切线：切点默认落在曲线顶点，之后可以在切线的属性里拖「切点参数」沿曲线滑动，或改成跟随某个动点。</p>
  </>
}

export function Vector3Fields({ prefix, value, disabled, onChange }: { prefix: string; value: Vector3; disabled: boolean; onChange: (axis: keyof Vector3, value: number) => void }) {
  return <div className="metric-grid"><CoordinateField label={`${prefix} X`} value={value.x} disabled={disabled} onChange={(next) => onChange("x", next)} /><CoordinateField label={`${prefix} Y`} value={value.y} disabled={disabled} onChange={(next) => onChange("y", next)} /><CoordinateField label={`${prefix} Z`} value={value.z} disabled={disabled} onChange={(next) => onChange("z", next)} /></div>
}

/**
 * Orientation of a parameterized solid. The angle inputs take exact degrees and step in 15s; the buttons
 * apply the classroom angles (90 degree turns and a reset) without typing.
 */
export function SolidRotationFields({ rotation, disabled, onChange }: { rotation: SolidRotation | undefined; disabled: boolean; onChange: (rotation: SolidRotation) => void }) {
  const current = rotation ?? { x: 0, y: 0, z: 0 }
  const axes = [["x", "X"], ["y", "Y"], ["z", "Z"]] as const
  const setDegrees = (axis: "x" | "y" | "z", degrees: number) => onChange({ ...current, [axis]: rotationRadians(degrees) })

  return <>
    {axes.map(([axis, label]) => <Field key={axis} label={`绕 ${label} 轴（度）`}>
      <input aria-label={`绕 ${label} 轴旋转角度`} type="number" step="15" disabled={disabled} value={displayDegrees(current[axis])} onChange={(event) => setDegrees(axis, numberValue(event))} />
    </Field>)}
    <div className="property-actions" aria-label="朝向快捷角度">
      <button type="button" aria-label="复位朝向" disabled={disabled} onClick={() => onChange({ x: 0, y: 0, z: 0 })}>归零</button>
      {axes.map(([axis, label]) => <button key={axis} type="button" aria-label={`绕 ${label} 轴加 90 度`} disabled={disabled} onClick={() => setDegrees(axis, displayDegrees(current[axis]) + 90)}>{label} +90°</button>)}
    </div>
    <p className="footer-note">角度以度为单位，按 X → Y → Z 依次绕图形自身中心旋转；快捷按钮每次叠加 90°。</p>
  </>
}

/**
 * 「朝向」——空间面 / 圆轨道版。
 *
 * 这两类对象**没有存欧拉角**：面的朝向由它的点算出来、圆轨道存的是一个法向。所以这里不能像模板实体那样
 * 把三个角绑到字段上（输入框会永远读回 0，用户以为没生效）。改成"选轴 + 填角度 + 应用"的相对旋转：
 * 每应用一次就是一次 `rotatePrimitive3`、一步撤销，下面那行法向读数随后刷新——**看到的就是文档里的值**。
 */
export function ObjectRotationFields({ normal, disabled, onRotate }: { normal: Vector3 | null; disabled: boolean; onRotate?: (axis: "x" | "y" | "z", degrees: number) => void }) {
  const [axis, setAxis] = useState<"x" | "y" | "z">("z")
  const [degrees, setDegrees] = useState(15)
  const axes = ["x", "y", "z"] as const
  const blocked = disabled || !onRotate
  const tilt = normal ? Number((Math.acos(Math.min(1, Math.max(-1, normal.z))) * 180 / Math.PI).toFixed(2)) : null
  return <>
    <Field label="旋转轴"><select aria-label="旋转轴" disabled={blocked} value={axis} onChange={(event) => setAxis(event.target.value as "x" | "y" | "z")}>{axes.map((value) => <option key={value} value={value}>{value.toUpperCase()} 轴</option>)}</select></Field>
    <Field label="再转角度（度）"><input aria-label="再转角度" type="number" step="15" disabled={blocked} value={degrees} onChange={(event) => setDegrees(numberValue(event))} /></Field>
    <div className="property-actions" aria-label="旋转朝向">
      <button type="button" aria-label="应用旋转" disabled={blocked || degrees === 0} onClick={() => onRotate?.(axis, degrees)}>旋转</button>
      {axes.map((value) => <button key={value} type="button" aria-label={`绕 ${value.toUpperCase()} 轴加 90 度`} disabled={blocked} onClick={() => onRotate?.(value, 90)}>{value.toUpperCase()} +90°</button>)}
    </div>
    <div className="metric-grid" data-object-orientation={normal ? `${normal.x.toFixed(3)},${normal.y.toFixed(3)},${normal.z.toFixed(3)}` : "none"}>
      <span>当前法向<strong>{normal ? `(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)})` : "—"}</strong></span>
      <span>与 +Z 夹角<strong>{tilt === null ? "—" : `${tilt.toFixed(2)}°`}</strong></span>
    </div>
    <p className="footer-note">空间面与圆轨道的朝向由它们的点 / 法向决定，不能像实体那样"存三个角"，所以这里是**相对**旋转：选轴、填角度、点「旋转」执行一次（一次撤销），快捷按钮每次 90°。法向是文档里的实时读数。</p>
  </>
}

/**
 * 颜色选择：**一排可点的色板** ＋ 一个自定义取色框。
 *
 * 为什么不是只留原生 `<input type="color">`：那个控件只有一个窄方块，用户既看不出"这里能换颜色"，
 * 也得先点开系统取色器才能挑 —— 用户反馈的"功能藏得深"说的就是这种。色板把常用色摊开，
 * 自定义那一格保留原生的完整能力（并且保留原来的 `aria-label`）。
 */
export function ColourField({ label, customLabel, palette, value, fallback, disabled, batch = false, onChange }: {
  label: string
  customLabel: string
  palette: typeof PLANAR_PALETTE
  value: string | undefined
  fallback: string
  disabled: boolean
  /**
   * 批量模式：这一排色块是"命令"而不是"当前值"。
   *
   * 它必须显式区分开，不能靠 `fallback` 传空串糊过去 —— 空串正好会与色板里的空值相等，
   * 于是第一个色块会被误显示成"已选中"（看起来像这一批都是那个颜色）。
   */
  batch?: boolean
  onChange: (value: string) => void
}) {
  const current = batch ? "" : value ?? fallback
  const isNone = !batch && normalizeColour(current) === NO_FILL
  /**
   * 色板分组与色块的**可访问名刻意不含** `线条颜色` / `填充颜色` 这两个串。
   *
   * 原因不是审美，是"名字必须能唯一定位"：`填充颜色色板`、`填充颜色 红` 都包含 `填充颜色`，
   * 于是按名字找取色框会一次命中十几个元素（实测让 3D 交面的 e2e 直接变红，无障碍工具同样会失准）。
   * 归属改由分组名交代（`线条预设` / `填充预设` / `批量改色预设`），色块自己只报颜色名。
   */
  const groupLabel = batch ? "批量改色预设" : label === "线条颜色" ? "线条预设" : "填充预设"
  return <div className="colour-field">
    <span className="properties-label"><span>{label}</span></span>
    <div className="colour-swatches" role="group" aria-label={groupLabel}>
      {palette.map((entry) => <button
        key={entry.value}
        type="button"
        className={`colour-swatch${entry.value === NO_FILL ? " is-none" : ""}`}
        data-colour={entry.value}
        aria-label={entry.label}
        aria-pressed={batch ? undefined : isActiveColour(entry.value, value, fallback)}
        title={entry.label}
        disabled={disabled}
        style={entry.value === NO_FILL ? undefined : { background: entry.value }}
        onClick={() => onChange(entry.value)}
      />)}
      <input
        className="colour-custom"
        aria-label={customLabel}
        type="color"
        disabled={disabled}
        value={isNone ? "#ffffff" : (batch ? "#ffffff" : current)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  </div>
}
