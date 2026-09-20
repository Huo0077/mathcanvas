import type { GeometryDocument } from "@draw/dsl"
import { createDocumentHandle, contentFingerprint } from "@draw/scene-graph"

import { createDocumentService, type DocumentPort, type DocumentService } from "./documentService"

/**
 * 把 `DocumentService` 接到真实的 `useSceneStore`（Task 0.7 Step 5 的后半）。
 *
 * 这一层刻意做得很薄：`DocumentService` 的四道闸与草稿逻辑都可单测，
 * 这里只把 store 的读（`document`）与写（`commitCandidate`）暴露成 `DocumentPort`。
 * 把它单独放一个文件，是为了让将来的 Tauri host 能用**同一份** service，只换 port 实现。
 *
 * **为什么收 getter 而不是 store 对象**：zustand 的 `setState` 会**整体换掉根对象**，
 * 所以 `const store = useSceneStore.getState()` 拿到的是一个**快照**——写一次之后它就永久停在旧版本上。
 * 端口要是闭包住了快照，CAS 的四道闸会在一个不动的值上比较，永远认为"没过期"。
 * 收 `() => state` 让每次读都重新取当前状态，这个坑就不存在了（此处踩过一次，见进度文档）。
 */

/** store 里与文档读写有关的最小形状；用结构类型而不是直接依赖 zustand，便于替换与测试。 */
export interface SceneStoreLike {
  document: GeometryDocument
  commitCandidate: (candidate: GeometryDocument) => void
}

export function createSceneDocumentPort(getState: () => SceneStoreLike, epoch?: () => string | undefined): DocumentPort {
  const port: DocumentPort = {
    // 每次调用都向 getState 现取：端口不缓存任何文档引用。
    current: () => ({ workspace: getState().document.workspace, document: getState().document }),
    replace: (candidate) => getState().commitCandidate(candidate)
  }
  // 只在真的给了 epoch 时才写这个键：`{ epoch: undefined }` 也算"有该属性"，
  // 于是 `port.epoch?.()` 会去调用 undefined（本轮踩到过）。
  if (epoch) port.epoch = epoch
  return port
}

export function createSceneDocumentService(getState: () => SceneStoreLike, epoch?: () => string | undefined): DocumentService {
  return createDocumentService(createSceneDocumentPort(getState, epoch))
}

/** `useSceneStore.getState` 本身就能当参数传进来；单独导出只是为了让调用点读起来一致。 */
export function sceneStorePort(getState: () => SceneStoreLike, epoch?: () => string | undefined): DocumentPort {
  return createSceneDocumentPort(getState, epoch)
}

/** 便于 UI 层展示"当前内容的指纹"（与句柄同一份规则）。 */
export function handleForDocument(document: GeometryDocument, projectId: string) {
  return createDocumentHandle(document, projectId)
}

export { contentFingerprint }

