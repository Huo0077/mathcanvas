import { useEffect, useMemo, useRef, useState } from "react"
import type { PrimitiveSpec, Vector3 } from "@draw/dsl"
import { dynamicPointPaths } from "../dynamicPointPaths"
import { isTangentSource } from "../curveTangents"
import { measurementOptionsFor } from "../spatialTools"
import { adaptiveSampleFunctionSegments, evaluateParameterExpression, functionPresets, getFunctionPreset, normalizeVector3, parseExpression, polygonNormal3 } from "@draw/geometry-kernel"
import { parameterWindow, pathConstraint, solidStatusReport, type PrimitiveUpdatePatch } from "@draw/scene-graph"
import { annotationFeatureOptions } from "../annotations"
import { insertFormulaTemplate } from "../formulaEditor"
import { useSceneStore } from "../store"
import { placementPivot, resizedPlacement } from "../curveRotation"
import { derivedSolidIdsOf, type ConicPrimitive, type SolidPrimitive } from "./inspectorLabels"
import { lineSlope, rotatePoint, rotationRadians } from "./inspectorMath"

/**
 * **模型真正需要的东西：三项。**
 *
 * 刻意**不是** `PropertiesBarProps`：那个接口有三十多个字段，其中绝大多数（`onCreateMeasurement`、
 * `onAlign` 一类）只被面板的 JSX 直接透传，模型一个都不碰。写成三项之后，"这个模型依赖什么"
 * 在类型上就看得见，而且它也因此能脱离整棵面板单独测（见 `inspectorModel.test.tsx`）。
 * `PropertiesBar` 把自己的 props 整个传进来仍然成立 —— 多出来的字段不影响结构兼容。
 */
export interface InspectorModelInput {
  selectedPrimitive: PrimitiveSpec | null
  selectedIds: string[]
  onUpdatePrimitive: (patch: PrimitiveUpdatePatch) => void
}

export function useInspectorModel(props: InspectorModelInput) {
  const { selectedPrimitive, selectedIds, onUpdatePrimitive } = props
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
   * **选中对象的派生读数**（规格 §3.4；Solid/Prism 切片 Task 5 的后半）。
   *
   * `solidStatusReport` 对**已提交的文档**逐个实体调内核那三个求解器，所以这里是
   * "文档现在长什么样"的实时读数（顶点被拖动、截面转了角度，下一帧就变）。
   *
   * 三点刻意的取舍：
   * - **按选中对象过滤，而且只在选中实体 / 截面时才算**：一份画了三十只立体的图纸里，
   *   每帧把每一只都算一遍是白花的（内切球那条是迭代求解）。过滤用的是文档里既有的
   *   归属关系（`topologyOfEntity` / `ownerOfTopology`，与场景图同一份规则），不是重新算几何。
   * - **选中的是截面时只显示这一刀自己的读数**：`App.addSection` 会把选择切到新建的截面上，
   *   所以这不是边角情形（Fix round 1 / M2）。读数带 `sourceId`，归属是**精确**的 ——
   *   不去猜"哪一行是哪一刀"，也不把整只实体的球体读数堆到截面面板上。
   * - `useMemo` 的依赖是**文档对象与选中图元**：`useSceneStore` 每次提交都换新对象，
   *   所以不会读到过期读数，也不会每渲染都重算一遍。
   */
  const derivedReadings = useMemo(() => {
    if (!selectedPrimitive) return []
    // 截面：只报这一刀（`sourceId` 是那条截面图元自己的 id）。
    if (selectedPrimitive.type === "section") {
      return solidStatusReport(sceneDocument, { sectionIds: [selectedPrimitive.id] }).filter((entry) => entry.sourceId === selectedPrimitive.id)
    }
    const solidIds = derivedSolidIdsOf(selectedPrimitive, sceneDocument)
    if (solidIds.length === 0) return []
    // **把范围传给报告本身**（外部审查 G1）：上面那段注释一直说"按选中对象过滤"，
    // 但原先的写法是 `solidStatusReport(sceneDocument)` 算完**整篇文档**再 `.filter(...)` ——
    // 过滤只筛结果、不省计算，而"算"才是贵的那一半（每只实体都要解外接球与内切球）。
    return solidStatusReport(sceneDocument, { solidIds }).filter((entry) => solidIds.includes(entry.solidId))
  }, [sceneDocument, selectedPrimitive])

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
  /**
   * 选/清空半径驱动点：清空时写 `null`，圆的半径回到"可直接编辑的数字"（值是最后一次算出来的那个）。
   *
   * `kind: "triangle"` 的规则（内切圆 / 外接圆）不走这个下拉：它的半径由三角形算出来，
   * 这里只处理"半径随动点"这一支，所以先收窄掉。
   */
  const updateRadiusDriver = (pointId: string) => {
    if (!selectedCenterDrivenCircle) return
    const distanceRule = selectedCenterDrivenCircle.radiusFrom?.kind === "triangle" ? undefined : selectedCenterDrivenCircle.radiusFrom
    onUpdatePrimitive({ radiusFrom: pointId ? { pointId, factor: distanceRule?.factor ?? 1 } : null })
  }
  const updateRadiusFactor = (factor: number) => {
    const distanceRule = selectedCenterDrivenCircle?.radiusFrom?.kind === "triangle" ? undefined : selectedCenterDrivenCircle?.radiusFrom
    if (!distanceRule || !(factor > 0)) return
    onUpdatePrimitive({ radiusFrom: { ...distanceRule, factor } })
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


  /** 只交出**视图真正要用的那一部分**：模型内部还有 12 个中间量（`setExpressionDraft`、`needsDomain` 一类），
   *  它们留在里面 —— 交出去只会让"外面能改的东西"变多。
   */
  return { 
selectedPoint, selectedPoint3, point3Binding, selectedLinear, selectedPolyline, selectedParabola, selectedEllipseOrHyperbola, selectedFunction, selectedCircleOrArc, selectedPlacedCurve, selectedSolid, selectedPlane3, selectedSection, selectedIntersectionLine, selectedIntersectionSolid, selectedIntersectionFace, selectedIntersectionPoint, sourceLabel, selectedDerivedPoint, selectedIntersection, selectedSlope, showSlopeParameter, editable, expressionDraft, selectedFunctionPresetId, expressionError, logBase, setLogBase, formulaRef, annotationText, setAnnotationText, sceneDocument, selectedCircle3, selectedFace3, objectOrientationNormal, applySceneOperation, derivedReadings, pointHasMovingCircle, annotationOptions, selectedAnnotations, pathPrimitives, selectedPointBinding, selectedPointWindow, pointTangentSource, selectedCenterDrivenCircle, radiusDriverCandidates, updateRadiusDriver, updateRadiusFactor, selectedCurveTangent, tangentAnchorParameters, tangentAnchorPoints, updateTangentParameter, updateTangentAnchorPoint, updateTangentLength, setTangentAnchorKind, selectedFacePair, visibleMeasurementOptions, engineeringAnnotationOptions, updatePoint, updatePoint3, updatePointBinding, updatePointParameter, createLocus, updateCenter, updateEndpoint, updateSlope, updatePolylinePoint, updateFunctionDomain, updateConicCenter, updateParabolaVertex, updateRotation, updatePlacementAngle, updatePlacementPivot, updateMovingRadius, parabolaFocus, conicFoci, ellipseMetrics, hyperbolaMetrics, arcAngle, updateFunctionExpression, applyFunctionPreset, insertFunctionTemplate, functionMetrics
 }
}
