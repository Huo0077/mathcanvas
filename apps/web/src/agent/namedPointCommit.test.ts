import { createEmptyDocument } from "@draw/dsl"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope, type PlannerPort } from "@draw/agent-core"
import { beforeEach, describe, expect, it } from "vitest"

import { useAgentStore } from "../agentStore"
import { isUserVisiblePrimitive } from "../primitiveVisibility"
import { useSceneStore } from "../store"
import { createAgentRunner } from "./agentRunner"

/**
 * **系统补建的点，提交之后到底落在哪里**（2026-10-10 用户现场）。
 *
 * 现场：桌面端现在能把图建出来了（对象列表里有 `O` 与 `E`），但**画布上看不到它们**、
 * 也没法像别的点那样点选后连线。
 *
 * ## 为什么这条要用**平移过**的四面体
 *
 * `dynamic.create_bound_point` 的动作只给 `parameter`，点的坐标初值是占位值 `(0,0,0)`，
 * 真坐标要靠绑定解析（`resolve3d` 的 `onHost` 那一支）算出来。而**既有用例里的 BD 中点恰好就是
 * `(0,0,0)`** —— 于是"算对了"和"根本没算"是同一个值，判据退化成恒真。把整只四面体平移到
 * 别处，占位值与正确答案才分得开。
 */
const PROMPT = "在三棱锥 A-BCD中，平面 ABD⊥平面 BCD，且 AB=AD，O为 BD的中点。"
const OFFSET = { x: 3, y: 0, z: 2 }
const VERTICES = [
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 0, z: 0 }
].map((point) => ({ x: point.x + OFFSET.x, y: point.y + OFFSET.y, z: point.z + OFFSET.z }))
const FACES = [
  [0, 1, 2],
  [0, 3, 1],
  [0, 2, 3],
  [1, 3, 2]
]

/** 模型会给的那一份：**一笔多面体**，O 由系统按题设补建。 */
const PLAN = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "画示意图",
  factIds: [],
  actions: [
    {
      actionId: "solid.create_polyhedron",
      actionKey: "solid",
      factIds: [],
      inputs: { alias: "solid", vertices: VERTICES, faces: FACES, vertexNames: ["A", "B", "C", "D"] }
    }
  ]
} as unknown as PlanEnvelope

type Point3 = Extract<ReturnType<typeof createEmptyDocument>["primitives"][number], { type: "point3" }>

describe("系统补建的点在提交之后的坐标", () => {
  beforeEach(() => {
    const document = createEmptyDocument("geometry3d")
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
    localStorage.clear()
    useAgentStore.getState().clearAll()
  })

  it("提交之后 O 落在 BD 的中点（不是那个占位坐标）", async () => {
    const planner: PlannerPort = { plan: async () => ({ plan: PLAN, requestId: "named-point", attemptId: "attempt-1" }) }
    const runner = createAgentRunner({ planner })
    useAgentStore.getState().sendPrompt(PROMPT)
    const conversation = useAgentStore.getState().activeConversation!
    const userMessage = [...conversation.messages].reverse().find((message) => message.role === "user")!

    const result = await runner.run(PROMPT, userMessage.id)
    expect(result.phase).toBe("awaiting_confirmation")
    expect(runner.confirm().status).toBe("committed")

    const document = useSceneStore.getState().document
    const point3s = document.primitives.filter((primitive): primitive is Point3 => primitive.type === "point3")
    const byLabel = (label: string) => point3s.find((point) => point.label === label)?.position
    const o = byLabel("O")
    const b = byLabel("B")
    const d = byLabel("D")
    expect(o, `文档里应当有一个叫 O 的点；实际标签 ${JSON.stringify(point3s.map((point) => point.label))}`).toBeTruthy()
    expect(b && d).toBeTruthy()

    const middle = { x: (b!.x + d!.x) / 2, y: (b!.y + d!.y) / 2, z: (b!.z + d!.z) / 2 }
    expect(o!.x).toBeCloseTo(middle.x, 6)
    expect(o!.y).toBeCloseTo(middle.y, 6)
    expect(o!.z).toBeCloseTo(middle.z, 6)

    // 画布（`threeScene`）与对象树（`AlgebraView`）都按这一条判断"是不是用户对象"：
    // 它必须是 true，否则点会被当成"圆柱/圆锥的细分顶点"那样既不画、也点不中。
    const committed = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: string }).label === "O")
    expect(committed).toBeTruthy()
    expect(isUserVisiblePrimitive(committed!)).toBe(true)
  })
})
