import { useEffect, useRef } from "react"

import { createEmptyDocument, type GeometryDocument, type Workspace } from "@draw/dsl"
import { loadActiveWorkspace, loadDraft, loadLastDocumentId, saveDraft } from "./persistence/draftStorage"
import { createDocumentRepository } from "./services/documentRepository"
import { createDocumentPersistence, type DocumentPersistence } from "./services/documentPersistence"
import { invokeDesktop } from "./services/desktopRuntime"
import { migrateLegacySolids } from "./solidTemplates"
import { useSceneStore } from "./store"

/**
 * **启动恢复 + 自动保存**（从 `App.tsx` 搬出来的两个 effect，评审方案 2）。
 *
 * 这是整个 App 里**时序最敏感**的一段：它有两个 effect，而它们之间隔着一条异步的恢复，
 * 于是"谁先跑"直接决定数据会不会丢。两条守卫全部是**被 e2e / 探针抓出来的**，
 * 注释随代码一起搬过来，别删：
 *
 * 1. **恢复没结束就不许写**（`restoreSettledRef`）：自动保存挂在 `[document]` 上，
 *    挂载时就会跑一次 —— 那时恢复还没回来，它会把**初始的空文档**写进 localStorage，
 *    覆盖掉上一轮的草稿（实测：刷新后草稿 3044 → 2663 字符、`图层 1` 消失，页面上没有任何报错）。
 * 2. **用户动过手就不覆盖**（`actedSinceStartup`）：恢复是异步的，回来就 `replace(...)`；
 *    如果用户在它返回之前建了一个对象，那次 `replace` 会把用户刚做的事整个盖掉。
 *
 * ## 为什么"读当前值"这件事要写成一道缝
 *
 * 守卫必须读**当前**的 store（`readLive`），不能读 effect 闭包里的那个 `document` ——
 * 后者是"切换工作区之前"的 revision，会让"切回上次工作区"这一步本身被判成"用户动过手"，
 * 于是刷新之后**永远不恢复草稿**（这三条用例就是当时失败的那三条）。
 * 把"读当前值"提成一个参数，是为了让这条区别在类型上就是显式的，也让它能被单独验。
 *
 * 另一道缝 `persistence` 是给测试用的：这两条守卫**只在恢复是异步的时候才有意义**，
 * 所以必须能在"控制 `restore()` 何时返回"的地方验（见 `useDraftPersistence.test.tsx`）。
 */
export interface DraftPersistenceDeps {
  /** 当前这份文档（决定草稿写在哪个工作区、以及要不要写）。 */
  document: GeometryDocument
  replace: (document: GeometryDocument) => void
  switchWorkspace: (workspace: Workspace) => void
  setFileError: (message: string | null) => void
  /** 测试缝：直接给一个仓储适配器（默认按下面的方式真建一个）。 */
  persistence?: DocumentPersistence
  /** 测试缝：读"当前那一份"store。守卫必须读它，而不是 effect 闭包里的 `document`。 */
  readLive?: () => { document: GeometryDocument }
}

export interface DraftPersistenceHandle {
  /**
   * 打开文件 / 导入 = **换一世**：作废在途保存、把新内容建为新的一版。
   * 留在仓储里的会是新文档的 epoch，于是上一次编辑那次**可能还在途**的自动保存会立刻 CAS 失败 ——
   * 否则用户刚打开的文档会被旧内容覆盖（界面上表现为"打开的文件又变回去了"，几乎无法复现）。
   */
  reset: (document: GeometryDocument) => void
}

export function useDraftPersistence({ document, replace, switchWorkspace, setFileError, persistence, readLive = () => useSceneStore.getState() }: DraftPersistenceDeps): DraftPersistenceHandle {
  const draftLoadedRef = useRef(false)
  const skipNextDraftSaveRef = useRef(false)
  /**
   * 启动恢复**是否已经结束**。
   *
   * 自动保存那个 effect 在挂载时就会跑一次，而那时恢复还没回来 ——
   * 没有这道闸，它会把初始的空文档写进 localStorage，**覆盖掉上一轮的草稿**
   * （实测：刷新后草稿从 3044 字符变成 2663、`图层 1` 消失，而页面没有任何报错）。
   */
  const restoreSettledRef = useRef(false)
  /** 项目仓储的适配器（Task 1.6）。**惰性建**：在浏览器里它只会如实报"没有桌面外壳"。 */
  const persistenceRef = useRef<DocumentPersistence | null>(null)
  /** 保存失败的提示**只报一次**：反复弹同一条没有任何意义，还会把状态栏刷掉。 */
  const persistenceErrorShownRef = useRef(false)
  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    const workspace = loadActiveWorkspace()
    if (workspace && workspace !== document.workspace) switchWorkspace(workspace)
    /**
     * 恢复期间**用户**已经动过手吗？
     *
     * **这条守卫是被 e2e 抓出来的**：`restore()` 是异步的，而它一完成就 `replace(...)`。
     * 如果用户在它返回之前建了一个对象，那次 `replace` 会把用户刚做的事情**整个盖掉**。
     *
     * 判据用 `document.revision`：**任何一次改动都会推进它** ——
     * 包括**我们在上面那行自己做的** `switchWorkspace(workspace)`。
     *
     * 所以这里有一个顺序上的坑，是第二次才被 e2e 抓出来的（`显示 图层 1` 找不到）：
     * 用 `document`（effect 闭包里的那个值，是**切换工作区之前**的 revision）当基准，
     * 那么"切回上次的工作区"这一步本身就会被判成"用户动过手"，
     * 于是**刷新之后永远不恢复草稿** —— 表现正是那三条用例失败。
     *
     * 修法：基准要在**自己那一步之后**取。`readLive()` 拿的是当前值，
     * 而 effect 的闭包是旧的 —— 这个区别在这里就是正确与错误的区别。
     */
    const revisionAtStartup = readLive().document.revision
    const workspaceAtStartup = readLive().document.workspace
    const actedSinceStartup = () => readLive().document.revision !== revisionAtStartup
    const stillOnTheSameWorkspace = () => readLive().document.workspace === workspaceAtStartup
    /**
     * **先从项目仓储恢复**（Task 1.6），再退回 localStorage 草稿。
     *
     * 顺序是有意义的：仓储是**事务性**的那一层（有历史、有 CAS），localStorage 只是
     * "会话内别丢"的兜底。桌面版里两者都有 —— 仓储先答，因为它才是权威。
     *
     * 浏览器里 `restore()` 会如实报 `not_a_desktop_shell`，于是走到 localStorage 那条路，
     * 行为与加这个功能之前**完全一样**（这一点很重要：不能在网页版上把已有草稿弄丢）。
     */
    void (async () => {
      if (!persistenceRef.current) persistenceRef.current = persistence ?? createDocumentPersistence({
        repository: createDocumentRepository(invokeDesktop),
        projectId: "local",
        emptyDocument: () => createEmptyDocument("conics"),
        /**
         * **探测要用"这一世真正会用的那个 documentId"**（2026-09-22 修 / 外部审查 X1）。
         *
         * 原先这里没有这一项，`restore()` 拿 `createEmptyDocument("conics")` 刚生成的
         * **新随机 id** 去 `readHead`。Rust 侧按 `(project_id, document_id)` 过滤 ⇒
         * 每次启动必然 `not_found` ⇒ 每次启动插一行新的空文档，而仓储里那份真正的内容
         * 永远读不回来（设计里"仓储才是真源"因此是空的），重启后会话侧栏也是空的
         * （`list_conversations` 按 document 过滤）。
         *
         * 取值顺序：**上次活动文档的 id**（`saveDraft` 与草稿一起记下的，不需要解码草稿、
         * 因此没有副作用）→ 退回 store 当前那份文档的 id（全新用户第一次启动）。
         * 这里刻意**不**读草稿本体：`loadDraft` 会把读不出来的草稿挪到旁路键并抛错，
         * 而那段处置属于下面 558 行的恢复分支，不该在探测阶段提前发生一次。
         */
        documentId: () => loadLastDocumentId() ?? readLive().document.metadata.id
      })
      const restored = await persistenceRef.current.restore()
      /**
       * **用户已经动过手就不再覆盖**（见上面那段注释：这条守卫是被 e2e 抓出来的）。
       * 只在"什么都没发生"和"还在同一个工作区"时才应用恢复结果 ——
       * 前者保证不丢用户的工作，后者保证不会把 B 工作区的文档盖到 A 工作区上。
       */
      if (actedSinceStartup() || !stillOnTheSameWorkspace()) return
      if (!restored.created && restored.document.primitives.length > 0) {
        // 仓储里有东西：用它，并跳过下一次自动保存（刚恢复的内容不该立刻回写一遍）。
        skipNextDraftSaveRef.current = true
        replace(migrateLegacySolids(restored.document))
        return
      }
      // 仓储里没有（网页版就是这样）：退回 localStorage 草稿。
      // 读不出来的草稿会被**保留**在旁路键上（绝不静默删除用户的草稿），这里如实告诉用户发生了什么。
      try {
        const draft = loadDraft(workspace ?? document.workspace)
        if (draft) {
          const restoredDraft = migrateLegacySolids(draft)
          /**
           * 草稿也要过同一条守卫，而且这里**额外**比对一次工作区：
           * `loadDraft` 是按工作区读的，而用户可能在读盘期间切走了 ——
           * 把一个工作区的草稿 `replace` 到另一个工作区上就是这个功能最容易犯的错。
           */
          if (!actedSinceStartup() && readLive().document.workspace === (workspace ?? document.workspace)) {
            skipNextDraftSaveRef.current = true
            replace(restoredDraft)
          }
        }
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "无法恢复上次的草稿")
      }
      if (restored.failure && restored.failure.code !== "not_a_desktop_shell") {
        // 仓储**本该可用**却失败了：如实说，用户才知道"这次改动关掉就没了"。
        setFileError(`本地项目库不可用，改动只保留在会话内：${restored.failure.detail}`)
      }
    })().finally(() => {
      /**
       * **恢复这一段结束了**，自动保存从这一刻起可以写。
       *
       * ## 这条标记是探针抓出来的（本片最隐蔽的一个缺陷）
       *
       * 自动保存那个 effect 挂在 `[document]` 上，而它在**挂载时就会跑一次** ——
       * 那时恢复还没回来，于是它把**初始的空文档**写进了 localStorage。
       * 后果是：刷新之后草稿先被空文档覆盖（实测 3044 → 2663 字符、`图层 1` 消失），
       * 恢复再去读那份**已经被覆盖了的**副本 —— 用户看到的就是"刷新之后我建的东西没了"。
       *
       * 探针输出的决定性证据就是那两行：
       * `draft has 图层 1 = true`（刷新前）→ `false`（刷新后），而页面上没有任何报错。
       *
       * 为什么不在"恢复成功"时才置位：恢复**失败**时也必须放行自动保存，
       * 否则用户之后的改动一次都存不下去 —— 那是比覆盖更糟的失败。
       */
      restoreSettledRef.current = true
    })
  }, [document.workspace, replace, switchWorkspace, persistence, readLive, setFileError])

  useEffect(() => {
    /**
     * **恢复还没结束就什么都不写**（见上面那段证据）。
     * 这一条挡的是"初始空文档覆盖掉上一轮的草稿"，而不是"别存"。
     */
    if (!restoreSettledRef.current) return
    if (skipNextDraftSaveRef.current) { skipNextDraftSaveRef.current = false; return }
    // localStorage 那一份照旧：它是网页版的**唯一**持久化，也是桌面版的兜底。
    try { saveDraft(document) } catch (error) { setFileError(error instanceof Error ? error.message : "无法自动保存草稿") }
    /**
     * 项目仓储那一份：**每次改动都写**（防丢），但适配器会在内容没变时**在本地挡掉**，
     * 所以高频拖动不会在仓储里留下几百个 generation。
     *
     * 这里刻意**不 await**：自动保存是后台动作，让它挡住渲染没有任何好处。
     * 失败**不静默** —— 一次失败就够告诉用户"本地项目库写不进去了"（反复弹同一条没有意义）。
     */
    void persistenceRef.current?.save(document, document.primitives.length).then((result) => {
      if (!result.ok && result.code !== "not_a_desktop_shell" && !persistenceErrorShownRef.current) {
        persistenceErrorShownRef.current = true
        setFileError(`本地项目库保存失败，改动只保留在会话内：${result.detail}`)
      }
    })
  }, [document, setFileError])

  /** 打开文件那一侧要用的"换一世"入口（见 `DraftPersistenceHandle`）。 */
  return { reset: (next) => { void persistenceRef.current?.reset(next) } }
}
