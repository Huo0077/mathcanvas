import type { Dispatch, SetStateAction } from "react"

import type { GeometryDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import type { CadMode } from "./components/EngineeringWorkbench"
import type { CreationMode, CreationStep } from "./draftingCommands"
import type { ProjectedDrawing } from "./projectionVisuals"

/**
 * **功能区与 CAD 命令的分发**（从 `App.tsx` 搬出来的两张 switch 表，评审方案 2）。
 *
 * 它是"用户按了一个命令按钮"到"哪个 handler 真的去做"之间那一段。搬出来之前，
 * 它与二十来个闭包 handler 一起挤在组件体里、**只能靠点界面来验**；现在它是一张纯表：
 * 给一个 commandId 与一组替身 handler，就能直接问"这一步该谁做、不该谁做"。
 *
 * ## 三个口径（都是搬动时逐字保留下来的）
 *
 * 1. **CAD 工作区里"能不能新建"先看活动图层**：锁定或隐藏时**只提示不创建**，
 *    而提示走状态栏（`setLayerNotice`），不是弹一条不知道怎么做的报错。
 * 2. **`runRibbonCommand` 在 CAD 工作区**直接转给 `runCadCommand` —— 也就是说
 *    两边的命令 id 有意共用一张表，改其中一个的语义要同时想另一个。
 * 3. **`handleCadModeChange` 要清干净**（创建步骤 / 活动命令 / 图层提示）：换了模式还留着上一步的
 *    半成品状态，用户点画布的那一下会落在旧模式的语义上。
 *
 * deps 一律是"handler 与 setter 本身"，这个模块**不认识 store，也不认识 React** ——
 * 所以它没有任何副作用来源，测起来就是喂替身。
 */
export interface CommandDispatchDeps {
  document: GeometryDocument
  selectedIds: string[]
  cadMode: CadMode
  /** 活动图层不可用时的那句话（`null` = 可以创建）。 */
  cadActiveLayerBlockedReason: string | null
  /** 只读它的 `primitives[].sourceId`（"选中所有投影来源"那一条命令）。 */
  engineeringDrawings: ProjectedDrawing[]
  apply: (operation: DomainOperation) => void
  setActiveCommand: Dispatch<SetStateAction<string | null>>
  setLayerNotice: Dispatch<SetStateAction<string | null>>
  setCreationStep: Dispatch<SetStateAction<CreationStep | null>>
  setSelectedIds: Dispatch<SetStateAction<string[]>>
  setShowProjectionDiagnostics: Dispatch<SetStateAction<boolean>>
  setCadMode: Dispatch<SetStateAction<CadMode>>
  addPoint3: () => void
  addLine3: () => void
  addPlane3: () => void
  addFace3: () => void
  addCircle3Track: () => void
  addPoint: () => void
  startCreation: (mode: Exclude<CreationMode, null>) => void
  deleteSelected: () => void
  toggleLock: () => void
  createGroup: () => void
  addEngineeringAnnotation: (kind: "linear" | "angular" | "tolerance") => void
  addDefaultPrimitive: (kind: "parabola" | "ellipse" | "hyperbola" | "function") => void
  addDefaultCube: () => void
  addDefaultSolid: (kind: "pyramid" | "cylinder" | "cone") => void
  addTetrahedron: () => void
  addSection: () => void
  anchorRotation: () => void
  exportSvgFile: (format?: "svg" | "dxf" | "pdf") => void
  exportCsvFile: () => void
  exportPngFile: () => void
  save: () => void
}

export function createCommandDispatch({ document, selectedIds, cadMode, cadActiveLayerBlockedReason, engineeringDrawings, apply, setActiveCommand, setLayerNotice, setCreationStep, setSelectedIds, setShowProjectionDiagnostics, setCadMode, addPoint3, addLine3, addPlane3, addFace3, addCircle3Track, addPoint, startCreation, deleteSelected, toggleLock, createGroup, addEngineeringAnnotation, addDefaultPrimitive, addDefaultCube, addDefaultSolid, addTetrahedron, addSection, anchorRotation, exportSvgFile, exportCsvFile, exportPngFile, save }: CommandDispatchDeps) {
  const runCadCommand = (commandId: string) => {
    setActiveCommand(commandId)
    if (cadMode === "draft" && commandId.startsWith("create-") && cadActiveLayerBlockedReason) {
      setLayerNotice(cadActiveLayerBlockedReason)
      return
    }
    setLayerNotice(null)
    switch (commandId) {
      case "select-tool": setCreationStep(null); break
      case "select-all": setSelectedIds(document.primitives.map((primitive) => primitive.id)); break
      case "select-clear": setSelectedIds([]); break
      case "create-point3": addPoint3(); break
      case "create-line3": addLine3(); break
      case "create-plane3": addPlane3(); break
      case "create-face3": addFace3(); break
      case "create-circle3-track": addCircle3Track(); break
      case "create-point": addPoint(); break
      case "create-line": startCreation("line"); break
      case "create-segment": startCreation("segment"); break
      case "create-ray": startCreation("ray"); break
      case "create-polyline": startCreation("polyline"); break
      case "create-circle": startCreation("circle"); break
      case "create-arc": startCreation("arc"); break
      case "modify-delete": deleteSelected(); break
      case "modify-lock": toggleLock(); break
      case "modify-hide": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: false }); break
      case "modify-show": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: true }); break
      case "modify-group": createGroup(); break
      case "annotate-linear": addEngineeringAnnotation("linear"); break
      case "annotate-angular": addEngineeringAnnotation("angular"); break
      case "annotate-tolerance": addEngineeringAnnotation("tolerance"); break
      case "inspect-diagnostics": setShowProjectionDiagnostics((visible) => !visible); break
      case "inspect-sources": {
        const sourceIds = new Set<string>()
        for (const drawing of engineeringDrawings) for (const primitive of drawing.primitives) sourceIds.add(primitive.sourceId)
        setSelectedIds([...sourceIds])
        break
      }
      case "export-svg": void exportSvgFile("svg"); break
      case "export-dxf": void exportSvgFile("dxf"); break
      case "export-pdf": void exportSvgFile("pdf"); break
      case "export-csv": exportCsvFile(); break
      case "export-mgeo": save(); break
      default: break
    }
  }
  const runRibbonCommand = (commandId: string) => {
    setActiveCommand(commandId)
    if (document.workspace === "cad") {
      runCadCommand(commandId)
      return
    }
    switch (commandId) {
      case "select-tool": setCreationStep(null); break
      case "create-point3": addPoint3(); break
      case "create-line3": addLine3(); break
      case "create-plane3": addPlane3(); break
      case "create-face3": addFace3(); break
      case "create-circle3-track": addCircle3Track(); break
      case "create-point": addPoint(); break
      case "create-line": startCreation("line"); break
      case "create-segment": startCreation("segment"); break
      case "create-ray": startCreation("ray"); break
      case "create-polyline": startCreation("polyline"); break
      case "create-circle": startCreation("circle"); break
      case "create-arc": startCreation("arc"); break
      case "create-parabola": addDefaultPrimitive("parabola"); break
      case "create-ellipse": addDefaultPrimitive("ellipse"); break
      case "create-hyperbola": addDefaultPrimitive("hyperbola"); break
      case "create-function": addDefaultPrimitive("function"); break
      case "create-cube": addDefaultCube(); break
      case "create-pyramid": addDefaultSolid("pyramid"); break
      case "create-tetrahedron": addTetrahedron(); break
      case "create-cylinder": addDefaultSolid("cylinder"); break
      case "create-cone": addDefaultSolid("cone"); break
      case "create-section": addSection(); break
      case "modify-delete": deleteSelected(); break
      case "modify-lock": toggleLock(); break
      case "modify-anchor-rotation": anchorRotation(); break
      case "modify-hide": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: false }); break
      case "modify-show": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: true }); break
      case "modify-group": createGroup(); break
      case "export-svg": void exportSvgFile(); break
      case "export-csv": exportCsvFile(); break
      case "export-png": exportPngFile(); break
      case "export-mgeo": save(); break
      default: break
    }
  }
  const handleCadModeChange = (mode: CadMode) => {
    setCadMode(mode)
    setCreationStep(null)
    setActiveCommand(null)
    setLayerNotice(null)
  }
  return { runCadCommand, runRibbonCommand, handleCadModeChange }
}
