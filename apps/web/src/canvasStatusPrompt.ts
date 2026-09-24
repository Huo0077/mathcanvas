import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"

import { dynamicPointPaths, isDynamicPointPath } from "./dynamicPointPaths"
import { resolveIntersectionPreviewPrompt, resolvePreviewInventoryPrompt, resolveStatusPrompt, type PromptCreationMode, type SceneControlMode } from "./statusPrompts"

/**
 * **状态栏那句话是怎么算出来的**（从 `App.tsx` 拆出，评审方案 2）。
 *
 * 解析器本身在 `./statusPrompts`（那里只认结构化的输入）；这一层负责把**画布现在的样子**
 * （文档 / 选择 / 创建中 / 3D 显示开关 / 预览）折算成解析器要的那几个字段。
 * 分成两层是有理由的：解析器能脱离文档单独测，而"折算"这件事要看文档。
 *
 * ## 优先级（改这里之前先看这一行）
 *
 * **创建步骤 > 3D 显示开关提示 > 交线预览 > 默认的选择提示**。显示开关排在预览前面，
 * 是因为它是用户**刚刚按下按钮**触发的 —— 被"选择带来的预览"盖掉，会让人以为按钮没反应。
 *
 * ## 依赖刻意写成结构化的
 *
 * `creationStep` / `previewStatus` / `scenePreviews` 只声明这里真正读到的字段（`center` / `start` /
 * `points`、`kind` / `label` / `reason`），不 import 渲染层那一堆类型：状态栏只关心这几样，
 * 写窄了它就不会因为渲染层的字段改名而被动摇。
 */
export interface CanvasStatusPromptInput {
  document: GeometryDocument
  selectedIds: string[]
  selectedPrimitive: PrimitiveSpec | null
  creationMode: PromptCreationMode
  creationStep: { center: { x: number; y: number } | null; start?: { x: number; y: number }; points?: readonly { x: number; y: number }[] } | null
  sceneControl: SceneControlMode | null
  previewStatus: { kind: string; label: string; reason?: string } | null
  /** 指针此刻是不是正悬停在某份预览上（只说"有没有"，不说"是哪一份"）。 */
  hovering: boolean
  scenePreviews: readonly { kind: string }[]
  previewSweep: { truncatedPairs: number; droppedPairs: number } | null
  /** 绕定点旋转的两个条件齐了没有（与命令可用性同源）。 */
  canAnchorRotation: boolean
}

export function deriveCanvasStatusPrompt({ document, selectedIds, selectedPrimitive, creationMode, creationStep, sceneControl, previewStatus, hovering, scenePreviews, previewSweep, canAnchorRotation }: CanvasStatusPromptInput): string {
  /**
   * 选中单个平面「点」时的绑定状态：把它交给状态栏，回答"怎么把点固定到曲线上"。
   * 只在平面/立体工作区、且恰好选中一个对象时给——多选时这句话没有意义。
   */
  const promptPoint = document.workspace === "cad" || selectedIds.length !== 1 || selectedPrimitive?.type !== "point" ? null : selectedPrimitive
  const promptPathId = promptPoint?.binding?.kind === "onPath" ? promptPoint.binding.pathId : null
  const promptPointBinding = promptPoint
    ? {
        bound: promptPathId !== null,
        hasPaths: dynamicPointPaths(document.primitives).some((primitive) => primitive.id !== promptPoint.id),
        pathLabel: promptPathId ? document.primitives.find((primitive) => primitive.id === promptPathId)?.label ?? null : null
      }
    : null
  const promptPathSelected = document.workspace !== "cad" && selectedIds.length === 1 && Boolean(selectedPrimitive && isDynamicPointPath(selectedPrimitive))
  /** 选中的是一条"动圆"（以某个点为定点的曲线）：提示它怎么转、半径在哪改。 */
  const promptMovingCircle = document.workspace !== "cad" && selectedIds.length === 1
    && Boolean(selectedPrimitive && (selectedPrimitive.type === "circle" || selectedPrimitive.type === "ellipse") && selectedPrimitive.rotationAbout)
  /**
   * 绕定点旋转的提示：`ready` 是"两样都选中了、命令可用"，`available` 是"文档里两样都有、只是还没选中组合"。
   * 没有这条提示，用户不会知道这个能力存在（与路径绑定当初的缺口同一个问题）。
   */
  const promptRotationAnchor = document.workspace === "cad" ? null : {
    ready: canAnchorRotation,
    available: document.primitives.some((primitive) => primitive.type === "point")
      && document.primitives.some((primitive) => primitive.type === "circle" || primitive.type === "ellipse")
  }
  const basePrompt = resolveStatusPrompt({ mode: creationMode, selectedCount: selectedIds.length, selectedLabel: selectedPrimitive?.label ?? selectedPrimitive?.id ?? null, hasCenter: Boolean(creationStep?.center), hasStart: Boolean(creationStep?.start), pointCount: creationStep?.points?.length ?? 0, sceneControl, pointBinding: promptPointBinding, pathSelected: promptPathSelected, rotationAnchor: promptRotationAnchor, movingCircleSelected: promptMovingCircle })
  const previewPrompt = document.workspace === "geometry3d" && !sceneControl && previewStatus && previewStatus.kind !== "none"
    ? resolveIntersectionPreviewPrompt(previewStatus, hovering)
    : null
  /**
   * 没有悬停也没有选择时，仍要把"画布上这些虚线 / 面片是什么、能点什么"说清楚——
   * 用户反馈过"画布上有东西却完全没有任何提示"。
   */
  const previewInventoryPrompt = document.workspace === "geometry3d" && !sceneControl && !previewPrompt
    ? resolvePreviewInventoryPrompt({
        lines: scenePreviews.filter((item) => item.kind === "intersection").length,
        points: scenePreviews.filter((item) => item.kind === "point").length,
        faces: scenePreviews.filter((item) => item.kind === "face").length,
        truncated: previewSweep?.truncatedPairs ?? 0,
        dropped: previewSweep?.droppedPairs ?? 0
      })
    : null

  return previewPrompt ?? previewInventoryPrompt ?? basePrompt
}
