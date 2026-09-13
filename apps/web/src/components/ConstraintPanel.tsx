import { useMemo, useState } from "react"
import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"
import { constraintResidual } from "@draw/geometry-kernel"

interface ConstraintPanelProps {
  constraints: ConstraintSpec[]
  primitives: PrimitiveSpec[]
  error: string | null
  onDelete: (id: string) => void
  onDeleteMany: (ids: string[]) => void
}

const constraintLabels: Record<ConstraintSpec["type"], string> = {
  parallel: "平行",
  perpendicular: "垂直",
  coincident: "重合"
}

function primitiveName(primitive: PrimitiveSpec | undefined, id: string): string {
  return primitive?.label ?? id
}

function constraintDiagnostic(constraint: ConstraintSpec, primitiveById: Map<string, PrimitiveSpec>): { status: "已满足" | "需检查" | "无效"; residual: number | null } {
  const [first, second] = constraint.targets
  const firstPrimitive = primitiveById.get(first)
  const secondPrimitive = primitiveById.get(second)
  if (firstPrimitive?.type !== "line" || secondPrimitive?.type !== "line") return { status: "无效", residual: null }
  const residual = constraintResidual(firstPrimitive, secondPrimitive, constraint.type)
  return { status: residual <= 1e-6 ? "已满足" : "需检查", residual }
}

export function ConstraintPanel({ constraints, primitives, error, onDelete, onDeleteMany }: ConstraintPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  const diagnostics = useMemo(() => new Map(constraints.map((constraint) => [constraint.id, constraintDiagnostic(constraint, primitiveById)])), [constraints, primitives])
  const warningIds = constraints.filter((constraint) => diagnostics.get(constraint.id)?.status !== "已满足").map((constraint) => constraint.id)
  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id])
  const deleteSelected = () => { onDeleteMany(selectedIds); setSelectedIds([]) }
  const deleteWarnings = () => { onDeleteMany(warningIds); setSelectedIds([]) }
  return <section className="panel-section constraints-panel"><h2 className="panel-title">约束列表</h2>{error && <div className="constraint-error" role="alert" aria-live="assertive"><strong>约束操作未完成</strong><span>{error}</span><small>请删除冲突约束，或调整其中一条直线后重试。</small></div>}{constraints.length === 0 ? <p className="empty-state">暂无约束。选中两条直线后可添加平行、垂直或重合约束。</p> : <><div className="constraint-batch-actions"><button disabled={!selectedIds.length} onClick={deleteSelected}>删除选中（{selectedIds.length}）</button><button disabled={!warningIds.length} onClick={deleteWarnings}>清理需检查（{warningIds.length}）</button></div><ul className="constraint-list">{constraints.map((constraint) => { const diagnostic = diagnostics.get(constraint.id)!; return <li key={constraint.id} className={`constraint-row constraint-${diagnostic.status === "已满足" ? "ok" : "warning"}`}><div className="constraint-main"><label><input aria-label={`选择约束 ${constraint.id}`} type="checkbox" checked={selectedIds.includes(constraint.id)} onChange={() => toggleSelected(constraint.id)} /> <strong>{constraintLabels[constraint.type]}</strong></label><span className="constraint-status" data-status={diagnostic.status}>{diagnostic.status}</span></div><p>{primitiveName(primitiveById.get(constraint.targets[0]), constraint.targets[0])} · {primitiveName(primitiveById.get(constraint.targets[1]), constraint.targets[1])}</p><small className="constraint-residual">{diagnostic.residual === null ? "无法计算误差" : `误差 ${diagnostic.residual.toExponential(2)}`}</small><button aria-label={`删除约束 ${constraint.id}`} onClick={() => onDelete(constraint.id)}>删除</button></li> })}</ul></>}</section>
}
