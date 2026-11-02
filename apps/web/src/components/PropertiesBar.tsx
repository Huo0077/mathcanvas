import { useState, type ReactNode } from "react"
import { tangentAnchorLabel } from "../curveTangents"
import type { AnnotationFeature, EngineeringAnnotationKind, Measurement3Metric, PrimitiveSpec } from "@draw/dsl"
import { functionPresets } from "@draw/geometry-kernel"
import { type Alignment, type PrimitiveUpdatePatch } from "@draw/scene-graph"

import { defaultStrokeFor } from "../primitiveStyle"
import { pointHostValue } from "../pointHostOptions"
import { measurementMetricLabel } from "../measurementLabels"
import { measurementFormText } from "../measurementForms"
import { FormulaKeyboard } from "./FormulaKeyboard"
import { EmptyStateArt } from "./EmptyStateArt"
import { exactConicOf, sectionConicMetrics } from "../conicMetrics"
import { FILL_PALETTE, NO_FILL, PLANAR_PALETTE, supportsFill } from "../palette"
/**
 * 字段原语与数值换算已经拆到 `./inspectorFields`（组件）与 `./inspectorMath`（纯函数）：
 * 面板怎么拆，这一层都只有一份实现。见那两个文件的头注释。
 */
import { ColourField, CoordinateField, CurveTangentAction, Field, InspectorAccordion, ObjectRotationFields, SolidRotationFields, Vector3Fields } from "./inspectorFields"
import { intersectionFaceAreaPrecisionLabels, intersectionLineStatusLabels, intersectionSolidStatusLabels, primitiveTypeLabels } from "./inspectorLabels"
import { SolidDerivedReadings } from "./inspectorReadings"
import { lineAngle, lineLength, numberValue, placementDegrees, rotationDegrees, rotationRadians } from "./inspectorMath"
/**
 * 「选中了什么 → 该显示什么、改一下该写什么」整个模型在 `./inspectorModel`：
 * 本文件从此只负责**画**（面板结构、分节折叠、把控件接到模型上），不再持有派生量与更新逻辑。
 * 见那个文件的头注释。
 */
import { useInspectorModel } from "./inspectorModel"

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

export function PropertiesBar(props: PropertiesBarProps) {
  const {
    value, min, max, step, onChange, selectedPrimitive, selectedIds, selectedCount, selectedGroupId, allSelectedVisible, canCreateIntersection, onUpdatePrimitive, onRotateSection, onRotate3, onMaterializeSection, pointHostCandidates, onBindPointHost, onChangeHostParameter, onToggleSelectedVisibility, onToggleSelectedLock, onDeleteSelected, onCreateGroup, onDeleteGroup, onCreateIntersection, onAlign, onToggleBatchVisibility, onAddAnnotation, onAddEngineeringAnnotation, onCreateMeasurement, onDeleteMeasurement, onCreateMovingCircle, onCreateCircleAtPoint, onCreateCurveTangent, onCreatePointTangent, onUpdateSelectionStyle, onCreateDerivative, onCreateTangent, onCreateIntegral, sections = allInspectorSections
  } = props
  const [openSections, setOpenSections] = useState<Record<InspectorSection, boolean>>({ data: true, appearance: false, constraints: false, engineering: true })
  const usesExternalSections = sections.length < allInspectorSections.length
  const shows = (section: InspectorSection) => sections.includes(section) && (usesExternalSections || openSections[section])
  const toggleSection = (section: InspectorSection) => setOpenSections((current) => ({ ...current, [section]: !current[section] }))
  const {
    selectedPoint, selectedPoint3, point3Binding, selectedLinear, selectedLinear3, selectedPolyline, selectedParabola, selectedEllipseOrHyperbola, selectedFunction, selectedCircleOrArc, selectedPlacedCurve, selectedSolid, selectedPolyhedron3, polyhedron3Metrics, selectedPlane3, selectedSection, selectedIntersectionLine, selectedIntersectionSolid, selectedIntersectionFace, selectedIntersectionPoint, sourceLabel, selectedDerivedPoint, selectedIntersection, selectedSlope, showSlopeParameter, editable, expressionDraft, selectedFunctionPresetId, expressionError, logBase, setLogBase, formulaRef, annotationText, setAnnotationText, sceneDocument, selectedCircle3, selectedFace3, face3Metrics, objectOrientationNormal, applySceneOperation, derivedReadings, pointHasMovingCircle, annotationOptions, selectedAnnotations, pathPrimitives, selectedPointBinding, selectedPointWindow, pointTangentSource, selectedCenterDrivenCircle, radiusDriverCandidates, updateRadiusDriver, updateRadiusFactor, selectedCurveTangent, tangentAnchorParameters, tangentAnchorPoints, updateTangentParameter, updateTangentAnchorPoint, updateTangentLength, setTangentAnchorKind, selectedFacePair, visibleMeasurementOptions, engineeringAnnotationOptions, updatePoint, updatePoint3, updatePointBinding, updatePointParameter, createLocus, updateCenter, updateEndpoint, updateSlope, updatePolylinePoint, updateFunctionDomain, updateConicCenter, updateParabolaVertex, updateRotation, updatePlacementAngle, updatePlacementPivot, updateMovingRadius, parabolaFocus, conicFoci, ellipseMetrics, hyperbolaMetrics, arcAngle, updateFunctionExpression, applyFunctionPreset, insertFunctionTemplate, functionMetrics
  } = useInspectorModel(props)
  const teachingLine = sceneDocument.workspace === "geometry3d" && ["line3", "segment3", "ray3", "edge3"].includes(selectedPrimitive?.type ?? "")
  const showLineStyle = sceneDocument.workspace !== "geometry3d" || teachingLine
  const lineStyleLabel = teachingLine ? "教学线型" : "线型"

  const renderSection = (section: InspectorSection, title: string, content: ReactNode) => {
    if (!sections.includes(section)) return null
    if (usesExternalSections) return content
    return (
      <InspectorAccordion title={title} open={openSections[section]} onToggle={() => toggleSection(section)}>
        {content}
      </InspectorAccordion>
    )
  }

  const dataSectionContent = shows("data") && <>
    {/* 1. 基础标识：图元名称放在默认展开的「几何参数」顶部，紧凑单行，不占大块高度 */}
    {selectedPrimitive && <div className="primitive-properties primitive-identity-card">
      <Field label="图元名称">
        <input
          aria-label="图元名称"
          type="text"
          value={selectedPrimitive.label ?? ""}
          placeholder={selectedPrimitive.id}
          onChange={(event) => onUpdatePrimitive({ label: event.target.value })}
        />
      </Field>
    </div>}

    {/* 2. 多选批量编辑：多选时置顶展示，优先响应连接、交点、分组、对齐与批量改色 */}
    {selectedCount > 1 && <div className="batch-properties">
      <h3>批量编辑 · {selectedCount} 个对象</h3>
      <div className="batch-actions">
        {canCreateIntersection && (selectedPrimitive?.type === "point"
          ? <button aria-label={selectedCount === 3 ? "创建三点抛物线" : "连接选中点"} onClick={onCreateIntersection}>{selectedCount === 3 ? "创建三点抛物线" : "连接选中点"}</button>
          : <button aria-label="添加交点" onClick={onCreateIntersection}>添加交点</button>)}
        <button aria-label={selectedGroupId ? "取消分组" : "创建分组"} onClick={selectedGroupId ? onDeleteGroup : onCreateGroup}>{selectedGroupId ? "取消分组" : "创建分组"}</button>
        <button aria-label={allSelectedVisible ? "批量隐藏" : "批量显示"} onClick={onToggleBatchVisibility}>{allSelectedVisible ? "批量隐藏" : "批量显示"}</button>
        {alignments.map((alignment) => <button key={alignment.value} aria-label={alignment.label} onClick={() => onAlign(alignment.value)}>{alignment.label}</button>)}
      </div>
      {onUpdateSelectionStyle && <ColourField
        label="批量线条颜色"
        customLabel="批量线条颜色"
        palette={PLANAR_PALETTE}
        value={undefined}
        fallback=""
        disabled={!editable}
        batch
        onChange={(stroke) => onUpdateSelectionStyle({ stroke })}
      />}
      {onUpdateSelectionStyle && <ColourField
        label="批量填充颜色"
        customLabel="批量填充颜色"
        palette={FILL_PALETTE}
        value={undefined}
        fallback=""
        disabled={!editable}
        batch
        onChange={(fill) => onUpdateSelectionStyle({ fill: fill === NO_FILL ? undefined : fill })}
      />}
    </div>}

    {/* 3. 二维点属性：先摆核心坐标与路径绑定，再放关联作图快捷命令 */}
    {selectedPoint && <div className="primitive-properties">
      <h3>点坐标</h3>
      <CoordinateField label="点 X" value={selectedPoint.x} disabled={!editable || selectedPoint.binding?.kind === "onPath"} onChange={(next) => updatePoint("x", next)} />
      <CoordinateField label="点 Y" value={selectedPoint.y} disabled={!editable || selectedPoint.binding?.kind === "onPath"} onChange={(next) => updatePoint("y", next)} />
      <Field label="路径绑定">
        <select aria-label="点路径绑定" disabled={!editable} value={selectedPoint.binding?.kind === "onPath" ? selectedPoint.binding.pathId : ""} onChange={(event) => updatePointBinding(event.target.value)}>
          <option value="">自由点</option>
          {pathPrimitives.map((path) => <option key={path.id} value={path.id}>{path.label ?? path.id}</option>)}
        </select>
      </Field>
      {selectedPoint.binding?.kind === "onPath" && <div className="property-subcard">
        <span className="property-subheading">在轨运动控制</span>
        <Field label="路径参数">
          <input
            aria-label="路径参数"
            type="number"
            min={selectedPointWindow?.min ?? 0}
            max={selectedPointWindow?.max ?? 1}
            step={selectedPointWindow ? (selectedPointWindow.max - selectedPointWindow.min) / 100 : 0.01}
            disabled={!editable}
            value={selectedPoint.binding.parameterId && sceneDocument.parameters[selectedPoint.binding.parameterId] ? sceneDocument.parameters[selectedPoint.binding.parameterId].value : selectedPoint.binding.parameter}
            onChange={(event) => updatePointParameter(numberValue(event))}
          />
        </Field>
        <div className="inspector-slider-row">
          <span>滑轨</span>
          <input
            aria-label="路径滑轨"
            type="range"
            min={selectedPointWindow?.min ?? 0}
            max={selectedPointWindow?.max ?? 1}
            step={selectedPointWindow ? (selectedPointWindow.max - selectedPointWindow.min) / 200 : 0.005}
            disabled={!editable}
            value={selectedPoint.binding.parameterId && sceneDocument.parameters[selectedPoint.binding.parameterId] ? sceneDocument.parameters[selectedPoint.binding.parameterId].value : selectedPoint.binding.parameter}
            onChange={(event) => updatePointParameter(numberValue(event))}
          />
        </div>
        {selectedPointBinding?.domain && <div className="metric-grid">
          <Field label="参数域起"><input aria-label="参数域起" type="number" step="0.1" disabled={!editable} value={selectedPointBinding.domain[0]} onChange={(event) => onUpdatePrimitive({ binding: { ...selectedPointBinding, domain: [numberValue(event), selectedPointBinding.domain![1]] } })} /></Field>
          <Field label="参数域止"><input aria-label="参数域止" type="number" step="0.1" disabled={!editable} value={selectedPointBinding.domain[1]} onChange={(event) => onUpdatePrimitive({ binding: { ...selectedPointBinding, domain: [selectedPointBinding.domain![0], numberValue(event)] } })} /></Field>
        </div>}
        {selectedPointBinding?.branch !== undefined && <Field label="分支">
          <select aria-label="圆锥曲线分支" disabled={!editable} value={selectedPointBinding.branch} onChange={(event) => onUpdatePrimitive({ binding: { ...selectedPointBinding, branch: Number(event.target.value) as 0 | 1 } })}>
            <option value="0">第一支</option>
            <option value="1">第二支</option>
          </select>
        </Field>}
        <div className="property-actions">
          <button type="button" aria-label="解绑为自由点" disabled={!editable} onClick={() => updatePointBinding("")}>解绑为自由点</button>
          <button type="button" aria-label="记录轨迹" disabled={!editable} onClick={createLocus}>记录轨迹</button>
        </div>
      </div>}
      <div className="property-subcard">
        <span className="property-subheading">关联作图</span>
        <div className="property-actions">
          <button type="button" aria-label="创建动圆" disabled={!editable || pointHasMovingCircle} onClick={() => onCreateMovingCircle?.()}>{pointHasMovingCircle ? "已有动圆" : "创建动圆"}</button>
          <button type="button" aria-label="以点为圆心作圆" disabled={!editable || !onCreateCircleAtPoint} onClick={() => onCreateCircleAtPoint?.(selectedPoint.id)}>以点为圆心作圆</button>
          <button type="button" aria-label="在动点处作切线" disabled={!editable || !pointTangentSource || !onCreatePointTangent} onClick={() => onCreatePointTangent?.(selectedPoint.id)}>在动点处作切线</button>
        </div>
        <p className="footer-note">
          {pointTangentSource
            ? `已绑定至「${pointTangentSource.label ?? pointTangentSource.id}」，可直接生成随动点滑动的轨道切线、动圆或以该点为圆心的圆。`
            : "可基于该点快速生成过定点的动圆或以该点为圆心的圆；绑定至曲线轨道后可作随动切线。"}
        </p>
      </div>
    </div>}

    {/* 4. 三维点属性：三列坐标 + 宿主绑定 */}
    {selectedPoint3 && <div className="primitive-properties">
      <h3>空间点坐标</h3>
      <Vector3Fields prefix="坐标" value={selectedPoint3.position} disabled={!editable || point3Binding?.kind !== "free"} onChange={updatePoint3} />
      <Field label="宿主绑定">
        <select aria-label="点宿主绑定" disabled={!editable} value={pointHostValue(point3Binding)} onChange={(event) => onBindPointHost?.(event.target.value === "" ? null : event.target.value)}>
          <option value="">自由点</option>
          {(pointHostCandidates ?? []).map((host) => <option key={host.id} value={host.id}>{host.label}</option>)}
        </select>
      </Field>
      {point3Binding?.kind === "onHost" && <Field label="宿主参数"><input aria-label="宿主参数" type="number" step="0.01" disabled={!editable} value={point3Binding.parameter} onChange={(event) => onChangeHostParameter?.(numberValue(event))} /></Field>}
      {(point3Binding?.kind === "onFace" || point3Binding?.kind === "onSurface") && <>
        <Field label="面上参数 u"><input aria-label="面上参数 u" type="number" step="0.1" disabled={!editable} value={point3Binding.uv[0]} onChange={(event) => onChangeHostParameter?.(numberValue(event), point3Binding.uv[1])} /></Field>
        <Field label="面上参数 v"><input aria-label="面上参数 v" type="number" step="0.1" disabled={!editable} value={point3Binding.uv[1]} onChange={(event) => onChangeHostParameter?.(point3Binding.uv[0], numberValue(event))} /></Field>
      </>}
      {point3Binding?.kind === "inSolid" && <div className="metric-grid vector3-grid">
        <Field label="体内 u"><input aria-label="体内参数 u" type="number" min="0" max="1" step="0.05" disabled={!editable} value={point3Binding.uvw[0]} onChange={(event) => onChangeHostParameter?.(numberValue(event), point3Binding.uvw[1], point3Binding.uvw[2])} /></Field>
        <Field label="体内 v"><input aria-label="体内参数 v" type="number" min="0" max="1" step="0.05" disabled={!editable} value={point3Binding.uvw[1]} onChange={(event) => onChangeHostParameter?.(point3Binding.uvw[0], numberValue(event), point3Binding.uvw[2])} /></Field>
        <Field label="体内 w"><input aria-label="体内参数 w" type="number" min="0" max="1" step="0.05" disabled={!editable} value={point3Binding.uvw[2]} onChange={(event) => onChangeHostParameter?.(point3Binding.uvw[0], point3Binding.uvw[1], numberValue(event))} /></Field>
      </div>}
      <p className="footer-note">绑定到空间线、棱、面或实体后，点坐标由宿主参数实时约束并随宿主联动。</p>
    </div>}

    {/* 5. 三维线 / 棱几何特征 */}
    {selectedLinear3 && <div className="primitive-properties">
      <h3>空间线棱属性</h3>
      <div className="metric-grid">
        {selectedLinear3.pointA && <span>起点 {selectedLinear3.pointA.label}<strong>({selectedLinear3.pointA.position.x.toFixed(2)}, {selectedLinear3.pointA.position.y.toFixed(2)}, {selectedLinear3.pointA.position.z.toFixed(2)})</strong></span>}
        {selectedLinear3.pointB && <span>终点 {selectedLinear3.pointB.label}<strong>({selectedLinear3.pointB.position.x.toFixed(2)}, {selectedLinear3.pointB.position.y.toFixed(2)}, {selectedLinear3.pointB.position.z.toFixed(2)})</strong></span>}
        {selectedLinear3.length !== null && <span>空间长度<strong>{selectedLinear3.length.toFixed(3)}</strong></span>}
        {selectedLinear3.direction && <span>方向向量<strong>({selectedLinear3.direction.x.toFixed(2)}, {selectedLinear3.direction.y.toFixed(2)}, {selectedLinear3.direction.z.toFixed(2)})</strong></span>}
      </div>
    </div>}

    {/* 6. 三维面几何特征 */}
    {selectedFace3 && face3Metrics && <div className="primitive-properties">
      <h3>空间面属性</h3>
      <div className="metric-grid">
        <span>顶点数<strong>{face3Metrics.vertexCount}</strong></span>
        <span>面积<strong>{face3Metrics.area.toFixed(3)}</strong></span>
        <span>周长<strong>{face3Metrics.perimeter.toFixed(3)}</strong></span>
        <span>顶点环<strong>{face3Metrics.vertexLabels}</strong></span>
      </div>
    </div>}

    {/* 7. 三维模板立体与多面体属性 */}
    {selectedSolid && <div className="primitive-properties">
      <h3>立体几何属性</h3>
      {selectedSolid.type === "cube" && <>
        <Vector3Fields prefix="原点" value={selectedSolid.origin} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ origin3: { ...selectedSolid.origin, [axis]: next } })} />
        <Vector3Fields prefix="尺寸" value={selectedSolid.size} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ size3: { ...selectedSolid.size, [axis]: Math.max(0.01, next) } })} />
      </>}
      {selectedSolid.type === "pyramid" && <>
        <Vector3Fields prefix="底面中心" value={selectedSolid.baseCenter} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ baseCenter3: { ...selectedSolid.baseCenter, [axis]: next } })} />
        <CoordinateField label="底面尺寸 X" value={selectedSolid.baseSize.x} disabled={!editable} onChange={(next) => onUpdatePrimitive({ baseSize3: { ...selectedSolid.baseSize, x: Math.max(0.01, next) } })} />
        <CoordinateField label="底面尺寸 Y" value={selectedSolid.baseSize.y} disabled={!editable} onChange={(next) => onUpdatePrimitive({ baseSize3: { ...selectedSolid.baseSize, y: Math.max(0.01, next) } })} />
        <CoordinateField label="高度" value={selectedSolid.height} disabled={!editable} onChange={(next) => onUpdatePrimitive({ height: Math.max(0.01, next) })} />
      </>}
      {(selectedSolid.type === "cylinder" || selectedSolid.type === "cone") && <>
        <Vector3Fields prefix="中心" value={selectedSolid.center} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ center3: { ...selectedSolid.center, [axis]: next } })} />
        <CoordinateField label="半径 3D" value={selectedSolid.radius} disabled={!editable} onChange={(next) => onUpdatePrimitive({ radius3: Math.max(0.01, next) })} />
        <CoordinateField label="高度" value={selectedSolid.height} disabled={!editable} onChange={(next) => onUpdatePrimitive({ height: Math.max(0.01, next) })} />
        <Field label="分段数"><input aria-label="分段数" type="number" min="3" max="256" step="1" disabled={!editable} value={selectedSolid.segments} onChange={(event) => onUpdatePrimitive({ segments: Math.max(3, Math.min(256, Math.round(numberValue(event)))) })} /></Field>
      </>}
      {selectedSolid.type === "sphere" && <>
        <Vector3Fields prefix="球心" value={selectedSolid.center} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ center3: { ...selectedSolid.center, [axis]: next } })} />
        <CoordinateField label="半径 3D" value={selectedSolid.radius} disabled={!editable} onChange={(next) => onUpdatePrimitive({ radius3: Math.max(0.01, next) })} />
      </>}
    </div>}

    {selectedPolyhedron3 && polyhedron3Metrics && <div className="primitive-properties">
      <h3>多面体属性</h3>
      <div className="metric-grid">
        <span>顶点数<strong>{polyhedron3Metrics.vertexCount}</strong></span>
        <span>棱数<strong>{polyhedron3Metrics.edgeCount}</strong></span>
        <span>面数<strong>{polyhedron3Metrics.faceCount}</strong></span>
        {polyhedron3Metrics.center && <span>形心<strong>({polyhedron3Metrics.center.x.toFixed(2)}, {polyhedron3Metrics.center.y.toFixed(2)}, {polyhedron3Metrics.center.z.toFixed(2)})</strong></span>}
      </div>
    </div>}

    {selectedSolid && selectedSolid.type !== "sphere" && <div className="primitive-properties">
      <h3>朝向</h3>
      <SolidRotationFields rotation={selectedSolid.rotation} disabled={!editable} onChange={(rotation) => onUpdatePrimitive({ rotation3: rotation })} />
    </div>}

    {selectedPlane3 && <div className="primitive-properties">
      <h3>平面大小</h3>
      <Field label="半边长（世界单位）">
        <input aria-label="平面半边长" type="number" min="0.1" step="0.5" placeholder="自动" disabled={!editable} value={selectedPlane3.halfSize ?? ""} onChange={(event) => onUpdatePrimitive({ halfSize: event.target.value === "" ? null : Math.max(0.1, numberValue(event)) })} />
      </Field>
      <div className="property-actions" aria-label="平面大小操作">
        <button type="button" disabled={!editable || selectedPlane3.halfSize === undefined} onClick={() => onUpdatePrimitive({ halfSize: null })}>恢复自动</button>
      </div>
      <p className="footer-note">留空表示按场景自动适配；填入数值后由该半边长决定显示范围。</p>
    </div>}

    {selectedCircle3 && <div className="primitive-properties">
      <h3>空间圆轨道</h3>
      <Field label="半径"><input aria-label="圆轨道半径" type="number" min="0.01" step="0.1" disabled={!editable} value={selectedCircle3.radius} onChange={(event) => onUpdatePrimitive({ radius3: Math.max(0.01, numberValue(event)) })} /></Field>
      <Vector3Fields prefix="圆心" value={selectedCircle3.center} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ center3: { ...selectedCircle3.center, [axis]: next } })} />
      <div className="metric-grid">
        <span>法向量<strong>({selectedCircle3.normal.x.toFixed(2)}, {selectedCircle3.normal.y.toFixed(2)}, {selectedCircle3.normal.z.toFixed(2)})</strong></span>
      </div>
      <p className="footer-note">空间圆轨道拥有独立的圆心、半径与法向，可将空间点绑定至该轨道滑动。</p>
    </div>}

    {(selectedCircle3 || selectedFace3) && <div className="primitive-properties">
      <h3>朝向</h3>
      <ObjectRotationFields normal={objectOrientationNormal} disabled={!editable} onRotate={onRotate3} />
    </div>}

    {selectedSection && exactConicOf(selectedSection) && <div className="primitive-properties">
      <h3>解析截面</h3>
      <div className="metric-grid">{sectionConicMetrics(selectedSection).map((row) => <span key={row.label}>{row.label}<strong>{row.value}</strong></span>)}</div>
      <p className="footer-note">边界为精确圆锥曲线，按屏幕误差自适应细分。</p>
    </div>}

    {selectedSection && <div className="primitive-properties">
      <h3>剖切面</h3>
      <div className="metric-grid">
        <span>法向量<strong>({selectedSection.plane.normal.x.toFixed(2)}, {selectedSection.plane.normal.y.toFixed(2)}, {selectedSection.plane.normal.z.toFixed(2)})</strong></span>
        <span>截面点数<strong>{selectedSection.points.length}</strong></span>
        <span>分类<strong>{selectedSection.classification === "polygon" ? "多边形" : selectedSection.classification === "segment" ? "线段" : selectedSection.classification === "point" ? "一点" : selectedSection.classification === "none" ? "无交线" : "数据不足"}</strong></span>
        {(selectedSection.loops?.length ?? 0) > 1 && <span>独立边界<strong>{selectedSection.loops!.length} 环</strong></span>}
      </div>
      <div className="property-actions" aria-label="剖切面旋转">
        {(["x", "y", "z"] as const).map((axis) => <span key={axis} className="property-axis-pair">
          <button type="button" aria-label={`绕 ${axis.toUpperCase()} 轴旋转剖切面 -15°`} disabled={!editable || !onRotateSection} onClick={() => onRotateSection?.(axis, -15)}>{axis.toUpperCase()} −15°</button>
          <button type="button" aria-label={`绕 ${axis.toUpperCase()} 轴旋转剖切面 +15°`} disabled={!editable || !onRotateSection} onClick={() => onRotateSection?.(axis, 15)}>{axis.toUpperCase()} +15°</button>
        </span>)}
      </div>
      <div className="property-actions">
        <button type="button" aria-label="转为图元" disabled={!editable || selectedSection.points.length < 3} title="把截面的每一环物化成独立的点 / 棱 / 面图元：之后它们不再随来源实体变化，可以单独移动、求交与测量" onClick={() => onMaterializeSection?.()}>转为图元</button>
      </div>
      <p className="footer-note">剖切面可沿法向拖动或按轴旋转；也可点击画布左上角「以面为剖切面」贴合实体平面。</p>
    </div>}

    {selectedIntersectionLine && <div className="primitive-properties">
      <h3>交线</h3>
      <div className="metric-grid">
        <span>来源 A<strong>{sourceLabel(selectedIntersectionLine.sourceIds[0])}</strong></span>
        <span>来源 B<strong>{sourceLabel(selectedIntersectionLine.sourceIds[1])}</strong></span>
        <span>段数<strong>{selectedIntersectionLine.segments.length}</strong></span>
        <span>总长度<strong>{selectedIntersectionLine.segments.reduce((total, segment) => total + Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y, segment.b.z - segment.a.z), 0).toFixed(3)}</strong></span>
        <span>状态<strong>{intersectionLineStatusLabels[selectedIntersectionLine.status] ?? selectedIntersectionLine.status}</strong></span>
      </div>
      {selectedIntersectionLine.diagnostic && <p className="footer-note">{selectedIntersectionLine.diagnostic}</p>}
      <p className="footer-note">两个来源移动时交线实时重算。</p>
    </div>}

    {selectedIntersectionSolid && <div className="primitive-properties">
      <h3>交面</h3>
      <div className="metric-grid">
        <span>来源 A<strong>{sourceLabel(selectedIntersectionSolid.sourceIds[0])}</strong></span>
        <span>来源 B<strong>{sourceLabel(selectedIntersectionSolid.sourceIds[1])}</strong></span>
        <span>体积<strong>{selectedIntersectionSolid.volume.toFixed(3)}</strong></span>
        <span>表面积<strong>{selectedIntersectionSolid.area.toFixed(3)}</strong></span>
        <span>面数<strong>{selectedIntersectionSolid.faces.length}</strong></span>
        <span>顶点数<strong>{selectedIntersectionSolid.vertices.length}</strong></span>
        <span>状态<strong>{intersectionSolidStatusLabels[selectedIntersectionSolid.status] ?? selectedIntersectionSolid.status}</strong></span>
      </div>
      {selectedIntersectionSolid.diagnostic && <p className="footer-note">{selectedIntersectionSolid.diagnostic}</p>}
      <p className="footer-note">布尔交集整体随来源移动自动重算。</p>
    </div>}

    {selectedIntersectionFace && <div className="primitive-properties">
      <h3>交面</h3>
      <div className="metric-grid">
        <span>来源 A<strong>{sourceLabel(selectedIntersectionFace.sourceIds[0])}</strong></span>
        <span>来源 B<strong>{sourceLabel(selectedIntersectionFace.sourceIds[1])}</strong></span>
        <span>面积<strong>{selectedIntersectionFace.area.toFixed(3)}</strong></span>
        <span>面积精度<strong>{intersectionFaceAreaPrecisionLabels[String(selectedIntersectionFace.areaExact)] ?? "未标注"}</strong></span>
        <span>顶点数<strong>{selectedIntersectionFace.points.length}</strong></span>
        <span>法向量<strong>({selectedIntersectionFace.normal.x.toFixed(2)}, {selectedIntersectionFace.normal.y.toFixed(2)}, {selectedIntersectionFace.normal.z.toFixed(2)})</strong></span>
        <span>状态<strong>{selectedIntersectionFace.status === "valid" ? "有效" : selectedIntersectionFace.status === "none" ? "两个实体没有公共面" : "数据不足"}</strong></span>
      </div>
      {selectedIntersectionFace.areaExact === false && <p className="footer-note">曲面区域按网格面片求和（数值近似）。</p>}
      {selectedIntersectionFace.areaExact === true && <p className="footer-note">平面区域与整圆边界为闭式精确面积。</p>}
      {selectedIntersectionFace.diagnostic && <p className="footer-note">{selectedIntersectionFace.diagnostic}</p>}
    </div>}

    {selectedIntersectionPoint && <div className="primitive-properties">
      <h3>交点</h3>
      <div className="metric-grid">
        <span>来源 A<strong>{sourceLabel(selectedIntersectionPoint.sourceIds[0])}</strong></span>
        <span>来源 B<strong>{sourceLabel(selectedIntersectionPoint.sourceIds[1])}</strong></span>
        <span>X<strong>{selectedIntersectionPoint.position.x.toFixed(3)}</strong></span>
        <span>Y<strong>{selectedIntersectionPoint.position.y.toFixed(3)}</strong></span>
        <span>Z<strong>{selectedIntersectionPoint.position.z.toFixed(3)}</strong></span>
        <span>状态<strong>{selectedIntersectionPoint.status === "valid" ? "有效" : selectedIntersectionPoint.status === "none" ? "两个表面不相交" : "数据不足"}</strong></span>
      </div>
      {selectedIntersectionPoint.diagnostic && <p className="footer-note">{selectedIntersectionPoint.diagnostic}</p>}
    </div>}

    {/* 8. 派生立体读数（外接球 / 内切球 / 截面核验） */}
    <SolidDerivedReadings entries={derivedReadings} labelFor={(entry) => entry.sourceId === undefined ? undefined : sceneDocument.primitives.find((primitive) => primitive.id === entry.sourceId)?.label ?? entry.sourceId} />

    {/* 9. 二维曲线与直线参数 */}
    {selectedPlacedCurve?.rotationAbout && <div className="primitive-properties">
      <h3>绕定点旋转</h3>
      {selectedPlacedCurve.rotationAbout.pivot.kind === "coordinate"
        ? <><CoordinateField label="定点 X" value={selectedPlacedCurve.rotationAbout.pivot.x} disabled={!editable} onChange={(next) => updatePlacementPivot("x", next)} /><CoordinateField label="定点 Y" value={selectedPlacedCurve.rotationAbout.pivot.y} disabled={!editable} onChange={(next) => updatePlacementPivot("y", next)} /></>
        : <p className="footer-note">定点：{selectedPlacedCurve.rotationAbout.pivot.primitiveId}（拖动那个点，曲线跟着绕它转）</p>}
      <Field label="绕定点转角（度）"><input aria-label="绕定点转角" type="number" disabled={!editable} step="1" value={placementDegrees(selectedPlacedCurve.rotationAbout.angle)} onChange={(event) => updatePlacementAngle(numberValue(event))} /></Field>
      {selectedPlacedCurve.type === "circle" && <p className="footer-note">圆绕定点转改变曲线参数基准，始终经过该定点。</p>}
    </div>}

    {showSlopeParameter && <div className="primitive-properties">
      <label className="properties-label" htmlFor="selected-slope-slider"><span>直线斜率参数</span><strong className="metric">{value.toFixed(2)}</strong></label>
      <input id="selected-slope-slider" aria-label="选中直线斜率" type="range" disabled={!editable} min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberValue(event))} />
    </div>}

    {selectedLinear && <div className="primitive-properties">
      <h3>斜率特征</h3>
      {(["a", "b"] as const).map((endpoint) => <div key={endpoint} className="endpoint-group">
        <strong>{selectedLinear.type === "ray" && endpoint === "a" ? "起点 A" : selectedLinear.type === "ray" && endpoint === "b" ? "方向点 B" : `端点 ${endpoint.toUpperCase()}`}</strong>
        <CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} X`} value={selectedLinear[endpoint].x} disabled={!editable} onChange={(next) => updateEndpoint(endpoint, "x", next)} />
        <CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} Y`} value={selectedLinear[endpoint].y} disabled={!editable || (selectedLinear.type === "line" && Boolean(selectedLinear.slopeParameter) && endpoint === "b")} onChange={(next) => updateEndpoint(endpoint, "y", next)} />
      </div>)}
      {selectedSlope === null
        ? <button type="button" disabled={!editable} onClick={() => updateSlope(0)}>设为水平线</button>
        : <Field label="斜率"><input aria-label="选中直线斜率值" type="number" step="0.1" value={selectedSlope} readOnly={showSlopeParameter} disabled={!editable} onChange={(event) => updateSlope(numberValue(event))} /></Field>}
      <div className="metric-grid">
        <span>倾角<strong>{lineAngle(selectedLinear).toFixed(2)}°</strong></span>
        <span>长度<strong>{lineLength(selectedLinear).toFixed(2)}</strong></span>
        <span>方向向量<strong>({(selectedLinear.b.x - selectedLinear.a.x).toFixed(2)}, {(selectedLinear.b.y - selectedLinear.a.y).toFixed(2)})</strong></span>
        <span>截距<strong>{selectedSlope === null ? "垂直线" : (selectedLinear.a.y - selectedSlope * selectedLinear.a.x).toFixed(2)}</strong></span>
      </div>
    </div>}

    {selectedPolyline && <div className="primitive-properties">
      <h3>折线属性</h3>
      <p className="footer-note">共 {selectedPolyline.points.length} 个顶点</p>
      {selectedPolyline.points.map((point, index) => <div key={`${selectedPolyline.id}-${index}`} className="endpoint-group">
        <strong>顶点 {index + 1}</strong>
        <CoordinateField label={`顶点 ${index + 1} X`} value={point.x} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "x", next)} />
        <CoordinateField label={`顶点 ${index + 1} Y`} value={point.y} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "y", next)} />
      </div>)}
    </div>}

    {selectedParabola && <div className="primitive-properties">
      <h3>抛物线属性</h3>
      <CoordinateField label="顶点 X" value={selectedParabola.vertex.x} disabled={!editable} onChange={(next) => updateParabolaVertex("x", next)} />
      <CoordinateField label="顶点 Y" value={selectedParabola.vertex.y} disabled={!editable} onChange={(next) => updateParabolaVertex("y", next)} />
      <Field label="焦参数"><input aria-label="焦参数" type="number" disabled={!editable} step="0.1" value={selectedParabola.focalParameter} onChange={(event) => onUpdatePrimitive({ focalParameter: numberValue(event) })} /></Field>
      <Field label="旋转角度（度）"><input aria-label="抛物线旋转角度" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedParabola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field>
      <Field label="轴向"><select aria-label="抛物线轴向" disabled={!editable} value={selectedParabola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field>
      <p className="footer-note">焦点：{(() => { const focus = parabolaFocus(selectedParabola); return `(${focus.x.toFixed(2)}, ${focus.y.toFixed(2)})` })()}</p>
      <CurveTangentAction sourceId={selectedParabola.id} editable={editable} onCreateCurveTangent={onCreateCurveTangent} />
    </div>}

    {selectedEllipseOrHyperbola && <div className="primitive-properties">
      <h3>{selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆属性" : "双曲线属性"}</h3>
      <CoordinateField label="中心 X" value={selectedEllipseOrHyperbola.center.x} disabled={!editable} onChange={(next) => updateConicCenter("x", next)} />
      <CoordinateField label="中心 Y" value={selectedEllipseOrHyperbola.center.y} disabled={!editable} onChange={(next) => updateConicCenter("y", next)} />
      <Field label="横向半径"><input aria-label="横向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusX} onChange={(event) => onUpdatePrimitive({ radiusX: Math.max(0.01, numberValue(event)) })} /></Field>
      <Field label="纵向半径"><input aria-label="纵向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusY} onChange={(event) => onUpdatePrimitive({ radiusY: Math.max(0.01, numberValue(event)) })} /></Field>
      <Field label="旋转角度（度）"><input aria-label={`${selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆" : "双曲线"}旋转角度`} type="number" disabled={!editable} step="1" value={rotationDegrees(selectedEllipseOrHyperbola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field>
      {selectedEllipseOrHyperbola.type === "hyperbola" && <Field label="轴向"><select aria-label="双曲线轴向" disabled={!editable} value={selectedEllipseOrHyperbola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field>}
      {ellipseMetrics && <div className="metric-grid">
        <span>长半轴<strong>{ellipseMetrics.major.toFixed(2)}</strong></span>
        <span>短半轴<strong>{ellipseMetrics.minor.toFixed(2)}</strong></span>
        <span>离心率<strong>{ellipseMetrics.eccentricity.toFixed(3)}</strong></span>
        <span>面积<strong>{(Math.PI * selectedEllipseOrHyperbola.radiusX * selectedEllipseOrHyperbola.radiusY).toFixed(2)}</strong></span>
      </div>}
      {hyperbolaMetrics && <div className="metric-grid">
        <span>离心率<strong>{hyperbolaMetrics.eccentricity.toFixed(3)}</strong></span>
        <span>渐近线角<strong>{hyperbolaMetrics.asymptoteAngle.toFixed(2)}°</strong></span>
      </div>}
      <p className="footer-note">焦点：{(() => { const focus = conicFoci(selectedEllipseOrHyperbola); return `(${focus.first.x.toFixed(2)}, ${focus.first.y.toFixed(2)}) / (${focus.second.x.toFixed(2)}, ${focus.second.y.toFixed(2)})` })()}</p>
      <CurveTangentAction sourceId={selectedEllipseOrHyperbola.id} editable={editable} onCreateCurveTangent={onCreateCurveTangent} />
    </div>}

    {selectedFunction && <div className="primitive-properties function-properties">
      <h3>函数图像属性</h3>
      <Field label="常用函数预设"><select aria-label="函数预设" disabled={!editable} value={selectedFunctionPresetId} onChange={(event) => applyFunctionPreset(event.target.value)}><option value="">自定义</option>{functionPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field>
      <Field label="公式"><textarea ref={formulaRef} aria-label="函数表达式" rows={2} placeholder="例如：y = e^x 或 sin(ln(x))" disabled={!editable} value={expressionDraft} onChange={(event) => updateFunctionExpression(event.target.value)} /></Field>
      <FormulaKeyboard logBase={logBase} onLogBaseChange={setLogBase} onInsert={insertFunctionTemplate} />
      {expressionError && <p className="footer-note" role="alert">{expressionError}</p>}
      <CoordinateField label="定义域起点" value={selectedFunction.domain[0]} disabled={!editable} onChange={(next) => updateFunctionDomain(0, next)} />
      <CoordinateField label="定义域终点" value={selectedFunction.domain[1]} disabled={!editable} onChange={(next) => updateFunctionDomain(1, next)} />
      <Field label="采样点数"><input aria-label="采样点数" type="number" disabled={!editable} min="2" max="2048" step="1" value={selectedFunction.samples ?? 128} onChange={(event) => onUpdatePrimitive({ samples: numberValue(event) })} /></Field>
      <div className="metric-grid">
        <span>定义域<strong>[{selectedFunction.domain[0]}, {selectedFunction.domain[1]}]</strong></span>
        {functionMetrics && <span>值域<strong>[{functionMetrics.min.toFixed(2)}, {functionMetrics.max.toFixed(2)}]</strong></span>}
      </div>
      <div className="property-actions" aria-label="函数分析">
        <button type="button" aria-label="创建导函数" disabled={!editable} onClick={() => onCreateDerivative(selectedFunction.id)}>创建导函数</button>
        <button type="button" aria-label="创建切线" disabled={!editable} onClick={() => onCreateTangent(selectedFunction.id)}>创建切线</button>
        <button type="button" aria-label="创建积分区域" disabled={!editable} onClick={() => onCreateIntegral(selectedFunction.id)}>创建积分区域</button>
      </div>
    </div>}

    {selectedCircleOrArc && <div className="primitive-properties">
      <h3>{selectedCircleOrArc.type === "circle" ? "圆属性" : "圆弧属性"}</h3>
      {selectedCircleOrArc.type === "circle" && selectedCircleOrArc.rotationAbout
        ? <p className="footer-note">动圆：圆心由定点与半径算出。</p>
        : selectedCenterDrivenCircle
          ? <p className="footer-note">圆心跟随点：<strong>{sourceLabel(selectedCenterDrivenCircle.centerPointId ?? "")}</strong></p>
          : <><CoordinateField label="圆心 X" value={selectedCircleOrArc.center.x} disabled={!editable} onChange={(next) => updateCenter("x", next)} /><CoordinateField label="圆心 Y" value={selectedCircleOrArc.center.y} disabled={!editable} onChange={(next) => updateCenter("y", next)} /></>}
      <Field label="半径"><input aria-label="半径" type="number" disabled={!editable || Boolean(selectedCircleOrArc.type === "circle" && selectedCircleOrArc.radiusFrom)} min="0.01" step="0.1" value={selectedCircleOrArc.radius} onChange={(event) => selectedCircleOrArc.type === "circle" && selectedCircleOrArc.rotationAbout ? updateMovingRadius(numberValue(event)) : onUpdatePrimitive({ radius: Math.max(0.01, numberValue(event)) })} /></Field>
      {selectedCircleOrArc.type === "arc" && <>
        <Field label="起始角（度）"><input aria-label="起始角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.startAngle)} onChange={(event) => onUpdatePrimitive({ startAngle: rotationRadians(numberValue(event)) })} /></Field>
        <Field label="结束角（度）"><input aria-label="结束角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.endAngle)} onChange={(event) => onUpdatePrimitive({ endAngle: rotationRadians(numberValue(event)) })} /></Field>
      </>}
      {selectedCenterDrivenCircle && <>
        <Field label="半径随动点"><select aria-label="半径随动点" disabled={!editable} value={selectedCenterDrivenCircle.radiusFrom?.kind === "triangle" ? "" : selectedCenterDrivenCircle.radiusFrom?.pointId ?? ""} onChange={(event) => updateRadiusDriver(event.target.value)}><option value="">固定半径（用上面的数字）</option>{radiusDriverCandidates.map((point) => <option key={point.id} value={point.id}>{point.label ?? point.id}</option>)}</select></Field>
        {selectedCenterDrivenCircle.radiusFrom && selectedCenterDrivenCircle.radiusFrom.kind !== "triangle" && <Field label="半径倍率"><input aria-label="半径倍率" type="number" min="0.01" step="0.1" disabled={!editable} value={selectedCenterDrivenCircle.radiusFrom.factor} onChange={(event) => updateRadiusFactor(numberValue(event))} /></Field>}
      </>}
      {selectedCircleOrArc.type === "circle"
        ? <div className="metric-grid"><span>周长<strong>{(2 * Math.PI * selectedCircleOrArc.radius).toFixed(2)}</strong></span><span>面积<strong>{(Math.PI * selectedCircleOrArc.radius ** 2).toFixed(2)}</strong></span></div>
        : <div className="metric-grid"><span>圆心角<strong>{(arcAngle * 180 / Math.PI).toFixed(2)}°</strong></span><span>弧长<strong>{(arcAngle * selectedCircleOrArc.radius).toFixed(2)}</strong></span></div>}
      <CurveTangentAction sourceId={selectedCircleOrArc.id} editable={editable} onCreateCurveTangent={onCreateCurveTangent} />
    </div>}

    {selectedPrimitive?.type === "derivative" && <div className="primitive-properties">
      <h3>导函数分析</h3>
      <div className="metric-grid">
        <span>来源<strong>{sourceLabel(selectedPrimitive.sourceId)}</strong></span>
        <span>阶数<strong>{selectedPrimitive.order} 阶</strong></span>
      </div>
      <p className="footer-note">状态：{selectedPrimitive.status}{selectedPrimitive.diagnostic ? ` · ${selectedPrimitive.diagnostic}` : ""}</p>
    </div>}

    {(selectedPrimitive?.type === "tangent" || selectedPrimitive?.type === "normal" || selectedPrimitive?.type === "secant") && <div className="primitive-properties">
      <h3>{primitiveTypeLabels[selectedPrimitive.type]}分析</h3>
      <div className="metric-grid">
        <span>斜率<strong>{selectedPrimitive.vertical ? "垂直" : selectedPrimitive.slope.toFixed(3)}</strong></span>
        <span>计算点<strong>{selectedDerivedPoint ? `(${selectedDerivedPoint.x.toFixed(2)}, ${selectedDerivedPoint.y.toFixed(2)})` : "—"}</strong></span>
      </div>
      <p className="footer-note">来源：{sourceLabel(selectedPrimitive.sourceId)} · 状态：{selectedPrimitive.status}</p>
      {selectedPrimitive.diagnostic && <p className="footer-note">{selectedPrimitive.diagnostic}</p>}
    </div>}

    {selectedCurveTangent && <div className="primitive-properties">
      <h3>切点定位</h3>
      <Field label="定位方式">
        <select aria-label="切点定位方式" disabled={!editable} value={selectedCurveTangent.anchor?.kind ?? "parameter"} onChange={(event) => setTangentAnchorKind(event.target.value as "parameter" | "point")}>
          <option value="parameter">曲线参数（拖动参数沿曲线滑）</option>
          <option value="point">跟随动点（点在哪就切在哪）</option>
        </select>
      </Field>
      {selectedCurveTangent.anchor?.kind === "point"
        ? <Field label="切点跟随"><select aria-label="切点跟随动点" disabled={!editable} value={selectedCurveTangent.anchor.pointId} onChange={(event) => updateTangentAnchorPoint(event.target.value)}>{tangentAnchorPoints.map((point) => <option key={point.id} value={point.id}>{point.label ?? point.id}</option>)}</select></Field>
        : <Field label="切点参数"><input aria-label="切点参数" type="number" disabled={!editable} min={tangentAnchorParameters?.min ?? 0} max={tangentAnchorParameters?.max ?? 1} step={tangentAnchorParameters ? (tangentAnchorParameters.max - tangentAnchorParameters.min) / 100 : 0.01} value={selectedCurveTangent.anchor?.kind === "parameter" ? selectedCurveTangent.anchor.parameter : 0} onChange={(event) => updateTangentParameter(numberValue(event))} /></Field>}
      <Field label="切线半长（留空＝无限长）"><input aria-label="切线半长" type="number" min="0.01" step="0.5" disabled={!editable} value={selectedCurveTangent.halfLength ?? ""} placeholder="无限长" onChange={(event) => updateTangentLength(numberValue(event))} /></Field>
      <p className="footer-note">当前：{tangentAnchorLabel(selectedCurveTangent.anchor, (id) => sceneDocument.primitives.find((primitive) => primitive.id === id)?.label ?? null)}</p>
    </div>}

    {selectedPrimitive?.type === "integral" && <div className="primitive-properties">
      <h3>积分区域</h3>
      <div className="metric-grid">
        <span>面积<strong>{selectedPrimitive.area === null ? "—" : selectedPrimitive.area.toFixed(4)}</strong></span>
        <span>步数<strong>{selectedPrimitive.steps}</strong></span>
      </div>
      <p className="footer-note">来源：{sourceLabel(selectedPrimitive.sourceId)} · 区间 [{selectedPrimitive.domain[0]}, {selectedPrimitive.domain[1]}]</p>
    </div>}

    {selectedPrimitive?.type === "analysisSet" && <div className="primitive-properties">
      <h3>分析结果集合</h3>
      <div className="metric-grid"><span>结果数量<strong>{selectedPrimitive.results.length}</strong></span></div>
      <p className="footer-note">来源：{sourceLabel(selectedPrimitive.sourceId)} · 状态：{selectedPrimitive.status}</p>
      {selectedPrimitive.diagnostic && <p className="footer-note">{selectedPrimitive.diagnostic}</p>}
    </div>}

    {selectedIntersection && <div className="primitive-properties">
      <h3>{selectedIntersection.type === "intersectionSet" ? "交点集合" : "派生交点"}</h3>
      {selectedIntersection.type === "intersectionSet"
        ? <>
          <p className="footer-note">共 {selectedIntersection.points.length} 个交点；位置随来源图元更新。</p>
          {selectedIntersection.points.map((point, index) => <div className="metric-grid" key={`${selectedIntersection.id}-point-${index}`}><span>交点 {index + 1}<strong>({point.x.toFixed(2)}, {point.y.toFixed(2)})</strong></span></div>)}
        </>
        : <>
          <CoordinateField label="交点 X" value={selectedIntersection.x} readOnly onChange={() => undefined} />
          <CoordinateField label="交点 Y" value={selectedIntersection.y} readOnly onChange={() => undefined} />
          <p className="footer-note">该点由来源图元求交得出，不可直接拖动。</p>
        </>}
    </div>}

    {/* 10. 已关联测量读数与教学测量工具 */}
    {selectedIds.length === 1 && sceneDocument.measurements.filter((measurement) => measurement.sourceIds.includes(selectedIds[0])).map((measurement) => {
      const title = measurement.metric === "dihedral" ? measurementMetricLabel(measurement) : `${measurementMetricLabel(measurement)}测量`
      const form = measurementFormText(measurement)
      return <div className="primitive-properties" key={measurement.id}>
        <h3>{title}</h3>
        <div className="metric-grid">
          <span>结果<strong>{measurement.value === undefined ? "—" : `${measurement.value.toFixed(3)} ${measurement.unit ?? ""}`}{form === null ? null : <>{` · `}<span className="metric-form">{form}</span></>}</strong></span>
          <span>状态<strong>{measurement.status}</strong></span>
        </div>
        <p className="footer-note">来源：{measurement.sourceIds.join("、")} · {measurement.precision === "numeric-approximation" ? "数值近似" : "输入精确"}</p>
        {measurement.explanation && <p className="footer-note">{measurement.explanation}</p>}
        <div className="property-actions">
          {form === null ? null : <button type="button" aria-label={`复制精确形式 ${title}`} data-exact-form-text={form} onClick={() => { void navigator.clipboard?.writeText(form) }}>复制 {form}</button>}
          <button type="button" aria-label={`删除测量 ${measurement.id}`} onClick={() => onDeleteMeasurement(measurement.id)}>删除测量</button>
        </div>
      </div>
    })}

    {visibleMeasurementOptions.length > 0 && <div className="primitive-properties">
      <h3>教学测量</h3>
      {selectedFacePair && <p className="measurement-guidance">已选两个面：二面角内角读实体内部夹角，外角读它的补角。</p>}
      <div className="property-actions" aria-label={sceneDocument.workspace === "geometry3d" ? "三维测量工具" : "平面测量工具"}>
        {visibleMeasurementOptions.map((option) => <button key={`${option.metric}-${option.dihedralKind ?? "default"}`} type="button" onClick={() => onCreateMeasurement(option.metric, option.dihedralKind)}>{option.label}</button>)}
      </div>
      <p className="footer-note">测量结果绑定来源对象并在移动后自动重算。</p>
    </div>}
  </>

  const appearanceSectionContent = shows("appearance") && selectedPrimitive && <div className="primitive-properties">
    {usesExternalSections && <>
      <div className="property-card-heading"><div><span className="property-kicker">当前图元</span><h3>{selectedPrimitive.label ?? selectedPrimitive.id}</h3></div><span className="property-type-badge">{primitiveTypeLabels[selectedPrimitive.type]}</span></div>
      <Field label="图元名称"><input aria-label="图元名称" type="text" value={selectedPrimitive.label ?? ""} placeholder={selectedPrimitive.id} onChange={(event) => onUpdatePrimitive({ label: event.target.value })} /></Field>
    </>}
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
    {showLineStyle && <>
      <Field label={lineStyleLabel}><select aria-label={lineStyleLabel} disabled={!editable} value={selectedPrimitive.style?.dash ?? "solid"} onChange={(event) => onUpdatePrimitive({ style: { dash: event.target.value === "solid" ? undefined : event.target.value } })}><option value="solid">实线</option><option value="8 6">虚线</option><option value="2 5">点线</option></select></Field>
      {teachingLine && <p className="footer-note">教学虚线保存在文档中；“隐藏边”只控制视图显示，两者相互独立。</p>}
    </>}
    <div className="property-actions">
      <button type="button" onClick={onToggleSelectedVisibility}>{selectedPrimitive.visible === false ? "显示图元" : "隐藏图元"}</button>
      {usesExternalSections && <button type="button" onClick={onToggleSelectedLock}>{selectedPrimitive.locked ? "解锁图元" : "锁定图元"}</button>}
    </div>
  </div>

  const engineeringSectionContent = shows("engineering") && (engineeringAnnotationOptions.length > 0 || selectedPrimitive) && <>
    {engineeringAnnotationOptions.length > 0 && <div className="primitive-properties">
      <h3>工程标注</h3>
      <div className="property-actions" aria-label="工程标注工具">
        {engineeringAnnotationOptions.map((option) => <button key={option.kind} type="button" aria-label={option.ariaLabel} onClick={() => onAddEngineeringAnnotation(option.kind)}>{option.label}</button>)}
      </div>
      <p className="footer-note">标注保留空间来源，并在四视图中随来源对象自动重算。</p>
    </div>}
    {selectedPrimitive && <div className="primitive-properties annotation-properties">
      <h3>图元标注</h3>
      <Field label="标注文本"><input aria-label="标注文本" type="text" value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} /></Field>
      <div className="property-actions">
        {annotationOptions.map((option) => <button key={`${option.feature}-${option.index ?? "default"}`} type="button" aria-label={`添加${option.label}标注`} disabled={!editable} onClick={() => onAddAnnotation(option.feature, option.index, annotationText)}>{`添加${option.label}`}</button>)}
      </div>
      {selectedAnnotations.length > 0 && <div className="annotation-list" aria-label="当前图元标注">
        {selectedAnnotations.map((annotation) => <div className="annotation-row" key={annotation.id}>
          <span>{annotation.text}</span>
          <button type="button" aria-label={`删除标注 ${annotation.text}`} onClick={() => applySceneOperation({ op: "deleteAnnotation", id: annotation.id })}>删除</button>
        </div>)}
      </div>}
    </div>}
  </>

  return <section className="panel-section properties" aria-label="属性检查器">
    <div className="inspector-heading">
      <div>
        <span className="panel-kicker">选中对象</span>
        <h2 className="panel-title">属性面板</h2>
      </div>
      <span className="inspector-indicator" aria-hidden="true" />
    </div>
    {selectedPrimitive && <div className="inspector-selected-heading">
      <div className="inspector-selected-identity">
        <div className="inspector-selected-meta">
          <span className="panel-kicker">当前图元</span>
          <span className="property-type-badge">{primitiveTypeLabels[selectedPrimitive.type]}</span>
        </div>
        <h3>{selectedPrimitive.label ?? selectedPrimitive.id}</h3>
      </div>
      <div className="inspector-quick-actions">
        <button type="button" aria-label={selectedPrimitive.locked ? "解锁图元" : "锁定图元"} onClick={onToggleSelectedLock}>{selectedPrimitive.locked ? "解锁" : "锁定"}</button>
        <button type="button" aria-label="快速删除对象" disabled={selectedPrimitive.locked} onClick={onDeleteSelected}>删除</button>
      </div>
    </div>}
    {!selectedPrimitive && selectedCount <= 1 && <div className="inspector-empty-state">
      <div className="inspector-empty-icon" aria-hidden="true"><EmptyStateArt name="selection" /></div>
      <strong>未选择任何图元</strong>
      <span>在画布中点击点、直线或椭圆即可配置几何参数与外观参数</span>
    </div>}
    {(selectedPrimitive || selectedCount > 1) && <>
      {renderSection("data", "几何参数", dataSectionContent)}
      {selectedPrimitive && renderSection("appearance", "外观样式", appearanceSectionContent)}
      {(selectedPrimitive || engineeringAnnotationOptions.length > 0) && renderSection("engineering", "标注与工程", engineeringSectionContent)}
    </>}
  </section>
}
