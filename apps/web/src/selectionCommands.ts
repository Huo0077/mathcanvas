/**
 * **选择与批量操作**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 七件事：点选 / 加选（`updateSelection`）、框选（`selectBox`）、批量锁定（`toggleLock`）、
 * 建组 / 解组（`createGroup` / `deleteGroup`）、对齐（`alignSelection`），以及"当前选中的是不是
 * 正好构成一个已有的组"（`selectedGroup`）。
 *
 * ## 三条写在这里的口径
 *
 * 1. **框选方向有语义**（CAD 约定）：**左→右**只选完全包含的，**右→左**选相交的。
 *    平面基础图元交给内核的 `selectPrimitivesInBox`；函数 / 圆锥曲线 / 派生曲线**没有解析的
 *    框相交几何**，所以只按"完全包含"判 —— 这不是漏判，是如实只保证能保证的那一半。
 * 2. **点选会清掉创建步骤**：正在画线的中途去点一个对象，意味着用户不画了。
 * 3. **选中模板实体时提示 Alt**：不说这句，用户永远找不到"单独选中一个面"的入口
 *    （二面角、剖切都靠它）。
 */

import type { GeometryDocument } from "@draw/dsl"
import { selectPrimitivesInBox, type BoxSelectionMode } from "@draw/geometry-kernel"
import type { Alignment, DomainOperation } from "@draw/scene-graph"

import { nextGroupId } from "./documentIds"
import { guidanceFor } from "./guidance"

export interface SelectionCommandDeps {
  document: GeometryDocument
  selectedIds: string[]
  /** "当前选中的对象是不是全都锁着" —— 与锁定按钮的显示同源，不在模块里重判一遍。 */
  allSelectedLocked: boolean
  apply: (operation: DomainOperation) => void
  setSelectedIds: (ids: string[] | ((current: string[]) => string[])) => void
  /** 选中任何东西都意味着"用户不再处于某个创建步骤里"。 */
  setCreationStep: (step: null) => void
  setGuidance: (guidance: string | null) => void
}

export function createSelectionCommands({ document, selectedIds, allSelectedLocked, apply, setSelectedIds, setCreationStep, setGuidance }: SelectionCommandDeps) {
  const selectedGroup = document.groups.find((group) => group.members.length === selectedIds.length && group.members.every((id) => selectedIds.includes(id))) ?? null
  const updateSelection = (id: string | null, additive = false) => {
    setCreationStep(null)
    if (!id) {
      setSelectedIds([])
      return
    }
    // 选中模板实体时说明 Alt 修饰键，否则用户永远找不到「单独选中一个面」的入口（二面角、剖切都靠它）。
    const picked = document.primitives.find((primitive) => primitive.id === id)
    if (picked && ["cube", "pyramid", "cylinder", "cone"].includes(picked.type)) setGuidance(guidanceFor({ kind: "selectSolid" }))
    setSelectedIds((current) => additive ? (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]) : [id])
  }
  /**
   * 框选：**左→右**只选完全包含的对象，**右→左**选相交的对象（CAD 约定）。
   * 平面基础图元交给内核的 `selectPrimitivesInBox`；函数、圆锥曲线和派生曲线仍按原有的
   * "完全包含"判定（它们没有解析的框相交几何，相交语义只覆盖平面基础图元）。
   */
  const planarBoxTypes = new Set(["point", "line", "segment", "ray", "polyline", "circle", "arc"])
  const selectBox = (bounds: { minX: number; minY: number; maxX: number; maxY: number }, mode: BoxSelectionMode = "window") => {
    const planar = selectPrimitivesInBox(document.primitives, bounds, mode)
    const rest = document.primitives.filter((primitive) => {
      if (planarBoxTypes.has(primitive.type)) return false
      if (primitive.type === "parabola") return primitive.vertex.x >= bounds.minX && primitive.vertex.x <= bounds.maxX && primitive.vertex.y >= bounds.minY && primitive.vertex.y <= bounds.maxY
      if (primitive.type === "ellipse" || primitive.type === "hyperbola") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      if (primitive.type === "function") return primitive.domain[0] >= bounds.minX && primitive.domain[1] <= bounds.maxX
      if (primitive.type === "derivative") return primitive.points.length > 0 && primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "tangent" || primitive.type === "normal") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "secant") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "integral") return primitive.points.length > 0 && primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "analysisSet") return primitive.results.length > 0 && primitive.results.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
      return false
    }).map((primitive) => primitive.id)
    setSelectedIds([...planar, ...rest])
  }
  const toggleLock = () => apply({ op: "setPrimitivesLocked", ids: selectedIds, locked: !allSelectedLocked })
  const createGroup = () => apply({ op: "createGroup", group: { id: nextGroupId(document), label: `分组 ${document.groups.length + 1}`, members: selectedIds } })
  const deleteGroup = () => selectedGroup && apply({ op: "deleteGroup", id: selectedGroup.id })
  const alignSelection = (alignment: Alignment) => apply({ op: "alignPrimitives", ids: selectedIds, alignment })

  return { selectedGroup, updateSelection, selectBox, toggleLock, createGroup, deleteGroup, alignSelection }
}
