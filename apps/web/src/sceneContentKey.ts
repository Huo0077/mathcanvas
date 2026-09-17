import type { GeometryDocument } from "@draw/dsl"

export interface SceneContentInputs {
  document: GeometryDocument
  selectedIds: string[]
  showHiddenEdges: boolean
  showNormals: boolean
  transparentFaces: boolean
  unfoldProgress: number
  previewKind: string | null
}

/**
 * 场景内容的同步签名：只要它不变，`syncContent()` 就没有必要跑。
 *
 * 刻意只包含"会改变 3D 场景内容"的输入——相机状态、指针状态、提示文案都不在内。
 * 否则每次悬停或提示刷新都会触发一次内容同步，而那正是本切片要消灭的开销。
 */
export function sceneContentKey(inputs: SceneContentInputs): string {
  const unfolded = inputs.unfoldProgress > 0.001 ? "1" : "0"
  return [
    inputs.document.metadata.id,
    inputs.document.revision,
    [...inputs.selectedIds].sort().join(","),
    unfolded,
    inputs.unfoldProgress.toFixed(4),
    inputs.showHiddenEdges ? "1" : "0",
    inputs.showNormals ? "1" : "0",
    inputs.transparentFaces ? "1" : "0",
    inputs.previewKind ?? "-"
  ].join("|")
}
