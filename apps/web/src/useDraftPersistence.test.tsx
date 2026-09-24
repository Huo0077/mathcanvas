import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { saveDraft } from "./persistence/draftStorage"
import type { RepositoryFailure } from "./services/documentRepository"
import type { DocumentPersistence, RestoreOutcome } from "./services/documentPersistence"
import { useSceneStore } from "./store"
import { useDraftPersistence } from "./useDraftPersistence"

/**
 * **启动恢复与自动保存的时序**（`./useDraftPersistence`）。
 *
 * 这一段过去住在 `App.tsx` 里，只能整页验：它的两条守卫都是**被 e2e / 探针抓出来的**，
 * 而它们只在**恢复是异步的**时候才有意义 —— 所以要验它们，必须能控制 `restore()` 什么时候返回。
 * 搬成 hook 之后就有了这道缝（注入 `persistence`），于是两条守卫从"靠整页 e2e 间接证明"
 * 变成"这里直接钉住"：
 *
 * 1. 恢复没结束，自动保存**一个字都不许写**（否则初始空文档会覆盖上一轮的草稿）；
 * 2. 用户在恢复返回**之前**动过手，恢复结果**不许覆盖**他的工作。
 */

/** 一份可以手动放行的 `restore()`：测试自己决定它什么时候返回。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function fakePersistence(restore: () => Promise<RestoreOutcome>) {
  /**
   * 保存的返回类型要写成**联合**：有的用例要让它成功、有的要让它失败
   * （只写 `ok: true` 的话，`mockResolvedValue(失败)` 那一行会被类型检查否掉）。
   */
  const save = vi.fn(async (): Promise<{ ok: true; generation: number } | RepositoryFailure> => ({ ok: true, generation: 1 }))
  const reset = vi.fn(async (): Promise<{ ok: true; generation: number } | RepositoryFailure> => ({ ok: true, generation: 1 }))
  const persistence: DocumentPersistence = { restore, save, reset, handle: () => null }
  return { persistence, save, reset }
}

/** 平面点的坐标是**顶层的 `x` / `y`**（不是 `position`）—— 文档校验器按这个形状查。 */
const pointPrimitive = { id: "point-1", type: "point" as const, x: 1, y: 2 }

const documentWithPoint = (): GeometryDocument =>
  ({ ...createEmptyDocument("conics"), primitives: [pointPrimitive] })

/** 一个"已经结束的恢复"：仓储里有一份带一个点的文档。 */
function restoredOutcome(document: GeometryDocument = documentWithPoint()): RestoreOutcome {
  return { document, created: false }
}

function mount(initial: GeometryDocument, persistence: DocumentPersistence, setFileError = vi.fn()) {
  const replace = vi.fn()
  const switchWorkspace = vi.fn()
  const view = renderHook(
    ({ document }: { document: GeometryDocument }) => useDraftPersistence({ document, replace, switchWorkspace, setFileError, persistence }),
    { initialProps: { document: initial } }
  )
  return { ...view, replace, switchWorkspace, setFileError }
}

/** 让两个 effect 与它们里面的微任务都跑完。 */
const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  localStorage.clear()
  useSceneStore.getState().replace(createEmptyDocument("conics"))
})

describe("startup restore and autosave", () => {
  /**
   * **本片最隐蔽的缺陷**（探针输出的两行证据：`draft has 图层 1 = true` → 刷新后 `false`，
   * 而页面上没有任何报错）。自动保存挂在 `[document]` 上、挂载时就会跑一次，
   * 那时恢复还没回来 —— 它会把初始的空文档写进 localStorage，把上一轮的草稿覆盖掉。
   */
  it("writes nothing while the restore is still in flight", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence, save } = fakePersistence(() => gate.promise)
    const { replace } = mount(initial, persistence)

    await flush()

    expect(save).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()

    // 恢复回来了：它把仓储里那份装进文档，而这一次变化**不算用户的改动**，所以也不该回写。
    await act(async () => {
      gate.resolve(restoredOutcome())
      await gate.promise
    })
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(save).not.toHaveBeenCalled()
  })

  it("starts saving again on the user's next edit, and skips the restore's own change only once", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence, save } = fakePersistence(() => gate.promise)
    const { replace, rerender } = mount(initial, persistence)

    await act(async () => {
      gate.resolve(restoredOutcome())
      await gate.promise
    })
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))

    /** 真机上这一步是 `replace()` → store 变了 → 组件用新 `document` 重渲染。 */
    rerender({ document: documentWithPoint() })
    await flush()
    expect(save).not.toHaveBeenCalled()

    /** 用户自己改了一笔：这才该写。 */
    rerender({ document: { ...documentWithPoint(), revision: 7 } })
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  /**
   * 恢复是异步的，而它一完成就 `replace(...)`。用户在它返回之前建的对象，
   * 会被那次 `replace` **整个盖掉** —— 这条守卫就是这么被抓出来的。
   */
  it("does not overwrite work the user did while the restore was in flight", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence } = fakePersistence(() => gate.promise)
    const { replace } = mount(initial, persistence)

    await flush()
    // 用户在恢复返回之前动了手：`revision` 前进（任何一次改动都会推进它）。
    act(() => { useSceneStore.setState({ document: { ...initial, revision: initial.revision + 1 } }) })

    await act(async () => {
      gate.resolve(restoredOutcome())
      await gate.promise
    })

    expect(replace).not.toHaveBeenCalled()
  })

  /** 用户在看盘期间切走了工作区：把一个工作区的文档 `replace` 到另一个上，是这段最容易犯的错。 */
  it("does not restore into a workspace the user has switched away from", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence } = fakePersistence(() => gate.promise)
    const { replace } = mount(initial, persistence)

    await flush()
    act(() => { useSceneStore.setState({ document: { ...initial, workspace: "cad" } }) })

    await act(async () => {
      gate.resolve(restoredOutcome())
      await gate.promise
    })

    expect(replace).not.toHaveBeenCalled()
  })

  /**
   * 仓储里没有东西（**网页版就是这样**）：退回 localStorage 草稿，
   * 且行为与加这个功能之前完全一样 —— 不能在网页版上把已有的草稿弄丢。
   */
  it("falls back to the localStorage draft when the repository has nothing", async () => {
    const initial = createEmptyDocument("conics")
    saveDraft(documentWithPoint())

    const gate = deferred<RestoreOutcome>()
    // `created: true` = 仓储里本来没有这份文档（浏览器里 restore() 必经的一支）。
    const { persistence } = fakePersistence(() => gate.promise)
    const { replace } = mount(initial, persistence)

    await act(async () => {
      gate.resolve({ document: createEmptyDocument("conics"), created: true })
      await gate.promise
    })

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(replace.mock.calls[0][0].primitives).toHaveLength(1)
  })

  it("says so when the repository was supposed to work and failed, and still lets autosave run", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence, save } = fakePersistence(() => gate.promise)
    const { replace, setFileError, rerender } = mount(initial, persistence)

    await act(async () => {
      gate.resolve({ document: createEmptyDocument("conics"), created: true, failure: { ok: false, code: "io", detail: "库打不开" } })
      await gate.promise
    })
    await waitFor(() => expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("本地项目库不可用")))

    /** 恢复**失败**也必须放行自动保存：否则用户之后的改动一次都存不下去（比覆盖更糟）。 */
    expect(replace).not.toHaveBeenCalled()
    rerender({ document: { ...initial, revision: 5 } })
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  /** 浏览器里 `not_a_desktop_shell` 是**正常状态**，不是错误 —— 不该弹提示。 */
  it("stays quiet when there simply is no desktop shell", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence } = fakePersistence(() => gate.promise)
    const { setFileError } = mount(initial, persistence)

    await act(async () => {
      gate.resolve({ document: createEmptyDocument("conics"), created: true, failure: { ok: false, code: "not_a_desktop_shell", detail: "浏览器" } })
      await gate.promise
    })

    expect(setFileError).not.toHaveBeenCalled()
  })

  /** 保存失败要**如实说**，但同一件事**只说一次**（反复弹同一条没有意义，还会把状态栏刷掉）。 */
  it("reports a save failure once, and not twice", async () => {
    const initial = createEmptyDocument("conics")
    const gate = deferred<RestoreOutcome>()
    const { persistence, save } = fakePersistence(() => gate.promise)
    save.mockResolvedValue({ ok: false, code: "io", detail: "盘满了" })
    const { setFileError, rerender } = mount(initial, persistence)

    await act(async () => {
      gate.resolve({ document: createEmptyDocument("conics"), created: true })
      await gate.promise
    })

    rerender({ document: { ...initial, revision: 3 } })
    await flush()
    rerender({ document: { ...initial, revision: 4 } })
    await flush()

    expect(save).toHaveBeenCalledTimes(2)
    expect(setFileError).toHaveBeenCalledTimes(1)
    expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("本地项目库保存失败"))
  })

  /** 打开文件那一侧要用的"换一世"入口：作废在途保存、把新内容建为新的一版。 */
  it("hands out the reset entry used when a file is opened", async () => {
    const initial = createEmptyDocument("conics")
    const { persistence, reset } = fakePersistence(async () => restoredOutcome())
    const { result } = mount(initial, persistence)

    await flush()
    const opened = documentWithPoint()
    act(() => { result.current.reset(opened) })

    expect(reset).toHaveBeenCalledWith(opened)
  })
})
