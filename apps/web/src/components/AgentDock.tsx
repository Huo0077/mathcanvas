import { useSceneStore } from "../store"

import { ConstraintPanel } from "./ConstraintPanel"

export function AgentDock() {
  const document = useSceneStore((state) => state.document)
  const error = useSceneStore((state) => state.error)
  const deleteConstraint = (id: string) => useSceneStore.getState().apply({ op: "deleteConstraint", id })
  const deleteConstraints = (ids: string[]) => ids.forEach(deleteConstraint)
  return <><ConstraintPanel constraints={document.constraints} primitives={document.primitives} error={error?.includes("constraint") ? error : null} onDelete={deleteConstraint} onDeleteMany={deleteConstraints} /><section className="panel-section agent-panel"><div className="panel-heading"><div><span className="panel-kicker">辅助编辑</span><h2 className="panel-title">智能体 (Agent)</h2></div><span className="agent-chip">Beta</span></div><div className="agent-status"><span className="status-dot pending" aria-hidden="true" />状态: 等待应用</div><p>自然语言修改会先生成补丁，经预览和校验后提交。</p><label className="agent-preview-label" htmlFor="agent-preview">补丁预览</label><textarea id="agent-preview" aria-label="补丁预览" readOnly value="等待生成修改建议…" /><button className="agent-apply" type="button" onClick={() => undefined}>审核并应用</button></section></>
}
