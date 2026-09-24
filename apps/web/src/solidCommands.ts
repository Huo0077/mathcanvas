/**
 * **立体几何的"截面与宿主绑定"命令**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 七条命令：建截面（`addSection`）、绕实体中心转截面（`rotateSelectedSection` + 内部的
 * `sectionPivotFor`）、空间面 / 圆轨道的相对旋转（`rotateSelected3`）、"以面为剖切面"
 * （`applySectionFace`）、把空间点绑到宿主 / 解绑（`bindPointToHost`）、改宿主参数
 * （`setPointHostParameter`）、把截面物化成独立图元（`materializeSelectedSection`）。
 *
 * ## 为什么是它们
 *
 * 依赖面是**七项**、而且都是"当次渲染就能拿到"的值与 setter：文档、选中的图元与 id、
 * `apply`、三个 setter。与 `App` 里真正纠缠在一起的那些状态（创建步骤、CAD 命令模式、
 * 图层提示、Agent 运行）无关 —— 所以这是**本身就干净**的缝，不是硬掰出来的。
 *
 * ## 两条写在这里的不变式
 *
 * 1. **剖切面绕实体中心转**，不是绕平面自身垂足：后者会把刀口推出实体
 *    （实测平面到原点距离从 1.5 掉到 0.15），而学生要的"把刀口摆斜"是绕着图形转。
 * 2. **绑定的一刻先反投影一次**（取点当前坐标在宿主上的最近参数）：所以"绑上去"这一步
 *    点不会跳，之后的移动完全由参数决定 —— 参数是唯一真值。
 */

import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { host3FromPrimitive } from "@draw/geometry-kernel"
import { sectionMaterialization, sectionPivot, sectionPlaneThroughSource, sectionSourceVertices, solidVolumeHostFor, type DomainOperation } from "@draw/scene-graph"

import { nextPrimitiveId } from "./documentIds"
import { guidanceFor } from "./guidance"
import { parsePointHostValue } from "./pointHostOptions"

export const solidTypes = ["cube", "pyramid", "cylinder", "cone", "polyhedron3"] as const

export interface SolidCommandDeps {
  document: GeometryDocument
  selectedPrimitive: PrimitiveSpec | null
  selectedId: string | null
  apply: (operation: DomainOperation) => void
  setSelectedIds: (ids: string[]) => void
  setGuidance: (guidance: string | null) => void
  setFileError: (message: string | null) => void
}

export function createSolidCommands({ document, selectedPrimitive, selectedId, apply, setSelectedIds, setGuidance, setFileError }: SolidCommandDeps) {
  const addSection = () => {
    if (!selectedPrimitive || !solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])) return
    const plane = sectionPlaneThroughSource(document, selectedPrimitive.id)
    if (!plane) {
      setFileError("无法解析该实体的顶点，暂时不能创建截面。")
      return
    }
    const id = nextPrimitiveId(document, "section")
    apply({ op: "addPrimitive", primitive: { id, type: "section", sourceId: selectedPrimitive.id, plane, points: [], classification: "none", status: "undefined", label: `截面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "section" }))
  }
  /**
   * 剖切面绕**实体中心**旋转：绕平面自身垂足转会把刀口推出实体（实测平面到原点距离从 1.5 掉到 0.15），
   * 而学生想要的"把刀口摆斜"是绕着图形转，倾斜后截面还要看得见。
   */
  const sectionPivotFor = (section: Extract<PrimitiveSpec, { type: "section" }>) => {
    const source = document.primitives.find((primitive) => primitive.id === section.sourceId)
    const vertices = sectionSourceVertices(document, section.sourceId)
    return source && vertices.length > 0 ? sectionPivot(vertices) : null
  }
  const rotateSelectedSection = (axis: "x" | "y" | "z", degrees: number) => {
    const section = document.workspace === "geometry3d" && selectedPrimitive?.type === "section" ? selectedPrimitive : null
    if (!section) return
    const pivot = sectionPivotFor(section)
    apply({ op: "rotateSectionPlane", id: section.id, axis, degrees, ...(pivot ? { pivot } : {}) })
  }
  /**
   * 对象朝向的**相对**旋转（空间面 / 圆轨道）：枢轴缺省由域操作取"它拥有的点的形心"，
   * 也就是面绕自己的重心转、圆轨道绕圆心转——界面不需要先算一次中心。
   */
  const rotateSelected3 = (axis: "x" | "y" | "z", degrees: number) => {
    if (!selectedId) return
    apply({ op: "rotatePrimitive3", id: selectedId, axis, degrees })
  }
  /** 「以面为剖切面」由 3D 场景在拾取到面后回调，这里只负责把平面落到选中的截面上。 */
  const applySectionFace = (id: string, plane: { normal: Vector3; constant: number }) => {
    apply({ op: "setSectionPlane", id, normal: plane.normal, constant: plane.constant })
    setGuidance("已用该面作为剖切面：拖动截面或按方向键仍可沿新法向平移。")
  }
  /**
   * 把空间点物化/解绑到宿主：绑定参数取**点当前坐标在宿主上的最近点**（内核的 closestParameter），
   * 所以"绑上去"这一步点不会跳，之后的移动完全由参数决定（参数是唯一真值）。
   */
  /**
   * 把选中的空间点绑到宿主上。下拉的值是 `<模式>:<图元 id>`（见 `pointHostOptions`）：
   * - `host` 一维宿主（直线 / 线段 / 射线 / 棱）：存参数 `u`；
   * - `face` / `surface` 二维宿主（面 / 圆柱与圆锥侧面）：存 `uv`；
   * - `solid` **实体内**：存包围盒内的三个比例 `uvw`，越界会被夹回实体表面。
   *
   * 绑定的一刻先做一次反投影，所以"绑上去"这一步点不会跳，之后的移动完全由参数决定（参数是唯一真值）。
   */
  const bindPointToHost = (value: string | null) => {
    if (selectedPrimitive?.type !== "point3") return
    const target = value ? parsePointHostValue(value) : null
    if (!target) {
      apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { kind: "free" } } })
      setGuidance("已解绑为自由点：坐标仍由你直接编辑。")
      return
    }
    const host = document.primitives.find((primitive) => primitive.id === target.primitiveId)
    const constraint = host
      ? host3FromPrimitive(host, document.primitives) ?? (target.mode === "solid" ? solidVolumeHostFor(new Map(document.primitives.map((primitive) => [primitive.id, primitive])), host.id) : null)
      : null
    if (!host || !constraint) {
      setFileError("这个图元不能作为宿主动点：只有空间直线 / 线段 / 射线 / 棱 / 面 / 圆柱与圆锥侧面，以及实体的内部可以。")
      return
    }
    const projected = constraint.closestParameter(selectedPrimitive.position)
    const binding3 = target.mode === "face"
      ? { kind: "onFace" as const, faceId: host.id, uv: [projected.u, projected.v ?? 0] as [number, number] }
      : target.mode === "surface"
        ? { kind: "onSurface" as const, solidId: host.id, uv: [projected.u, projected.v ?? 0] as [number, number] }
        : target.mode === "solid"
          ? { kind: "inSolid" as const, solidId: host.id, uvw: [projected.u, projected.v ?? 0, projected.w ?? 0] as [number, number, number] }
          : { kind: "onHost" as const, hostId: host.id, parameter: projected.u }
    apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3 } })
    setGuidance(target.mode === "solid"
      ? `已绑定到「${host.label ?? host.id}」的**内部**：点可以在实体内自由移动，但出不去——拖到外面会被夹回表面，实体移动时它跟着走。`
      : `已绑定到「${host.label ?? host.id}」：点由宿主参数算出坐标，之后拖动或改参数都沿宿主滑动。`)
  }
  /** 改宿主参数：一维宿主只用 u；面与曲面用 (u, v)；实体内用 (u, v, w)，只改给出的维度。 */
  const setPointHostParameter = (u: number, v?: number, w?: number) => {
    if (selectedPrimitive?.type !== "point3") return
    const binding = selectedPrimitive.binding
    if (!binding) return
    if (binding.kind === "onHost") {
      if (!Number.isFinite(u)) return
      apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { ...binding, parameter: u } } })
      return
    }
    if (binding.kind === "inSolid") {
      if (!Number.isFinite(u)) return
      apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { ...binding, uvw: [u, v ?? binding.uvw[1], w ?? binding.uvw[2]] } } })
      return
    }
    if (binding.kind !== "onFace" && binding.kind !== "onSurface") return
    if (!Number.isFinite(u) || !Number.isFinite(v ?? binding.uv[1])) return
    apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { ...binding, uv: [u, v ?? binding.uv[1]] } } })
  }

  /** 把截面物化成独立图元：每一环 → 点 / 棱 / 面，且**不写来源引用**，
   * 所以物化之后删掉宿主实体也不影响它们（这就是"可以获取截面图元"）。
   */
  const materializeSelectedSection = () => {
    if (selectedPrimitive?.type !== "section") return
    const primitives = sectionMaterialization(document, selectedPrimitive.id)
    if (!primitives || primitives.length === 0) {
      setGuidance("这个截面没有可物化的闭合边界：它只是相切的一点或一段。")
      return
    }
    apply({ op: "addPrimitives", primitives })
    setSelectedIds(primitives.filter((primitive) => primitive.type === "face3").map((primitive) => primitive.id))
    setGuidance(`已把截面物化为 ${primitives.length} 个独立图元（点 / 棱 / 面），它们不再随来源变化。`)
  }

  return { addSection, rotateSelectedSection, rotateSelected3, applySectionFace, bindPointToHost, setPointHostParameter, materializeSelectedSection }
}
