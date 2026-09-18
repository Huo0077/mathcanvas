import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react"
import { dynamicPointPaths } from "../dynamicPointPaths"
import { isTangentSource, tangentAnchorLabel } from "../curveTangents"
import type { AnnotationFeature, EngineeringAnnotationKind, Measurement3Metric, PrimitiveSpec, SolidRotation, Vector3 } from "@draw/dsl"
import { measurementOptionsFor } from "../spatialTools"
import { adaptiveSampleFunctionSegments, evaluateParameterExpression, functionPresets, getFunctionPreset, normalizeVector3, parseExpression, polygonNormal3 } from "@draw/geometry-kernel"
import { parameterWindow, pathConstraint, type Alignment, type PrimitiveUpdatePatch } from "@draw/scene-graph"

import { defaultStrokeFor } from "../primitiveStyle"
import { pointHostValue } from "../pointHostOptions"
import { annotationFeatureOptions } from "../annotations"
import { insertFormulaTemplate } from "../formulaEditor"
import { measurementMetricLabel } from "../measurementLabels"
import { measurementFormText } from "../measurementForms"
import { FormulaKeyboard } from "./FormulaKeyboard"
import { useSceneStore } from "../store"
import { exactConicOf, sectionConicMetrics } from "../conicMetrics"
import { placementPivot, resizedPlacement } from "../curveRotation"
import { FILL_PALETTE, NO_FILL, PLANAR_PALETTE, isActiveColour, normalizeColour, supportsFill } from "../palette"

/** Inspector tabs stay a pure filter: every field update still flows through PropertiesBar's own callbacks. */
export type InspectorSection = "data" | "appearance" | "constraints" | "engineering"
const allInspectorSections: InspectorSection[] = ["data", "appearance", "constraints", "engineering"]

export interface PropertiesBarProps {
  sections?: InspectorSection[]
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  selectedPrimitive: PrimitiveSpec | null
  selectedIds: string[]
  selectedCount: number
  selectedGroupId: string | null
  allSelectedVisible: boolean
  canCreateIntersection: boolean
  onUpdatePrimitive: (patch: PrimitiveUpdatePatch) => void
  /** 剖切面的朝向调整：绕世界轴旋转，枢轴取实体中心（界面上由 App 计算并传入）。 */
  onRotateSection?: (axis: "x" | "y" | "z", degrees: number) => void
  /**
   * 对象朝向的**相对**旋转：空间面 / 圆轨道没有存欧拉角，所以属性栏给的是"再绕世界轴转多少度"，
   * 由 `rotatePrimitive3` 提交（一次操作 = 一步撤销）。模板实体仍走上面那三个绝对角度字段。
   */
  onRotate3?: (axis: "x" | "y" | "z", degrees: number) => void
  /** 把截面物化成独立的点/棱/面图元（与来源解耦）。 */
  onMaterializeSection?: () => void
  /** 空间点可以绑定的宿主（空间直线 / 棱 / 面 / 圆柱与圆锥侧面）。 */
  pointHostCandidates?: { id: string; label: string }[]
  /** 绑定到宿主（传 null = 解绑为自由点）。 */
  onBindPointHost?: (hostValue: string | null) => void
  /** 改宿主参数：一维宿主只用 u，面与曲面用 (u, v)。 */
  onChangeHostParameter?: (u: number, v?: number, w?: number) => void
  onToggleSelectedVisibility: () => void
  onToggleSelectedLock: () => void
  onCreateGroup: () => void
  onDeleteGroup: () => void
  onCreateIntersection: () => void
  onAlign: (alignment: Alignment) => void
  onToggleBatchVisibility: () => void
  onAddAnnotation: (feature: AnnotationFeature, index?: number, text?: string) => void
  onAddEngineeringAnnotation: (kind: EngineeringAnnotationKind) => void
  onCreateMeasurement: (metric: Measurement3Metric, dihedralKind?: "interior" | "exterior") => void
  onDeleteMeasurement: (id: string) => void
  /** 以选中的点为定点创建一条"动圆"（曲线始终过这个点，半径可改，删点即消失）。 */
  onCreateMovingCircle?: () => void
  /** 批量改外观：一次提交改完所有选中对象（多选时检查器里改色只打主选中那一个是老问题）。 */
  onUpdateSelectionStyle?: (style: { stroke?: string; fill?: string; dash?: string; strokeWidth?: number; opacity?: number }) => void
  onDeleteSelected?: () => void
  /** Calculus entry points: a function curve in the planar workspace can grow a derivative, a tangent and an area. */
  onCreateDerivative: (sourceId: string) => void
  onCreateTangent: (sourceId: string) => void
  onCreateIntegral: (sourceId: string) => void
  /**
   * 在**曲线**上作切线（圆 / 圆弧 / 抛物线 / 椭圆 / 双曲线）。
   * 与 `onCreateTangent`（函数图像，切点取定义域中点）分开：两者的切点默认位置不同，
   * 混成一个回调会让"用户此刻点的是哪种曲线"这件事在 App 里再判一次。
   */
  onCreateCurveTangent?: (sourceId: string) => void
  /** 在**动点**处作切线：切线从此随这个点沿轨道滑动。 */
  onCreatePointTangent?: (pointId: string) => void
  /** 以这个点为**圆心**作圆（圆心跟着点走，半径可改、也可以跟随另一个动点）。 */
  onCreateCircleAtPoint?: (pointId: string) => void
}

const alignments: { value: Alignment; label: string }[] = [
  { value: "left", label: "左对齐" }, { value: "right", label: "右对齐" },
  { value: "top", label: "上对齐" }, { value: "bottom", label: "下对齐" },
  { value: "horizontalCenter", label: "横向居中（X）" }, { value: "verticalCenter", label: "纵向居中（Y）" }
]

type LinearPrimitive = Extract<PrimitiveSpec, { type: "line" | "segment" | "ray" }>
type ConicPrimitive = Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>
type SolidPrimitive = Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>

/** 交线 / 交面的状态读数：给用户看的说法，不是内核里的枚举名。 */
const intersectionLineStatusLabels: Record<string, string> = { valid: "有交线", degenerate: "无交线", "insufficient-data": "数据不足" }
const intersectionSolidStatusLabels: Record<string, string> = {
  polyhedron: "有体积的公共区域",
  flat: "只有一块公共平面（体积 0）",
  segment: "只沿一条线段相接",
  point: "只在一个点相接",
  none: "没有公共区域",
  "insufficient-data": "数据不足"
}

/**
 * 交面面积的精度读数（A2）：平面区域/整圆是闭式解，曲面区域（圆柱 / 圆锥侧面）是网格面片求和的近似。
 * `undefined` 是旧文档或还没算过的图元——不假装知道它精确。
 */
const intersectionFaceAreaPrecisionLabels: Record<string, string> = { "true": "闭式精确", "false": "数值近似", "undefined": "未标注" }

const primitiveTypeLabels: Record<PrimitiveSpec["type"], string> = {  point: "点",  point3: "空间点",
  line: "直线",
  line3: "空间直线",
  segment: "线段",
  segment3: "空间线段",
  ray: "射线",
  ray3: "空间射线",
  polyline: "折线",
  connection: "点连接",
  locus: "轨迹",
  parabola: "抛物线",
  ellipse: "椭圆",
  hyperbola: "双曲线",
  function: "函数",
  derivative: "导函数",
  tangent: "切线",
  normal: "法线",
  secant: "割线",
  integral: "积分区域",
  analysisSet: "分析结果",
  cube: "立方体",
  pyramid: "棱锥",
  cylinder: "圆柱",
  cone: "圆锥",
  plane3: "空间平面",
  circle3: "空间圆",
  edge3: "空间棱",
  face3: "空间面",
  polyhedron3: "多面体",
  section: "截面",
  intersectionLine: "交线",
  intersectionSolid: "交集整体",
  intersectionFace: "交面",
  intersectionPoint3: "交点",
  circle: "圆",
  arc: "圆弧",
  intersection: "直线交点",
  lineCircleIntersection: "线圆交点",
  circleIntersection: "圆交点",
  curveIntersection: "曲线交点",
  intersectionSet: "交点集合"
}

function numberValue(event: ChangeEvent<HTMLInputElement>): number {
  return Number(event.target.value)
}

function rotationDegrees(rotation = 0): number {
  return rotation * 180 / Math.PI
}

/** 绕定点的转角读数：折算成 0°..360°，负角折回正区间。 */
function placementDegrees(angle = 0): number {
  const degrees = (angle * 180 / Math.PI) % 360
  return degrees < 0 ? degrees + 360 : degrees
}

function rotationRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

function rotatePoint(center: { x: number; y: number }, x: number, y: number, rotation: number): { x: number; y: number } {
  return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
}

function lineSlope(line: LinearPrimitive): number | null {
  const deltaX = line.b.x - line.a.x
  return Math.abs(deltaX) < 1e-9 ? null : (line.b.y - line.a.y) / deltaX
}

function lineAngle(line: LinearPrimitive): number {
  return Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x) * 180 / Math.PI
}

function lineLength(line: LinearPrimitive): number {
  return Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>
}

function InspectorAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return <section className={`inspector-accordion${open ? " is-open" : ""}`}>
    <button className="inspector-accordion-trigger" type="button" aria-expanded={open} onClick={onToggle}>
      <span>{title}</span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="inspector-accordion-content">{children}</div>}
  </section>
}

function CoordinateField({ label, value, onChange, disabled = false, readOnly = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean; readOnly?: boolean }) {
  return <Field label={label}><input aria-label={label} type="number" step="0.1" value={value} disabled={disabled} readOnly={readOnly} onChange={(event) => onChange(numberValue(event))} /></Field>
}

/**
 * 「创建切线」入口 —— 用户口径 1 的落点：「创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项
 * 是创建一条在这个曲线上的切线。曲线包括抛物线，双曲线，圆，椭圆。」
 *
 * 抽成一个小组件而不是在四个属性面板里各写一遍：按钮文案、禁用条件、可访问名字必须完全一致，
 * 分开写迟早会有一处漏掉（这个项目里"提示与下拉对不上"的教训已经出现过两次）。
 */
function CurveTangentAction({ sourceId, editable, onCreateCurveTangent }: { sourceId: string; editable: boolean; onCreateCurveTangent?: (sourceId: string) => void }) {
  return <>
    <div className="property-actions" aria-label="曲线切线">
      <button type="button" aria-label="创建切线" disabled={!editable || !onCreateCurveTangent} onClick={() => onCreateCurveTangent?.(sourceId)}>创建切线</button>
    </div>
    <p className="footer-note">创建切线：切点默认落在曲线顶点，之后可以在切线的属性里拖「切点参数」沿曲线滑动，或改成跟随某个动点。</p>
  </>
}

function Vector3Fields({ prefix, value, disabled, onChange }: { prefix: string; value: Vector3; disabled: boolean; onChange: (axis: keyof Vector3, value: number) => void }) {
  return <div className="metric-grid"><CoordinateField label={`${prefix} X`} value={value.x} disabled={disabled} onChange={(next) => onChange("x", next)} /><CoordinateField label={`${prefix} Y`} value={value.y} disabled={disabled} onChange={(next) => onChange("y", next)} /><CoordinateField label={`${prefix} Z`} value={value.z} disabled={disabled} onChange={(next) => onChange("z", next)} /></div>
}

/** Degrees shown to the user, rounded so a 45 or 90 preset never reads back as 44.999999. */
function displayDegrees(radians: number): number {
  return Number((radians * 180 / Math.PI).toFixed(2))
}

/**
 * Orientation of a parameterized solid. The angle inputs take exact degrees and step in 15s; the buttons
 * apply the classroom angles (90 degree turns and a reset) without typing.
 */
function SolidRotationFields({ rotation, disabled, onChange }: { rotation: SolidRotation | undefined; disabled: boolean; onChange: (rotation: SolidRotation) => void }) {
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
function ObjectRotationFields({ normal, disabled, onRotate }: { normal: Vector3 | null; disabled: boolean; onRotate?: (axis: "x" | "y" | "z", degrees: number) => void }) {
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
function ColourField({ label, customLabel, palette, value, fallback, disabled, batch = false, onChange }: {
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

export function PropertiesBar({ value, min, max, step, onChange, selectedPrimitive, selectedIds, selectedCount, selectedGroupId, allSelectedVisible, canCreateIntersection, onUpdatePrimitive, onRotateSection, onRotate3, onMaterializeSection, pointHostCandidates, onBindPointHost, onChangeHostParameter, onToggleSelectedVisibility, onToggleSelectedLock, onDeleteSelected, onCreateGroup, onDeleteGroup, onCreateIntersection, onAlign, onToggleBatchVisibility, onAddAnnotation, onAddEngineeringAnnotation, onCreateMeasurement, onDeleteMeasurement, onCreateMovingCircle, onCreateCircleAtPoint, onCreateCurveTangent, onCreatePointTangent, onUpdateSelectionStyle, onCreateDerivative, onCreateTangent, onCreateIntegral, sections = allInspectorSections }: PropertiesBarProps) {
  const [openSections, setOpenSections] = useState<Record<InspectorSection, boolean>>({ data: true, appearance: false, constraints: false, engineering: true })
  const usesExternalSections = sections.length < allInspectorSections.length
  const shows = (section: InspectorSection) => sections.includes(section) && (usesExternalSections || openSections[section])
  const toggleSection = (section: InspectorSection) => setOpenSections((current) => ({ ...current, [section]: !current[section] }))
  const selectedPoint = selectedPrimitive?.type === "point" ? selectedPrimitive : null
  const selectedPoint3 = selectedPrimitive?.type === "point3" ? selectedPrimitive : null
  /** 取成 const 是为了让下面那几段 JSX 里的箭头函数也能保住类型收窄（直接读 `selectedPoint3.binding` 收窄不了）。 */
  const point3Binding = selectedPoint3?.binding
  const selectedLinear = selectedPrimitive?.type === "line" || selectedPrimitive?.type === "segment" || selectedPrimitive?.type === "ray" ? selectedPrimitive : null
  const selectedPolyline = selectedPrimitive?.type === "polyline" ? selectedPrimitive : null
  const selectedParabola = selectedPrimitive?.type === "parabola" ? selectedPrimitive : null
  const selectedEllipseOrHyperbola = selectedPrimitive?.type === "ellipse" || selectedPrimitive?.type === "hyperbola" ? selectedPrimitive : null
  const selectedFunction = selectedPrimitive?.type === "function" ? selectedPrimitive : null
  const selectedCircleOrArc = selectedPrimitive?.type === "circle" || selectedPrimitive?.type === "arc" ? selectedPrimitive : null
  /** 已经定了绕哪个定点旋转的圆 / 椭圆：检查器多出一块"绕定点旋转"。 */
  const selectedPlacedCurve = selectedPrimitive && (selectedPrimitive.type === "circle" || selectedPrimitive.type === "ellipse") && selectedPrimitive.rotationAbout ? selectedPrimitive : null
  const selectedSolid = selectedPrimitive && ["cube", "pyramid", "cylinder", "cone"].includes(selectedPrimitive.type) ? selectedPrimitive as SolidPrimitive : null
  const selectedPlane3 = selectedPrimitive?.type === "plane3" ? selectedPrimitive : null
  const selectedSection = selectedPrimitive?.type === "section" ? selectedPrimitive : null
  const selectedIntersectionLine = selectedPrimitive?.type === "intersectionLine" ? selectedPrimitive : null
  const selectedIntersectionSolid = selectedPrimitive?.type === "intersectionSolid" ? selectedPrimitive : null
  const selectedIntersectionFace = selectedPrimitive?.type === "intersectionFace" ? selectedPrimitive : null
  const selectedIntersectionPoint = selectedPrimitive?.type === "intersectionPoint3" ? selectedPrimitive : null
  /** 交线 / 交面的来源在检查器里要显示成用户认得出的名字，而不是 id。 */
  const sourceLabel = (id: string) => sceneDocument.primitives.find((primitive) => primitive.id === id)?.label ?? id

  const selectedDerivedPoint = selectedPrimitive && (selectedPrimitive.type === "tangent" || selectedPrimitive.type === "normal" || selectedPrimitive.type === "secant") ? ("point" in selectedPrimitive ? selectedPrimitive.point : selectedPrimitive.points[0]) : null
  const selectedIntersection = selectedPrimitive && ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet"].includes(selectedPrimitive.type) ? selectedPrimitive as Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" | "intersectionSet" }> : null
  const selectedSlope = selectedLinear ? lineSlope(selectedLinear) : null
  const showSlopeParameter = selectedLinear?.type === "line" && Boolean(selectedLinear.slopeParameter)
  const editable = selectedPrimitive?.locked !== true
  const [expressionDraft, setExpressionDraft] = useState(selectedFunction?.expression ?? "")
  /** The preset selector shows "自定义" unless the current expression is still exactly a preset's. */
  const selectedFunctionPresetId = functionPresets.find((preset) => preset.expression === selectedFunction?.expression)?.id ?? ""
  const [expressionError, setExpressionError] = useState<string | null>(null)
  const [logBase, setLogBase] = useState("10")
  const formulaRef = useRef<HTMLTextAreaElement>(null)
  /** 插入模板后要等一帧再定位光标：把这一帧记下来，面板卸载时取消，避免对着已经不在的输入框聚焦。 */
  const formulaFocusFrameRef = useRef<number | null>(null)
  const [annotationText, setAnnotationText] = useState("")
  const sceneDocument = useSceneStore((state) => state.document)
  /** 空间圆轨道：圆心、半径、法向都是它**自己**的几何（不再引用点），所以三项都可读可编。 */
  const selectedCircle3 = selectedPrimitive?.type === "circle3" ? selectedPrimitive : null
  /** 空间面：朝向要现算（法向是从点环 Newell 出来的，不是存下来的字段）。 */
  const selectedFace3 = selectedPrimitive?.type === "face3" ? selectedPrimitive : null
  const face3Normal = selectedFace3
    ? polygonNormal3(selectedFace3.pointIds.map((id) => {
      const point = sceneDocument.primitives.find((primitive) => primitive.id === id)
      return point?.type === "point3" ? point.position : null
    }).filter((position): position is Vector3 => position !== null))
    : null
  const objectOrientationNormal = selectedCircle3 ? normalizeVector3(selectedCircle3.normal) : face3Normal
  const applySceneOperation = useSceneStore((state) => state.apply)

  /**
   * 这个点是不是已经被某条曲线当作**定点**了：是的话就不再提供「创建动圆」，避免重复创建。
   * 判断放在这里（`sceneDocument` 之后），因为它要读文档。
   */
  const pointHasMovingCircle = selectedPoint !== null && sceneDocument.primitives.some((primitive) =>
    (primitive.type === "circle" || primitive.type === "ellipse")
    && primitive.rotationAbout?.pivot.kind === "primitive"
    && primitive.rotationAbout.pivot.primitiveId === selectedPoint?.id)
  const annotationOptions = selectedPrimitive ? annotationFeatureOptions(selectedPrimitive) : []
  const selectedAnnotations = selectedPrimitive ? sceneDocument.annotations.filter((annotation) => annotation.target === selectedPrimitive.id || (annotation.anchor?.kind === "primitive" && annotation.anchor.primitiveId === selectedPrimitive.id)) : []
  /**
   * 可绑定动点的曲线。
   *
   * 抛物线与双曲线的自然参数是无界的轴向参数 u，所以它们的绑定要自带一个 `domain` 作为扫描窗口
   * （绑定时就写入，用户可以在「参数域」里改），双曲线还要记录分支以免拖动时跳支。
   */
  const pathPrimitives = dynamicPointPaths(sceneDocument.primitives)
  const selectedPointBinding = selectedPoint?.binding?.kind === "onPath" ? selectedPoint.binding : null
  /**
   * 选中动点所在曲线的自然参数窗口：有界曲线用它自己的参数域，抛物线/双曲线用绑定里的 `domain`。
   * 它供给「路径参数」输入框，所以编辑「参数域」后输入框会立刻跟着变。
   */
  const selectedPointWindow = (() => {
    if (!selectedPointBinding) return null
    const path = sceneDocument.primitives.find((primitive) => primitive.id === selectedPointBinding.pathId)
    return path ? parameterWindow(path, sceneDocument.parameters, selectedPointBinding.domain) : null
  })()
  /**
   * 选中的动点所在的那条轨道 —— 只有它是"能作切线"的曲线时，「在动点处作切线」才可用。
   *
   * 这条判断必须与 App 里的 `addPointTangent` 用同一个名单（`isTangentSource`）：
   * 按钮亮着但点下去什么都不发生，是最难查的一类缺陷。
   */
  const pointTangentSource = (() => {
    if (!selectedPointBinding) return null
    const path = sceneDocument.primitives.find((primitive) => primitive.id === selectedPointBinding.pathId)
    return isTangentSource(path) ? path : null
  })()
  /**
   * "以动点为圆心"的圆：圆心点接管了 `center`，因此不再给圆心坐标输入框
   * （这里改的值下一趟重算就会被那个点覆盖回去）。
   */
  const selectedCenterDrivenCircle = selectedPrimitive?.type === "circle" && selectedPrimitive.centerPointId ? selectedPrimitive : null
  /**
   * 半径驱动点的候选：文档里除圆心点自己以外的所有点。
   *
   * 把圆心点排除掉是有理由的：它的距离恒为 0，选它只会得到一个半径 0 的退化圆
   * （重算会把它夹到一个不可见的下限上），用户看到的是"选了之后圆消失了"。
   */
  const radiusDriverCandidates = sceneDocument.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> =>
    primitive.type === "point" && primitive.id !== selectedCenterDrivenCircle?.centerPointId)
  /** 选/清空半径驱动点：清空时写 `null`，圆的半径回到"可直接编辑的数字"（值是最后一次算出来的那个）。 */
  const updateRadiusDriver = (pointId: string) => {
    if (!selectedCenterDrivenCircle) return
    onUpdatePrimitive({ radiusFrom: pointId ? { pointId, factor: selectedCenterDrivenCircle.radiusFrom?.factor ?? 1 } : null })
  }
  const updateRadiusFactor = (factor: number) => {
    if (!selectedCenterDrivenCircle?.radiusFrom || !(factor > 0)) return
    onUpdatePrimitive({ radiusFrom: { ...selectedCenterDrivenCircle.radiusFrom, factor } })
  }
  /**
   * 曲线来源的切线 / 法线：只有它们才有"切点落在哪里"这件事要调。
   *
   * 函数来源的切线不带 `anchor`（那是历史路径，切点由 `x` 给出），因此这个面板对它是空操作，
   * 旧文档的检查器一个像素都不会变。
   */
  const selectedCurveTangent = selectedPrimitive && (selectedPrimitive.type === "tangent" || selectedPrimitive.type === "normal") && selectedPrimitive.anchor ? selectedPrimitive : null
  const tangentAnchorParameters = selectedCurveTangent
    ? parameterWindow(sceneDocument.primitives.find((primitive) => primitive.id === selectedCurveTangent.sourceId) ?? selectedCurveTangent, sceneDocument.parameters)
    : null
  const tangentAnchorPoints = sceneDocument.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point")
  const updateTangentParameter = (parameter: number) => {
    if (!selectedCurveTangent || !Number.isFinite(parameter)) return
    const branch = selectedCurveTangent.anchor?.kind === "parameter" ? selectedCurveTangent.anchor.branch ?? 0 : 0
    onUpdatePrimitive({ anchor: { kind: "parameter", parameter, branch } })
  }
  const updateTangentAnchorPoint = (pointId: string) => {
    if (!selectedCurveTangent || !pointId) return
    onUpdatePrimitive({ anchor: { kind: "point", pointId } })
  }
  /** 切线画多长（半长，世界单位）。切点不动，只是把线段向两侧拉长/缩短。 */
  const updateTangentLength = (halfLength: number) => {
    if (!selectedCurveTangent || !(halfLength > 0)) return
    onUpdatePrimitive({ halfLength })
  }
  /**
   * 切换切点的定位方式。
   *
   * 从"跟随动点"切回"曲线参数"时，参数取**当前切点在曲线上的投影**（用内核的 `project`），
   * 于是切线在切换的那一刻留在原地 —— 直接拿 `x` 当参数是错的：曲线来源的 `x` 是切点的横坐标、
   * 不是自然参数，用它会让切线跳到曲线上完全不同的地方（圆上尤其明显）。
   */
  const setTangentAnchorKind = (kind: "parameter" | "point") => {
    if (!selectedCurveTangent) return
    if (kind === "point") {
      const candidate = tangentAnchorPoints[0]
      if (candidate) onUpdatePrimitive({ anchor: { kind: "point", pointId: candidate.id } })
      return
    }
    const source = sceneDocument.primitives.find((primitive) => primitive.id === selectedCurveTangent.sourceId)
    const projection = source ? pathConstraint(source, sceneDocument.parameters)?.project(selectedCurveTangent.point) ?? null : null
    onUpdatePrimitive({ anchor: { kind: "parameter", parameter: projection?.parameter ?? 0, branch: projection?.branch ?? 0 } })
  }
  const selected3dPrimitives = selectedIds.map((id) => sceneDocument.primitives.find((primitive) => primitive.id === id)).filter((primitive): primitive is PrimitiveSpec => Boolean(primitive))
  const measurementOptions = measurementOptionsFor(sceneDocument.workspace, selected3dPrimitives)
  const selectedFacePair = selected3dPrimitives.length === 2 && selected3dPrimitives.every((primitive) => primitive.type === "face3")
  const visibleMeasurementOptions = selectedFacePair
    ? [...measurementOptions.filter((option) => option.metric !== "dihedral"), { metric: "dihedral" as const, label: "二面角内角", dihedralKind: "interior" as const }, { metric: "dihedral" as const, label: "二面角外角", dihedralKind: "exterior" as const }]
    : measurementOptions
  const selectedPoint3Ids = selected3dPrimitives.filter((primitive) => primitive.type === "point3").map((primitive) => primitive.id)
  const selectedEdge3Ids = selected3dPrimitives.filter((primitive) => primitive.type === "edge3").map((primitive) => primitive.id)
  const canCreateLinearAnnotation = selectedPoint3Ids.length === 2 || selectedEdge3Ids.length === 1
  const canCreateAngularAnnotation = selectedPoint3Ids.length === 3 || selectedEdge3Ids.length === 2
  const engineeringAnnotationOptions = sceneDocument.workspace === "cad"
    ? [
      ...(canCreateLinearAnnotation ? [{ kind: "linear" as const, label: "线性尺寸", ariaLabel: "Add linear annotation" }, { kind: "tolerance" as const, label: "公差", ariaLabel: "Add tolerance annotation" }] : []),
      ...(canCreateAngularAnnotation ? [{ kind: "angular" as const, label: "角度", ariaLabel: "Add angular annotation" }] : [])
    ]
    : []

  useEffect(() => {
    setExpressionDraft(selectedFunction?.expression ?? "")
    setExpressionError(null)
  }, [selectedFunction?.id, selectedFunction?.expression])

  useEffect(() => {
    setAnnotationText(selectedPrimitive ? selectedPrimitive.label ?? selectedPrimitive.id : "")
  }, [selectedPrimitive?.id, selectedPrimitive?.label])

  useEffect(() => () => {
    if (formulaFocusFrameRef.current !== null) window.cancelAnimationFrame(formulaFocusFrameRef.current)
    formulaFocusFrameRef.current = null
  }, [])

  const updatePoint = (axis: "x" | "y", next: number) => selectedPoint && editable && onUpdatePrimitive({ [axis]: next })
  const updatePoint3 = (axis: keyof Vector3, next: number) => selectedPoint3 && editable && onUpdatePrimitive({ position3: { ...selectedPoint3.position, [axis]: next } })
  /**
   * 每个动点拥有**自己的**驱动参数。
   *
   * 之前这里盲取 `Object.keys(parameters)[0]`，在圆锥曲线工作区里就是那个 `slope`（直线斜率），
   * 后果有三：点的参数域被限制在 `slope` 的 min/max 上、拖点会顺带把无关的直线转起来、
   * 而「路径参数」输入框写的是 `binding.parameter`，在有 `parameterId` 时会被求值直接忽略因而完全失效。
   * 给每个点一个专属参数后，拖拽、数字框、记录轨迹三者共用同一个真值来源，且互不干扰。
   *
   * 参数的 min/max 取该曲线的**自然参数窗口**（直线是 ±2 个 a→b 长度、圆/椭圆是 [0, 2π) 等）。
   * 注意这个窗口只决定滑块和轨迹扫多远：拖动本身直接写参数值，不受它限制。
   */
  const pointParameterId = (pointId: string) => `t-${pointId}`
  /** 无界自然参数的曲线需要在绑定里存一个扫描窗口（抛物线与双曲线）。 */
  const needsDomain = (path: PrimitiveSpec) => path.type === "parabola" || path.type === "hyperbola"
  const updatePointBinding = (pathId: string) => {
    if (!selectedPoint || !editable) return
    if (!pathId) {
      onUpdatePrimitive({ binding: { kind: "free" } })
      return
    }
    const path = sceneDocument.primitives.find((primitive) => primitive.id === pathId)
    if (!path) return
    const window = parameterWindow(path, sceneDocument.parameters)
    const existing = selectedPoint.binding?.kind === "onPath" ? selectedPoint.binding : null
    // 复用已有的专属参数，避免每换一次路径就留下一个孤儿参数；域与分支按新曲线重算。
    if (existing?.parameterId && sceneDocument.parameters[existing.parameterId]) {
      onUpdatePrimitive({ binding: {
        kind: "onPath",
        pathId,
        parameterId: existing.parameterId,
        parameter: existing.parameter,
        ...(needsDomain(path) ? { domain: existing.domain ?? ([window.min, window.max] as [number, number]) } : {}),
        ...(path.type === "hyperbola" ? { branch: existing.branch ?? 0 } : {})
      } })
      return
    }
    const id = pointParameterId(selectedPoint.id)
    const value = window.min + (window.max - window.min) / 2
    // 驱动参数带上 ownerId：点被删除时会被自动回收，不会留下孤儿参数。
    applySceneOperation({
      op: "setParameter",
      id,
      value,
      min: window.min,
      max: window.max,
      step: (window.max - window.min) / 100,
      label: `${selectedPoint.label ?? selectedPoint.id} 的路径参数`,
      ownerId: selectedPoint.id
    })
    onUpdatePrimitive({ binding: {
      kind: "onPath",
      pathId,
      parameterId: id,
      parameter: value,
      ...(needsDomain(path) ? { domain: [window.min, window.max] as [number, number] } : {}),
      ...(path.type === "hyperbola" ? { branch: 0 as const } : {})
    } })
  }
  const updatePointParameter = (parameter: number) => {
    if (!selectedPoint || selectedPoint.binding?.kind !== "onPath" || !editable) return
    const parameterId = selectedPoint.binding.parameterId
    // 驱动参数才是坐标的真值来源；只改 `binding.parameter` 这个副本不会让点动起来。
    if (parameterId && sceneDocument.parameters[parameterId]) {
      applySceneOperation({ op: "setParameter", id: parameterId, value: parameter })
      return
    }
    onUpdatePrimitive({ binding: { ...selectedPoint.binding, parameter } })
  }
  const createLocus = () => {
    const binding = selectedPoint?.binding
    if (!selectedPoint || binding?.kind !== "onPath" || !editable) return
    const path = sceneDocument.primitives.find((primitive) => primitive.id === binding.pathId)
    const window = path ? parameterWindow(path, sceneDocument.parameters, binding.domain) : { min: 0, max: 1 }
    let parameterId = binding.parameterId
    // 老文档里的绑定可能没有驱动参数（或它已被删掉），补一个再记录轨迹。
    if (!parameterId || !sceneDocument.parameters[parameterId]) {
      parameterId = pointParameterId(selectedPoint.id)
      applySceneOperation({ op: "setParameter", id: parameterId, value: binding.parameter })
      onUpdatePrimitive({ binding: { ...binding, parameterId } })
    }
    let index = 1
    while (sceneDocument.primitives.some((primitive) => primitive.id === `locus-${index}`)) index += 1
    const parameter = sceneDocument.parameters[parameterId]
    applySceneOperation({ op: "addPrimitive", primitive: { id: `locus-${index}`, type: "locus", sourcePointId: selectedPoint.id, parameterId, domain: [parameter?.min ?? window.min, parameter?.max ?? window.max], samples: 128, label: `轨迹 ${index}` } })
  }
  const updateCenter = (axis: "x" | "y", next: number) => selectedCircleOrArc && editable && onUpdatePrimitive({ center: { ...selectedCircleOrArc.center, [axis]: next } })
  const updateEndpoint = (endpoint: "a" | "b", axis: "x" | "y", next: number) => selectedLinear && editable && !(selectedLinear.type === "line" && selectedLinear.slopeParameter && endpoint === "b" && axis === "y") && onUpdatePrimitive({ [endpoint]: { ...selectedLinear[endpoint], [axis]: next } })
  const updateSlope = (next: number) => {
    if (!selectedLinear || showSlopeParameter || !editable) return
    const deltaX = Math.abs(selectedLinear.b.x - selectedLinear.a.x) < 1e-9 ? 1 : selectedLinear.b.x - selectedLinear.a.x
    onUpdatePrimitive({ b: { x: selectedLinear.a.x + deltaX, y: selectedLinear.a.y + next * deltaX } })
  }
  const updatePolylinePoint = (index: number, axis: "x" | "y", next: number) => selectedPolyline && editable && onUpdatePrimitive({ points: selectedPolyline.points.map((point, pointIndex) => pointIndex === index ? { ...point, [axis]: next } : point) })
  const updateFunctionDomain = (index: 0 | 1, next: number) => {
    if (!selectedFunction || !editable) return
    const domain: [number, number] = [...selectedFunction.domain]
    domain[index] = next
    onUpdatePrimitive({ domain })
  }
  const updateConicCenter = (axis: "x" | "y", next: number) => selectedEllipseOrHyperbola && editable && onUpdatePrimitive({ center: { ...selectedEllipseOrHyperbola.center, [axis]: next } })
  const updateParabolaVertex = (axis: "x" | "y", next: number) => selectedParabola && editable && onUpdatePrimitive({ vertex: { ...selectedParabola.vertex, [axis]: next } })
  const updateRotation = (next: number) => editable && onUpdatePrimitive({ rotation: rotationRadians(next) })
  /**
   * 绕定点旋转的两项编辑：
   * - 改转角只换 `angle`（基准 `baseCenter` 不动，所以重算幂等、不会越转越偏）；
   * - 改定点把**整条曲线平移过去**：定点与基准中心搬同一个位移，
   *   于是"曲线过这个定点、已经转了多少度"两件事在平移前后完全一致（与拖动本体同一条规则）。
   *
   * 这里刻意**不重算基准**：重算基准会改变"参数 0 在哪"，同一个 `angle` 读数对应的姿态就变了，
   * 用户改一下定点坐标会看到曲线莫名其妙转了个角度。
   */
  const updatePlacementAngle = (next: number) => {
    if (!editable || !selectedPlacedCurve?.rotationAbout) return
    const angle = rotationRadians(next)
    onUpdatePrimitive({ rotationAbout: { ...selectedPlacedCurve.rotationAbout, angle }, rotation: angle })
  }
  const updatePlacementPivot = (axis: "x" | "y", next: number) => {
    if (!editable || !selectedPlacedCurve?.rotationAbout) return
    const current = selectedPlacedCurve.rotationAbout.pivot
    if (current.kind !== "coordinate") return
    const dx = axis === "x" ? next - current.x : 0
    const dy = axis === "y" ? next - current.y : 0
    onUpdatePrimitive({
      center: { x: selectedPlacedCurve.center.x + dx, y: selectedPlacedCurve.center.y + dy },
      rotationAbout: {
        ...selectedPlacedCurve.rotationAbout,
        pivot: { kind: "coordinate", x: current.x + dx, y: current.y + dy },
        baseCenter: { x: selectedPlacedCurve.rotationAbout.baseCenter.x + dx, y: selectedPlacedCurve.rotationAbout.baseCenter.y + dy }
      }
    })
  }
  /**
   * 改半径：必须**同时**把基准圆心摆到离定点恰好一个新半径处，否则曲线就不再过那个定点。
   *
   * 定点是点图元引用时这里拿不到它的坐标（要读文档），所以走 `placementPivot` 现查一次。
   */
  const updateMovingRadius = (radius: number) => {
    const curve = selectedPlacedCurve
    if (!editable || !curve?.rotationAbout) return
    const next = Math.max(0.01, radius)
    const pivot = placementPivot(curve, (id) => sceneDocument.primitives.find((primitive) => primitive.id === id))
    const placement = pivot ? resizedPlacement(curve, next, pivot) : undefined
    onUpdatePrimitive(placement ? { radius: next, rotationAbout: placement } : { radius: next })
  }
  const parabolaFocus = (conic: Extract<ConicPrimitive, { type: "parabola" }>) => {
    const distance = conic.focalParameter / 2
    return rotatePoint(conic.vertex, conic.axis === "x" ? distance : 0, conic.axis === "y" ? distance : 0, conic.rotation ?? 0)
  }

  const conicFoci = (conic: Extract<ConicPrimitive, { type: "ellipse" | "hyperbola" }>) => {
    const majorRadius = Math.max(conic.radiusX, conic.radiusY)
    const minorRadius = Math.min(conic.radiusX, conic.radiusY)
    const distance = conic.type === "ellipse"
      ? Math.sqrt(Math.max(majorRadius ** 2 - minorRadius ** 2, 0))
      : Math.sqrt(conic.radiusX ** 2 + conic.radiusY ** 2)
    const alongX = conic.type === "hyperbola" ? conic.axis === "x" : conic.radiusX >= conic.radiusY
    const first = rotatePoint(conic.center, alongX ? distance : 0, alongX ? 0 : distance, conic.rotation ?? 0)
    const second = rotatePoint(conic.center, alongX ? -distance : 0, alongX ? 0 : -distance, conic.rotation ?? 0)
    return { first, second }
  }
  const ellipseMetrics = selectedEllipseOrHyperbola?.type === "ellipse" ? {
    major: Math.max(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY),
    minor: Math.min(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY),
    eccentricity: Math.sqrt(Math.max(Math.max(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY) ** 2 - Math.min(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY) ** 2, 0)) / Math.max(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY)
  } : null
  const hyperbolaMetrics = selectedEllipseOrHyperbola?.type === "hyperbola" ? {
    eccentricity: Math.sqrt(selectedEllipseOrHyperbola.radiusX ** 2 + selectedEllipseOrHyperbola.radiusY ** 2) / (selectedEllipseOrHyperbola.axis === "x" ? selectedEllipseOrHyperbola.radiusX : selectedEllipseOrHyperbola.radiusY),
    asymptoteAngle: Math.atan2(selectedEllipseOrHyperbola.axis === "x" ? selectedEllipseOrHyperbola.radiusY : selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.axis === "x" ? selectedEllipseOrHyperbola.radiusX : selectedEllipseOrHyperbola.radiusY) * 180 / Math.PI + (selectedEllipseOrHyperbola.rotation ?? 0) * 180 / Math.PI
  } : null
  const arcAngle = selectedCircleOrArc?.type === "arc" ? Math.abs(selectedCircleOrArc.endAngle - selectedCircleOrArc.startAngle) : 0
  const updateFunctionExpression = (source: string) => {
    setExpressionDraft(source)
    try {
      parseExpression(source)
      setExpressionError(null)
      onUpdatePrimitive({ expression: source })
    } catch {
      setExpressionError("表达式暂不可计算")
    }
  }
  /** Picking a preset also restores its classroom domain, so e^x or sin(x) lands inside the visible canvas. */
  const applyFunctionPreset = (presetId: string) => {
    const preset = getFunctionPreset(presetId)
    if (!preset) return
    setExpressionDraft(preset.expression)
    setExpressionError(null)
    onUpdatePrimitive({ expression: preset.expression, domain: [...preset.defaultDomain] as [number, number] })
  }
  const insertFunctionTemplate = (template: string) => {
    if (!selectedFunction || !editable) return
    const input = formulaRef.current
    const start = input?.selectionStart ?? expressionDraft.length
    const end = input?.selectionEnd ?? start
    const insertion = insertFormulaTemplate(expressionDraft, start, end, template)
    setExpressionDraft(insertion.value)
    try {
      parseExpression(insertion.value)
      setExpressionError(null)
      onUpdatePrimitive({ expression: insertion.value })
    } catch {
      setExpressionError("公式还需要补全")
    }
    if (formulaFocusFrameRef.current !== null) window.cancelAnimationFrame(formulaFocusFrameRef.current)
    formulaFocusFrameRef.current = window.requestAnimationFrame(() => {
      formulaFocusFrameRef.current = null
      formulaRef.current?.focus()
      formulaRef.current?.setSelectionRange(insertion.cursorStart, insertion.cursorEnd)
    })
  }
  const functionMetrics = selectedFunction ? (() => {
    try {
      const segments = adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(selectedFunction.expression, { x }), selectedFunction.domain, { initialSteps: selectedFunction.samples ?? 128, maxSteps: Math.max(selectedFunction.samples ?? 128, 2048) })
      const values = segments.flat().map((point) => point.y)
      if (!values.length) return null
      return { min: Math.min(...values), max: Math.max(...values) }
    } catch {
      return null
    }
  })() : null

  return <section className="panel-section properties" aria-label="属性检查器">
    {/* 「精确形式」只读面板已按用户要求删除（2026-09-18：「删除右侧的"精确形式"，似乎没什么用」）。
        内核里的 `exactFormOf` 与文档里的 `measurements` 都保留 —— 删掉的是一块展示，不是测量能力。 */}
    <div className="inspector-heading"><div><span className="panel-kicker">选中对象</span><h2 className="panel-title">属性面板</h2></div><span className="inspector-indicator" aria-hidden="true" /></div>
    {selectedPrimitive && <div className="inspector-selected-heading"><div><span className="panel-kicker">当前图元</span><h3>{selectedPrimitive.label ?? selectedPrimitive.id}</h3></div><span className="property-type-badge">{primitiveTypeLabels[selectedPrimitive.type]}</span><div className="inspector-quick-actions"><button type="button" aria-label={selectedPrimitive.locked ? "解锁图元" : "锁定图元"} onClick={onToggleSelectedLock}>{selectedPrimitive.locked ? "解锁" : "锁定"}</button><button type="button" aria-label="快速删除对象" disabled={selectedPrimitive.locked} onClick={onDeleteSelected}>删除</button></div></div>}
    {!selectedPrimitive && <div className="inspector-empty-state"><div className="inspector-empty-icon" aria-hidden="true">⌁</div><strong>未选择任何图元</strong><span>在画布中点击点、直线或椭圆即可配置几何参数与外观参数</span></div>}
    {selectedPrimitive && !usesExternalSections && <>
      <InspectorAccordion title="几何参数" open={openSections.data} onToggle={() => toggleSection("data")} />
      <InspectorAccordion title="外观样式" open={openSections.appearance} onToggle={() => toggleSection("appearance")} />
    </>}
    {/* 「动效演示」栏已按用户要求删除（2026-09-17）：播放时只看得到起始与结束两帧，与其修不如去掉。 */}
    {/* 重命名放在默认可见的「几何参数」区，避免必须先展开外观页签才能改名。 */}
    {shows("data") && selectedPrimitive && <div className="primitive-properties"><h3>图元名称</h3><Field label="名称"><input aria-label="图元名称" type="text" value={selectedPrimitive.label ?? ""} placeholder={selectedPrimitive.id} onChange={(event) => onUpdatePrimitive({ label: event.target.value })} /></Field><p className="footer-note">名称只影响显示，不改动对象 ID 或几何数据。</p></div>}
    {shows("data") && selectedPoint3 && <div className="primitive-properties"><h3>空间点坐标</h3><Vector3Fields prefix="坐标" value={selectedPoint3.position} disabled={!editable || point3Binding?.kind !== "free"} onChange={updatePoint3} /><Field label="宿主绑定"><select aria-label="点宿主绑定" disabled={!editable} value={pointHostValue(point3Binding)} onChange={(event) => onBindPointHost?.(event.target.value === "" ? null : event.target.value)}><option value="">自由点</option>{(pointHostCandidates ?? []).map((host) => <option key={host.id} value={host.id}>{host.label}</option>)}</select></Field>{point3Binding?.kind === "onHost" && <Field label="宿主参数"><input aria-label="宿主参数" type="number" step="0.01" disabled={!editable} value={point3Binding.parameter} onChange={(event) => onChangeHostParameter?.(numberValue(event))} /></Field>}{(point3Binding?.kind === "onFace" || point3Binding?.kind === "onSurface") && <><Field label="面上参数 u"><input aria-label="面上参数 u" type="number" step="0.1" disabled={!editable} value={point3Binding.uv[0]} onChange={(event) => onChangeHostParameter?.(numberValue(event), point3Binding.uv[1])} /></Field><Field label="面上参数 v"><input aria-label="面上参数 v" type="number" step="0.1" disabled={!editable} value={point3Binding.uv[1]} onChange={(event) => onChangeHostParameter?.(point3Binding.uv[0], numberValue(event))} /></Field></>}{point3Binding?.kind === "inSolid" && <><Field label="体内参数 u"><input aria-label="体内参数 u" type="number" min="0" max="1" step="0.05" disabled={!editable} value={point3Binding.uvw[0]} onChange={(event) => onChangeHostParameter?.(numberValue(event), point3Binding.uvw[1], point3Binding.uvw[2])} /></Field><Field label="体内参数 v"><input aria-label="体内参数 v" type="number" min="0" max="1" step="0.05" disabled={!editable} value={point3Binding.uvw[1]} onChange={(event) => onChangeHostParameter?.(point3Binding.uvw[0], numberValue(event), point3Binding.uvw[2])} /></Field><Field label="体内参数 w"><input aria-label="体内参数 w" type="number" min="0" max="1" step="0.05" disabled={!editable} value={point3Binding.uvw[2]} onChange={(event) => onChangeHostParameter?.(point3Binding.uvw[0], point3Binding.uvw[1], numberValue(event))} /></Field></>}<p className="footer-note">点位置是空间构造的真源；线、面和实体通过点引用联动。绑定到宿主（空间直线 / 棱 / 面 / 圆柱与圆锥侧面）之后，点由**宿主参数**算出坐标，永远贴住宿主；绑定到**实体内**则可以在体内自由移动，出不去（拖到外面会被夹回表面）。</p></div>}
    {shows("data") && selectedSolid && <div className="primitive-properties"><h3>立体几何属性</h3>{selectedSolid.type === "cube" && <><Vector3Fields prefix="原点" value={selectedSolid.origin} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ origin3: { ...selectedSolid.origin, [axis]: next } })} /><Vector3Fields prefix="尺寸" value={selectedSolid.size} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ size3: { ...selectedSolid.size, [axis]: Math.max(0.01, next) } })} /></>}{selectedSolid.type === "pyramid" && <><Vector3Fields prefix="底面中心" value={selectedSolid.baseCenter} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ baseCenter3: { ...selectedSolid.baseCenter, [axis]: next } })} /><CoordinateField label="底面尺寸 X" value={selectedSolid.baseSize.x} disabled={!editable} onChange={(next) => onUpdatePrimitive({ baseSize3: { ...selectedSolid.baseSize, x: Math.max(0.01, next) } })} /><CoordinateField label="底面尺寸 Y" value={selectedSolid.baseSize.y} disabled={!editable} onChange={(next) => onUpdatePrimitive({ baseSize3: { ...selectedSolid.baseSize, y: Math.max(0.01, next) } })} /><CoordinateField label="高度" value={selectedSolid.height} disabled={!editable} onChange={(next) => onUpdatePrimitive({ height: Math.max(0.01, next) })} /></>}{(selectedSolid.type === "cylinder" || selectedSolid.type === "cone") && <><Vector3Fields prefix="中心" value={selectedSolid.center} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ center3: { ...selectedSolid.center, [axis]: next } })} /><CoordinateField label="半径 3D" value={selectedSolid.radius} disabled={!editable} onChange={(next) => onUpdatePrimitive({ radius3: Math.max(0.01, next) })} /><CoordinateField label="高度" value={selectedSolid.height} disabled={!editable} onChange={(next) => onUpdatePrimitive({ height: Math.max(0.01, next) })} /><Field label="分段数"><input aria-label="分段数" type="number" min="3" max="256" step="1" disabled={!editable} value={selectedSolid.segments} onChange={(event) => onUpdatePrimitive({ segments: Math.max(3, Math.min(256, Math.round(numberValue(event)))) })} /></Field></>}</div>}
    {shows("data") && selectedSolid && <div className="primitive-properties"><h3>朝向</h3><SolidRotationFields rotation={selectedSolid.rotation} disabled={!editable} onChange={(rotation) => onUpdatePrimitive({ rotation3: rotation })} /></div>}
    {shows("data") && selectedPlane3 && <div className="primitive-properties"><h3>平面大小</h3><Field label="半边长（世界单位）"><input aria-label="平面半边长" type="number" min="0.1" step="0.5" placeholder="自动" disabled={!editable} value={selectedPlane3.halfSize ?? ""} onChange={(event) => onUpdatePrimitive({ halfSize: event.target.value === "" ? null : Math.max(0.1, numberValue(event)) })} /></Field><div className="property-actions" aria-label="平面大小操作"><button type="button" disabled={!editable || selectedPlane3.halfSize === undefined} onClick={() => onUpdatePrimitive({ halfSize: null })}>恢复自动</button></div><p className="footer-note">留空表示仍按场景自动适配；填入数值后，平面画出的范围由该半边长决定。</p></div>}
    {shows("data") && selectedSection && exactConicOf(selectedSection) && <div className="primitive-properties"><h3>解析截面</h3><div className="metric-grid">{sectionConicMetrics(selectedSection).map((row) => <span key={row.label}>{row.label}<strong>{row.value}</strong></span>)}</div><p className="footer-note">这一圈边界是**精确的圆锥曲线**（不是多边形近似），画布按屏幕误差细分它——放大不会看出棱。垂直切圆、斜切成椭圆、切到端面时补上端面弦，都是算出来的结论；面积与周长只在整条曲线没被端面裁切时才给闭式（椭圆周长是级数，如实标数值近似）。</p></div>}
    {shows("data") && selectedSection && <div className="primitive-properties"><h3>剖切面</h3><p className="footer-note">截面 = 一个平面切一个实体。剖切面可以沿法向平移（自由拖动模式下拖动截面或按方向键），也可以在这里摆斜。</p><div className="property-actions" aria-label="剖切面旋转">{(["x", "y", "z"] as const).map((axis) => <span key={axis}><button type="button" aria-label={`绕 ${axis.toUpperCase()} 轴旋转剖切面 -15°`} disabled={!editable || !onRotateSection} onClick={() => onRotateSection?.(axis, -15)}>{axis.toUpperCase()} −15°</button><button type="button" aria-label={`绕 ${axis.toUpperCase()} 轴旋转剖切面 +15°`} disabled={!editable || !onRotateSection} onClick={() => onRotateSection?.(axis, 15)}>{axis.toUpperCase()} +15°</button></span>)}</div><div className="metric-grid"><span>法向量<strong>({selectedSection.plane.normal.x.toFixed(2)}, {selectedSection.plane.normal.y.toFixed(2)}, {selectedSection.plane.normal.z.toFixed(2)})</strong></span><span>截面点数<strong>{selectedSection.points.length}</strong></span><span>分类<strong>{selectedSection.classification === "polygon" ? "多边形" : selectedSection.classification === "segment" ? "线段" : selectedSection.classification === "point" ? "一点" : selectedSection.classification === "none" ? "无交线" : "数据不足"}</strong></span>{(selectedSection.loops?.length ?? 0) > 1 && <span>独立边界<strong>{selectedSection.loops!.length} 环</strong></span>}</div><div className="property-actions"><button type="button" aria-label="转为图元" disabled={!editable || selectedSection.points.length < 3} title="把截面的每一环物化成独立的点 / 棱 / 面图元：之后它们不再随来源实体变化，可以单独移动、求交与测量" onClick={() => onMaterializeSection?.()}>转为图元</button></div><p className="footer-note">要用某个面当剖切面，点画布左上角的「以面为剖切面」，再点实体上的那个面；曲面侧边（点不共面）会被拒绝。</p></div>}
    {shows("data") && selectedIntersectionLine && <div className="primitive-properties"><h3>交线</h3><p className="footer-note">交线 = 两个对象表面的公共边界（几个实体同时相交时，画布上每一对都有自己的交线，点一下即可各自创建）。</p><div className="metric-grid"><span>来源 A<strong>{sourceLabel(selectedIntersectionLine.sourceIds[0])}</strong></span><span>来源 B<strong>{sourceLabel(selectedIntersectionLine.sourceIds[1])}</strong></span><span>段数<strong>{selectedIntersectionLine.segments.length}</strong></span><span>总长度<strong>{selectedIntersectionLine.segments.reduce((total, segment) => total + Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y, segment.b.z - segment.a.z), 0).toFixed(3)}</strong></span><span>状态<strong>{intersectionLineStatusLabels[selectedIntersectionLine.status] ?? selectedIntersectionLine.status}</strong></span></div>{selectedIntersectionLine.diagnostic && <p className="footer-note">{selectedIntersectionLine.diagnostic}</p>}<p className="footer-note">两个来源一移动，交线就跟着重算；删掉任一来源，它会一起注销。</p></div>}
    {shows("data") && selectedIntersectionSolid && <div className="primitive-properties"><h3>交面</h3><p className="footer-note">交面 = 两个实体公共区域的**整体表面**（布尔交集），不是"一刀切出来的截面"。</p><div className="metric-grid"><span>来源 A<strong>{sourceLabel(selectedIntersectionSolid.sourceIds[0])}</strong></span><span>来源 B<strong>{sourceLabel(selectedIntersectionSolid.sourceIds[1])}</strong></span><span>体积<strong>{selectedIntersectionSolid.volume.toFixed(3)}</strong></span><span>表面积<strong>{selectedIntersectionSolid.area.toFixed(3)}</strong></span><span>面数<strong>{selectedIntersectionSolid.faces.length}</strong></span><span>顶点数<strong>{selectedIntersectionSolid.vertices.length}</strong></span><span>状态<strong>{intersectionSolidStatusLabels[selectedIntersectionSolid.status] ?? selectedIntersectionSolid.status}</strong></span></div>{selectedIntersectionSolid.diagnostic && <p className="footer-note">{selectedIntersectionSolid.diagnostic}</p>}<p className="footer-note">来源一移动，交面就跟着重算；删掉任一来源，它会一起注销。</p></div>}
    {shows("data") && selectedIntersectionFace && <div className="primitive-properties"><h3>交面</h3><p className="footer-note">交面 = 两个实体公共区域的**一个面**（点哪块建哪块）。填色就是这一面的内部颜色。</p><div className="metric-grid"><span>来源 A<strong>{sourceLabel(selectedIntersectionFace.sourceIds[0])}</strong></span><span>来源 B<strong>{sourceLabel(selectedIntersectionFace.sourceIds[1])}</strong></span><span>面积<strong>{selectedIntersectionFace.area.toFixed(3)}</strong></span><span>面积精度<strong>{intersectionFaceAreaPrecisionLabels[String(selectedIntersectionFace.areaExact)] ?? "未标注"}</strong></span><span>顶点数<strong>{selectedIntersectionFace.points.length}</strong></span><span>法向量<strong>({selectedIntersectionFace.normal.x.toFixed(2)}, {selectedIntersectionFace.normal.y.toFixed(2)}, {selectedIntersectionFace.normal.z.toFixed(2)})</strong></span><span>状态<strong>{selectedIntersectionFace.status === "valid" ? "有效" : selectedIntersectionFace.status === "none" ? "两个实体没有公共面" : "数据不足"}</strong></span></div>{selectedIntersectionFace.areaExact === false && <p className="footer-note">面积是**数值近似**：曲面区域按面片求和，比真值略小；平面区域与整圆边界才有闭式解。</p>}{selectedIntersectionFace.areaExact === true && <p className="footer-note">面积是**闭式精确**值：平面区域就是它自己的面积，边界是整圆时用 πab（圆盘 πr²）。</p>}{selectedIntersectionFace.diagnostic && <p className="footer-note">{selectedIntersectionFace.diagnostic}</p>}<p className="footer-note">来源一移动，这一面就跟着重算（按离它最近的区域形心继续认领同一块，解析边界与面积精度一起更新）；删掉任一来源，它会一起注销。</p></div>}
    {shows("data") && selectedIntersectionPoint && <div className="primitive-properties"><h3>交点</h3><p className="footer-note">交点 = 交线的端点 / 拐点，也就是两个表面的公共点。位置由来源算出，不能直接拖。</p><div className="metric-grid"><span>来源 A<strong>{sourceLabel(selectedIntersectionPoint.sourceIds[0])}</strong></span><span>来源 B<strong>{sourceLabel(selectedIntersectionPoint.sourceIds[1])}</strong></span><span>X<strong>{selectedIntersectionPoint.position.x.toFixed(3)}</strong></span><span>Y<strong>{selectedIntersectionPoint.position.y.toFixed(3)}</strong></span><span>Z<strong>{selectedIntersectionPoint.position.z.toFixed(3)}</strong></span><span>状态<strong>{selectedIntersectionPoint.status === "valid" ? "有效" : selectedIntersectionPoint.status === "none" ? "两个表面不相交" : "数据不足"}</strong></span></div>{selectedIntersectionPoint.diagnostic && <p className="footer-note">{selectedIntersectionPoint.diagnostic}</p>}<p className="footer-note">来源一移动，它就跟着重算（按离它最近的那个交点继续认领）；删掉任一来源，它会一起注销。</p></div>}
    {shows("data") && selectedCircle3 && <div className="primitive-properties">
      <h3>空间圆轨道</h3>
      <p className="footer-note">圆轨道 = 一条**空间圆**：把空间点绑到它上面（选中点 → 右侧「宿主绑定」选它），点就只能沿这个圈滑动。**圆心、半径、法向都是它自己的几何**——拖圆本体平移、拖圆上的半径手柄缩放、用画布上的三色环摆斜，都不会牵动任何点。</p>
      <Field label="半径"><input aria-label="圆轨道半径" type="number" min="0.01" step="0.1" disabled={!editable} value={selectedCircle3.radius} onChange={(event) => onUpdatePrimitive({ radius3: Math.max(0.01, numberValue(event)) })} /></Field>
      <Vector3Fields prefix="圆心" value={selectedCircle3.center} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ center3: { ...selectedCircle3.center, [axis]: next } })} />
      <div className="metric-grid">
        <span>法向量<strong>({selectedCircle3.normal.x.toFixed(2)}, {selectedCircle3.normal.y.toFixed(2)}, {selectedCircle3.normal.z.toFixed(2)})</strong></span>
      </div>
      <p className="footer-note">建轨道时用选中的点量出圆心 / 半径 / 平面，**建完就与那些点无关**：拖点、改点的坐标、删掉那个点，这条轨道都留在原地。</p>
    </div>}
    {shows("data") && (selectedCircle3 || selectedFace3) && <div className="primitive-properties"><h3>朝向</h3><ObjectRotationFields normal={objectOrientationNormal} disabled={!editable} onRotate={onRotate3} /></div>}
    {shows("appearance") && selectedPrimitive && <div className="primitive-properties">
      <div className="property-card-heading"><div><span className="property-kicker">当前图元</span><h3>{selectedPrimitive.label ?? selectedPrimitive.id}</h3></div><span className="property-type-badge">{primitiveTypeLabels[selectedPrimitive.type]}</span></div>
      <h3 className="property-subheading">外观</h3>
      <Field label="图元名称"><input aria-label="图元名称" type="text" value={selectedPrimitive.label ?? ""} placeholder={selectedPrimitive.id} onChange={(event) => onUpdatePrimitive({ label: event.target.value })} /></Field>
      <div className="property-actions">
        <button type="button" onClick={onToggleSelectedVisibility}>{selectedPrimitive.visible === false ? "显示图元" : "隐藏图元"}</button>
        <button type="button" onClick={onToggleSelectedLock}>{selectedPrimitive.locked ? "解锁图元" : "锁定图元"}</button>
      </div>
      {/**
        * 颜色：**色板 + 自定义取色**。
        *
        * 用户反馈"增加让平面几何的元素可以让用户选择不同颜色的功能" —— 能力本来就在，
        * 但一个窄窄的原生取色框既看不出有颜色可选、也点不出想要的颜色。摊成色板之后一眼就能选。
        * 自定义那一格的 `aria-label` 仍是「线条颜色」/「填充颜色」（既有测试与肌肉记忆都认这个名字）。
        */}
      <ColourField
        label="线条颜色"
        customLabel="线条颜色"
        palette={PLANAR_PALETTE}
        value={selectedPrimitive.style?.stroke}
        fallback={defaultStrokeFor(selectedPrimitive)}
        disabled={!editable}
        onChange={(stroke) => onUpdatePrimitive({ style: { stroke } })}
      />
      {supportsFill(selectedPrimitive) && <ColourField
        label="填充颜色"
        customLabel="填充颜色"
        palette={FILL_PALETTE}
        value={selectedPrimitive.style?.fill}
        fallback={NO_FILL}
        disabled={!editable}
        onChange={(fill) => onUpdatePrimitive({ style: { fill: fill === NO_FILL ? undefined : fill } })}
      />}
      <Field label="线宽"><input aria-label="线宽" type="number" disabled={!editable} min="0.5" max="20" step="0.5" value={selectedPrimitive.style?.strokeWidth ?? 3} onChange={(event) => onUpdatePrimitive({ style: { strokeWidth: Math.max(0.5, numberValue(event)) } })} /></Field>
      <Field label="透明度"><input aria-label="透明度" type="number" disabled={!editable} min="0" max="1" step="0.05" value={selectedPrimitive.style?.opacity ?? 1} onChange={(event) => onUpdatePrimitive({ style: { opacity: Math.min(1, Math.max(0, numberValue(event))) } })} /></Field>
      <Field label="线型"><select aria-label="线型" disabled={!editable} value={selectedPrimitive.style?.dash ?? "solid"} onChange={(event) => onUpdatePrimitive({ style: { dash: event.target.value === "solid" ? undefined : event.target.value } })}><option value="solid">实线</option><option value="8 6">虚线</option><option value="2 5">点线</option></select></Field>
    </div>}
    {shows("data") && visibleMeasurementOptions.length > 0 && <div className="primitive-properties"><h3>教学测量</h3><p className="footer-note">结果会保留来源对象，并在点移动后自动重算。</p>{selectedFacePair && <p className="measurement-guidance">已选两个面：二面角内角读实体内部夹角，外角读它的补角。</p>}{sceneDocument.workspace !== "geometry3d" && <p className="measurement-guidance">平面测量：选 2 个点量长度；选 3 个点可量角度（第二个点为顶点）、面积，以及第三个点到前两点连线的垂距。</p>}<div className="property-actions" aria-label={sceneDocument.workspace === "geometry3d" ? "三维测量工具" : "平面测量工具"}>{visibleMeasurementOptions.map((option) => <button key={`${option.metric}-${option.dihedralKind ?? "default"}`} type="button" onClick={() => onCreateMeasurement(option.metric, option.dihedralKind)}>{option.label}</button>)}</div></div>}
    {shows("engineering") && engineeringAnnotationOptions.length > 0 && <div className="primitive-properties"><h3>工程标注</h3><p className="footer-note">标注保留空间来源，并在四视图中随来源对象自动重算。</p><div className="property-actions" aria-label="工程标注工具">{engineeringAnnotationOptions.map((option) => <button key={option.kind} type="button" aria-label={option.ariaLabel} onClick={() => onAddEngineeringAnnotation(option.kind)}>{option.label}</button>)}</div></div>}
    {shows("data") && selectedIds.length === 1 && sceneDocument.measurements.filter((measurement) => measurement.sourceIds.includes(selectedIds[0])).map((measurement) => {
      /**
       * 「数值转换」重新加回来了（2026-09-19，用户口径："根据现在已有的 ui，重新优化再加上去"），
       * 但**不再**做那块"把所有测量再列一遍"的置顶面板（它正是当初被判"没什么用"的形态）：
       * 分数就贴在数字已经在的地方 —— 下面这个结果读数自己，以及画布上的常驻数字。
       *
       * 标题顺手统一到 `measurementMetricLabel`：这里以前用的是英文度量 key（"length测量"），
       * 而对象列表用的是中文（"长度测量"）—— 同一份名单的第二处副本，正是本仓库反复吃过的亏。
       */
      const title = measurement.metric === "dihedral" ? measurementMetricLabel(measurement) : `${measurementMetricLabel(measurement)}测量`
      const form = measurementFormText(measurement)
      return <div className="primitive-properties" key={measurement.id}><h3>{title}</h3><p className="footer-note">来源：{measurement.sourceIds.join("、")} · {measurement.precision === "numeric-approximation" ? "数值近似" : "输入精确"}</p><div className="metric-grid"><span>结果<strong>{measurement.value === undefined ? "—" : `${measurement.value.toFixed(3)} ${measurement.unit ?? ""}`}{form === null ? null : <>{` · `}<span className="metric-form">{form}</span></>}</strong></span><span>状态<strong>{measurement.status}</strong></span></div><p className="footer-note">{measurement.explanation}</p><div className="property-actions">{form === null ? null : <button type="button" aria-label={`复制精确形式 ${title}`} data-exact-form-text={form} onClick={() => { void navigator.clipboard?.writeText(form) }}>复制 {form}</button>}<button type="button" aria-label={`删除测量 ${measurement.id}`} onClick={() => onDeleteMeasurement(measurement.id)}>删除测量</button></div></div>
    })}
     {shows("data") && showSlopeParameter && <div className="primitive-properties"><label className="properties-label" htmlFor="selected-slope-slider"><span>直线斜率参数</span><strong className="metric">{value.toFixed(2)}</strong></label><input id="selected-slope-slider" aria-label="选中直线斜率" type="range" disabled={!editable} min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberValue(event))} /></div>}
     {shows("data") && selectedPoint && <div className="primitive-properties"><h3>点坐标</h3>
       {/**
         * 把点做成"动圆"的基准（用户口径）：点一下这个按钮，曲线就以这个点为定点生成，
         * 不画圆心、半径可改、删掉这个点动圆也跟着消失。
         */}
       <div className="property-actions">
         <button type="button" aria-label="创建动圆" disabled={!editable || pointHasMovingCircle} onClick={() => onCreateMovingCircle?.()}>{pointHasMovingCircle ? "已有动圆" : "创建动圆"}</button>
         {/**
           * 用户口径 2 的后半：「第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化。」
           * 与上面那条「创建动圆」是两件事，所以两个按钮都在：动圆是"曲线绕定点转、始终过这个点"，
           * 这里是"这个点就是圆心"。按钮文案把这点差别直接说出来，用户才不用试。
           */}
         <button type="button" aria-label="以点为圆心作圆" disabled={!editable || !onCreateCircleAtPoint} onClick={() => onCreateCircleAtPoint?.(selectedPoint.id)}>以点为圆心作圆</button>
         {/**
           * 用户口径 2 的前半：「动点在轨道上能够在动点位置画切线，同时切线能根据动点位置进行动态变化。」
           * 只有**已经绑在轨道上**的动点才有这个入口 —— 自由点没有"在它那里作切线"这回事。
           */}
         <button type="button" aria-label="在动点处作切线" disabled={!editable || !pointTangentSource || !onCreatePointTangent} onClick={() => onCreatePointTangent?.(selectedPoint.id)}>在动点处作切线</button>
       </div>
       <p className="footer-note">创建动圆：以这个点为<strong>定点</strong>生成一条圆——圆始终过这个点，可以在画布上直接拖着转，半径在右侧改；删掉这个点，动圆会一起消失。</p>
       <p className="footer-note">以点为圆心作圆：圆心就是这个点（点动圆心跟着动）；半径可以直接改，也可以选一个动点让半径<strong>随它的位置变化</strong>。</p>
       <p className="footer-note">{pointTangentSource ? `在动点处作切线：切点永远在这个点的当前位置上，拖动它就沿「${pointTangentSource.label ?? pointTangentSource.id}」滑动，切线跟着转。` : "在动点处作切线：先在下面的「路径绑定」里给它选一条曲线轨道（圆 / 圆弧 / 抛物线 / 椭圆 / 双曲线 / 函数图像）。"}</p>
       <CoordinateField label="点 X" value={selectedPoint.x} disabled={!editable || selectedPoint.binding?.kind === "onPath"} onChange={(next) => updatePoint("x", next)} /><CoordinateField label="点 Y" value={selectedPoint.y} disabled={!editable || selectedPoint.binding?.kind === "onPath"} onChange={(next) => updatePoint("y", next)} /><Field label="路径绑定"><select aria-label="点路径绑定" disabled={!editable} value={selectedPoint.binding?.kind === "onPath" ? selectedPoint.binding.pathId : ""} onChange={(event) => updatePointBinding(event.target.value)}><option value="">自由点</option>{pathPrimitives.map((path) => <option key={path.id} value={path.id}>{path.label ?? path.id}</option>)}</select></Field><p className="footer-note">把点变成动点：在上面的「路径绑定」里选一条曲线或直线，这个点就会<strong>严格沿它滑动</strong>——可以直接在画布上拖它，也可以改「路径参数」精确摆位；绑定后还能点「记录轨迹」画出它的运动轨迹。</p>{selectedPoint.binding?.kind === "onPath" && <><Field label="路径参数"><input aria-label="路径参数" type="number" min={selectedPointWindow?.min ?? 0} max={selectedPointWindow?.max ?? 1} step={selectedPointWindow ? (selectedPointWindow.max - selectedPointWindow.min) / 100 : 0.01} disabled={!editable} value={selectedPoint.binding.parameterId && sceneDocument.parameters[selectedPoint.binding.parameterId] ? sceneDocument.parameters[selectedPoint.binding.parameterId].value : selectedPoint.binding.parameter} onChange={(event) => updatePointParameter(numberValue(event))} /></Field><button type="button" aria-label="记录轨迹" disabled={!editable} onClick={createLocus}>记录轨迹</button>{selectedPointBinding?.domain && <><Field label="参数域起"><input aria-label="参数域起" type="number" step="0.1" disabled={!editable} value={selectedPointBinding.domain[0]} onChange={(event) => onUpdatePrimitive({ binding: { ...selectedPointBinding, domain: [numberValue(event), selectedPointBinding.domain![1]] } })} /></Field><Field label="参数域止"><input aria-label="参数域止" type="number" step="0.1" disabled={!editable} value={selectedPointBinding.domain[1]} onChange={(event) => onUpdatePrimitive({ binding: { ...selectedPointBinding, domain: [selectedPointBinding.domain![0], numberValue(event)] } })} /></Field></>}{selectedPointBinding?.branch !== undefined && <Field label="分支"><select aria-label="圆锥曲线分支" disabled={!editable} value={selectedPointBinding.branch} onChange={(event) => onUpdatePrimitive({ binding: { ...selectedPointBinding, branch: Number(event.target.value) as 0 | 1 } })}><option value="0">第一支</option><option value="1">第二支</option></select></Field>}</>}</div>}
     {/**
       * 绕定点旋转：定点与转角都摆在这里。
       *
       * 定点是另一个点图元时不提供坐标输入（那个点有自己的属性栏），只说明"绕哪个点"；
       * 圆绕定点转时外形不变、只有参数基准在转，所以补一句提示，避免用户以为"没生效"。
       */}
     {shows("data") && selectedPlacedCurve?.rotationAbout && <div className="primitive-properties"><h3>绕定点旋转</h3>
       {selectedPlacedCurve.rotationAbout.pivot.kind === "coordinate"
         ? <><CoordinateField label="定点 X" value={selectedPlacedCurve.rotationAbout.pivot.x} disabled={!editable} onChange={(next) => updatePlacementPivot("x", next)} /><CoordinateField label="定点 Y" value={selectedPlacedCurve.rotationAbout.pivot.y} disabled={!editable} onChange={(next) => updatePlacementPivot("y", next)} /></>
         : <p className="footer-note">定点：{selectedPlacedCurve.rotationAbout.pivot.primitiveId}（拖动那个点，曲线跟着绕它转）</p>}
       <Field label="绕定点转角（度）"><input aria-label="绕定点转角" type="number" disabled={!editable} step="1" value={placementDegrees(selectedPlacedCurve.rotationAbout.angle)} onChange={(event) => updatePlacementAngle(numberValue(event))} /></Field>
       {selectedPlacedCurve.type === "circle" && <p className="footer-note">圆绕定点转不改变外形（圆没有朝向）：转的是曲线自己的参数基准，周长、面积与到定点的距离都不变。</p>}
     </div>}
     {shows("data") && selectedLinear && <div className="primitive-properties"><h3>斜率特征</h3><div className="metric-grid"><span>倾角<strong>{lineAngle(selectedLinear).toFixed(2)}°</strong></span><span>长度<strong>{lineLength(selectedLinear).toFixed(2)}</strong></span><span>方向向量<strong>({(selectedLinear.b.x - selectedLinear.a.x).toFixed(2)}, {(selectedLinear.b.y - selectedLinear.a.y).toFixed(2)})</strong></span><span>截距<strong>{selectedSlope === null ? "垂直线" : (selectedLinear.a.y - selectedSlope * selectedLinear.a.x).toFixed(2)}</strong></span></div>{selectedSlope === null ? <button type="button" disabled={!editable} onClick={() => updateSlope(0)}>设为水平线</button> : <Field label="斜率"><input aria-label="选中直线斜率值" type="number" step="0.1" value={selectedSlope} readOnly={showSlopeParameter} disabled={!editable} onChange={(event) => updateSlope(numberValue(event))} /></Field>}{(["a", "b"] as const).map((endpoint) => <div key={endpoint} className="endpoint-group"><strong>{selectedLinear.type === "ray" && endpoint === "a" ? "起点 A" : selectedLinear.type === "ray" && endpoint === "b" ? "方向点 B" : `端点 ${endpoint.toUpperCase()}`}</strong><CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} X`} value={selectedLinear[endpoint].x} disabled={!editable} onChange={(next) => updateEndpoint(endpoint, "x", next)} /><CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} Y`} value={selectedLinear[endpoint].y} disabled={!editable || (selectedLinear.type === "line" && Boolean(selectedLinear.slopeParameter) && endpoint === "b")} onChange={(next) => updateEndpoint(endpoint, "y", next)} /></div>)}</div>}
     {shows("data") && selectedPolyline && <div className="primitive-properties"><h3>折线属性</h3><p className="footer-note">共 {selectedPolyline.points.length} 个顶点</p>{selectedPolyline.points.map((point, index) => <div key={`${selectedPolyline.id}-${index}`} className="endpoint-group"><strong>顶点 {index + 1}</strong><CoordinateField label={`顶点 ${index + 1} X`} value={point.x} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "x", next)} /><CoordinateField label={`顶点 ${index + 1} Y`} value={point.y} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "y", next)} /></div>)}</div>}
     {shows("data") && selectedParabola && <div className="primitive-properties"><h3>抛物线属性</h3><CoordinateField label="顶点 X" value={selectedParabola.vertex.x} disabled={!editable} onChange={(next) => updateParabolaVertex("x", next)} /><CoordinateField label="顶点 Y" value={selectedParabola.vertex.y} disabled={!editable} onChange={(next) => updateParabolaVertex("y", next)} /><Field label="焦参数"><input aria-label="焦参数" type="number" disabled={!editable} step="0.1" value={selectedParabola.focalParameter} onChange={(event) => onUpdatePrimitive({ focalParameter: numberValue(event) })} /></Field><Field label="轴向"><select aria-label="抛物线轴向" disabled={!editable} value={selectedParabola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field><Field label="旋转角度（度）"><input aria-label="抛物线旋转角度" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedParabola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field><p className="footer-note">焦点：{(() => { const focus = parabolaFocus(selectedParabola); return `(${focus.x.toFixed(2)}, ${focus.y.toFixed(2)})` })()}</p><CurveTangentAction sourceId={selectedParabola.id} editable={editable} onCreateCurveTangent={onCreateCurveTangent} /></div>}
     {shows("data") && selectedEllipseOrHyperbola && <div className="primitive-properties"><h3>{selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆属性" : "双曲线属性"}</h3><CoordinateField label="中心 X" value={selectedEllipseOrHyperbola.center.x} disabled={!editable} onChange={(next) => updateConicCenter("x", next)} /><CoordinateField label="中心 Y" value={selectedEllipseOrHyperbola.center.y} disabled={!editable} onChange={(next) => updateConicCenter("y", next)} /><Field label="横向半径"><input aria-label="横向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusX} onChange={(event) => onUpdatePrimitive({ radiusX: Math.max(0.01, numberValue(event)) })} /></Field><Field label="纵向半径"><input aria-label="纵向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusY} onChange={(event) => onUpdatePrimitive({ radiusY: Math.max(0.01, numberValue(event)) })} /></Field>{selectedEllipseOrHyperbola.type === "hyperbola" && <Field label="轴向"><select aria-label="双曲线轴向" disabled={!editable} value={selectedEllipseOrHyperbola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field>}<Field label="旋转角度（度）"><input aria-label={`${selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆" : "双曲线"}旋转角度`} type="number" disabled={!editable} step="1" value={rotationDegrees(selectedEllipseOrHyperbola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field><p className="footer-note">焦点：{(() => { const focus = conicFoci(selectedEllipseOrHyperbola); return `(${focus.first.x.toFixed(2)}, ${focus.first.y.toFixed(2)}) / (${focus.second.x.toFixed(2)}, ${focus.second.y.toFixed(2)})` })()}</p>{ellipseMetrics && <div className="metric-grid"><span>长半轴<strong>{ellipseMetrics.major.toFixed(2)}</strong></span><span>短半轴<strong>{ellipseMetrics.minor.toFixed(2)}</strong></span><span>离心率<strong>{ellipseMetrics.eccentricity.toFixed(3)}</strong></span><span>面积<strong>{(Math.PI * selectedEllipseOrHyperbola.radiusX * selectedEllipseOrHyperbola.radiusY).toFixed(2)}</strong></span></div>}{hyperbolaMetrics && <div className="metric-grid"><span>离心率<strong>{hyperbolaMetrics.eccentricity.toFixed(3)}</strong></span><span>渐近线角<strong>{hyperbolaMetrics.asymptoteAngle.toFixed(2)}°</strong></span></div>}<CurveTangentAction sourceId={selectedEllipseOrHyperbola.id} editable={editable} onCreateCurveTangent={onCreateCurveTangent} /></div>}
     {shows("data") && selectedFunction && <div className="primitive-properties function-properties"><h3>函数图像属性</h3><Field label="常用函数预设"><select aria-label="函数预设" disabled={!editable} value={selectedFunctionPresetId} onChange={(event) => applyFunctionPreset(event.target.value)}><option value="">自定义</option>{functionPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field><Field label="公式"><textarea ref={formulaRef} aria-label="函数表达式" rows={2} placeholder="例如：y = e^x 或 sin(ln(x))" disabled={!editable} value={expressionDraft} onChange={(event) => updateFunctionExpression(event.target.value)} /></Field><FormulaKeyboard logBase={logBase} onLogBaseChange={setLogBase} onInsert={insertFunctionTemplate} />{expressionError && <p className="footer-note" role="alert">{expressionError}</p>}<CoordinateField label="定义域起点" value={selectedFunction.domain[0]} disabled={!editable} onChange={(next) => updateFunctionDomain(0, next)} /><CoordinateField label="定义域终点" value={selectedFunction.domain[1]} disabled={!editable} onChange={(next) => updateFunctionDomain(1, next)} /><Field label="采样点数"><input aria-label="采样点数" type="number" disabled={!editable} min="2" max="2048" step="1" value={selectedFunction.samples ?? 128} onChange={(event) => onUpdatePrimitive({ samples: numberValue(event) })} /></Field><p className="footer-note">定义域 [{selectedFunction.domain[0]}, {selectedFunction.domain[1]}] · {selectedFunction.samples ?? 128} 个采样点</p>{functionMetrics && <p className="footer-note">值域 [{functionMetrics.min.toFixed(2)}, {functionMetrics.max.toFixed(2)}]</p>}<div className="property-actions" aria-label="函数分析"><button type="button" aria-label="创建导函数" disabled={!editable} onClick={() => onCreateDerivative(selectedFunction.id)}>创建导函数</button><button type="button" aria-label="创建切线" disabled={!editable} onClick={() => onCreateTangent(selectedFunction.id)}>创建切线</button><button type="button" aria-label="创建积分区域" disabled={!editable} onClick={() => onCreateIntegral(selectedFunction.id)}>创建积分区域</button></div></div>}
     {shows("data") && selectedCircleOrArc && <div className="primitive-properties"><h3>{selectedCircleOrArc.type === "circle" ? "圆属性" : "圆弧属性"}</h3>{selectedCircleOrArc.type === "circle" && selectedCircleOrArc.rotationAbout
        ? <p className="footer-note">动圆：圆心由定点与半径算出，不单独编辑（定点可以单独选中、也可以在画布上直接拖）。</p>
        : selectedCenterDrivenCircle
           ? <p className="footer-note">圆心由点图元给出：<strong>{sourceLabel(selectedCenterDrivenCircle.centerPointId ?? "")}</strong>。拖动那个点，圆心跟着动（圆心坐标不在这里单独编辑）。</p>
           : <><CoordinateField label="圆心 X" value={selectedCircleOrArc.center.x} disabled={!editable} onChange={(next) => updateCenter("x", next)} /><CoordinateField label="圆心 Y" value={selectedCircleOrArc.center.y} disabled={!editable} onChange={(next) => updateCenter("y", next)} /></>}<Field label="半径"><input aria-label="半径" type="number" disabled={!editable || Boolean(selectedCircleOrArc.type === "circle" && selectedCircleOrArc.radiusFrom)} min="0.01" step="0.1" value={selectedCircleOrArc.radius} onChange={(event) => selectedCircleOrArc.type === "circle" && selectedCircleOrArc.rotationAbout ? updateMovingRadius(numberValue(event)) : onUpdatePrimitive({ radius: Math.max(0.01, numberValue(event)) })} /></Field>{selectedCircleOrArc.type === "arc" && <><Field label="起始角（度）"><input aria-label="起始角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.startAngle)} onChange={(event) => onUpdatePrimitive({ startAngle: rotationRadians(numberValue(event)) })} /></Field><Field label="结束角（度）"><input aria-label="结束角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.endAngle)} onChange={(event) => onUpdatePrimitive({ endAngle: rotationRadians(numberValue(event)) })} /></Field></>}{selectedCircleOrArc.type === "circle" ? <div className="metric-grid"><span>周长<strong>{(2 * Math.PI * selectedCircleOrArc.radius).toFixed(2)}</strong></span><span>面积<strong>{(Math.PI * selectedCircleOrArc.radius ** 2).toFixed(2)}</strong></span></div> : <div className="metric-grid"><span>圆心角<strong>{(arcAngle * 180 / Math.PI).toFixed(2)}°</strong></span><span>弧长<strong>{(arcAngle * selectedCircleOrArc.radius).toFixed(2)}</strong></span></div>}
      {/**
        * 用户口径 2 的后半：「第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化。」
        * 两种方式并排摆：不选驱动点就是固定半径（上面的数字可改），选了动点半径就跟着它走。
        */}
      {selectedCenterDrivenCircle && <><Field label="半径随动点"><select aria-label="半径随动点" disabled={!editable} value={selectedCenterDrivenCircle.radiusFrom?.pointId ?? ""} onChange={(event) => updateRadiusDriver(event.target.value)}><option value="">固定半径（用上面的数字）</option>{radiusDriverCandidates.map((point) => <option key={point.id} value={point.id}>{point.label ?? point.id}</option>)}</select></Field>{selectedCenterDrivenCircle.radiusFrom && <Field label="半径倍率"><input aria-label="半径倍率" type="number" min="0.01" step="0.1" disabled={!editable} value={selectedCenterDrivenCircle.radiusFrom.factor} onChange={(event) => updateRadiusFactor(numberValue(event))} /></Field>}<p className="footer-note">选中一个动点后，圆就<strong>始终经过那个点</strong>：它沿轨道滑动时圆的大小自动变化。倍率用来做「半径 = 2 倍距离」这类题；上面的半径数字此时不可直接编辑（它是算出来的）。删掉那个动点，圆会保留，只是半径不再跟随。</p></>}
      <CurveTangentAction sourceId={selectedCircleOrArc.id} editable={editable} onCreateCurveTangent={onCreateCurveTangent} />
    </div>}
     {shows("data") && selectedPrimitive?.type === "derivative" && <div className="primitive-properties"><h3>导函数分析</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · {selectedPrimitive.order} 阶 · 采样近似</p><p className="footer-note">状态：{selectedPrimitive.status}{selectedPrimitive.diagnostic ? ` · ${selectedPrimitive.diagnostic}` : ""}</p></div>}
     {shows("data") && (selectedPrimitive?.type === "tangent" || selectedPrimitive?.type === "normal" || selectedPrimitive?.type === "secant") && <div className="primitive-properties"><h3>{primitiveTypeLabels[selectedPrimitive.type]}分析</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · 状态：{selectedPrimitive.status}</p><div className="metric-grid"><span>斜率<strong>{selectedPrimitive.vertical ? "垂直" : selectedPrimitive.slope.toFixed(3)}</strong></span><span>计算点<strong>{selectedDerivedPoint ? `(${selectedDerivedPoint.x.toFixed(2)}, ${selectedDerivedPoint.y.toFixed(2)})` : "—"}</strong></span></div>{selectedPrimitive.diagnostic && <p className="footer-note">{selectedPrimitive.diagnostic}</p>}</div>}
      {/**
        * 曲线切线的两个旋钮：切点落在哪、切线画多长。
        *
        * 用户口径 1 是"点一下曲线就能作切线"，紧接着的问题必然是"切点在哪、怎么挪"；
        * 用户口径 2 是"切线随动点变化"，落点就是这里的「跟随动点」。
        */}
      {shows("data") && selectedCurveTangent && <div className="primitive-properties"><h3>切点定位</h3>
        <p className="footer-note">当前：{tangentAnchorLabel(selectedCurveTangent.anchor, (id) => sceneDocument.primitives.find((primitive) => primitive.id === id)?.label ?? null)}</p>
        <Field label="定位方式"><select aria-label="切点定位方式" disabled={!editable} value={selectedCurveTangent.anchor?.kind ?? "parameter"} onChange={(event) => setTangentAnchorKind(event.target.value as "parameter" | "point")}><option value="parameter">曲线参数（拖动参数沿曲线滑）</option><option value="point">跟随动点（点在哪就切在哪）</option></select></Field>
        {selectedCurveTangent.anchor?.kind === "point"
          ? <Field label="切点跟随"><select aria-label="切点跟随动点" disabled={!editable} value={selectedCurveTangent.anchor.pointId} onChange={(event) => updateTangentAnchorPoint(event.target.value)}>{tangentAnchorPoints.map((point) => <option key={point.id} value={point.id}>{point.label ?? point.id}</option>)}</select></Field>
          : <Field label="切点参数"><input aria-label="切点参数" type="number" disabled={!editable} min={tangentAnchorParameters?.min ?? 0} max={tangentAnchorParameters?.max ?? 1} step={tangentAnchorParameters ? (tangentAnchorParameters.max - tangentAnchorParameters.min) / 100 : 0.01} value={selectedCurveTangent.anchor?.kind === "parameter" ? selectedCurveTangent.anchor.parameter : 0} onChange={(event) => updateTangentParameter(numberValue(event))} /></Field>}
        <Field label="切线半长（留空＝无限长）"><input aria-label="切线半长" type="number" min="0.01" step="0.5" disabled={!editable} value={selectedCurveTangent.halfLength ?? ""} placeholder="无限长" onChange={(event) => updateTangentLength(numberValue(event))} /></Field>
        <p className="footer-note">「跟随动点」时切点永远在那个点的当前位置上：拖动它，切线沿轨道跟着转（那个点要在「点坐标」面板里绑定到这条曲线）。留空半长表示**无限长**（画到视野之外）；填一个值就把切线修剪成以切点为中心的那一段。</p>
      </div>}
     {shows("data") && selectedPrimitive?.type === "integral" && <div className="primitive-properties"><h3>积分区域</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · 区间 [{selectedPrimitive.domain[0]}, {selectedPrimitive.domain[1]}]</p><p className="footer-note">状态：{selectedPrimitive.status}{selectedPrimitive.diagnostic ? ` · ${selectedPrimitive.diagnostic}` : ""}</p><div className="metric-grid"><span>面积<strong>{selectedPrimitive.area === null ? "—" : selectedPrimitive.area.toFixed(4)}</strong></span><span>步数<strong>{selectedPrimitive.steps}</strong></span></div></div>}
     {shows("data") && selectedPrimitive?.type === "analysisSet" && <div className="primitive-properties"><h3>分析结果集合</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · 状态：{selectedPrimitive.status}</p><div className="metric-grid"><span>结果数量<strong>{selectedPrimitive.results.length}</strong></span></div>{selectedPrimitive.diagnostic && <p className="footer-note">{selectedPrimitive.diagnostic}</p>}</div>}
      {shows("data") && selectedIntersection && <div className="primitive-properties"><h3>{selectedIntersection.type === "intersectionSet" ? "交点集合" : "派生交点"}</h3>{selectedIntersection.type === "intersectionSet" ? <><p className="footer-note">共 {selectedIntersection.points.length} 个交点；位置会随来源图元更新。</p>{selectedIntersection.points.map((point, index) => <div className="metric-grid" key={`${selectedIntersection.id}-point-${index}`}><span>交点 {index + 1}<strong>({point.x.toFixed(2)}, {point.y.toFixed(2)})</strong></span></div>)}</> : <><p className="footer-note">该点由其他图元计算，不可直接拖动。</p><CoordinateField label="交点 X" value={selectedIntersection.x} readOnly onChange={() => undefined} /><CoordinateField label="交点 Y" value={selectedIntersection.y} readOnly onChange={() => undefined} /></>}</div>}
    {shows("data") && selectedCount > 1 && <div className="batch-properties"><h3>批量编辑 · {selectedCount} 个对象</h3><div className="batch-actions">{canCreateIntersection && (selectedPrimitive?.type === "point" ? <button aria-label={selectedCount === 3 ? "创建三点抛物线" : "连接选中点"} onClick={onCreateIntersection}>{selectedCount === 3 ? "创建三点抛物线" : "连接选中点"}</button> : <button aria-label="添加交点" onClick={onCreateIntersection}>添加交点</button>)}<button aria-label={selectedGroupId ? "取消分组" : "创建分组"} onClick={selectedGroupId ? onDeleteGroup : onCreateGroup}>{selectedGroupId ? "取消分组" : "创建分组"}</button><button aria-label={allSelectedVisible ? "批量隐藏" : "批量显示"} onClick={onToggleBatchVisibility}>{allSelectedVisible ? "批量隐藏" : "批量显示"}</button>{alignments.map((alignment) => <button key={alignment.value} aria-label={alignment.label} onClick={() => onAlign(alignment.value)}>{alignment.label}</button>)}</div>{/**
         * 批量改色。
         *
         * 之前多选时检查器里改颜色只作用于**主选中**那一个 —— 用户以为全改了，其实没有。
         * 这一块把"整批一起改"做成明确的一件事，走 `setPrimitivesStyle`：一次提交、一次撤销。
         */}
      {onUpdateSelectionStyle && <ColourField
        label="批量线条颜色"
        customLabel="批量线条颜色"
        palette={PLANAR_PALETTE}
        value={undefined}
        fallback=""
        disabled={!editable}
        batch
        onChange={(stroke) => onUpdateSelectionStyle({ stroke })}
      />}{onUpdateSelectionStyle && <ColourField
        label="批量填充颜色"
        customLabel="批量填充颜色"
        palette={FILL_PALETTE}
        value={undefined}
        fallback=""
        disabled={!editable}
        batch
        onChange={(fill) => onUpdateSelectionStyle({ fill: fill === NO_FILL ? undefined : fill })}
      />}</div>}
    {shows("engineering") && selectedPrimitive && <div className="primitive-properties annotation-properties"><h3>图元标注</h3><Field label="标注文本"><input aria-label="标注文本" type="text" value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} /></Field><div className="property-actions">{annotationOptions.map((option) => <button key={`${option.feature}-${option.index ?? "default"}`} type="button" aria-label={`添加${option.label}标注`} disabled={!editable} onClick={() => onAddAnnotation(option.feature, option.index, annotationText)}>{`添加${option.label}`}</button>)}</div>{selectedAnnotations.length > 0 && <div className="annotation-list" aria-label="当前图元标注">{selectedAnnotations.map((annotation) => <div className="annotation-row" key={annotation.id}><span>{annotation.text}</span><button type="button" aria-label={`删除标注 ${annotation.text}`} onClick={() => applySceneOperation({ op: "deleteAnnotation", id: annotation.id })}>删除</button></div>)}</div>}</div>}
  </section>
}
