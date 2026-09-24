import type { Workspace } from "@draw/dsl"

import type { CadMode } from "./components/EngineeringWorkbench"
import type { RibbonGroup, RibbonIcon } from "./uiState"

export interface RibbonCommandContext {
  workspace: Workspace
  cadMode?: CadMode
  selectedCount: number
  allSelectedLocked: boolean
  canCreateSection: boolean
  canCreateLine3: boolean
  canCreatePlane3: boolean
  canCreateFace3: boolean
  canCreateCircle3: boolean
  canCreateLinearAnnotation: boolean
  canCreateAngularAnnotation: boolean
  /** 选中的是不是"一个点 + 一条圆/椭圆"——只有这种组合才谈得上把曲线定在过该点的旋转上。 */
  canAnchorRotation: boolean
  diagnosticVisible: boolean
}

function command(id: string, label: string, icon: RibbonIcon, options: { prompt?: string; disabled?: boolean; disabledReason?: string } = {}) {
  return { id, label, icon, ...options }
}

export function createRibbonGroups(context: RibbonCommandContext): RibbonGroup[] {
  const hasSelection = context.selectedCount > 0
  const allSelectedLocked = context.allSelectedLocked
  const selectionReason = "请先选择对象"
  const planar = context.workspace !== "geometry3d" && !(context.workspace === "cad" && context.cadMode === "projection")
  const baseCommands = planar
    ? [
      command("select-tool", "选择工具", "select", { prompt: "点击对象进行选择，Shift 加选" }),
      command("create-point", "添加点", "point", { prompt: "在空白处或交点单击以创建点" }),
      command("create-line", "添加直线", "line", { prompt: "点击直线的两个点" }),
      command("create-segment", "添加线段", "segment", { prompt: "依次点击线段的起点与终点" }),
      command("create-ray", "添加射线", "ray", { prompt: "依次点击射线的起点与经过点" }),
      command("create-polyline", "添加折线", "polyline", { prompt: "点击顶点，双击结束" }),
      command("create-circle", "添加圆", "circle", { prompt: "点击圆心，再点击圆周上的点" }),
      command("create-arc", "添加圆弧", "arc", { prompt: "点击圆心、起点和终点" }),
      command("create-parabola", "添加抛物线", "parabola", { prompt: "选择抛物线控制点" }),
      command("create-ellipse", "添加椭圆", "ellipse", { prompt: "选择椭圆中心和轴参数" }),
      command("create-hyperbola", "添加双曲线", "hyperbola", { prompt: "选择双曲线中心和轴参数" }),
      command("create-function", "添加函数", "function", { prompt: "在表达式栏输入公式后按回车" })
    ]
    : [
      command("select-tool", "选择工具", "select", { prompt: "点击对象进行选择，Shift 加选" }),
      command("create-point3", "添加空间点", "point", { prompt: "添加一个用于建模的空间点" }),
      command("create-line3", "由选中点创建空间直线", "line", { prompt: "按住 Shift 依次点选两个空间点", disabled: !context.canCreateLine3, disabledReason: "请先按住 Shift 依次点选 2 个空间点" }),
      command("create-plane3", "由选中点创建空间平面", "segment", { prompt: "按住 Shift 点选三个不共线空间点", disabled: !context.canCreatePlane3, disabledReason: "请先按住 Shift 点选 3 个不共线的空间点" }),
      command("create-face3", "由选中点创建空间面", "polyline", { prompt: "按住 Shift 点选三个以上空间点", disabled: !context.canCreateFace3, disabledReason: "请先按住 Shift 点选 3 个以上的空间点" }),
      /**
       * 圆轨道：选 1 个点建以它为圆心的水平圆、2 个点用第二点定半径、3 个点用三点平面定朝向。
       * 它同时是**动点的约束轨道**（绑定下拉里会出现"圆轨道"那一项）。
       */
      command("create-circle3-track", "添加空间圆轨道", "circle", { prompt: "按住 Shift 点选 1–3 个空间点", disabled: !context.canCreateCircle3, disabledReason: "请先按住 Shift 点选 1 至 3 个空间点" }),
      command("create-cube", "添加立方体", "line", { prompt: "添加参数化立方体" }),
      command("create-pyramid", "添加棱锥", "line", { prompt: "添加参数化棱锥" }),
      command("create-tetrahedron", "添加正四面体", "line", { prompt: "添加棱长为 4 的正四面体" }),
      command("create-cylinder", "添加圆柱", "circle", { prompt: "添加参数化圆柱" }),
      command("create-cone", "添加圆锥", "parabola", { prompt: "添加参数化圆锥" }),
      command("create-section", "创建截面", "polyline", { prompt: "创建当前选中实体的剖切截面", disabled: !context.canCreateSection, disabledReason: "请先选择可剖切的空间实体" })
    ]

  const engineeringCommands = context.workspace === "cad"
    ? [
      command("annotate-linear", "线性尺寸", "line", { disabled: !context.canCreateLinearAnnotation, disabledReason: "请选择两个空间点或一条空间棱" }),
      command("annotate-angular", "角度标注", "arc", { disabled: !context.canCreateAngularAnnotation, disabledReason: "请选择三个空间点或两条空间棱" }),
      command("annotate-tolerance", "公差标注", "segment", { disabled: !context.canCreateLinearAnnotation, disabledReason: "请选择两个空间点或一条空间棱" }),
      command("inspect-diagnostics", context.diagnosticVisible ? "隐藏投影诊断" : "投影诊断", "select", { prompt: "展开四个投影视图的诊断信息" }),
      command("inspect-sources", "选择全部投影来源", "point", { prompt: "选中参与投影的全部空间对象" })
    ]
    : []

  const editCommands = [
    command("modify-delete", "删除对象", "delete", { disabled: !hasSelection || allSelectedLocked, disabledReason: allSelectedLocked ? "选中的对象已锁定" : "请先选择要删除的对象" }),
    command("modify-lock", context.allSelectedLocked ? "解锁对象" : "锁定对象", "lock", { disabled: !hasSelection, disabledReason: selectionReason }),
    ...(planar ? [command("modify-anchor-rotation", "绕定点旋转", "rotate", {
      prompt: "先选一个点、再选一个圆或椭圆，曲线就定成绕这个定点旋转（转过任意角度都仍然过它）",
      disabled: !context.canAnchorRotation,
      disabledReason: "请同时选中一个点和一个圆 / 椭圆"
    })] : []),
    ...engineeringCommands
  ]

  const exportCommands = context.workspace === "cad"
    ? [
      command("export-svg", "导出 SVG", "svg", { prompt: "导出四个视图的矢量工程图" }),
      command("export-dxf", "导出 DXF", "csv", { prompt: "导出 AutoCAD DXF 文件" }),
      command("export-pdf", "导出 PDF", "png", { prompt: "导出矢量 PDF 页面" }),
      command("export-csv", "导出 CSV", "csv", { prompt: "导出图元清单" }),
      command("export-mgeo", "保存 .mgeo", "svg", { prompt: "保存当前文档" })
    ]
    : [
      command("export-svg", "导出 SVG", "svg", { prompt: "导出当前画布", disabled: context.workspace === "geometry3d", disabledReason: "立体几何暂不支持投影 SVG 导出" }),
      command("export-csv", "导出 CSV", "csv", { prompt: "导出图元清单" }),
      command("export-png", "导出 PNG", "png", { prompt: "导出当前画布图片", disabled: context.workspace === "geometry3d", disabledReason: "立体几何暂不支持投影 PNG 导出" }),
      command("export-mgeo", "保存 .mgeo", "svg", { prompt: "保存当前文档" })
    ]

  return [
    { id: "base", label: "基础与图元", commands: baseCommands },
    { id: "multimodal", label: "多模态输入", commands: [
      // 只保留项目真正规划的两个入口；转换后端尚未接入，所以入口保持禁用并说明原因，不做假的成功反馈。
      command("input-text-conversion", "文字转换", "text", { disabled: true, disabledReason: "文字转换服务尚未接入，暂不可用" }),
      command("input-image-conversion", "图片转换", "image", { disabled: true, disabledReason: "图片转换服务尚未接入，暂不可用" })
    ] },
    { id: "edit", label: "作业操作", commands: editCommands },
    { id: "export", label: "文件输出", commands: exportCommands }
  ]
}
