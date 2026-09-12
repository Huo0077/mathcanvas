interface GeometryToolbarProps { onUndo: () => void; onRedo: () => void; onSave: () => void; onOpen: () => void; onAddPoint: () => void; onAddCircle: () => void; onAddArc: () => void }

export function GeometryToolbar({ onUndo, onRedo, onSave, onOpen, onAddPoint, onAddCircle, onAddArc }: GeometryToolbarProps) {
  return <div className="toolbar" aria-label="几何工具栏"><button className="primary" aria-label="添加点" onClick={onAddPoint}>＋ 添加点</button><button>选择</button><button>直线</button><button aria-label="添加圆" onClick={onAddCircle}>圆</button><button aria-label="添加圆弧" onClick={onAddArc}>圆弧</button><button onClick={onUndo}>撤销</button><button onClick={onRedo}>重做</button><button onClick={onSave}>保存 .mgeo</button><button onClick={onOpen}>打开 .mgeo</button></div>
}
