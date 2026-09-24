/**
 * **标注 / 参数 / 测量这三条"记录"命令**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 五条命令：加一条标注（`addAnnotation`）、加一条工程标注（`addEngineeringAnnotation`）、
 * 手工新建一个参数（`addParameter`）、加一条测量（`addMeasurement`）、删一条测量
 *（`deleteMeasurement`）。
 *
 * ## 为什么是它们
 *
 * 这三样**都不是几何**，而是挂在图元或文档上的**记录**：加一条、删一条，几何一律由
 * `applyOperation` 在同一笔里重算。它们的依赖因此只有六项（文档、选中的图元与 id、
 * `apply`、两个 setter），与 `App` 里真正纠缠的那些状态无关 —— 又是一个**本身就干净**的缝。
 *
 * ## 两条写在这里的口径
 *
 * 1. **先预检再落盘**：平面测量走内核的**同一个实体解析器**（`entityResolverFor`）算一次，
 *    只为拒绝无意义的来源 —— 少了这一步，"切线与直线的夹角"会被当成无意义来源直接拒掉，
 *    按钮点了没反应。空间测量同理（`createMeasurement3` 的状态）。
 * 2. **来源不够时说"要选什么"**，而不是抛一句测量说明：所以拒绝分支给的是 `guidance`，
 *    不是 `fileError` —— 用户要的是下一步怎么做。
 */

import type { AnnotationFeature, EngineeringAnnotationKind, GeometryDocument, Measurement3Metric, PrimitiveSpec } from "@draw/dsl"
import { createMeasurement3, entityResolverFor, evaluatePlanarMeasurement, type PlanarMetric } from "@draw/geometry-kernel"
import { validatePatch, type DomainOperation } from "@draw/scene-graph"

import { nextAnnotationId, nextEngineeringAnnotationId, nextMeasurementId } from "./documentIds"
import { guidanceFor } from "./guidance"

export interface RecordCommandDeps {
  document: GeometryDocument
  selectedPrimitive: PrimitiveSpec | null
  selectedIds: string[]
  apply: (operation: DomainOperation) => void
  setGuidance: (guidance: string | null) => void
  setFileError: (message: string | null) => void
}

export function createRecordCommands({ document, selectedPrimitive, selectedIds, apply, setGuidance, setFileError }: RecordCommandDeps) {
  const addAnnotation = (feature: AnnotationFeature, index?: number, text?: string) => {
    if (!selectedPrimitive) return
    const id = nextAnnotationId(document)
    const annotationText = text?.trim() || `${selectedPrimitive.label ?? selectedPrimitive.id} · ${feature}${index !== undefined ? ` ${index + 1}` : ""}`
    apply({ op: "addAnnotation", annotation: { id, text: annotationText, anchor: { kind: "primitive", primitiveId: selectedPrimitive.id, feature, ...(index === undefined ? {} : { index }) }, offset: { x: 0.25, y: 0.25 }, visible: true } })
  }
  const addEngineeringAnnotation = (kind: EngineeringAnnotationKind) => {
    if (document.workspace !== "cad") return
    const sourceIds = selectedIds.filter((id) => {
      const primitive = document.primitives.find((candidate) => candidate.id === id)
      return primitive?.type === "point3" || primitive?.type === "edge3"
    })
    const pointCount = sourceIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3").length
    const edgeCount = sourceIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "edge3").length
    const validSources = kind === "angular"
      ? pointCount === 3 || edgeCount === 2
      : pointCount === 2 || edgeCount === 1
    if (!validSources) {
      setFileError(kind === "angular" ? "选择三个空间点或两条空间棱后再创建角度标注" : "选择两个空间点或一条空间棱后再创建尺寸标注")
      return
    }
    apply({ op: "addEngineeringAnnotation", annotation: { id: nextEngineeringAnnotationId(document), kind, sourceIds, view: "front", unit: kind === "angular" ? "deg" : "mm", ...(kind === "tolerance" ? { tolerance: { upper: 0.1, lower: 0.1 } } : {}), status: "valid", explanation: "" } })
    setFileError(null)
  }
  /**
   * 手工新建一个参数。它不带 `ownerId`（不是某个对象生成的），所以删除对象时不会被回收。
   * 值/上下界/步长一次给全，否则滑块会没有可用的范围。
   */
  const addParameter = () => {
    let index = 1
    while (document.parameters[`p${index}`]) index += 1
    apply({ op: "setParameter", id: `p${index}`, value: 0.5, min: 0, max: 1, step: 0.01, label: `参数 ${index}` })
  }
  const addMeasurement = (metric: Measurement3Metric, dihedralKind?: "interior" | "exterior") => {
    const id = nextMeasurementId(document)
    /**
     * 平面测量与空间测量共用 `Measurement3` 容器，但求值走内核的平面求值器
     * （见 scene-graph 的 `calculatePlanarMeasurement`）。这里先算一次只为拒绝无意义的来源，
     * 与空间分支"来源不够就提示要选什么"的行为保持一致。
     */
    if (document.workspace !== "geometry3d") {
      /**
       * 与 scene-graph 的重算**用同一个实体解析器**（点 / 线 / 圆），否则这里预检会把
       * "切线与直线的夹角"当成无意义的来源直接拒掉 —— 按钮点了没反应。
       */
      const reading = evaluatePlanarMeasurement({
        id,
        metric: metric as PlanarMetric,
        sourceIds: selectedIds,
        angleKind: dihedralKind === "exterior" ? "exterior" : "interior"
      }, entityResolverFor(document.primitives))
      if (reading.status === "insufficient-data" || reading.status === "degenerate") {
        setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "blocked" }))
        return
      }
      apply({ op: "addMeasurement", measurement: {
        id,
        kind: "measurement3",
        sourceIds: [...selectedIds],
        metric,
        ...(dihedralKind ? { dihedralKind } : {}),
        precision: "numeric-approximation",
        status: reading.status,
        explanation: reading.explanation
      } })
      setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "created", ...(dihedralKind ? { dihedralKind } : {}) }))
      setFileError(null)
      return
    }
    const measurement = createMeasurement3(id, metric, selectedIds, document.primitives, dihedralKind)
    if (measurement.status === "insufficient-data" || measurement.status === "degenerate") {
      // 来源不够时给出「要选什么」，比抛一条测量说明更能让人继续操作。
      setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "blocked" }))
      return
    }
    apply({ op: "addMeasurement", measurement })
    setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "created", ...(dihedralKind ? { dihedralKind } : {}) }))
    setFileError(null)
  }
  const deleteMeasurement = (id: string) => {
    const validation = validatePatch(document, { op: "deleteMeasurement", id })
    if (!validation.valid) {
      setFileError(validation.errors.join(", "))
      return
    }
    apply({ op: "deleteMeasurement", id })
    setFileError(null)
  }

  return { addAnnotation, addEngineeringAnnotation, addParameter, addMeasurement, deleteMeasurement }
}
