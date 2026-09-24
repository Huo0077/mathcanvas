/**
 * **文档结构编辑：批量删除与图层增删**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 三条命令：删除选中的对象（`deleteSelected`）、新建图层（`addLayer`）、删除图层
 *（`deleteLayer`）。它们动的是**文档的骨架**（有哪些对象、它们归在哪一层），不是几何本身。
 *
 * ## 两条写在这里的不变式
 *
 * 1. **删除：校验先行，然后整批一步撤销。** `validateDeletion` 给出的是**用户可读**的拒绝理由
 *    （"对象被另一个对象引用"），事务里的 `errors` 是给运行记录看的实现细节 —— 两者不能互换。
 *    而实际执行的补丁由**与 Agent 同一份**动作编译器产出（`compileActions` + `object.delete_many`，
 *    设计规格 §7.4：不复制一份 Agent 专用语义）。以前是逐个 `apply` 删除：N 个对象留下 N 步撤销，
 *    一次 Ctrl+Z 只退一个。
 * 2. **新建子图层要把它展开。** 折叠状态下新建一层，用户会以为"点了没反应"。
 */

import type { GeometryDocument } from "@draw/dsl"
import { CAPABILITY_REGISTRY_REVISION } from "@draw/agent-core"
import { compileActions, createIdAllocator, validateDeletion, type DomainOperation } from "@draw/scene-graph"

export interface StructureCommandDeps {
  document: GeometryDocument
  selectedIds: string[]
  apply: (operation: DomainOperation) => void
  applyBatch: (operations: DomainOperation[]) => void
  setSelectedIds: (ids: string[]) => void
  setFileError: (message: string | null) => void
  expandedIds: string[]
  setExpandedIds: (ids: string[]) => void
}

export function createStructureCommands({ document, selectedIds, apply, applyBatch, setSelectedIds, setFileError, expandedIds, setExpandedIds }: StructureCommandDeps) {
  const deleteSelected = () => {
    if (!selectedIds.length) return
    /**
     * **一次批量删除**（Task 0.4）：整批当作并集提交，所以与选择顺序无关，
     * 而且只占**一步撤销**。以前是逐个 `apply({op:"deleteObject"})` ——
     * 虽然已经用 `validateDeletion` 做过并集校验，但 N 个对象会留下 N 步撤销。
     *
     * `validateDeletion` 仍然先行：它给出的是**用户可读**的拒绝理由
     *（"对象被另一个对象引用"），而事务的 `errors` 是给 run 记录看的实现细节。
     */
    const validation = validateDeletion(document, selectedIds)
    if (!validation.valid) {
      setFileError(validation.errors.join(", "))
      return
    }
    /**
     * 手工按钮与 Agent 走**同一份动作编译器**（设计规格 §7.4：不复制一份 Agent 专用语义）。
     * `validateDeletion` 仍然先行，因为它给的是**用户可读**的拒绝理由（"对象被另一个对象引用"）；
     * 编译器的诊断是给 run 记录与模型修复路径看的，措辞面向执行而非面向人。
     */
    const compiled = compileActions(document, [{ actionId: "object.delete_many", actionKey: "manual-delete", factIds: [], inputs: { targets: [...selectedIds] } }], {
      targetDocument: document,
      targetWorkspace: document.workspace,
      orderedSelection: [...selectedIds],
      capabilityRevision: CAPABILITY_REGISTRY_REVISION,
      idAllocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
    })
    if (compiled.diagnostics.length > 0) {
      setFileError(compiled.diagnostics.map((entry) => entry.message).join("；"))
      return
    }
    applyBatch(compiled.operations)
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

  return { deleteSelected, addLayer, deleteLayer }
}
