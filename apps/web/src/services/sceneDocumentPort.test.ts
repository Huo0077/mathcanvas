import { createEmptyDocument } from "@draw/dsl"
import { beforeEach, describe, expect, it } from "vitest"

import { useSceneStore } from "../store"
import { createSceneDocumentService, sceneStorePort } from "./sceneDocumentPort"

/**
 * Task 0.7 Step 5 的后半：**把 CAS 写入接到真实 store**。
 *
 * 前面的 `documentService` 单测用的是假端口；这里用真 `useSceneStore` 跑一遍，
 * 证明"过期候选永远不落盘"这条性质在应用里成立——而不是只在测试替身上成立。
 *
 * 注意端口一律传 `useSceneStore.getState`（函数本身），**不要**传 `useSceneStore.getState()` 的结果：
 * zustand 的 `setState` 会整体换掉根对象（实测确认），快照写一次就永久停在旧版本上，
 * 端口闭包住它会让四道闸在一个不动的值上比较。收 getter 就是为了让这个坑不可能出现。
 */
function resetStore(document = createEmptyDocument("conics")) {
  useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
}

describe("scene document port", () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it("commits a candidate through the store and keeps one undo step", () => {
    const service = createSceneDocumentService(useSceneStore.getState)
    const handle = service.readHandle("project-1")!

    const live = useSceneStore.getState().document
    const candidate = { ...live, primitives: [{ id: "point-1", type: "point" as const, x: 1, y: 1 }], revision: live.revision + 1 }
    const receipt = service.commit(candidate, handle)

    expect(receipt.ok).toBe(true)
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)
    // 走的是 `commitCandidate`：压一步历史（那样才撤销得回去），而不是 `replace` 的"清历史"。
    expect(useSceneStore.getState().history).toHaveLength(1)
  })

  it("refuses a stale candidate and leaves the live store untouched", () => {
    const service = createSceneDocumentService(useSceneStore.getState)
    const handle = service.readHandle("project-1")!

    // 用户在这份句柄之后又操作了一次（模拟"预览期间手工编辑"）。
    useSceneStore.getState().applyBatch([{ op: "addPrimitive", primitive: { id: "point-9", type: "point", x: 9, y: 9 } }])
    const afterEdit = useSceneStore.getState().document
    expect(afterEdit.primitives).toHaveLength(1)
    expect(afterEdit.revision).toBeGreaterThan(handle.generation)

    const candidate = { ...afterEdit, primitives: [{ id: "point-1", type: "point" as const, x: 1, y: 1 }], revision: afterEdit.revision + 1 }
    const receipt = service.commit(candidate, handle)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_generation")
    // 关键：真 store 没有被改写（既没换文档，也没多压一步历史）。
    expect(useSceneStore.getState().document.primitives.map((primitive) => primitive.id)).toEqual(["point-9"])
    expect(useSceneStore.getState().history).toHaveLength(1)
  })

  it("reads the live document every time instead of a construction-time snapshot", () => {
    const port = sceneStorePort(useSceneStore.getState)
    const first = port.current()!.document

    useSceneStore.getState().applyBatch([{ op: "addPrimitive", primitive: { id: "point-9", type: "point", x: 9, y: 9 } }])

    const second = port.current()!.document
    expect(first.revision).toBe(0)
    expect(second.revision).toBe(1)
    expect(second.primitives.map((primitive) => primitive.id)).toEqual(["point-9"])
  })

  it("treats an import/replace epoch change as invalidating every earlier handle", () => {
    let epoch = "session-1"
    const service = createSceneDocumentService(useSceneStore.getState, () => epoch)
    const handle = service.readHandle("project-1")!

    // 导入/替换之后内容可能一模一样（同 id、同 revision），只有 epoch 说得清"换了一世"。
    epoch = "session-2"
    const live = useSceneStore.getState().document
    const candidate = { ...live, revision: live.revision + 1 }
    const receipt = service.commit(candidate, handle)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_epoch")
  })
})
