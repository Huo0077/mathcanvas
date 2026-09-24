/**
 * **三维工具的创建命令**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 六条：`addPoint`（按工作区转发）/ `addPoint3` 空间点、`addLine3` 直线、`addPlane3` 平面、
 * `addFace3` 空间面、`addCircle3Track` 圆轨道。六条都对外 —— `addPoint3` 既被 `addPoint` 转发，
 * 也被命令分发直接调用（"空间点"按钮走的是后者）。
 *
 * ## 三条写在这里的几何口径（原来只写在注释里）
 *
 * 1. **空间点按 2×2×k 的格点走**，不是行优先：行优先会把前三个点摆在同一条直线上，
 *    于是"加三个点 → 建平面"必然失败（平面要三个不共线的点）。格点还顺带保证点不重叠。
 * 2. **圆轨道：三种选点法都有确定含义**（1 点 = 圆心、2 点 = 圆心 + 圆周点、3 点 = 三点定平面）。
 *    三点共线时平面法向没有定义 —— **如实拒绝并说明**，而不是退回 +Z 假装成功。
 * 3. **圆轨道"取一次坐标就脱钩"**：选中的点只用来量出圆心 / 半径 / 平面，圆自己不引用任何点
 *    （用户口径："我要的轨道圆是点在圆上，而不是圆跟着点走"）。
 */

import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { planeThroughPoints, type DomainOperation } from "@draw/scene-graph"

import { nextPoint3Label, nextPointLabel, nextPrimitiveId } from "./documentIds"
import { guidanceFor } from "./guidance"

/** 三点定不出平面时圆轨道的默认半径（用户只点一个点 = 只要一个水平圈）。 */
const DEFAULT_CIRCLE3_TRACK_RADIUS = 1.5

export interface Point3ToolDeps {
  document: GeometryDocument
  /**
   * 下面这几个名字**刻意与 `App` 里的派生名一一对应**，而不是在这里重判一遍：
   * 按钮亮不亮、命令拒不拒必须看**同一个**值，否则会长出"按钮亮着但按下去没反应"这类缺陷
   *（这个项目已经吃过这个亏）。名字对齐也让这次搬动是逐字的。
   */
  selectedPoint3Ids: string[]
  canCreateLine3: boolean
  canCreatePlane3: boolean
  canCreateFace3: boolean
  canCreateCircle3: boolean
  apply: (operation: DomainOperation) => void
  setSelectedIds: (ids: string[]) => void
  setGuidance: (guidance: string | null) => void
  setFileError: (message: string | null) => void
  /** 平面工作区新建图元要写进当前图层（空间工作区不需要）。 */
  cadLayerFields: () => { layerId?: string }
}

export function createPoint3ToolCommands({ document, selectedPoint3Ids, canCreateLine3, canCreatePlane3, canCreateFace3, canCreateCircle3, apply, setSelectedIds, setGuidance, setFileError, cadLayerFields }: Point3ToolDeps) {
  const addPoint = () => {
    if (document.workspace === "geometry3d") {
      addPoint3()
      return
    }
    const id = nextPrimitiveId(document, "point")
    apply({ op: "addPrimitive", primitive: { id, type: "point", x: 2, y: 1, ...cadLayerFields(), label: nextPointLabel(document) } })
    setGuidance(guidanceFor({ kind: "point", workspace: document.workspace }))
  }
  function addPoint3() {
    const pointCount = document.primitives.filter((primitive) => primitive.type === "point3").length
    const id = nextPrimitiveId(document, "point3")
    // Walk a 2x2xk lattice: the first three points must never be collinear (a plane needs three non-collinear
    // points) and no two points may land on top of each other. The old row-major layout put A, B and C on one
    // line, so "add three points, build a plane" always failed.
    const position = { x: (pointCount % 2) * 3, y: (Math.floor(pointCount / 2) % 2) * 3, z: Math.floor(pointCount / 4) * 3 }
    apply({ op: "addPrimitive", primitive: { id, type: "point3", position, binding: { kind: "free" }, label: nextPoint3Label(document) } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point", workspace: "geometry3d" }))
  }
  function addLine3() {
    if (!canCreateLine3) return
    const id = nextPrimitiveId(document, "line3")
    apply({ op: "addPrimitive", primitive: { id, type: "line3", definition: { kind: "throughPoints", pointIds: selectedPoint3Ids as [string, string] }, label: `空间直线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "line", outcome: "created" }))
  }
  function addPlane3() {
    if (!canCreatePlane3) return
    const id = nextPrimitiveId(document, "plane3")
    apply({ op: "addPrimitive", primitive: { id, type: "plane3", definition: { kind: "throughPoints", pointIds: selectedPoint3Ids as [string, string, string] }, label: `空间平面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "plane", outcome: "created" }))
  }
  function addFace3() {
    if (!canCreateFace3) return
    const id = nextPrimitiveId(document, "face3")
    apply({ op: "addPrimitive", primitive: { id, type: "face3", pointIds: [...selectedPoint3Ids], label: `空间面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "face", outcome: "created" }))
  }
  /**
   * 空间圆轨道（`circle3`）：三种选点法都有确定的几何含义，绝不靠猜——
   * 1 个点 = 圆心（法向默认 +Z 水平放置，半径默认 1.5，属性栏可改）；
   * 2 个点 = 圆心 + 圆周上一点（半径 = 两点距离）；
   * 3 个点 = 三点定平面（法向 = 三点平面法向、圆心 = 第一个点、半径 = 到第二个点的距离）。
   *
   * 三点共线时平面法向没有定义：如实拒绝并说明，而不是退回 +Z 假装成功。
   */
  function addCircle3Track() {
    if (!canCreateCircle3) return
    const centres = selectedPoint3Ids
      .map((id) => document.primitives.find((primitive) => primitive.id === id))
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point3" }> => primitive?.type === "point3")
    const center = centres[0]
    if (!center) return
    // 三个点时法向取三点平面；`planeThroughPoints` 对共线输入返回 null——那就不猜，如实拒绝。
    const plane = centres.length === 3 ? planeThroughPoints(centres.map((point) => point.position)) : null
    if (centres.length === 3 && !plane) {
      setFileError("三个点共线，定不出圆轨道所在的平面：请换一个不共线的点")
      return
    }
    const normal = plane ? plane.normal : { x: 0, y: 0, z: 1 }
    const rim = centres[1]
    // 半径优先取"圆心到第二个点的距离"：用户点两个点就是想要那么大一个圈。
    const delta = rim ? { x: rim.position.x - center.position.x, y: rim.position.y - center.position.y, z: rim.position.z - center.position.z } : null
    const radius = delta ? Math.hypot(delta.x, delta.y, delta.z) : DEFAULT_CIRCLE3_TRACK_RADIUS
    if (!(radius > 1e-6)) {
      setFileError("圆心与圆周点重合，定不出半径：请让两点分开")
      return
    }
    const id = nextPrimitiveId(document, "circle3")
    /**
     * **取一次坐标就脱钩**：选中的点只用来量出圆心 / 半径 / 平面，圆自己不引用任何点。
     * 用户口径："我要的轨道圆是点在圆上而不是圆跟着点走"——所以建完之后拖那些点不会动这条轨道。
     */
    apply({ op: "addPrimitive", primitive: { id, type: "circle3", center: { ...center.position }, normal, radius, label: `圆轨道 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setFileError(null)
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "circle", outcome: "created" }))
  }

  return { addPoint, addPoint3, addLine3, addPlane3, addFace3, addCircle3Track }
}
