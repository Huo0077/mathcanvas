import type { ConstraintType, Measurement3Metric, Workspace } from "@draw/dsl"

/**
 * 画布左下角的小指引：每点一个功能键就说明「这一步要做什么/刚做了什么」。
 *
 * 这些文案是产品语气的一部分，所以放在纯函数里：没有 DOM 依赖、可以被测试逐条钉住长度，也不会因为
 * 组件重渲染而变。键位提示（Esc / Alt / Shift）必须写清楚，二面角这类功能的卡点几乎都在键位上。
 */
export type PlanarCreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc"

export type GuidanceAction =
  | { kind: "point"; workspace: Workspace }
  | { kind: "creation"; mode: PlanarCreationMode }
  | { kind: "conic"; type: "parabola" | "ellipse" | "hyperbola" }
  | { kind: "function" }
  | { kind: "functionAnalysis"; analysis: "derivative" | "tangent" | "integral" }
  | { kind: "solid"; solid: "cube" | "pyramid" | "cylinder" | "cone" }
  | { kind: "section" }
  | { kind: "selectSolid" }
  | { kind: "measurement"; metric: Measurement3Metric; outcome: "created" | "blocked"; dihedralKind?: "interior" | "exterior" }
  | { kind: "constraint"; type: ConstraintType; outcome?: "created" | "blocked" }
  | { kind: "point3Tool"; tool: "line" | "plane" | "face" | "circle"; outcome: "created" | "blocked"; point3Count?: number }

const creationGuidance: Record<PlanarCreationMode, string> = {
  line: "直线：先点起点，再点终点；按 Esc 取消",
  segment: "线段：先点起点，再点终点；按 Esc 取消",
  ray: "射线：先点起点，再点经过点；按 Esc 取消",
  polyline: "折线：依次点击各顶点，双击结束；按 Esc 取消",
  circle: "圆：先点圆心，再点边缘确定半径；按 Esc 取消",
  arc: "圆弧：依次点圆心 → 起点 → 终点；按 Esc 取消"
}

const conicGuidance: Record<"parabola" | "ellipse" | "hyperbola", string> = {
  parabola: "已创建抛物线：属性栏可改顶点、焦参数、轴向与旋转",
  ellipse: "已创建椭圆：属性栏可改中心、横纵半径与旋转",
  hyperbola: "已创建双曲线：属性栏可改中心、半径、轴向与旋转"
}

const functionAnalysisGuidance: Record<"derivative" | "tangent" | "integral", string> = {
  derivative: "已创建导函数：由来源函数数值求导，改公式后自动重算",
  tangent: "已创建切线：切点取定义域中点，属性栏可看斜率",
  integral: "已创建积分区域：属性栏显示面积，改定义域后重新积分"
}

const measurementCreatedGuidance: Record<Measurement3Metric, string> = {
  length: "长度已创建：结果显示在属性栏，来源点移动后自动重算",
  distance: "距离已创建：结果显示在属性栏，来源移动后自动重算",
  angle: "角度已创建：三点中中间点为顶点，属性栏显示角度值",
  area: "面积已创建：结果为数值近似，来源变化后自动重算",
  volume: "体积已创建：结果为数值近似，来源变化后自动重算",
  dihedral: "二面角已创建"
}

const measurementBlockedGuidance: Record<Measurement3Metric, string> = {
  length: "长度需要 1 条棱/直线，或 2 个空间点：先选中来源",
  distance: "距离需要 2 个空间点，或 1 点 + 1 线/平面",
  angle: "角度需要 2 条线，或 3 个空间点（中间点为顶点）",
  area: "面积需要 1 个面或空间圆，或 3 个以上空间点",
  volume: "体积需要 1 个实体：立方体、棱锥、圆柱、圆锥或多面体",
  dihedral: "二面角需要两个面：按住 Alt 点实体表面单独选面，Shift 加选第二个面"
}

const constraintGuidance: Record<ConstraintType, string> = {
  parallel: "平行需要选中 2 条空间直线或棱，先多选来源",
  perpendicular: "垂直需要选中 2 条空间直线或棱，先多选来源",
  pointOnLine: "点在线需要 1 个空间点 + 1 条直线或棱",
  pointOnPlane: "点在面需要 1 个空间点 + 1 个空间平面",
  collinear: "共线需要 3 个空间点",
  coplanar: "共面需要 4 个空间点",
  coincident: "重合需要两个共点的对象，先选中来源",
  fixedDistance: "固定距离需要 2 个空间点或 2 个实体"
}

const point3ToolName: Record<"line" | "plane" | "face" | "circle", string> = { line: "空间直线", plane: "空间平面", face: "空间面", circle: "圆轨道" }
const point3ToolRequirement: Record<"line" | "plane" | "face" | "circle", string> = { line: "2 个空间点", plane: "3 个空间点", face: "3 个以上空间点", circle: "1 至 3 个空间点" }

export function guidanceFor(action: GuidanceAction): string {
  switch (action.kind) {
    case "point":
      return action.workspace === "geometry3d"
        ? "空间点已添加：右侧改 x/y/z；Shift 多选后可创建直线、平面与面"
        : "点已添加：可拖动移动，右侧属性栏可改坐标与标签"
    case "creation":
      return creationGuidance[action.mode]
    case "conic":
      return conicGuidance[action.type]
    case "function":
      return "已添加函数：右侧可选常用预设（e^x、sin(x)）或直接改公式"
    case "functionAnalysis":
      return functionAnalysisGuidance[action.analysis]
    case "solid":
      return "模板实体：属性栏可改尺寸与三轴朝向；Alt 点棱面可单独选中"
    case "section":
      return "截面已创建：剖切面穿过实体中心，代数区可看分类与边界"
    case "selectSolid":
      return "点击棱或面默认选中整个实体；按住 Alt 点击可单独选中棱或面"
    case "measurement": {
      if (action.outcome === "blocked") return measurementBlockedGuidance[action.metric]
      if (action.metric !== "dihedral") return measurementCreatedGuidance[action.metric]
      return action.dihedralKind === "exterior"
        ? "二面角（外角）已创建：与内角互为补角；画布同时标出公共棱与角弧"
        : "二面角（内角）已创建：画布标出公共棱、角弧与法向量；再点外角比较补角"
    }
    case "constraint":
      return action.outcome === "blocked" ? constraintGuidance[action.type] : `已创建${guidanceLabelForConstraint(action.type)}约束：左侧列表显示残差与冲突原因`
    case "point3Tool": {
      const name = point3ToolName[action.tool]
      if (action.outcome === "created") return `已创建${name}：来源点移动后自动更新`
      const needed = point3ToolRequirement[action.tool]
      const current = action.point3Count ?? 0
      return `${name}需要 ${needed}，当前 ${current} 个：按住 Shift 依次点选`
    }
  }
}

function guidanceLabelForConstraint(type: ConstraintType): string {
  switch (type) {
    case "parallel": return "平行"
    case "perpendicular": return "垂直"
    case "pointOnLine": return "点在线"
    case "pointOnPlane": return "点在面"
    case "collinear": return "共线"
    case "coplanar": return "共面"
    case "coincident": return "重合"
    case "fixedDistance": return "固定距离"
  }
}
