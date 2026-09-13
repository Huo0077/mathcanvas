import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"
import { constraintResidual } from "@draw/geometry-kernel"

interface ConstraintPanelProps {
  constraints: ConstraintSpec[]
  primitives: PrimitiveSpec[]
  error: string | null
  onDelete: (id: string) => void
}

const constraintLabels: Record<ConstraintSpec["type"], string> = {
  parallel: "平行",
  perpendicular: "垂直",
  coincident: "重合"
}

function primitiveName(primitive: PrimitiveSpec | undefined, id: string): string {
  return primitive?.label ?? id
}

function constraintStatus(constraint: ConstraintSpec, primitiveById: Map<string, PrimitiveSpec>): "已满足" | "需检查" | "无效" {
  const [first, second] = constraint.targets
  const firstPrimitive = primitiveById.get(first)
  const secondPrimitive = primitiveById.get(second)
  if (firstPrimitive?.type !== "line" || secondPrimitive?.type !== "line") return "无效"
  return constraintResidual(firstPrimitive, secondPrimitive, constraint.type) <= 1e-6 ? "已满足" : "需检查"
}

export function ConstraintPanel({ constraints, primitives, error, onDelete }: ConstraintPanelProps) {
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  return <section className="panel-section constraints-panel"><h2 className="panel-title">约束列表</h2>{error && <div className="constraint-error" role="alert" aria-live="assertive"><strong>约束操作未完成</strong><span>{error}</span><small>请删除冲突约束，或调整其中一条直线后重试。</small></div>}{constraints.length === 0 ? <p className="empty-state">暂无约束。选中两条直线后可添加平行、垂直或重合约束。</p> : <ul className="constraint-list">{constraints.map((constraint) => { const status = constraintStatus(constraint, primitiveById); return <li key={constraint.id} className={`constraint-row constraint-${status === "已满足" ? "ok" : "warning"}`}><div className="constraint-main"><strong>{constraintLabels[constraint.type]}</strong><span className="constraint-status" data-status={status}>{status}</span></div><p>{primitiveName(primitiveById.get(constraint.targets[0]), constraint.targets[0])} · {primitiveName(primitiveById.get(constraint.targets[1]), constraint.targets[1])}</p><button aria-label={`删除约束 ${constraint.id}`} onClick={() => onDelete(constraint.id)}>删除</button></li> })}</ul>}</section>
}
