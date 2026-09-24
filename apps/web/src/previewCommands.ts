/**
 * **"点预览就建图元"**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 两条命令：`createFromPreview`（3D 预览 → 交面 / 交点 / 交线 / 截面）与
 * `createIntersectionFromPreview`（平面画布预览 → 交点）。它们承载的是同一套心智：
 * **看到什么就创建什么** —— 用户指的是画面上那一块，不是从菜单里挑一个类型。
 *
 * ## 三条写在这里的口径
 *
 * 1. **几何留空，由同一事务重算**：交面 / 交线新建时 `points` / `segments` 是空的，
 *    `addPrimitive` 会在同一笔里按来源算出来 —— 界面上看不到"先空后有"的那一帧。
 * 2. **`hint` 是"用户点的是哪一个解"**：重算按"离 hint 最近"继续认领同一份，
 *    所以解的数量或顺序变了也不会串位。
 * 3. **预览里的"截面"复用 `addSection`**（依赖注入进来的那一个）：不在预览这条路上
 *    另写一份剖切平面逻辑 —— 两条路各写一遍就会长出"从预览建的和从按钮建的截面不一样"。
 */

import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"

import { nextPrimitiveId } from "./documentIds"
import type { IntersectionPreview } from "./intersectionPreview"
import type { ThreeScenePreview } from "./threeScenePreview"

export interface PreviewCommandDeps {
  document: GeometryDocument
  apply: (operation: DomainOperation) => void
  setSelectedIds: (ids: string[]) => void
  /** 建完之后在状态栏说一句"已创建××图元"：预览点击是"看到什么建什么"，动作得有声。 */
  setLayerNotice: (message: string | null) => void
  /** 预览里的"截面"直接复用已选实体的默认剖切面命令（不在预览这条路上另写一份）。 */
  addSection: () => void
}

export function createPreviewCommands({ document, apply, setSelectedIds, setLayerNotice, addSection }: PreviewCommandDeps) {
  /**
   * 点击 3D 预览即创建图元（与平面画布同一套心智：看到什么就创建什么）：
   * - 交面：新建 `intersectionFace`，来源是两个实体 + 这一面的形心 `hint`——**点哪块建哪块**，
   *   重算时按"离 hint 最近的面"继续认领同一面；
   * - 交点：新建 `intersectionPoint3`，来源是两个对象 + 那个拐点的位置 `hint`；
   * - 交线：新建 `intersectionLine`，来源是两个对象，`segments` 由内核在同一事务里重算；
   * - 截面：单个实体的默认剖切平面，走既有 `addSection`。
   * 创建后把选择切到新图元，与"保存交点"的心智模型一致。
   */
  const createFromPreview = (preview: ThreeScenePreview) => {
    if (preview.kind === "section") {
      addSection()
      return
    }
    const [firstId, secondId] = preview.sourceIds
    if (!firstId || !secondId) return
    if (preview.kind === "face") {
      const id = nextPrimitiveId(document, "intersectionFace")
      apply({
        op: "addPrimitive",
        primitive: {
          id,
          type: "intersectionFace",
          sourceIds: [firstId, secondId],
          // 几何留空：`addPrimitive` 会在同一事务里按来源重算，界面上看不到"先空后有"的一帧。
          points: [],
          normal: { x: 0, y: 0, z: 0 },
          area: 0,
          hint: preview.hint ?? { x: 0, y: 0, z: 0 },
          status: "none",
          label: `交面 ${id.split("-").at(-1)}`
        }
      })
      setSelectedIds([id])
      setLayerNotice("已创建交面图元")
      return
    }
    if (preview.kind === "point") {
      const id = nextPrimitiveId(document, "intersectionPoint3")
      const hint = preview.position ?? preview.hint ?? { x: 0, y: 0, z: 0 }
      apply({
        op: "addPrimitive",
        primitive: {
          id,
          type: "intersectionPoint3",
          sourceIds: [firstId, secondId],
          position: { ...hint },
          hint: { ...hint },
          status: "none",
          label: `交点 ${id.split("-").at(-1)}`
        }
      })
      setSelectedIds([id])
      setLayerNotice("已创建交点图元")
      return
    }
    const id = nextPrimitiveId(document, "intersectionLine")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "intersectionLine",
        sourceIds: [firstId, secondId],
        segments: preview.segments,
        classification: preview.segments.length > 1 ? "polyline" : "segment",
        status: "valid",
        label: `交线 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setLayerNotice("已创建交线图元")
  }

  const createIntersectionFromPreview = (preview: IntersectionPreview) => {
    const first = document.primitives.find((primitive) => primitive.id === preview.objectA)
    const second = document.primitives.find((primitive) => primitive.id === preview.objectB)
    if (!first || !second) return
    const id = nextPrimitiveId(document, "intersection")
    const solutionIndex = Math.max(0, Math.floor(preview.solutionIndex))
    // hint = 用户点的那个解：重算按"离它最近的解"匹配，解的数量或顺序变化时不会串位。
    const hint = { x: preview.point.x, y: preview.point.y }
    const label = `交点 ${id.split("-").at(-1)}`
    let primitive: PrimitiveSpec
    if (first.type === "line" && second.type === "line") {
      primitive = { id, type: "intersection", lineA: first.id, lineB: second.id, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "line" && second.type === "circle") {
      primitive = { id, type: "lineCircleIntersection", lineId: first.id, circleId: second.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "circle" && second.type === "line") {
      primitive = { id, type: "lineCircleIntersection", lineId: second.id, circleId: first.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "circle" && second.type === "circle") {
      primitive = { id, type: "circleIntersection", circleA: first.id, circleB: second.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    } else {
      primitive = { id, type: "curveIntersection", objectA: first.id, objectB: second.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
  }

  return { createFromPreview, createIntersectionFromPreview }
}
