import { useEffect, useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo, type AnnotationFeature, type PrimitiveSpec, type Workspace } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { validatePatch } from "@draw/scene-graph"
import type { Alignment } from "@draw/scene-graph"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { PropertiesBar } from "./components/PropertiesBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { ThreeSceneView } from "./threeScene"
import type { IntersectionPreview } from "./intersectionPreview"
import { loadActiveWorkspace, loadDraft, saveDraft } from "./persistence/draftStorage"
import { exportCsv, exportSvg } from "./persistence/exporters"
import { migrateLegacySolids } from "./solidTemplates"
import { useSceneStore } from "./store"

type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null
type CreationStep = { mode: Exclude<CreationMode, null>; center: { x: number; y: number } | null; start?: { x: number; y: number }; points?: { x: number; y: number }[] }

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftLoadedRef = useRef(false)
  const skipNextDraftSaveRef = useRef(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creationStep, setCreationStep] = useState<CreationStep | null>(null)
  const selectedId = selectedIds.at(-1) ?? null
  const slope = document.parameters.slope
  const slopeLine = useMemo(() => document.primitives.find((primitive) => primitive.id === "line-slope"), [document.primitives])

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
  const exportSvgFile = () => {
    try { download(exportSvg(document), "image/svg+xml", "svg"); setFileError(null) } catch (error) { reportFileError(error, "无法导出 SVG 文件") }
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
        else setFileError("请先选择两个空间点创建直线")
      }
      if (mode === "segment") {
        if (canCreatePlane3) addPlane3()
        else setFileError("请先选择三个空间点创建平面")
      }
      if (mode === "ray" || mode === "polyline") {
        if (canCreateFace3) addFace3()
        else setFileError("请先选择三个或更多空间点创建空间面")
      }
      return
    }
    setCreationStep({ mode, center: null })
  }
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
      apply({ op: "addPrimitive", primitive: { id, type, a: creationStep.center, b: coordinate, label: `${type === "line" ? "直线" : type === "ray" ? "射线" : "线段"} ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (creationStep.mode === "circle") {
      const radius = Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y)
      if (radius < 0.05) return
      const id = nextPrimitiveId(document, "circle")
      apply({ op: "addPrimitive", primitive: { id, type: "circle", center: creationStep.center, radius, label: `圆 ${id.split("-").at(-1)}` } })
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
    apply({ op: "addPrimitive", primitive: { id, type: "arc", center: creationStep.center, radius, startAngle, endAngle, label: `圆弧 ${id.split("-").at(-1)}` } })
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
    apply({ op: "addPrimitive", primitive: { id, type: "polyline", points: finalPoints, label: `折线 ${id.split("-").at(-1)}` } })
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
  const canCreateLine3 = selectedPoint3Ids.length === 2 && selectedPoint3Ids.length === selectedIds.length
  const canCreatePlane3 = selectedPoint3Ids.length === 3 && selectedPoint3Ids.length === selectedIds.length
  const canCreateFace3 = selectedPoint3Ids.length >= 3 && selectedPoint3Ids.length === selectedIds.length
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
  const solidTypes = ["cube", "pyramid", "cylinder", "cone"] as const
  const canCreateSection = selectedPrimitive !== null && solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])
  const addSection = () => {
    if (!selectedPrimitive || !solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])) return
    const id = nextPrimitiveId(document, "section")
    apply({ op: "addPrimitive", primitive: { id, type: "section", sourceId: selectedPrimitive.id, plane: { normal: { x: 0, y: 1, z: 0 }, constant: -1.5 }, points: [], status: "undefined", label: `截面 ${id.split("-").at(-1)}` } })
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
    apply({ op: "addPrimitive", primitive: { id, type: "point", x: 2, y: 1, label: nextPointLabel(document) } })
  }
  function addPoint3() {
    const pointCount = document.primitives.filter((primitive) => primitive.type === "point3").length
    const id = nextPrimitiveId(document, "point3")
    const position = { x: (pointCount % 3) * 2, y: Math.floor(pointCount / 3) * 2, z: 0 }
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
    for (const id of [...selectedIds].reverse()) apply({ op: "deleteObject", id })
    setSelectedIds([])
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

  return <div className="app-shell"><WorkspaceHeader activeWorkspace={document.workspace} onWorkspaceChange={(workspace: Workspace) => { setSelectedIds([]); setCreationStep(null); switchWorkspace(workspace) }} /><div className="workbench"><GeometryToolbar workspace={document.workspace} canCreateSection={canCreateSection} hasSelection={selectedIds.length > 0} allSelectedLocked={allSelectedLocked} creationMode={creationMode} onSelectTool={() => setCreationStep(null)} onDelete={deleteSelected} onToggleLock={toggleLock} onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} onExportSvg={exportSvgFile} onExportCsv={exportCsvFile} onExportPng={exportPngFile} onAddPoint={addPoint} onAddLine={() => startCreation("line")} onAddSegment={() => startCreation("segment")} onAddRay={() => startCreation("ray")} onAddPolyline={() => startCreation("polyline")} onAddCircle={() => startCreation("circle")} onAddArc={() => startCreation("arc")} onAddParabola={() => addDefaultPrimitive("parabola")} onAddEllipse={() => addDefaultPrimitive("ellipse")} onAddHyperbola={() => addDefaultPrimitive("hyperbola")} onAddFunction={() => addDefaultPrimitive("function")} onAddCube={addDefaultCube} onAddPyramid={() => addDefaultSolid("pyramid")} onAddCylinder={() => addDefaultSolid("cylinder")} onAddCone={() => addDefaultSolid("cone")} onAddSection={addSection} /><AlgebraView primitives={document.primitives} selectedIds={selectedIds} onSelect={updateSelection} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} />{document.workspace === "geometry3d" ? <ThreeSceneView document={document} selectedIds={selectedIds} onSelect={updateSelection} /> : <GraphicsView document={document} selectedIds={selectedIds} creationMode={creationMode} onSelect={updateSelection} onBoxSelect={selectBox} onCanvasClick={handleCanvasCreationClick} onCanvasDoubleClick={handleCanvasDoubleClick} onDragEnd={handleDragEnd} onCreateIntersection={createIntersectionFromPreview} />}<aside className="panel right"><PropertiesBar selectedPrimitive={selectedPrimitive} selectedCount={selectedIds.length} selectedGroupId={selectedGroup?.id ?? null} allSelectedVisible={allSelectedVisible} canCreateIntersection={canCreateIntersection} onCreateGroup={createGroup} onDeleteGroup={deleteGroup} onCreateIntersection={createIntersection} onAlign={alignSelection} onToggleSelectedVisibility={() => selectedId && apply({ op: "toggleVisibility", id: selectedId, visible: selectedPrimitive?.visible === false })} onToggleSelectedLock={() => selectedId && apply({ op: "toggleLock", id: selectedId, locked: !selectedPrimitive?.locked })} onToggleBatchVisibility={() => apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: !allSelectedVisible })} onUpdatePrimitive={(patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch })} onAddAnnotation={addAnnotation} value={slope?.value ?? 0.5} min={slope?.min ?? 0.15} max={slope?.max ?? 0.85} step={slope?.step ?? 0.05} onChange={(value) => apply({ op: "setParameter", id: "slope", value })} /><AgentDock /></aside><div className="footer-note">revision {document.revision} · 工作区：{document.workspace} · 草稿自动保存 · {creationMode ? `${creationLabel}创建：${creationHint}` : slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div>{(fileError || operationError) && <div role="alert" className="footer-note">{fileError ?? operationError}</div>}<input ref={fileInputRef} hidden aria-label="加载 .mgeo 文件" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} /></div>
}
