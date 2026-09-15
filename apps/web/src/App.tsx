import { useEffect, useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo, type AnnotationFeature, type ConstraintType, type DrawingSheetSpec, type EngineeringAnnotationKind, type Measurement3Metric, type PrimitiveSpec, type Workspace } from "@draw/dsl"
import { buildSolidTemplate, createMeasurement3 } from "@draw/geometry-kernel"
import { deletionTargets, sectionPlaneThroughSource, validatePatch } from "@draw/scene-graph"
import type { Alignment } from "@draw/scene-graph"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { CommandBar, type CommandCategory, type CommandCategoryId } from "./components/CommandBar"
import { ConstraintPanel } from "./components/ConstraintPanel"
import { DocumentTreePanel } from "./components/DocumentTreePanel"
import { DrawingSheetView } from "./components/DrawingSheetView"
import { DrawingTree } from "./components/DrawingTree"
import type { DrawingViewPatch } from "./components/DrawingViewport"
import { EngineeringDrawingView } from "./components/EngineeringDrawingView"
import { EngineeringInspector, type InspectorSource } from "./components/EngineeringInspector"
import { EngineeringWorkbench, type CadMode } from "./components/EngineeringWorkbench"
import type { InspectorTab } from "./components/InspectorTabs"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { LayerTree } from "./components/LayerTree"
import { PropertiesBar, type PropertiesBarProps } from "./components/PropertiesBar"
import { StatusBar } from "./components/StatusBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { ThreeSceneView } from "./threeScene"
import type { IntersectionPreview } from "./intersectionPreview"
import { loadActiveWorkspace, loadDraft, saveDraft } from "./persistence/draftStorage"
import { exportCsv, exportSvg } from "./persistence/exporters"
import { exportEngineeringDxf, exportEngineeringPdf, exportEngineeringSvg, selectExportableDrawings } from "./persistence/engineeringExporters"
import { defaultDraftView, drawingViewLabels, resolveProjectedDrawing } from "./projectionVisuals"
import { migrateLegacySolids } from "./solidTemplates"
import { point3ToolAvailability, point3ToolHint } from "./spatialTools"
import { useSceneStore } from "./store"

type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null
type CreationStep = { mode: Exclude<CreationMode, null>; center: { x: number; y: number } | null; start?: { x: number; y: number }; points?: { x: number; y: number }[] }
const engineeringDrawingViews = ["front", "top", "left", "axonometric"] as const

function nextPrimitiveId(document: ReturnType<typeof useSceneStore.getState>["document"], prefix: string): string {
  let index = 1
  while (document.primitives.some((primitive) => primitive.id === `${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function nextGroupId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.groups.some((group) => group.id === `group-${index}`)) index += 1
  return `group-${index}`
}

function nextAnnotationId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.annotations.some((annotation) => annotation.id === `annotation-${index}`)) index += 1
  return `annotation-${index}`
}

function nextEngineeringAnnotationId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.engineeringAnnotations?.some((annotation) => annotation.id === `engineering-annotation-${index}`)) index += 1
  return `engineering-annotation-${index}`
}

function nextMeasurementId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.measurements.some((measurement) => measurement.id === `measurement3-${index}`)) index += 1
  return `measurement3-${index}`
}

function nextConstraintId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.constraints.some((constraint) => constraint.id === `constraint3-${index}`)) index += 1
  return `constraint3-${index}`
}

function nextPointLabel(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  const usedLabels = new Set(document.primitives.filter((primitive) => primitive.type === "point").map((primitive) => primitive.label))
  for (let index = 0; index < 26; index += 1) {
    const label = `新点 ${String.fromCharCode(65 + index)}`
    if (!usedLabels.has(label)) return label
  }
  return `新点 ${document.primitives.filter((primitive) => primitive.type === "point").length + 1}`
}

function nextPoint3Label(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  const usedLabels = new Set(document.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => primitive.label))
  for (let index = 0; index < 26; index += 1) {
    const label = String.fromCharCode(65 + index)
    if (!usedLabels.has(label)) return label
  }
  return `P${document.primitives.filter((primitive) => primitive.type === "point3").length + 1}`
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}

export function App() {
  const document = useSceneStore((state) => state.document)
  const apply = useSceneStore((state) => state.apply)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const switchWorkspace = useSceneStore((state) => state.switchWorkspace)
  const replace = useSceneStore((state) => state.replace)
  const operationError = useSceneStore((state) => state.error)
  const treeTab = useSceneStore((state) => state.treeTab)
  const expandedIds = useSceneStore((state) => state.expandedIds)
  const filterQuery = useSceneStore((state) => state.filterQuery)
  const setTreeTab = useSceneStore((state) => state.setTreeTab)
  const toggleExpanded = useSceneStore((state) => state.toggleExpanded)
  const setExpandedIds = useSceneStore((state) => state.setExpandedIds)
  const setFilterQuery = useSceneStore((state) => state.setFilterQuery)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftLoadedRef = useRef(false)
  const skipNextDraftSaveRef = useRef(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creationStep, setCreationStep] = useState<CreationStep | null>(null)
  const [cadMode, setCadMode] = useState<CadMode>("projection")
  const [commandCategory, setCommandCategory] = useState<CommandCategoryId | null>(null)
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [showProjectionDiagnostics, setShowProjectionDiagnostics] = useState(false)
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [layerNotice, setLayerNotice] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("data")
  const selectedId = selectedIds.at(-1) ?? null
  const slope = document.parameters.slope
  const slopeLine = useMemo(() => document.primitives.find((primitive) => primitive.id === "line-slope"), [document.primitives])
  // Projection geometry is derived once per revision and shared by the four viewports and every exporter.
  const engineeringDrawings = useMemo(() => engineeringDrawingViews.map((view) => resolveProjectedDrawing(document, view)), [document])
  // Hidden sheet views are dropped from exports instead of being replaced with fabricated geometry.
  const exportableEngineeringDrawings = useMemo(() => selectExportableDrawings(engineeringDrawings, document.drawingViews ?? []), [engineeringDrawings, document.drawingViews])
  const cadDiagnosticCount = engineeringDrawings.reduce((total, drawing) => total + drawing.diagnostics.length, 0)

  const downloadBlob = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = globalThis.document.createElement("a")
    anchor.href = url
    anchor.download = `${document.metadata.name.replace(/\s+/g, "-")}.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const download = (content: string, type: string, extension: string) => downloadBlob(new Blob([content], { type }), extension)
  const reportFileError = (error: unknown, fallback: string) => setFileError(error instanceof Error ? error.message : fallback)
  const save = () => {
    try { download(encodeMgeo(document), "application/json", "mgeo"); setFileError(null) } catch (error) { reportFileError(error, "无法保存 .mgeo 文件") }
  }
  const exportSvgFile = async (format: "svg" | "dxf" | "pdf" = "svg") => {
    try {
      if (format === "pdf") {
        if (document.workspace !== "cad") return
        const content = await exportEngineeringPdf(exportableEngineeringDrawings)
        downloadBlob(new Blob([content.buffer as ArrayBuffer], { type: "application/pdf" }), "pdf")
        setFileError(null)
        return
      }
      if (format === "dxf") {
        if (document.workspace !== "cad") return
        download(exportEngineeringDxf(exportableEngineeringDrawings), "application/dxf", "dxf")
        setFileError(null)
        return
      }
      const content = document.workspace === "cad" ? exportEngineeringSvg(exportableEngineeringDrawings) : exportSvg(document)
      download(content, "image/svg+xml", "svg")
      setFileError(null)
    } catch (error) { reportFileError(error, "无法导出 SVG 文件") }
  }
  const exportCsvFile = () => {
    try { download(exportCsv(document), "text/csv;charset=utf-8", "csv"); setFileError(null) } catch (error) { reportFileError(error, "无法导出 CSV 文件") }
  }
  const exportPngFile = () => {
    try {
      const svgUrl = URL.createObjectURL(new Blob([exportSvg(document)], { type: "image/svg+xml" }))
      const image = new Image()
      image.onload = () => {
        const canvas = globalThis.document.createElement("canvas")
        canvas.width = 1600
        canvas.height = 760
        const context = canvas.getContext("2d")
        if (!context) { URL.revokeObjectURL(svgUrl); setFileError("当前浏览器不支持 PNG 导出"); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => { URL.revokeObjectURL(svgUrl); if (!blob) setFileError("无法生成 PNG 文件"); else { downloadBlob(blob, "png"); setFileError(null) } }, "image/png")
      }
      image.onerror = () => { URL.revokeObjectURL(svgUrl); setFileError("无法渲染 PNG 导出内容") }
      image.src = svgUrl
    } catch (error) { reportFileError(error, "无法导出 PNG 文件") }
  }
  const load = (serialized: string) => {
    try {
      replace(migrateLegacySolids(decodeMgeo(serialized)))
      setFileError(null)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "无法打开 .mgeo 文件")
    }
  }

  const creationMode: CreationMode = creationStep?.mode ?? null
  const startCreation = (mode: Exclude<CreationMode, null>) => {
    if (document.workspace === "geometry3d") {
      if (mode === "line") {
        if (canCreateLine3) addLine3()
        else setFileError("请先在代数区按住 Shift 依次点选 2 个空间点，再创建直线")
      }
      if (mode === "segment") {
        if (canCreatePlane3) addPlane3()
        else setFileError("请先按住 Shift 点选 3 个不共线的空间点，再创建平面")
      }
      if (mode === "ray" || mode === "polyline") {
        if (canCreateFace3) addFace3()
        else setFileError("请先按住 Shift 点选 3 个以上的空间点，再创建空间面")
      }
      return
    }
    setCreationStep({ mode, center: null })
  }
  /** New 2D objects join the active CAD layer so the layer tree can hide or lock them. */
  const cadLayerFields = (): { layerId?: string } => document.workspace === "cad" && document.activeLayerId ? { layerId: document.activeLayerId } : {}
  const handleCanvasClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep) return
    if (creationStep.mode === "polyline") {
      const points = creationStep.points ?? []
      if (!points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) >= 0.05) setCreationStep({ ...creationStep, points: [...points, coordinate] })
      return
    }
    if (!creationStep.center) {
      setCreationStep({ ...creationStep, center: coordinate })
      return
    }
    if (creationStep.mode === "line" || creationStep.mode === "segment" || creationStep.mode === "ray") {
      if (Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y) < 0.05) return
      const type = creationStep.mode
      const id = nextPrimitiveId(document, type)
      apply({ op: "addPrimitive", primitive: { id, type, a: creationStep.center, b: coordinate, ...cadLayerFields(), label: `${type === "line" ? "直线" : type === "ray" ? "射线" : "线段"} ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (creationStep.mode === "circle") {
      const radius = Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y)
      if (radius < 0.05) return
      const id = nextPrimitiveId(document, "circle")
      apply({ op: "addPrimitive", primitive: { id, type: "circle", center: creationStep.center, radius, ...cadLayerFields(), label: `圆 ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (!creationStep.start) {
      setCreationStep({ ...creationStep, start: coordinate })
      return
    }
    const radius = Math.hypot(creationStep.start.x - creationStep.center.x, creationStep.start.y - creationStep.center.y)
    if (radius < 0.05) return
    const startAngle = Math.atan2(creationStep.start.y - creationStep.center.y, creationStep.start.x - creationStep.center.x)
    const endAngle = Math.atan2(coordinate.y - creationStep.center.y, coordinate.x - creationStep.center.x)
    const id = nextPrimitiveId(document, "arc")
    apply({ op: "addPrimitive", primitive: { id, type: "arc", center: creationStep.center, radius, startAngle, endAngle, ...cadLayerFields(), label: `圆弧 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  const handleCanvasCreationClick = (coordinate: { x: number; y: number }) => {
    handleCanvasClick(coordinate)
  }
  const handleCanvasDoubleClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep || creationStep.mode !== "polyline") return
    const points = creationStep.points ?? []
    const finalPoints = !points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) < 0.05 ? points : [...points, coordinate]
    if (finalPoints.length < 2) return
    const id = nextPrimitiveId(document, "polyline")
    apply({ op: "addPrimitive", primitive: { id, type: "polyline", points: finalPoints, ...cadLayerFields(), label: `折线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    const workspace = loadActiveWorkspace()
    if (workspace && workspace !== document.workspace) switchWorkspace(workspace)
    const draft = loadDraft(workspace ?? document.workspace)
    if (draft) { skipNextDraftSaveRef.current = true; replace(migrateLegacySolids(draft)) }
  }, [document.workspace, replace, switchWorkspace])

  useEffect(() => {
    if (skipNextDraftSaveRef.current) { skipNextDraftSaveRef.current = false; return }
    try { saveDraft(document) } catch (error) { reportFileError(error, "无法自动保存草稿") }
  }, [document])

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
  }

  const selectedPrimitive = selectedId ? document.primitives.find((primitive) => primitive.id === selectedId) ?? null : null
  const intersectionTypes = ["point", "line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"] as const
  const selectedPointIds = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point")
  const selectedPoint3Ids = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3")
  const point3ToolState = point3ToolAvailability(selectedPoint3Ids.length, selectedIds.length)
  const canCreateLine3 = point3ToolState.line
  const canCreatePlane3 = point3ToolState.plane
  const canCreateFace3 = point3ToolState.face
  const canCreatePointConnection = (selectedIds.length === 2 || selectedIds.length === 3) && selectedPointIds.length === selectedIds.length
  const canCreateIntersection = canCreatePointConnection || (selectedIds.length === 2 && selectedIds.every((id) => intersectionTypes.includes(document.primitives.find((primitive) => primitive.id === id)?.type as typeof intersectionTypes[number])))
  const allSelectedLocked = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)
  const allSelectedVisible = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.visible !== false)
  const selectedGroup = document.groups.find((group) => group.members.length === selectedIds.length && group.members.every((id) => selectedIds.includes(id))) ?? null
  const updateSelection = (id: string | null, additive = false) => {
    setCreationStep(null)
    if (!id) {
      setSelectedIds([])
      return
    }
    setSelectedIds((current) => additive ? (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]) : [id])
  }
  const selectBox = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const contained = document.primitives.filter((primitive) => {
      if (primitive.type === "point") return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
      if (primitive.type === "line" || primitive.type === "segment") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "ray") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "polyline") return primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "circle" || primitive.type === "arc") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      if (primitive.type === "parabola") return primitive.vertex.x >= bounds.minX && primitive.vertex.x <= bounds.maxX && primitive.vertex.y >= bounds.minY && primitive.vertex.y <= bounds.maxY
      if (primitive.type === "ellipse" || primitive.type === "hyperbola") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      if (primitive.type === "function") return primitive.domain[0] >= bounds.minX && primitive.domain[1] <= bounds.maxX
      if (primitive.type === "derivative") return primitive.points.length > 0 && primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "tangent" || primitive.type === "normal") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "secant") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "integral") return primitive.points.length > 0 && primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "analysisSet") return primitive.results.length > 0 && primitive.results.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "cube" || primitive.type === "pyramid" || primitive.type === "cylinder" || primitive.type === "cone") return false
      if (primitive.type === "section") return false
      if (primitive.type === "connection") return false
      if (primitive.type === "locus") return false
      if (primitive.type === "intersectionSet") return false
      if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
      return false
    }).map((primitive) => primitive.id)
    setSelectedIds(contained)
  }
  const toggleLock = () => apply({ op: "setPrimitivesLocked", ids: selectedIds, locked: !allSelectedLocked })
  const createGroup = () => apply({ op: "createGroup", group: { id: nextGroupId(document), label: `分组 ${document.groups.length + 1}`, members: selectedIds } })
  const deleteGroup = () => selectedGroup && apply({ op: "deleteGroup", id: selectedGroup.id })
  const alignSelection = (alignment: Alignment) => apply({ op: "alignPrimitives", ids: selectedIds, alignment })
  const createIntersection = () => {
    if (!canCreateIntersection) return
    const [objectA, objectB] = selectedIds
    if (canCreatePointConnection) {
      const id = nextPrimitiveId(document, "connection")
      const isParabola = selectedIds.length === 3
      apply({ op: "addPrimitive", primitive: isParabola
        ? { id, type: "connection", kind: "parabola", startPointId: objectA, endPointId: objectB, control: { thirdPointId: selectedIds[2] }, label: `抛物线连接 ${id.split("-").at(-1)}` }
        : { id, type: "connection", kind: "segment", startPointId: objectA, endPointId: objectB, label: `连接 ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      return
    }
    const id = nextPrimitiveId(document, "intersectionSet")
    apply({ op: "addPrimitive", primitive: { id, type: "intersectionSet", objectA, objectB, points: [], label: `交点集合 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
  }

  const addDefaultCube = () => {
    const id = nextPrimitiveId(document, "cube")
    addSolidTemplate({ id, type: "cube", origin: { x: -2, y: -2, z: -1 }, size: { x: 4, y: 4, z: 2 }, label: `立方体 ${id.split("-").at(-1)}` })
  }
  const addDefaultSolid = (type: "pyramid" | "cylinder" | "cone") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "pyramid"
      ? { id, type, baseCenter: { x: -2, y: 0, z: -2 }, baseSize: { x: 4, y: 4 }, height: 4, label: `棱锥 ${id.split("-").at(-1)}` }
      : type === "cylinder"
        ? { id, type, center: { x: 3, y: 0, z: 0 }, radius: 1.5, height: 3, segments: 24, label: `圆柱 ${id.split("-").at(-1)}` }
        : { id, type, center: { x: -3, y: 0, z: 3 }, radius: 1.5, height: 3, segments: 24, label: `圆锥 ${id.split("-").at(-1)}` }
    addSolidTemplate(primitive)
  }
  const addSolidTemplate = (primitive: Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>) => {
    const result = buildSolidTemplate(primitive)
    if (result.diagnostics.length > 0) { setFileError(result.diagnostics.map((diagnostic) => diagnostic.message).join("；")); return }
    apply({ op: "addPrimitives", primitives: [primitive, ...result.primitives] })
    setSelectedIds([primitive.id])
  }
  const solidTypes = ["cube", "pyramid", "cylinder", "cone", "polyhedron3"] as const
  const canCreateSection = selectedPrimitive !== null && solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])
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
  }
  const createIntersectionFromPreview = (preview: IntersectionPreview) => {
    const first = document.primitives.find((primitive) => primitive.id === preview.objectA)
    const second = document.primitives.find((primitive) => primitive.id === preview.objectB)
    if (!first || !second) return
    const id = nextPrimitiveId(document, "intersection")
    const solutionIndex = Math.min(1, Math.max(0, Math.floor(preview.solutionIndex))) as 0 | 1
    const label = `交点 ${id.split("-").at(-1)}`
    let primitive: PrimitiveSpec
    if (first.type === "line" && second.type === "line") {
      primitive = { id, type: "intersection", lineA: first.id, lineB: second.id, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "line" && second.type === "circle") {
      primitive = { id, type: "lineCircleIntersection", lineId: first.id, circleId: second.id, solutionIndex, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "circle" && second.type === "line") {
      primitive = { id, type: "lineCircleIntersection", lineId: second.id, circleId: first.id, solutionIndex, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "circle" && second.type === "circle") {
      primitive = { id, type: "circleIntersection", circleA: first.id, circleB: second.id, solutionIndex, x: preview.point.x, y: preview.point.y, label }
    } else {
      primitive = { id, type: "curveIntersection", objectA: first.id, objectB: second.id, solutionIndex, x: preview.point.x, y: preview.point.y, label }
    }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
  }
  const addPoint = () => {
    if (document.workspace === "geometry3d") {
      addPoint3()
      return
    }
    const id = nextPrimitiveId(document, "point")
    apply({ op: "addPrimitive", primitive: { id, type: "point", x: 2, y: 1, ...cadLayerFields(), label: nextPointLabel(document) } })
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
  }
  function addLine3() {
    if (!canCreateLine3) return
    const id = nextPrimitiveId(document, "line3")
    apply({ op: "addPrimitive", primitive: { id, type: "line3", definition: { kind: "throughPoints", pointIds: selectedPoint3Ids as [string, string] }, label: `空间直线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
  }
  function addPlane3() {
    if (!canCreatePlane3) return
    const id = nextPrimitiveId(document, "plane3")
    apply({ op: "addPrimitive", primitive: { id, type: "plane3", definition: { kind: "throughPoints", pointIds: selectedPoint3Ids as [string, string, string] }, label: `空间平面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
  }
  function addFace3() {
    if (!canCreateFace3) return
    const id = nextPrimitiveId(document, "face3")
    apply({ op: "addPrimitive", primitive: { id, type: "face3", pointIds: [...selectedPoint3Ids], label: `空间面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
  }
  const addAnnotation = (feature: AnnotationFeature, index?: number, text?: string) => {
    if (!selectedPrimitive) return
    const id = nextAnnotationId(document)
    const annotationText = text?.trim() || `${selectedPrimitive.label ?? selectedPrimitive.id} · ${feature}${index !== undefined ? ` ${index + 1}` : ""}`
    apply({ op: "addAnnotation", annotation: { id, text: annotationText, anchor: { kind: "primitive", primitiveId: selectedPrimitive.id, feature, ...(index === undefined ? {} : { index }) }, offset: { x: 0.25, y: 0.25 }, visible: true } })
  }
  const addEngineeringAnnotation = (kind: EngineeringAnnotationKind) => {
    if (document.workspace !== "cad") return
    const sourceIds = selectedIds.filter((id) => {
      const primitive = document.primitives.find((candidate) => candidate.id === id)
      return primitive?.type === "point3" || primitive?.type === "edge3"
    })
    const pointCount = sourceIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3").length
    const edgeCount = sourceIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "edge3").length
    const validSources = kind === "angular"
      ? pointCount === 3 || edgeCount === 2
      : pointCount === 2 || edgeCount === 1
    if (!validSources) {
      setFileError(kind === "angular" ? "选择三个空间点或两条空间棱后再创建角度标注" : "选择两个空间点或一条空间棱后再创建尺寸标注")
      return
    }
    apply({ op: "addEngineeringAnnotation", annotation: { id: nextEngineeringAnnotationId(document), kind, sourceIds, view: "front", unit: kind === "angular" ? "deg" : "mm", ...(kind === "tolerance" ? { tolerance: { upper: 0.1, lower: 0.1 } } : {}), status: "valid", explanation: "" } })
    setFileError(null)
  }
  const addMeasurement = (metric: Measurement3Metric, dihedralKind?: "interior" | "exterior") => {
    if (document.workspace !== "geometry3d") return
    const id = nextMeasurementId(document)
    const measurement = createMeasurement3(id, metric, selectedIds, document.primitives, dihedralKind)
    if (measurement.status === "insufficient-data" || measurement.status === "degenerate") {
      setFileError(measurement.explanation)
      return
    }
    apply({ op: "addMeasurement", measurement })
    setFileError(null)
  }
  const addConstraint = (type: ConstraintType, targets: string[]) => {
    if (document.workspace !== "geometry3d") return
    const id = nextConstraintId(document)
    apply({ op: "addConstraint", constraint: { id, type, targets } })
    setFileError(null)
  }
  const deleteMeasurement = (id: string) => {
    const validation = validatePatch(document, { op: "deleteMeasurement", id })
    if (!validation.valid) {
      setFileError(validation.errors.join(", "))
      return
    }
    apply({ op: "deleteMeasurement", id })
    setFileError(null)
  }
  const handleDragEnd = (id: string, action: import("./interaction").DragAction) => {
    apply(action.kind === "translate" ? { op: "translatePrimitive", id, delta: action.delta } : { op: "updatePrimitive", id, patch: action.patch })
  }
  const deleteSelected = () => {
    if (!selectedIds.length) return
    const validations = selectedIds.map((id) => validatePatch(document, { op: "deleteObject", id }))
    const invalid = validations.find((validation) => !validation.valid)
    if (invalid && !invalid.valid) {
      setFileError(invalid.errors.join(", "))
      return
    }
    // A solid and its generated topology are one object, so a selection covering both must delete it once.
    const removed = new Set<string>()
    for (const id of [...selectedIds].reverse()) {
      if (removed.has(id)) continue
      for (const target of deletionTargets(document, id)) removed.add(target)
      apply({ op: "deleteObject", id })
    }
    setSelectedIds([])
    setFileError(null)
  }

  const nextLayerId = (): string => {
    let index = 1
    while (document.layers?.some((layer) => layer.id === `layer-${index}`)) index += 1
    return `layer-${index}`
  }
  const addLayer = (parentId?: string) => {
    const id = nextLayerId()
    const kind = document.layers?.find((layer) => layer.id === parentId)?.kind ?? "geometry"
    apply({ op: "addLayer", layer: { id, name: `图层 ${id.split("-").at(-1)}`, ...(parentId ? { parentId } : {}), kind, visible: true, locked: false, printable: true } })
    if (parentId && !expandedIds.includes(parentId)) setExpandedIds([...expandedIds, parentId])
  }
  const deleteLayer = (id: string) => {
    const fallback = document.layers?.find((layer) => layer.kind === "geometry" && layer.id !== id)?.id
    apply({ op: "deleteLayer", id, ...(fallback ? { reassignTo: fallback } : {}) })
  }

  /** The active layer must be visible and unlocked before a drafting command may commit new geometry. */
  const cadActiveLayer = (document.layers ?? []).find((layer) => layer.id === document.activeLayerId) ?? null
  const cadActiveLayerBlockedReason = cadActiveLayer?.visible === false
    ? `图层「${cadActiveLayer.name}」已隐藏，无法创建对象`
    : cadActiveLayer?.locked ? `图层「${cadActiveLayer.name}」已锁定，无法创建对象` : null

  const cadAnnotationSources = selectedIds.filter((id) => {    const primitive = document.primitives.find((candidate) => candidate.id === id)
    return primitive?.type === "point3" || primitive?.type === "edge3"
  })
  const cadPoint3SourceCount = cadAnnotationSources.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3").length
  const cadEdge3SourceCount = cadAnnotationSources.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "edge3").length
  const canCreateLinearAnnotation = cadPoint3SourceCount === 2 || cadEdge3SourceCount === 1
  const canCreateAngularAnnotation = cadPoint3SourceCount === 3 || cadEdge3SourceCount === 2

  const cadCreateCommands: CommandCategory["commands"] = cadMode === "draft"
    ? [
      { id: "create-point", label: "添加点", prompt: "在 2D 视口中点击创建点" },
      { id: "create-line", label: "添加直线", prompt: "点击起点和终点创建直线" },
      { id: "create-segment", label: "添加线段", prompt: "点击起点和终点创建线段" },
      { id: "create-ray", label: "添加射线", prompt: "点击起点和经过点创建射线" },
      { id: "create-polyline", label: "添加折线", prompt: "点击顶点，双击结束" },
      { id: "create-circle", label: "添加圆", prompt: "点击圆心和边缘" },
      { id: "create-arc", label: "添加圆弧", prompt: "点击圆心、起点和终点" }
    ]
    : [
      { id: "create-point3", label: "空间点", prompt: "添加一个用于建模的空间点" },
      { id: "create-line3", label: "空间直线", disabled: !canCreateLine3, disabledReason: "请先按住 Shift 依次点选 2 个空间点" },
      { id: "create-plane3", label: "空间平面", disabled: !canCreatePlane3, disabledReason: "请先按住 Shift 点选 3 个不共线的空间点" },
      { id: "create-face3", label: "空间面", disabled: !canCreateFace3, disabledReason: "请先按住 Shift 点选 3 个以上的空间点" }
    ]

  const cadCommandCategories: CommandCategory[] = [
    {
      id: "select",
      label: "选择",
      commands: [
        { id: "select-tool", label: "选择工具", prompt: "点击对象进行选择，Shift 加选" },
        { id: "select-all", label: "全选", prompt: "选中当前文档的全部对象" },
        { id: "select-clear", label: "清除选择", prompt: "清除当前选择" }
      ]
    },
    { id: "create", label: "创建", commands: cadCreateCommands },
    {
      id: "modify",
      label: "修改",
      commands: [
        { id: "modify-delete", label: "删除对象", disabled: selectedIds.length === 0, disabledReason: "请先选择要删除的对象" },
        { id: "modify-lock", label: allSelectedLocked ? "解锁对象" : "锁定对象", disabled: selectedIds.length === 0, disabledReason: "请先选择对象" },
        { id: "modify-hide", label: "隐藏对象", disabled: selectedIds.length === 0, disabledReason: "请先选择对象" },
        { id: "modify-show", label: "显示对象", disabled: selectedIds.length === 0, disabledReason: "请先选择对象" },
        { id: "modify-group", label: "创建分组", disabled: selectedIds.length === 0, disabledReason: "请先选择对象" }
      ]
    },
    {
      id: "annotate",
      label: "标注",
      commands: [
        { id: "annotate-linear", label: "线性尺寸", disabled: !canCreateLinearAnnotation, disabledReason: "请选择两个空间点或一条空间棱" },
        { id: "annotate-angular", label: "角度标注", disabled: !canCreateAngularAnnotation, disabledReason: "请选择三个空间点或两条空间棱" },
        { id: "annotate-tolerance", label: "公差标注", disabled: !canCreateLinearAnnotation, disabledReason: "请选择两个空间点或一条空间棱" }
      ]
    },
    {
      id: "inspect",
      label: "检查",
      commands: [
        { id: "inspect-diagnostics", label: showProjectionDiagnostics ? "隐藏投影诊断" : "投影诊断", prompt: "展开四个投影视图的诊断信息" },
        { id: "inspect-sources", label: "选择全部投影来源", prompt: "选中参与投影的全部空间对象" }
      ]
    },
    {
      id: "export",
      label: "导出",
      commands: [
        { id: "export-svg", label: "导出 SVG", prompt: "导出四个视图的矢量工程图" },
        { id: "export-dxf", label: "导出 DXF", prompt: "导出 AutoCAD DXF 文件" },
        { id: "export-pdf", label: "导出 PDF", prompt: "导出矢量 PDF 页面" },
        { id: "export-csv", label: "导出 CSV", prompt: "导出图元清单" },
        { id: "export-mgeo", label: "保存 .mgeo", prompt: "保存当前文档" }
      ]
    }
  ]

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
  const cancelCadCommand = () => {
    setCreationStep(null)
    setActiveCommand(null)
    setCommandCategory(null)
  }
  const backToCadCategories = () => {
    setActiveCommand(null)
    setCommandCategory(null)
  }
  const handleCadModeChange = (mode: CadMode) => {
    setCadMode(mode)
    setCreationStep(null)
    setActiveCommand(null)
    setCommandCategory(null)
    setLayerNotice(null)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreationStep(null)
        return
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0 && !isTextEditingTarget(event.target)) {
        event.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedIds, document, apply])

  const creationLabel = creationMode === "line" ? "直线" : creationMode === "segment" ? "线段" : creationMode === "ray" ? "射线" : creationMode === "polyline" ? "折线" : creationMode === "circle" ? "圆" : "圆弧"
  const creationHint = creationMode === "polyline" ? "点击添加顶点，双击结束" : creationMode === "line" || creationMode === "segment" || creationMode === "ray" ? (creationStep?.center ? "点击终点" : "点击起点") : creationStep?.mode === "arc" ? (creationStep.start ? "点击终点" : "点击起点") : creationStep?.center ? "点击边缘" : "点击圆心"

  const activeCommandPrompt = cadCommandCategories
    .flatMap((category) => category.commands)
    .find((command) => command.id === activeCommand)?.prompt ?? null
  const cadStatusPrompt = creationMode
    ? `${creationLabel}创建：${creationHint}`
    : activeCommandPrompt ?? (cadMode === "draft"
      ? "2D 绘图：在视口中创建对象，新对象写入当前图层。"
      : "工程制图根据当前文档的 3D 点、棱和面显示四个视图。")

  const algebraPanel = <AlgebraView primitives={document.primitives} measurements={document.measurements} workspace={document.workspace} selectedIds={selectedIds} filter={filterQuery} onSelect={updateSelection} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} />

  const planarCanvas = <GraphicsView document={document} selectedIds={selectedIds} creationMode={creationMode} onSelect={updateSelection} onBoxSelect={selectBox} onCanvasClick={handleCanvasCreationClick} onCanvasDoubleClick={handleCanvasDoubleClick} onDragEnd={handleDragEnd} onCreateIntersection={createIntersectionFromPreview} />

  const propertiesBarProps: PropertiesBarProps = { selectedPrimitive, selectedIds, selectedCount: selectedIds.length, selectedGroupId: selectedGroup?.id ?? null, allSelectedVisible, canCreateIntersection, onCreateGroup: createGroup, onDeleteGroup: deleteGroup, onCreateIntersection: createIntersection, onAlign: alignSelection, onToggleSelectedVisibility: () => selectedId && apply({ op: "toggleVisibility", id: selectedId, visible: selectedPrimitive?.visible === false }), onToggleSelectedLock: () => selectedId && apply({ op: "toggleLock", id: selectedId, locked: !selectedPrimitive?.locked }), onToggleBatchVisibility: () => apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: !allSelectedVisible }), onUpdatePrimitive: (patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch }), onAddAnnotation: addAnnotation, onAddEngineeringAnnotation: addEngineeringAnnotation, onCreateMeasurement: addMeasurement, onCreateConstraint: addConstraint, onDeleteMeasurement: deleteMeasurement, value: slope?.value ?? 0.5, min: slope?.min ?? 0.15, max: slope?.max ?? 0.85, step: slope?.step ?? 0.05, onChange: (value) => apply({ op: "setParameter", id: "slope", value }) }

  const propertiesPanel = <PropertiesBar {...propertiesBarProps} />

  const inspectorPanel = <aside className="panel right">{propertiesPanel}<AgentDock /></aside>


  const layers = document.layers ?? []
  const drawingViews = document.drawingViews ?? []
  const drawingSheets = document.drawingSheets ?? []
  const currentSheet = drawingSheets.find((sheet) => sheet.id === (activeSheetId ?? document.activeSheetId)) ?? drawingSheets[0] ?? null
  const fallbackSheet: DrawingSheetSpec = { id: "sheet-1", name: "工程图纸", paper: "A4", orientation: "landscape", scale: 1, viewIds: [] }
  const sheetForCanvas = currentSheet ?? fallbackSheet
  const draftViewSpec = defaultDraftView(currentSheet, drawingViews)
  const activeLayerName = cadActiveLayer?.name ?? "几何"
  const activeSheetScale = currentSheet?.scale ?? 1
  const sourceLabels = Object.fromEntries(document.primitives.map((primitive) => [primitive.id, primitive.label ?? primitive.id]))

  // Sources referenced by engineering annotations and drawing views; deleted ones stay visible as diagnostics.
  const cadInspectorSources: InspectorSource[] = useMemo(() => {
    const ids = new Set<string>()
    for (const annotation of document.engineeringAnnotations ?? []) for (const id of annotation.sourceIds) ids.add(id)
    for (const view of document.drawingViews ?? []) for (const id of view.sourceIds ?? []) ids.add(id)
    return [...ids].map((id) => {
      const primitive = document.primitives.find((candidate) => candidate.id === id)
      return { id, label: primitive?.label ?? id, missing: !primitive }
    })
  }, [document])

  const activeViewLabel = activeViewId ? drawingViewLabels[drawingViews.find((view) => view.id === activeViewId)?.kind ?? "front"] : null
  const cadInspector = <EngineeringInspector
    activeTab={inspectorTab}
    onTabChange={setInspectorTab}
    context={{
      sheetName: sheetForCanvas.name,
      viewName: activeViewLabel,
      layerName: activeLayerName,
      layerVisible: cadActiveLayer?.visible !== false,
      layerLocked: Boolean(cadActiveLayer?.locked),
      commandPrompt: cadStatusPrompt,
      unit: "mm",
      selectedLayerName: selectedPrimitive?.layerId ? layers.find((layer) => layer.id === selectedPrimitive.layerId)?.name ?? selectedPrimitive.layerId : null
    }}
    sources={cadInspectorSources}
    constraints={<ConstraintPanel constraints={document.constraints} primitives={document.primitives} error={operationError?.includes("constraint") ? operationError : null} onDelete={(id) => apply({ op: "deleteConstraint", id })} onDeleteMany={(ids) => ids.forEach((id) => apply({ op: "deleteConstraint", id }))} />}
    properties={propertiesBarProps}
  />

  const documentTreePanel = <DocumentTreePanel
    activeTab={treeTab}
    onTabChange={setTreeTab}
    filter={filterQuery}
    onFilterChange={setFilterQuery}
    model={algebraPanel}
    layers={<LayerTree layers={layers} activeLayerId={document.activeLayerId ?? null} expandedIds={expandedIds} filter={filterQuery} onToggleExpanded={toggleExpanded} onActivate={(id) => apply({ op: "setActiveLayer", id })} onToggleVisibility={(id, visible) => apply({ op: "updateLayer", id, patch: { visible } })} onToggleLocked={(id, locked) => apply({ op: "updateLayer", id, patch: { locked } })} onAdd={addLayer} onDelete={deleteLayer} />}
    drawings={<DrawingTree sheets={drawingSheets} views={drawingViews} activeSheetId={currentSheet?.id ?? null} activeViewId={activeViewId} expandedIds={expandedIds} filter={filterQuery} sourceLabels={sourceLabels} onToggleExpanded={toggleExpanded} onSelectSheet={setActiveSheetId} onSelectView={setActiveViewId} onToggleView={(id, visible) => apply({ op: "updateDrawingView", id, patch: { visible } })} />}
  />

  const handleViewLayoutChange = (viewId: string, patch: DrawingViewPatch) => apply({ op: "updateDrawingView", id: viewId, patch })

  const cadCanvas = <>
    {cadMode === "draft"
      ? <DrawingSheetView
        sheet={sheetForCanvas}
        views={[draftViewSpec]}
        document={document}
        selectedIds={selectedIds}
        mode="draft"
        activeViewId={draftViewSpec.id}
        ariaLabel="二维绘图视图"
        onSelect={updateSelection}
        onViewSelect={setActiveViewId}
        onViewLayoutChange={handleViewLayoutChange}
        onCreateAt={handleCanvasCreationClick}
      />
      : <EngineeringDrawingView document={document} selectedIds={selectedIds} activeViewId={activeViewId} onSelect={updateSelection} onViewSelect={setActiveViewId} onViewLayoutChange={handleViewLayoutChange} />}
    {showProjectionDiagnostics && <details className="engineering-drawing-diagnostics workbench-diagnostics" open><summary>投影诊断 {cadDiagnosticCount} 条</summary>{cadDiagnosticCount > 0 ? <ul>{engineeringDrawings.flatMap((drawing) => drawing.diagnostics).map((diagnostic, index) => <li key={`${index}-${diagnostic}`}>{diagnostic}</li>)}</ul> : <p role="status">当前四个投影视图没有诊断信息。</p>}</details>}
  </>

  const cadWorkbench = <EngineeringWorkbench
    document={document}
    mode={cadMode}
    onModeChange={handleCadModeChange}
    commandBar={<CommandBar categories={cadCommandCategories} activeCategory={commandCategory} activeCommand={activeCommand} onCategoryChange={setCommandCategory} onCommandChange={runCadCommand} onBack={backToCadCategories} onCancel={cancelCadCommand} />}
    leftDock={documentTreePanel}
    canvas={cadCanvas}
    inspector={<>{cadInspector}<AgentDock showConstraints={false} /></>}
    statusBar={<StatusBar commandPrompt={cadStatusPrompt} activeLayerName={activeLayerName} unit="mm" scale={activeSheetScale} diagnosticCount={cadDiagnosticCount} notice={layerNotice} />}
  />

  return <div className="app-shell"><WorkspaceHeader activeWorkspace={document.workspace} onWorkspaceChange={(workspace: Workspace) => { setSelectedIds([]); setCreationStep(null); setCommandCategory(null); setActiveCommand(null); switchWorkspace(workspace) }} onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} />{document.workspace === "cad" ? cadWorkbench : <div className="workbench"><GeometryToolbar workspace={document.workspace} canCreateSection={canCreateSection} hasSelection={selectedIds.length > 0} allSelectedLocked={allSelectedLocked} creationMode={creationMode} onSelectTool={() => setCreationStep(null)} onDelete={deleteSelected} onToggleLock={toggleLock} onExportSvg={exportSvgFile} onExportCsv={exportCsvFile} onExportPng={exportPngFile} onAddPoint={addPoint} onAddLine={() => startCreation("line")} onAddSegment={() => startCreation("segment")} onAddRay={() => startCreation("ray")} onAddPolyline={() => startCreation("polyline")} onAddCircle={() => startCreation("circle")} onAddArc={() => startCreation("arc")} onAddParabola={() => addDefaultPrimitive("parabola")} onAddEllipse={() => addDefaultPrimitive("ellipse")} onAddHyperbola={() => addDefaultPrimitive("hyperbola")} onAddFunction={() => addDefaultPrimitive("function")} onAddCube={addDefaultCube} onAddPyramid={() => addDefaultSolid("pyramid")} onAddCylinder={() => addDefaultSolid("cylinder")} onAddCone={() => addDefaultSolid("cone")} onAddSection={addSection} point3ToolHint={point3ToolHint(selectedPoint3Ids.length, selectedIds.length)} />{algebraPanel}{document.workspace === "geometry3d" ? <ThreeSceneView document={document} selectedIds={selectedIds} onSelect={updateSelection} /> : planarCanvas}{inspectorPanel}<div className="footer-note">revision {document.revision} · 工作区：{document.workspace} · 草稿自动保存 · {creationMode ? `${creationLabel}创建：${creationHint}` : slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div>}{(fileError || operationError) && <div role="alert" className="footer-note">{fileError ?? operationError}</div>}<input ref={fileInputRef} hidden aria-label="加载 .mgeo 文件" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} /></div>
}