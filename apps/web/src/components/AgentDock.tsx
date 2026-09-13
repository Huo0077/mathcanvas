import { useSceneStore } from "../store"

import { ConstraintPanel } from "./ConstraintPanel"

export function AgentDock() {
  const document = useSceneStore((state) => state.document)
  const error = useSceneStore((state) => state.error)
  const deleteConstraint = (id: string) => useSceneStore.getState().apply({ op: "deleteConstraint", id })
  const deleteConstraints = (ids: string[]) => ids.forEach(deleteConstraint)
  return <><ConstraintPanel constraints={document.constraints} primitives={document.primitives} error={error?.includes("constraint") ? error : null} onDelete={deleteConstraint} onDeleteMany={deleteConstraints} /><section className="panel-section"><h2 className="panel-title">Agent Dock</h2><div className="agent-status"><span className="status-dot" aria-hidden="true" />Patch 校验就绪</div><p>自然语言修改会先生成 Domain Patch，经预览和校验后提交。</p></section></>
}
