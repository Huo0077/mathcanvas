/**
 * **"动圆"与"绕定点旋转"**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 两条命令其实是**同一个几何**：一条曲线始终过一个定点（用户口径："我要的轨道圆是点在圆上，
 * 而不是圆跟着点走"）。区别只在入口与默认值 —— `createMovingCircle` 新建一条曲线、定点是它的基准；
 * `anchorRotation` 把已选中的点定成已有曲线的定点。
 *
 * ## 为什么依赖里是"`rotationAnchor` 这个值"而不是重新算一遍
 *
 * "一个点 + 一条封闭曲线"这个组合在 `App` 里已经算过一次（命令可用性、状态栏提示都在用它）。
 * 这里直接收那个结果，而不是自己再判一次 —— 否则"命令能不能用"与"按下去做了什么"会各判一套，
 * 正是这个项目反复吃亏的那类分叉。
 *
 * ## 两条不变式
 *
 * 1. **定点是活的点**：写的是 `pivot: { kind: "primitive", primitiveId }`，不是把坐标抄下来 ——
 *    抄下来是一次性快照，之后拖那个点曲线就不跟了。
 * 2. **两笔补丁合成一步撤销**：定点先落到位、曲线再摆到"过它"的位置，顺序不能反；
 *    而 `applyBatch` 在事务里逐笔校验、逐笔应用，整批只压**一条**撤销记录
 *    （原先写成两次 `apply`，"把点定为定点"要按两次 Ctrl+Z 才回得去，中间那一步用户从没见过）。
 */

import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"

import { anchoredCurve } from "./curveRotation"
import { nextPrimitiveId } from "./documentIds"

/** 以定点为基准新建"动圆"时的默认半径：圆心摆在定点正右方一个半径处，参数 0 落在定点上。 */
const DEFAULT_MOVING_CIRCLE_RADIUS = 2

export interface AnchorRotationDeps {
  document: GeometryDocument
  selectedPrimitive: PrimitiveSpec | null
  /** 选中的"一个点 + 一条封闭曲线"；`null` 表示当前选择不构成这个组合。 */
  rotationAnchor: {
    point: Extract<PrimitiveSpec, { type: "point" }>
    curve: Extract<PrimitiveSpec, { type: "circle" | "ellipse" }>
  } | null
  apply: (operation: DomainOperation) => void
  applyBatch: (operations: DomainOperation[]) => void
  setFileError: (message: string | null) => void
  /** 新建的曲线要**在文档更新之后**才选中：所以这里只登记"待选中"，由 App 的副作用落地。 */
  setPendingSelection: (id: string) => void
}

export function createAnchorRotationCommands({ document, selectedPrimitive, rotationAnchor, apply, applyBatch, setFileError, setPendingSelection }: AnchorRotationDeps) {
  /**
   * 以选中的点为**定点**创建一条"动圆"（用户口径）。
   *
   * 和"选中点 + Shift 选曲线 → 绕定点旋转"是同一个几何（曲线始终过这个定点），
   * 区别在入口与默认值：这里是一条新曲线，定点是它的基准，圆心不画、半径可改。
   * 圆心摆成"离定点恰好一个默认半径"，于是曲线一开始就过定点。
   */
  const createMovingCircle = () => {
    const point = rotationAnchor?.point ?? (selectedPrimitive?.type === "point" ? selectedPrimitive : null)
    if (!point || point.type !== "point") return
    const radius = DEFAULT_MOVING_CIRCLE_RADIUS
    const id = nextPrimitiveId(document, "circle")
    // 基准圆心放在定点的正右方一个半径处：参数 0 落在定点上，于是"过定点"从第一帧就成立。
    const baseCenter = { x: point.x + radius, y: point.y }
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "circle",
        center: baseCenter,
        radius,
        rotation: 0,
        label: `动圆 ${id.split("-").at(-1)}`,
        rotationAbout: { pivot: { kind: "primitive", primitiveId: point.id }, angle: 0, baseCenter }
      }
    })
    // 新曲线自动选中：**在文档更新之后**才轮得到它，所以这里只登记待选中（见 deps 上的说明）。
    setPendingSelection(id)
  }
  /**
   * 把选中的点定为选中曲线上那个**定点**：曲线从此绕它旋转，转过任意角度都仍然过它。
   *
   * 两件事都要做，少一件这条性质就不成立：
   * 1. **点本身要挪到曲线上**（`anchored.pivot`）。定点是点图元引用，曲线只保证过"那个坐标"；
   *    点若留在原地（实测：点在 (5,0)、曲线被摆到过 (3,0)），用户看到的仍然不是"过这个定点"。
   * 2. 曲线的基准中心摆到"离定点恰好一个半轴"处，于是放置出来的曲线确实经过它。
   *
   * 用点图元引用而不是把坐标拷下来：这样定点还是一个活的点（可以继续拖动、可以约束），
   * "在曲线上取一个动点再让它当旋转中心"那类做法才成立。
   */
  const anchorRotation = () => {
    if (!rotationAnchor) return
    const { point, curve } = rotationAnchor
    // 定点必须落在曲线上：点不在曲线上时先投影上去，而不是拒绝用户。
    const anchored = anchoredCurve(curve, { x: point.x, y: point.y })
    if (!anchored) {
      setFileError("这个点无法作为旋转中心：它落在曲线中心，没有确定的方向。")
      return
    }
    /**
     * **两笔补丁合成一步**（外部审查 S1）：定点先落到位，曲线再摆到"过它"的位置。
     *
     * 顺序不能反，而且**每一步都要过校验**（`addPrimitives` 这类"新增"操作对已存在的 id
     * 会被拒绝）—— `applyBatch` 正是按这个语义做的：它在事务里逐笔校验、逐笔应用，
     * 只是**整批只压一条撤销记录**。原先写成两次 `apply`，于是"把点定为定点"这一个动作
     * 要按两次 Ctrl+Z 才回得去，而中间那一步是用户从没见过的状态
     *（点已经挪到曲线上、曲线却还没摆过去 —— 曲线不过定点）。
     */
    applyBatch([
      { op: "updatePrimitive", id: point.id, patch: { x: anchored.pivot.x, y: anchored.pivot.y } },
      {
        op: "updatePrimitive",
        id: curve.id,
        patch: {
          center: anchored.curve.center,
          rotation: anchored.curve.rotation,
          rotationAbout: {
            pivot: { kind: "primitive", primitiveId: point.id },
            angle: 0,
            baseCenter: anchored.rotationAbout.baseCenter
          }
        }
      }
    ])
  }

  return { createMovingCircle, anchorRotation }
}
