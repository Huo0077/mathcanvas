import type { MouseEvent as ReactMouseEvent } from "react"
import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"

const toX = (x: number) => 40 + ((x + 10) / 20) * 720
const toY = (y: number) => 320 - ((y + 6) / 12) * 360

type CreationMode = "line" | "circle" | "arc" | null

interface GraphicsViewProps {
  document: GeometryDocument
  selectedId: string | null
  creationMode: CreationMode
  onSelect: (id: string) => void
  onCanvasClick: (coordinate: Coordinate) => void
}

function eventToWorld(event: ReactMouseEvent<SVGElement>): Coordinate {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as SVGSVGElement
  const bounds = svg.getBoundingClientRect()
  const width = bounds.width || 800
  const height = bounds.height || 380
  const viewX = ((event.clientX - bounds.left) / width) * 800
  const viewY = ((event.clientY - bounds.top) / height) * 380
  return { x: (viewX - 400) / 36, y: (140 - viewY) / 30 }
}

export function GraphicsView({ document, selectedId, creationMode, onSelect, onCanvasClick }: GraphicsViewProps) {
  const lines = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "line" }> => primitive.type === "line" && primitive.visible !== false)
  const circles = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "circle" }> => primitive.type === "circle" && primitive.visible !== false)
  const arcs = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "arc" }> => primitive.type === "arc" && primitive.visible !== false)
  const points = document.primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "point" }> => primitive.type === "point" && primitive.visible !== false)
  const intersections = document.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" }> => ["intersection", "lineCircleIntersection", "circleIntersection"].includes(primitive.type) && primitive.visible !== false)
  const arcPath = (centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) => {
    const start = { x: toX(centerX + radius * Math.cos(startAngle)), y: toY(centerY + radius * Math.sin(startAngle)) }
    const end = { x: toX(centerX + radius * Math.cos(endAngle)), y: toY(centerY + radius * Math.sin(endAngle)) }
    const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0
    const sweep = endAngle >= startAngle ? 0 : 1
    return `M ${start.x} ${start.y} A ${radius * 36} ${radius * 30} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`
  }
  const handleObjectClick = (event: ReactMouseEvent<SVGElement>, id: string) => {
    event.stopPropagation()
    if (creationMode) {
      onCanvasClick(eventToWorld(event))
      return
    }
    onSelect(id)
  }
  return <main className="graphics"><div className="canvas-card"><svg viewBox="0 0 800 380" role="img" aria-label="几何画布" onClick={(event) => onCanvasClick(eventToWorld(event))}><g stroke="#e6eaf2" strokeWidth="1">{Array.from({ length: 21 }, (_, index) => <line key={`v-${index}`} x1={40 + index * 36} y1="20" x2={40 + index * 36} y2="340" />)}{Array.from({ length: 11 }, (_, index) => <line key={`h-${index}`} x1="40" y1={20 + index * 32} x2="760" y2={20 + index * 32} />)}</g><line x1="40" y1={toY(0)} x2="760" y2={toY(0)} stroke="#9aa6bd" strokeWidth="1.5" /><line x1={toX(0)} y1="20" x2={toX(0)} y2="340" stroke="#9aa6bd" strokeWidth="1.5" />{lines.map((line) => <line key={line.id} onClick={(event) => handleObjectClick(event, line.id)} x1={toX(line.a.x)} y1={toY(line.a.y)} x2={toX(line.b.x)} y2={toY(line.b.y)} stroke={line.id === "line-slope" ? "#3d5afe" : "#172033"} strokeWidth={selectedId === line.id ? 5 : 3} strokeLinecap="round" />)}{circles.map((circle) => <g key={circle.id} onClick={(event) => handleObjectClick(event, circle.id)}><ellipse cx={toX(circle.center.x)} cy={toY(circle.center.y)} rx={circle.radius * 36} ry={circle.radius * 30} fill="none" stroke={selectedId === circle.id ? "#3d5afe" : "#0f8a63"} strokeWidth={selectedId === circle.id ? 5 : 3} /><text x={toX(circle.center.x) + circle.radius * 36 + 8} y={toY(circle.center.y)} fill="#172033" fontSize="14" fontWeight="700">{circle.label ?? circle.id}</text></g>)}{arcs.map((arc) => <path key={arc.id} onClick={(event) => handleObjectClick(event, arc.id)} d={arcPath(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle)} fill="none" stroke={selectedId === arc.id ? "#3d5afe" : "#f08a24"} strokeWidth={selectedId === arc.id ? 5 : 3} />)}{points.map((point) => <g key={point.id} onClick={(event) => handleObjectClick(event, point.id)}><circle cx={toX(point.x)} cy={toY(point.y)} r="6" fill="#3d5afe" stroke="white" strokeWidth="3" /><text x={toX(point.x) + 12} y={toY(point.y) + 5} fill="#172033" fontSize="14" fontWeight="700">{point.label ?? point.id}</text></g>)}{intersections.map((primitive) => <g key={primitive.id} onClick={(event) => handleObjectClick(event, primitive.id)}><circle cx={toX(primitive.x)} cy={toY(primitive.y)} r="7" fill="#f04f5f" stroke="white" strokeWidth="3" /><text x={toX(primitive.x) + 12} y={toY(primitive.y) - 12} fill="#172033" fontSize="14" fontWeight="700">{primitive.label ?? "交点"} ({primitive.x.toFixed(2)}, {primitive.y.toFixed(2)})</text></g>)}</svg></div></main>
}
