import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"

const toX = (x: number) => 40 + ((x + 10) / 20) * 720
const toY = (y: number) => 320 - ((y + 6) / 12) * 360

export function GraphicsView({ document }: { document: GeometryDocument }) {
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
  return <main className="graphics"><div className="canvas-card"><svg viewBox="0 0 800 380" role="img" aria-label="几何画布"><g stroke="#e6eaf2" strokeWidth="1">{Array.from({ length: 21 }, (_, index) => <line key={`v-${index}`} x1={40 + index * 36} y1="20" x2={40 + index * 36} y2="340" />)}{Array.from({ length: 11 }, (_, index) => <line key={`h-${index}`} x1="40" y1={20 + index * 32} x2="760" y2={20 + index * 32} />)}</g><line x1="40" y1={toY(0)} x2="760" y2={toY(0)} stroke="#9aa6bd" strokeWidth="1.5" /><line x1={toX(0)} y1="20" x2={toX(0)} y2="340" stroke="#9aa6bd" strokeWidth="1.5" />{lines.map((line) => <line key={line.id} x1={toX(line.a.x)} y1={toY(line.a.y)} x2={toX(line.b.x)} y2={toY(line.b.y)} stroke={line.id === "line-slope" ? "#3d5afe" : "#172033"} strokeWidth="3" strokeLinecap="round" />)}{circles.map((circle) => <g key={circle.id}><ellipse cx={toX(circle.center.x)} cy={toY(circle.center.y)} rx={circle.radius * 36} ry={circle.radius * 30} fill="none" stroke="#0f8a63" strokeWidth="3" /><text x={toX(circle.center.x) + circle.radius * 36 + 8} y={toY(circle.center.y)} fill="#172033" fontSize="14" fontWeight="700">{circle.label ?? circle.id}</text></g>)}{arcs.map((arc) => <path key={arc.id} d={arcPath(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle)} fill="none" stroke="#f08a24" strokeWidth="3" />)}{points.map((point) => <g key={point.id}><circle cx={toX(point.x)} cy={toY(point.y)} r="6" fill="#3d5afe" stroke="white" strokeWidth="3" /><text x={toX(point.x) + 12} y={toY(point.y) + 5} fill="#172033" fontSize="14" fontWeight="700">{point.label ?? point.id}</text></g>)}{intersections.map((primitive) => <g key={primitive.id}><circle cx={toX(primitive.x)} cy={toY(primitive.y)} r="7" fill="#f04f5f" stroke="white" strokeWidth="3" /><text x={toX(primitive.x) + 12} y={toY(primitive.y) - 12} fill="#172033" fontSize="14" fontWeight="700">{primitive.label ?? "交点"} ({primitive.x.toFixed(2)}, {primitive.y.toFixed(2)})</text></g>)}</svg></div></main>
}
