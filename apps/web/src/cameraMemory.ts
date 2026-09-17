import type { CameraState } from "./threeCamera"

/**
 * 相机记忆（会话内）。
 *
 * 3D 场景组件是跟着工作区挂载/卸载的：切到平面几何再切回来会**新建**一份组件状态，
 * 相机原本存在组件的 `useRef` 里，于是回来时永远停在默认视角——用户转过的角度、缩放、
 * 视点中心全丢，还要重新找图形。这里把"某个文档配某个相机状态"记在模块级：
 * 组件卸载时写回，挂载时读回；**换了文档就不恢复**，新文档应当重新取景。
 *
 * 记忆按文档分别保存（最多 `MAX_REMEMBERED_CAMERAS` 个，最近使用的优先保留）：
 * 只有一个槽位时，交替打开两个 3D 文档会让前一个的相机被覆盖掉。
 *
 * 只活在内存里：刷新页面回到默认视角（与改动前的行为一致，也不会把视角写进用户偏好）。
 */

/** 最多记住几个文档的相机（超过就淘汰最久未用的那一个）。 */
export const MAX_REMEMBERED_CAMERAS = 4

const remembered = new Map<string, CameraState>()

const copyState = (state: CameraState): CameraState => ({ ...state, target: { ...state.target } })

/** 记住某个文档当前的相机状态（组件卸载时调用，写的是副本）。 */
export function rememberCamera(documentId: string, state: CameraState): void {
  // 先删再插：Map 的迭代顺序即插入顺序，于是"最近写入的"排在最后，淘汰时从最前面拿。
  remembered.delete(documentId)
  remembered.set(documentId, copyState(state))
  while (remembered.size > MAX_REMEMBERED_CAMERAS) {
    const oldest = remembered.keys().next().value
    if (oldest === undefined) break
    remembered.delete(oldest)
  }
}

/** 读回某个文档的相机状态；没记过时返回 `null`（调用方回默认视角并取景）。 */
export function loadRememberedCamera(documentId: string): CameraState | null {
  const state = remembered.get(documentId)
  return state ? copyState(state) : null
}

/** 只给测试用：清掉记忆，避免用例之间互相影响。 */
export function forgetRememberedCamera(): void {
  remembered.clear()
}
