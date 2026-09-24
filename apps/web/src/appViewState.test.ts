import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type LayerSpec, type PrimitiveSpec } from "@draw/dsl"
import { deriveAppViewState } from "./appViewState"

/**
 * **App 的派生视图状态**（`./appViewState`）—— 从 `App.tsx` 里搬出来的纯计算。
 *
 * 它们过去散在组件体里，**只有渲染整棵 App 才能验**：想知道"锁定两个对象之后批量锁定该不该灰掉"，
 * 得先把 App 跑起来、选中、再看按钮。搬成纯函数之后，喂一份文档 + 一个选中数组就能直接问，
 * 所以这里钉的是**判据本身**，不是界面。
 */

const point = (id: string, extra: Partial<PrimitiveSpec> = {}): PrimitiveSpec =>
  ({ id, type: "point", position: { x: 0, y: 0 }, binding: { kind: "free" }, ...extra }) as PrimitiveSpec
const point3 = (id: string): PrimitiveSpec =>
  ({ id, type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } }) as PrimitiveSpec
const edge3 = (id: string): PrimitiveSpec => ({ id, type: "edge3", pointIds: ["a", "b"] }) as PrimitiveSpec
const circle = (id: string, extra: Partial<PrimitiveSpec> = {}): PrimitiveSpec =>
  ({ id, type: "circle", center: { x: 0, y: 0 }, radius: 2, ...extra }) as PrimitiveSpec
const ellipse = (id: string): PrimitiveSpec =>
  ({ id, type: "ellipse", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 }) as PrimitiveSpec
const cube = (id: string): PrimitiveSpec =>
  ({ id, type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }) as PrimitiveSpec

const layer = (id: string, extra: Partial<LayerSpec> = {}): LayerSpec =>
  ({ id, name: id, kind: "geometry", visible: true, locked: false, printable: true, ...extra })

function viewOf(primitives: PrimitiveSpec[], selectedIds: string[], document: Partial<GeometryDocument> = {}) {
  return deriveAppViewState({ document: { ...createEmptyDocument("geometry3d"), primitives, ...document }, selectedIds })
}

describe("derived app view state", () => {
  it("takes the last selected id as the current primitive, and nothing when the selection is empty", () => {
    const primitives = [point("p-1"), point("p-2")]

    expect(viewOf(primitives, []).selectedId).toBeNull()
    expect(viewOf(primitives, []).selectedPrimitive).toBeNull()
    expect(viewOf(primitives, ["p-1", "p-2"]).selectedId).toBe("p-2")
    expect(viewOf(primitives, ["p-1", "p-2"]).selectedPrimitive?.id).toBe("p-2")
    /** 选中一个**不存在**的 id（刚被删掉的对象）时不许抛，也不许认成一个别的对象。 */
    expect(viewOf(primitives, ["gone"]).selectedPrimitive).toBeNull()
  })

  it("does not call an empty selection all-locked or all-visible", () => {
    const primitives = [point("p-1", { locked: true } as Partial<PrimitiveSpec>), point("p-2", { visible: false } as Partial<PrimitiveSpec>)]

    /** 空选中是 `false`：没有选中对象时，"批量锁定 / 批量显示"这类命令不该可用。 */
    expect(viewOf(primitives, []).allSelectedLocked).toBe(false)
    expect(viewOf(primitives, []).allSelectedVisible).toBe(false)

    expect(viewOf(primitives, ["p-1"]).allSelectedLocked).toBe(true)
    expect(viewOf(primitives, ["p-1", "p-2"]).allSelectedLocked).toBe(false)

    expect(viewOf(primitives, ["p-2"]).allSelectedVisible).toBe(false)
    expect(viewOf(primitives, ["p-1"]).allSelectedVisible).toBe(true)
  })

  it("offers a section only for the solid templates", () => {
    expect(viewOf([cube("c-1")], []).canCreateSection).toBe(false)
    expect(viewOf([cube("c-1")], ["c-1"]).canCreateSection).toBe(true)
    expect(viewOf([circle("k-1")], ["k-1"]).canCreateSection).toBe(false)
    /** 锁定与否不在这一层判：它只回答"这个对象的类型能不能做截面"。 */
    expect(viewOf([{ ...cube("c-1"), locked: true } as PrimitiveSpec], ["c-1"]).canCreateSection).toBe(true)
  })

  it("lets two sampled objects make an intersection, using the shared table rather than a local list", () => {
    const primitives = [point("p-1"), point("p-2"), point("p-3"), circle("k-1"), circle("k-2"), cube("c-1")]

    // 两个点走的是"连接"那条路；三个点是抛物线连接。
    expect(viewOf(primitives, ["p-1", "p-2"]).canCreatePointConnection).toBe(true)
    expect(viewOf(primitives, ["p-1", "p-2", "p-3"]).canCreatePointConnection).toBe(true)
    expect(viewOf(primitives, ["p-1"]).canCreatePointConnection).toBe(false)

    // 两个圆（`SAMPLED_PRIMITIVE_TYPES` 里的类型）：交点集合。
    expect(viewOf(primitives, ["k-1", "k-2"]).canCreateIntersection).toBe(true)
    // 圆 + 立方体：一个可采样、一个不可 —— 不许给"交点"这个选项。
    expect(viewOf(primitives, ["k-1", "c-1"]).canCreateIntersection).toBe(false)
    expect(viewOf(primitives, ["p-1"]).canCreateIntersection).toBe(false)
  })

  it("derives the 3D tool availability from the point3-only rule", () => {
    const primitives = [point3("s-1"), point3("s-2"), point3("s-3"), point("p-1")]
    const one = viewOf(primitives, ["s-1"])
    const two = viewOf(primitives, ["s-1", "s-2"])
    const three = viewOf(primitives, ["s-1", "s-2", "s-3"])
    /** 混进一个平面点时，空间工具必须全部关掉（"请只保留空间点"那条提示的前提）。 */
    const mixed = viewOf(primitives, ["s-1", "s-2", "p-1"])

    expect([one.canCreateLine3, one.canCreatePlane3, one.canCreateFace3, one.canCreateCircle3]).toEqual([false, false, false, true])
    expect([two.canCreateLine3, two.canCreatePlane3, two.canCreateFace3, two.canCreateCircle3]).toEqual([true, false, false, true])
    expect([three.canCreateLine3, three.canCreatePlane3, three.canCreateFace3, three.canCreateCircle3]).toEqual([false, true, true, true])
    expect([mixed.canCreateLine3, mixed.canCreatePlane3, mixed.canCreateFace3, mixed.canCreateCircle3]).toEqual([false, false, false, false])
  })

  it("counts annotation sources by point3 and edge3, and refuses the mixed pair", () => {
    const primitives = [point3("s-1"), point3("s-2"), point3("s-3"), edge3("e-1"), edge3("e-2"), point("p-1")]

    expect(viewOf(primitives, ["s-1", "s-2"]).canCreateLinearAnnotation).toBe(true)
    expect(viewOf(primitives, ["s-1", "s-2"]).canCreateAngularAnnotation).toBe(false)
    expect(viewOf(primitives, ["s-1", "s-2", "s-3"]).canCreateAngularAnnotation).toBe(true)
    expect(viewOf(primitives, ["e-1"]).canCreateLinearAnnotation).toBe(true)
    expect(viewOf(primitives, ["e-1", "e-2"]).canCreateAngularAnnotation).toBe(true)
    /**
     * 一个空间点 + 一条空间棱：两个计数**各自独立**，不要求"选中里只能有一种来源"。
     * 所以线性标注**可用**（那条棱自己就够：`edge3 === 1`），角标注不可用（要 3 个点或 2 条棱）。
     */
    const mixed = viewOf(primitives, ["s-1", "e-1"])
    expect(mixed.canCreateLinearAnnotation).toBe(true)
    expect(mixed.canCreateAngularAnnotation).toBe(false)
    expect(mixed.cadAnnotationSources).toEqual(["s-1", "e-1"])
    expect(mixed.cadPoint3SourceCount).toBe(1)
    expect(mixed.cadEdge3SourceCount).toBe(1)
    /** 平面点不算标注来源。 */
    expect(viewOf(primitives, ["p-1"]).cadAnnotationSources).toEqual([])
  })

  it("anchors a rotation on one point plus one closed curve, and refuses a locked curve", () => {
    const primitives = [point("p-1"), point("p-2"), circle("k-1"), ellipse("k-2"), { ...circle("k-3"), locked: true } as PrimitiveSpec]

    const anchored = viewOf(primitives, ["p-1", "k-1"])
    expect(anchored.rotationAnchor?.point.id).toBe("p-1")
    expect(anchored.rotationAnchor?.curve.id).toBe("k-1")
    expect(anchored.canAnchorRotation).toBe(true)

    expect(viewOf(primitives, ["p-1", "k-2"]).canAnchorRotation).toBe(true)
    /** 顺序无所谓：先点曲线、后点点，一样成立。 */
    expect(viewOf(primitives, ["k-1", "p-1"]).canAnchorRotation).toBe(true)

    /** 锁定的曲线不能当定点旋转的锚（"不允许改它就别说能绕它转"）。 */
    expect(viewOf(primitives, ["p-1", "k-3"]).rotationAnchor?.curve.id).toBe("k-3")
    expect(viewOf(primitives, ["p-1", "k-3"]).canAnchorRotation).toBe(false)

    expect(viewOf(primitives, ["p-1", "p-2"]).rotationAnchor).toBeNull()
    expect(viewOf(primitives, ["k-1"]).rotationAnchor).toBeNull()
  })

  it("explains why the active layer blocks drafting, and says nothing when it does not", () => {
    const layers = [layer("L-1"), layer("L-2", { visible: false }), layer("L-3", { locked: true })]
    const withLayers = (activeLayerId: string) => viewOf([point("p-1")], [], { layers, activeLayerId })

    expect(withLayers("L-1").cadActiveLayerBlockedReason).toBeNull()
    expect(withLayers("L-2").cadActiveLayerBlockedReason).toContain("已隐藏")
    expect(withLayers("L-3").cadActiveLayerBlockedReason).toContain("已锁定")
    /** 没有活动图层（网页版的平面几何就是这样）：不是"被挡住"，只是没有图层可言。 */
    expect(viewOf([point("p-1")], []).cadActiveLayer).toBeNull()
    expect(viewOf([point("p-1")], []).cadActiveLayerBlockedReason).toBeNull()
  })
})
