/**
 * **"把选中的东西变成一个新图元"这一族命令**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 九条命令，两族：
 * - **平面**：默认圆锥曲线 / 函数（`addDefaultPrimitive`）、函数的导函数·切线·积分区域
 *   （`addFunctionAnalysis`）、曲线上作切线（`addCurveTangent`）、动点处作切线（`addPointTangent`）、
 *   以选中点为圆心作圆（`createCircleAtPoint`）；
 * - **立体**：四类模板的默认落点（`addDefaultCube` / `addDefaultSolid`）、正四面体（`addTetrahedron`），
 *   以及它们的共同出口 `addSolidTemplate`（**手工按钮与 Agent 动作走同一个构造器**，见那个函数的注释）。
 *
 * ## 为什么是它们（而不是随便一块）
 *
 * 这两族的依赖**恰好只有五样**：当前文档、`apply`、`setSelectedIds`、`setGuidance`、`setFileError`
 * （立体那几条要先问构造器有没有诊断，不通过就如实报错、不落盘）—— 与 `App` 里其余那些真正
 * 纠缠在一起的状态（创建步骤、CAD 命令模式、图层提示、Agent 运行）一点都不沾。
 * 所以这是一个**依赖面本身就干净**的缝，不是硬掰出来的：接口写成 `CreationCommandDeps` 之后，
 * "这族命令需要什么"是类型上看得见的五行。
 *
 * ## 为什么是工厂函数而不是 hook
 *
 * 它们本来就是**每次渲染重建的闭包**（原来就定义在组件体里），闭包里读的是当次渲染的 `document`。
 * 做成 `createCreationCommands(deps)` 保持这个语义**逐字不变**；做成 hook 反而要多一层
 * `useCallback` 依赖数组的坑，而这里没有任何"身份必须稳定"的消费者
 *（调用点只有命令分发与检查器回调）。
 *
 * ## 一处口径不变式
 *
 * **手工按钮与 Agent 动作走同一个构造器**（设计规格 §7.4）：本文件只负责"造出带占位几何的图元
 * 并交给 `apply`"，真正的几何由 `applyOperation` 在同一笔里重算 —— 与 Agent 那条路同源，
 * 不在这里各算一份（`addCurveTangent` 的注释里记着这条约定的来由）。
 */

import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { compileSolidTetrahedron, compileTemplateSolid, type DomainOperation } from "@draw/scene-graph"

import { defaultTangentAnchor, isTangentSource } from "./curveTangents"
import { nextPrimitiveId } from "./documentIds"
import { guidanceFor } from "./guidance"
import { ROUND_SOLID_SEGMENTS } from "./solidDefaults"

const DEFAULT_CENTERED_CIRCLE_RADIUS = 1.5

export interface CreationCommandDeps {
  document: GeometryDocument
  apply: (operation: DomainOperation) => void
  setSelectedIds: (ids: string[]) => void
  setGuidance: (guidance: string | null) => void
  /**
   * 手工造实体时会**先问构造器**（有没有诊断），不通过就如实报错、不落盘 —— 所以这一族命令
   * 需要一个"把失败原因说出来"的出口。它不是可选的：少了它，"构造器拒绝"会变成静默的空操作。
   */
  setFileError: (message: string | null) => void
}

export function createCreationCommands({ document, apply, setSelectedIds, setGuidance, setFileError }: CreationCommandDeps) {
  const addDefaultPrimitive = (type: "parabola" | "ellipse" | "hyperbola" | "function") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "parabola"
      ? { id, type, vertex: { x: 0, y: -1 }, focalParameter: 2, axis: "y" as const, label: `抛物线 ${id.split("-").at(-1)}` }
      : type === "ellipse"
        ? { id, type, center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2, label: `椭圆 ${id.split("-").at(-1)}` }
        : type === "hyperbola"
          ? { id, type, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" as const, label: `双曲线 ${id.split("-").at(-1)}` }
          : { id, type, expression: "x*x", domain: [-6, 6] as [number, number], samples: 128, label: `函数 ${id.split("-").at(-1)}` }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
    setGuidance(guidanceFor(type === "function" ? { kind: "function" } : { kind: "conic", type }))
  }

  /**
   * Calculus entry points for the planar workspace. The retired 微积分 workspace used to build these objects, but
   * the kernel and the DSL still model them; creating them from a selected function keeps the feature reachable
   * without restoring a whole workspace. `applyOperation` recomputes the derived geometry in the same patch.
   */
  const addFunctionAnalysis = (sourceId: string, kind: "derivative" | "tangent" | "integral") => {
    const source = document.primitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.id === sourceId && primitive.type === "function")
    if (!source) return
    const id = nextPrimitiveId(document, kind)
    const index = id.split("-").at(-1)
    const midpoint = (source.domain[0] + source.domain[1]) / 2
    const primitive: PrimitiveSpec = kind === "derivative"
      ? { id, type: "derivative", sourceId, order: 1, domain: [...source.domain], samples: source.samples ?? 128, points: [], status: "approximate", label: `导函数 ${index}` }
      : kind === "tangent"
        ? { id, type: "tangent", sourceId, x: midpoint, point: { x: midpoint, y: 0 }, slope: 0, a: { x: source.domain[0], y: 0 }, b: { x: source.domain[1], y: 0 }, status: "approximate", label: `切线 ${index}` }
        : { id, type: "integral", sourceId, domain: [...source.domain], steps: 256, points: [], area: null, status: "approximate", label: `积分区域 ${index}` }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "functionAnalysis", analysis: kind }))
  }
  /**
   * 在一条**曲线**上作切线（用户口径 1：「创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项
   * 是创建一条在这个曲线上的切线。曲线包括抛物线，双曲线，圆，椭圆」）。
   *
   * 切点落在曲线的**自然参数原点**上 —— 四条曲线的参数 0 都恰好是它们的一个顶点
   * （圆的右顶点、椭圆的长轴端点、双曲线的顶点、抛物线的顶点），因此这是"教科书上那条切线"。
   * 之后用户可以在右侧拖「切点参数」把它沿曲线滑到任意位置，或者改用「跟随动点」。
   *
   * 几何不在这里算：只写 `anchor` + 一个占位几何，重算会立刻把真正的切点与切向填进去
   * （与函数切线同一条路径，见 `addFunctionAnalysis`）。
   */
  const addCurveTangent = (sourceId: string) => {
    const source = document.primitives.find((primitive) => primitive.id === sourceId)
    if (!isTangentSource(source)) return
    const id = nextPrimitiveId(document, "tangent")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "tangent",
        sourceId,
        x: 0,
        point: { x: 0, y: 0 },
        slope: 0,
        a: { x: 0, y: 0 },
        b: { x: 0, y: 0 },
        status: "approximate",
        anchor: defaultTangentAnchor(),
        label: `切线 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "curveTangent", source: source.type }))
  }
  /**
   * 在**动点**处作切线（用户口径 2 的前半：「动点在轨道上能够在动点位置画切线，同时切线能根据动点位置
   * 进行动态变化」）。
   *
   * 定位写成 `{ kind: "point", pointId }` 而不是把当前参数抄下来：抄下来的是一次性的快照，
   * 动点再动切线就不跟了。写成引用之后，"点动 → 切线动"由依赖图保证（见 `primitiveDependencies`）。
   * 动点必须已经绑在一条曲线轨道上 —— 没有轨道就没有"在它那里作切线"这回事。
   */
  const addPointTangent = (pointId: string) => {
    const point = document.primitives.find((primitive) => primitive.id === pointId)
    // 收窄先落到局部常量上：`point.binding!.pathId` 这种写法过不了类型检查（`!` 不参与辨识联合的收窄）。
    const binding = point?.type === "point" ? point.binding : undefined
    if (point?.type !== "point" || binding?.kind !== "onPath") return
    const source = document.primitives.find((primitive) => primitive.id === binding.pathId)
    if (!isTangentSource(source)) return
    const id = nextPrimitiveId(document, "tangent")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "tangent",
        sourceId: source.id,
        x: point.x,
        point: { x: point.x, y: point.y },
        slope: 0,
        a: { x: point.x, y: point.y },
        b: { x: point.x, y: point.y },
        status: "approximate",
        anchor: { kind: "point", pointId },
        label: `切线 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "pointTangent", point: point.label ?? point.id }))
  }
  /**
   * 以选中的点为**圆心**作圆（用户口径 2 的后半：「第二动点能够作为圆心作圆，圆的半径能够调节，
   * 也能够根据动点位置进行动态变化」）。
   *
   * 只写 `centerPointId`，半径先给一个默认值 —— 「半径是否随动点走」是用户下一步的选择：
   * 想固定就在右侧改数字，想跟随就选一个驱动点（`radiusFrom`）。圆心一开始就摆在点上，
   * 所以第一帧起"圆心就是这个点"就成立。
   */
  const createCircleAtPoint = (pointId: string) => {
    const point = document.primitives.find((primitive) => primitive.id === pointId)
    if (point?.type !== "point") return
    const id = nextPrimitiveId(document, "circle")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "circle",
        center: { x: point.x, y: point.y },
        radius: DEFAULT_CENTERED_CIRCLE_RADIUS,
        centerPointId: point.id,
        label: `圆 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "circleAtPoint", point: point.label ?? point.id }))
  }

  /**
   * 四类模板的默认落点：**都坐在地面上**（底面 z = 0），并分在四个象限里**互不重叠**。
   *
   * 用户反馈："你的立体几何内容好像原点位置错了，图有点怪。" 量出来是四套互相矛盾的约定：
   * 立方体 / 棱锥"中心在原点"（一半埋在地面下）、圆柱躺在地面上、圆锥悬空 3 格；而且立方体与棱锥的
   * 水平足迹本来就相交（x ∈ [−2,0]），先后添加两个会直接穿在一起。现在统一成"实体放在桌上"：
   * 网格是地板，底面落在 z = 0 上，四个象限各一个（±5），原点正好落在它们中间。
   */
  const addDefaultCube = () => {
    const id = nextPrimitiveId(document, "cube")
    addSolidTemplate({ id, type: "cube", origin: { x: -7, y: 3, z: 0 }, size: { x: 4, y: 4, z: 2 }, label: `立方体 ${id.split("-").at(-1)}` })
  }
  const addDefaultSolid = (type: "pyramid" | "cylinder" | "cone") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "pyramid"
      ? { id, type, baseCenter: { x: 5, y: 5, z: 0 }, baseSize: { x: 4, y: 4 }, height: 4, label: `棱锥 ${id.split("-").at(-1)}` }
      : type === "cylinder"
        ? { id, type, center: { x: 5, y: -5, z: 0 }, radius: 1.5, height: 3, segments: ROUND_SOLID_SEGMENTS, label: `圆柱 ${id.split("-").at(-1)}` }
        : { id, type, center: { x: -5, y: -5, z: 0 }, radius: 1.5, height: 3, segments: ROUND_SOLID_SEGMENTS, label: `圆锥 ${id.split("-").at(-1)}` }
    addSolidTemplate(primitive)
  }
  /**
   * **正四面体**：手工入口（与四类模板并列的那个按钮）。
   *
   * 它**没有参数化图元** —— 文档里的样子就是一只 `polyhedron3`（`fromPoints`）+ 它的 4 点 / 6 棱 / 4 面，
   * 所以这里直接调动作层那个构造器（`compileSolidTetrahedron`），把 15 个图元**一次**落盘：
   * 一步撤销、整族一起走，而且与 Agent 那条路（`solid.create_tetrahedron`）产出**同一种东西**。
   *
   * 落点取**原点**：另外四个模板各占一个象限（±5），原点正空着（见上面那段"实体放在桌上"的口径）。
   */
  const addTetrahedron = () => {
    const id = nextPrimitiveId(document, "tetrahedron")
    const built = compileSolidTetrahedron(id, { baseCenter: { x: 0, y: 0, z: 0 }, edge: 4 }, `正四面体 ${id.split("-").at(-1)}`)
    if (built.diagnostics.length > 0) { setFileError(built.diagnostics.map((diagnostic) => diagnostic.message).join("；")); return }
    apply({ op: "addPrimitives", primitives: built.primitives })
    setSelectedIds([id])
  }
  const addSolidTemplate = (primitive: Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>) => {
    /**
     * **手工按钮与 Agent 动作走同一个构造器**（设计规格 §7.4："手工按钮调用相同编译器/DocumentService；
     * 不复制一份 Agent 专用语义"）。
     *
     * 这里以前直接调内核的 `buildSolidTemplate`，而 `solid.create_template` 走的是动作层另一条分支 ——
     * 于是 Agent 造出来的模板没有物化拓扑，渲染落到"直接画模板"的分支，而那条分支**不读 `rotation`**：
     * 用户把朝向从 0 改到 45°，文档值变了、画面不动
     *（现场见 `docs/project-progress.md` 的「Agent 造的实体改「朝向」画布不动」一节）。
     * 现在两边都从 `compileTemplateSolid` 拿结果，物化拓扑与子对象命名（`<id>-point-1` 一类）
     * 都只有一份定义，`operations.ts` 的 `syncTemplateTopology` 才能按 id 回填坐标。
     */
    const result = compileTemplateSolid(primitive.id, primitive)
    if (result.diagnostics.length > 0) { setFileError(result.diagnostics.map((diagnostic) => diagnostic.message).join("；")); return }
    apply({ op: "addPrimitives", primitives: [primitive, ...result.primitives] })
    setSelectedIds([primitive.id])
    setGuidance(guidanceFor({ kind: "solid", solid: primitive.type }))
  }

  /**
   * `addSolidTemplate` **不往外给**：它只是上面那几条默认落点命令的共同出口，
   * 对 `App` 没有独立用途（导出去只会多一个能被误用的入口）。
   */
  return { addDefaultPrimitive, addFunctionAnalysis, addCurveTangent, addPointTangent, createCircleAtPoint, addDefaultCube, addDefaultSolid, addTetrahedron }
}
