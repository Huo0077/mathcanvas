import type { ToolResult } from "./contracts"
import type { SceneTools } from "./tools/sceneTools"

/**
 * **工具分发**（Task 2.4 缺的那一半）。
 *
 * ## 为什么必须单独有这么一层
 *
 * 在它之前，"接上 `ToolPort`"是一句空话：`ToolCallRequest` 只有
 * `run` / `toolCallId` / `actionCount` / `signal` —— **没有工具名，也没有参数**，
 * 端口根本无从执行任何工具。工具目录（`toolRegistry.ts`）声明了*模型能看到什么*，
 * `sceneTools.ts` 实现了*真正怎么读场景*，而**从名字到实现的这一段**此前不存在。
 *
 * ## 四条纪律，逐条有测试
 *
 * 1. **只认这张表里的名字**。模型可以要求任何字符串；未知名字如实报错、绝不转发、绝不猜。
 * 2. **目录里声明了但还没实现的工具要如实说 `tool_not_implemented`**，而不是返回一个
 *    看起来像结果的东西。`scene.measure` / `scene.check_relations` / `scene.check_section` /
 *    `scene.capabilities` / `cad.inspect_drawing` 目前都属于这一类 —— 说"还没实现"比编一个
 *    空结果好，因为模型会据此停下来问用户，而不是拿着空数组继续推理。
 * 3. **参数畸形也要在这里拦下**：把 `undefined` 传下去只会让下层崩在某个更远的地方，
 *    而错误信息会丢掉"是模型的参数不对"这个事实。
 * 4. **这里没有、也不会有任何写文档的工具**。目录里唯一的写工具是 `draft.confirm_commit`，
 *    分发器**明确不认它**（有用例钉住）—— 写入只有 `CommitterPort.commit` 一条路
 *    （计划 Task 0.8 Step 3："do not expose `commit` as a model-facing tool"）。
 */

export interface ToolDispatcherDependencies {
  scene: SceneTools
}

export interface ToolDispatcher {
  call(toolId: string, input: Record<string, unknown>): ToolResult<unknown>
}

/**
 * 分发器**认识**的工具名。
 *
 * 它与 `toolRegistry.ts` 的目录是两份不同的东西，而且是刻意的：
 * 目录回答"模型能看到什么"，这张表回答"宿主真的能执行什么"。
 * 两者必须**同时**满足才可能被调用 —— 只看目录会调用到没实现的工具，
 * 只看这张表则会漏掉工作区/阶段的边界。
 *
 * 有测试逐条核对：这张表里的每个名字都必须在**某个阶段**被目录声明过，
 * 免得这里偷偷多出一条模型看不到（但别人调得到）的通道。
 */
export const DISPATCHABLE_TOOL_IDS = [
  "scene.inspect",
  "scene.search_entities",
  "scene.describe_entities",
  "scene.dependencies"
] as const

/** 目录里声明了、但宿主还没实现的工具。列出来是为了给出可执行的下一步。 */
const DECLARED_BUT_UNIMPLEMENTED: readonly string[] = [
  "scene.measure",
  "scene.check_relations",
  "scene.check_section",
  "scene.capabilities",
  "cad.inspect_drawing",
  "run.explain_refusal"
]

function failure(code: string, summary: string, nextActions: string[] = []): ToolResult<unknown> {
  return { status: "error", summary, next_actions: nextActions, artifacts: [], payload: null, diagnostics: [{ code, severity: "error", message: summary }] }
}

function readString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function createToolDispatcher(dependencies: ToolDispatcherDependencies): ToolDispatcher {
  return {
    call(toolId, input) {
      const { scene } = dependencies

      switch (toolId) {
        case "scene.inspect": {
          const documentId = readString(input, "documentId")
          if (!documentId) return failure("invalid_arguments", "scene.inspect needs a documentId", ["call scene.inspect with the target document's id"])
          const limit = typeof input.limit === "number" ? input.limit : undefined
          return scene.inspect(documentId, limit)
        }

        case "scene.search_entities": {
          const documentId = readString(input, "documentId")
          const query = readString(input, "query")
          if (!documentId || !query) return failure("invalid_arguments", "scene.search_entities needs a documentId and a query", ["call scene.search_entities with a label, id or type fragment"])
          const limit = typeof input.limit === "number" ? input.limit : undefined
          return scene.searchEntities(documentId, query, limit)
        }

        case "scene.describe_entities": {
          const documentId = readString(input, "documentId")
          const entityIds = Array.isArray(input.entityIds) ? input.entityIds.filter((id): id is string => typeof id === "string") : []
          if (!documentId || entityIds.length === 0) return failure("invalid_arguments", "scene.describe_entities needs a documentId and at least one entityId", ["use scene.search_entities to find valid ids first"])
          return scene.describeEntities(documentId, entityIds)
        }

        case "scene.dependencies": {
          const documentId = readString(input, "documentId")
          const entityId = readString(input, "entityId")
          if (!documentId || !entityId) return failure("invalid_arguments", "scene.dependencies needs a documentId and an entityId", ["use scene.search_entities to find valid ids first"])
          return scene.dependencies(documentId, entityId)
        }

        default:
          // 目录声明了但没实现：如实说"还没实现"，并给出可执行的下一步。
          if (DECLARED_BUT_UNIMPLEMENTED.includes(toolId)) {
            return failure("tool_not_implemented", `${toolId} is declared but not implemented yet`, ["use scene.inspect or scene.search_entities instead", "tell the user this reading is not available yet"])
          }
          // 其余一概不认：包括目录里唯一的写工具 `draft.confirm_commit`。
          return failure("unknown_tool", `no such tool: ${toolId}`, ["only the tools listed in the run context are available"])
      }
    }
  }
}
