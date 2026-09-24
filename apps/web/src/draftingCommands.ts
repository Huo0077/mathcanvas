import type { GeometryDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"

import { nextPrimitiveId } from "./documentIds"
import { guidanceFor } from "./guidance"

/**
 * **2D 绘图的创建流程**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 三步：开始创建（`startCreation`）→ 画布点击（`handleCanvasClick`，按模式落点）→
 * 折线以双击收尾（`handleCanvasDoubleClick`）。`handleCanvasCreationClick` 只是转发。
 *
 * ## 四条写在这里的口径
 *
 * 1. **3D 工作区里这几个"模式"另有含义**：直线 / 线段 / 射线在那里分别转发给
 *    空间直线 / 平面 / 面的创建命令；预置条件不足时给的是**左下角指引**（"还要选几个点"），
 *    不是一条不知道该怎么办的报错。
 * 2. **两点太近就不建**（< 0.05）：误触产生的退化图元（零长线段、零半径圆）之后会变成
 *    一堆"看不见但删不掉"的东西。
 * 3. **折线的重复点要去掉**：双击收尾时那一击的位置往往与最后一个点几乎重合。
 * 4. **图元落在当前图层上**（`cadLayerFields`）—— 由调用方注入，平面工作区里它是空的。
 */

export type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

export interface CreationStep {
  mode: Exclude<CreationMode, null>
  center: { x: number; y: number } | null
  start?: { x: number; y: number }
  points?: { x: number; y: number }[]
}

export interface DraftingCommandDeps {
  document: GeometryDocument
  creationStep: CreationStep | null
  /** 三维那三条工具命令：3D 工作区里 2D 模式会转发给它们（见口径 1）。 */
  addLine3: () => void
  addPlane3: () => void
  addFace3: () => void
  canCreateLine3: boolean
  canCreatePlane3: boolean
  canCreateFace3: boolean
  selectedPoint3Ids: string[]
  apply: (operation: DomainOperation) => void
  setCreationStep: (step: CreationStep | null) => void
  setSelectedIds: (ids: string[]) => void
  setGuidance: (guidance: string | null) => void
  cadLayerFields: () => { layerId?: string }
}

export function createDraftingCommands({ document, creationStep, addLine3, addPlane3, addFace3, canCreateLine3, canCreatePlane3, canCreateFace3, selectedPoint3Ids, apply, setCreationStep, setSelectedIds, setGuidance, cadLayerFields }: DraftingCommandDeps) {
  const startCreation = (mode: Exclude<CreationMode, null>) => {
    if (document.workspace === "geometry3d") {
      // 预置条件不足时给左下角指引，而不是弹一条不知道该怎么做的报错。
      if (mode === "line") {
        if (canCreateLine3) addLine3()
        else setGuidance(guidanceFor({ kind: "point3Tool", tool: "line", outcome: "blocked", point3Count: selectedPoint3Ids.length }))
      }
      if (mode === "segment") {
        if (canCreatePlane3) addPlane3()
        else setGuidance(guidanceFor({ kind: "point3Tool", tool: "plane", outcome: "blocked", point3Count: selectedPoint3Ids.length }))
      }
      if (mode === "ray" || mode === "polyline") {
        if (canCreateFace3) addFace3()
        else setGuidance(guidanceFor({ kind: "point3Tool", tool: "face", outcome: "blocked", point3Count: selectedPoint3Ids.length }))
      }
      return
    }
    setCreationStep({ mode, center: null })
    setGuidance(guidanceFor({ kind: "creation", mode }))
  }

  const handleCanvasClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep) return
    if (creationStep.mode === "polyline") {
      const points = creationStep.points ?? []
      if (!points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) >= 0.05) setCreationStep({ ...creationStep, points: [...points, coordinate] })
      return
    }
    if (!creationStep.center) {
      setCreationStep({ ...creationStep, center: coordinate })
      return
    }
    if (creationStep.mode === "line" || creationStep.mode === "segment" || creationStep.mode === "ray") {
      if (Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y) < 0.05) return
      const type = creationStep.mode
      const id = nextPrimitiveId(document, type)
      apply({ op: "addPrimitive", primitive: { id, type, a: creationStep.center, b: coordinate, ...cadLayerFields(), label: `${type === "line" ? "直线" : type === "ray" ? "射线" : "线段"} ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (creationStep.mode === "circle") {
      const radius = Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y)
      if (radius < 0.05) return
      const id = nextPrimitiveId(document, "circle")
      apply({ op: "addPrimitive", primitive: { id, type: "circle", center: creationStep.center, radius, ...cadLayerFields(), label: `圆 ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (!creationStep.start) {
      setCreationStep({ ...creationStep, start: coordinate })
      return
    }
    const radius = Math.hypot(creationStep.start.x - creationStep.center.x, creationStep.start.y - creationStep.center.y)
    if (radius < 0.05) return
    const startAngle = Math.atan2(creationStep.start.y - creationStep.center.y, creationStep.start.x - creationStep.center.x)
    const endAngle = Math.atan2(coordinate.y - creationStep.center.y, coordinate.x - creationStep.center.x)
    const id = nextPrimitiveId(document, "arc")
    apply({ op: "addPrimitive", primitive: { id, type: "arc", center: creationStep.center, radius, startAngle, endAngle, ...cadLayerFields(), label: `圆弧 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  const handleCanvasCreationClick = (coordinate: { x: number; y: number }) => {
    handleCanvasClick(coordinate)
  }

  const handleCanvasDoubleClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep || creationStep.mode !== "polyline") return
    const points = creationStep.points ?? []
    const finalPoints = !points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) < 0.05 ? points : [...points, coordinate]
    if (finalPoints.length < 2) return
    const id = nextPrimitiveId(document, "polyline")
    apply({ op: "addPrimitive", primitive: { id, type: "polyline", points: finalPoints, ...cadLayerFields(), label: `折线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  /**
   * `handleCanvasClick` **不往外给**：它只被下面那个 `handleCanvasCreationClick` 转发，
   * 对外只有"画布点击"这一个入口（多导出一个名字只是多一个能被误用的入口）。
   */
  return { startCreation, handleCanvasCreationClick, handleCanvasDoubleClick }
}
