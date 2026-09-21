import { describe, expect, it } from "vitest"

import { canonicalContentHash, newDraftId, newRunId, parsePlanEnvelope, parseDraftAction, sha256HexBytes } from "./schemas"
import type { DocumentHandle } from "./contracts"

const HANDLE: DocumentHandle = {
  projectId: "project-1",
  documentId: "document-1",
  workspace: "geometry3d",
  epoch: "epoch-1",
  generation: 7,
  contentHash: "hash-1"
}

/** 附录 A 的示例：画一个边长 4 的立方体 + z=2 的水平截面。它是"必须被接受"的基准。 */
function validPlan(): unknown {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "创建立方体及水平截面",
    factIds: ["size-four", "section-height-two"],
    actions: [
      {
        actionId: "solid.create_template",
        actionKey: "create-solid",
        inputs: { alias: "solid", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
        factIds: ["size-four"]
      },
      {
        actionId: "section.create",
        actionKey: "create-section",
        // `SectionCreateAction` 收的是**同文档内的裸 id**（动作层用 `findPrimitive` 查），
        // 不是带 documentId 的作用域引用。这条夹具此前写成 `source: { scope: "draft", … }`，
        // 与动作层的真实形状不符 —— 登记表修正后才暴露出来。
        inputs: { alias: "cut", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -2 } },
        factIds: ["section-height-two"]
      }
    ]
  }
}

/** 解析失败时应当带一个稳定的错误码，方便 Agent 侧据此走"可见修复"路径。 */
function expectRejected(result: { ok: boolean; errors?: { code: string; path: string }[] }, code: string) {
  expect(result.ok, `expected rejection with ${code}`).toBe(false)
  expect(result.errors?.some((error) => error.code === code), `missing ${code} in ${JSON.stringify(result.errors)}`).toBe(true)
}

describe("plan envelope parsing", () => {
  it("accepts the appendix A plan", () => {
    const result = parsePlanEnvelope(validPlan())
    expect(result.ok).toBe(true)
    if (result.ok && result.value.kind === "plan") {
      expect(result.value.actions).toHaveLength(2)
    } else {
      throw new Error("expected a plan branch")
    }
  })

  it("rejects an unknown kind", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), kind: "not-a-plan" }), "unknown_kind")
  })

  it("rejects unknown top-level fields", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), authorised: true }), "unknown_field")
  })

  it("rejects unknown fields inside an action", () => {
    const plan = validPlan() as { actions: Record<string, unknown>[] }
    plan.actions[0].mayCommit = true
    expectRejected(parsePlanEnvelope(plan), "unknown_field")
  })

  it("rejects an unknown action id", () => {
    const plan = validPlan() as { actions: Record<string, unknown>[] }
    plan.actions[0].actionId = "solid.explode"
    expectRejected(parsePlanEnvelope(plan), "unknown_action")
  })

  it("rejects a duplicate action key within one run", () => {
    const plan = validPlan() as { actions: Record<string, unknown>[] }
    plan.actions[1].actionKey = plan.actions[0].actionKey
    expectRejected(parsePlanEnvelope(plan), "duplicate_action_key")
  })

  it("rejects non-finite numbers", () => {
    const plan = validPlan() as { actions: { inputs: { size?: { x: number } } }[] }
    plan.actions[0].inputs.size!.x = Number.POSITIVE_INFINITY
    expectRejected(parsePlanEnvelope(plan), "non_finite_number")
  })

  it("rejects oversized strings", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), goal: "x".repeat(2000) }), "string_too_long")
  })

  it("rejects oversized arrays", () => {
    const plan = validPlan() as { actions: unknown[] }
    plan.actions = Array.from({ length: 64 }, (_, index) => ({ ...(plan.actions[0] as object), actionKey: `key-${index}` }))
    expectRejected(parsePlanEnvelope(plan), "array_too_long")
  })

  it("rejects a scoped reference that is missing its scope", () => {
    // `object.update_inputs` 收的是**带 documentId** 的作用域引用（动作层会检查它是否跨文档），
    // 所以"只给 entityId"必须被拒 —— 名称不是 ID（设计规格 §6）。
    const plan = validPlan() as { actions: unknown[] }
    plan.actions[1] = { actionId: "object.update_inputs", actionKey: "rename", factIds: [], inputs: { target: { entityId: "point-1" }, patch: { label: "B" } } }
    expectRejected(parsePlanEnvelope(plan), "unscoped_reference")
  })

  it("rejects a plan branch without actions", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), actions: [] }), "empty_actions")
  })
})

describe("draft action parsing", () => {
  it("accepts a single well-formed action", () => {
    const action = (validPlan() as { actions: unknown[] }).actions[0]
    const result = parseDraftAction(action)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.actionKey).toBe("create-solid")
  })

  it("rejects a raw domain operation masquerading as an action", () => {
    expectRejected(parseDraftAction({ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } }), "unknown_action")
  })

  it("rejects an unscoped scene reference", () => {
    // 既有实体必须写成 {scope:"scene", ref:{documentId,entityId}}；只给 entityId 不算数。
    expectRejected(parseDraftAction({ actionId: "object.update_inputs", actionKey: "delete", inputs: { target: { entityId: "point-1" }, patch: { label: "x" } }, factIds: [] }), "unscoped_reference")
  })
})

describe("envelope assumptions", () => {
  /**
   * `AssumptionList` 与 `ConfirmationPanel` 都要求"把系统替你做的假设列出来"，但**线上一直没有这个字段** ——
   * 于是那一节永远是空的：组件做完了、数据没有。这里补上数据面。
   *
   * 为什么要由**计划自己**声明假设：一个自然语言计划里必然有"我替你定了"的部分
   * （"直径 6" → 半径 3；"正方形" → 边长取 4）。这些不是错误，但用户必须**看见**它们才能确认，
   * 否则他确认的是一件自己没看过的事。
   */
  it("carries the assumptions the planner made, so the confirmation panel can list them", () => {
    const plan = validPlan() as Record<string, unknown>
    plan.assumptions = ["把「直径 6」读作半径 3", "正方形的边长取 4"]

    const result = parsePlanEnvelope(plan)

    expect(result.ok).toBe(true)
    if (result.ok && result.value.kind === "plan") {
      expect(result.value.assumptions).toEqual(["把「直径 6」读作半径 3", "正方形的边长取 4"])
    }
  })

  it("treats a plan without assumptions as having none declared", () => {
    const result = parsePlanEnvelope(validPlan())
    expect(result.ok).toBe(true)
    if (result.ok && result.value.kind === "plan") expect(result.value.assumptions).toBeUndefined()
  })

  it("rejects an assumption that is not a bounded non-empty string", () => {
    const plan = validPlan() as Record<string, unknown>
    plan.assumptions = [""]
    expectRejected(parsePlanEnvelope(plan), "empty_string")

    const numeric = validPlan() as Record<string, unknown>
    numeric.assumptions = [42]
    expectRejected(parsePlanEnvelope(numeric), "invalid_type")
  })

  it("rejects more assumptions than the envelope budget allows", () => {
    const plan = validPlan() as Record<string, unknown>
    plan.assumptions = Array.from({ length: 64 }, (_, index) => `assumption ${index}`)
    expectRejected(parsePlanEnvelope(plan), "array_too_long")
  })
})

describe("deterministic ids and hashes", () => {
  it("mints distinct, prefixed ids", () => {
    const runIds = new Set(Array.from({ length: 50 }, () => newRunId()))
    expect(runIds.size).toBe(50)
    expect([...runIds][0]).toMatch(/^run_/)
    expect(newDraftId()).toMatch(/^draft_/)
  })

  it("hashes canonical content stably and ignores key order", () => {
    const left = canonicalContentHash({ b: 1, a: { d: 4, c: 3 } })
    const right = canonicalContentHash({ a: { c: 3, d: 4 }, b: 1 })
    expect(left).toBe(right)
    expect(left).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes the hash when geometry changes", () => {
    const before = canonicalContentHash({ primitives: [{ id: "p1", x: 0 }] })
    const after = canonicalContentHash({ primitives: [{ id: "p1", x: 1 }] })
    expect(after).not.toBe(before)
  })

  it("excludes runtime-only and view-only keys from the hash", () => {
    const withNoise = canonicalContentHash({ geometry: { radius: 2 }, viewport: { scale: 9 }, updatedAt: 123, logs: ["x"] })
    const clean = canonicalContentHash({ geometry: { radius: 2 } })
    expect(withNoise).toBe(clean)
  })

  it("includes the semantic document handle identity", () => {
    const base = canonicalContentHash({ handle: HANDLE, geometry: { radius: 2 } })
    const otherGeneration = canonicalContentHash({ handle: { ...HANDLE, generation: 8 }, geometry: { radius: 2 } })
    expect(otherGeneration).not.toBe(base)
  })

  /**
   * **`undefined` 等于"没有这个字段"**（2026-09-21 的真实故障）。
   *
   * 真实现场：用户画布上的立方体在启动恢复时过了 `migrateLegacySolids`，物化出来的子对象带着
   * `style: undefined` / `label: undefined`（"去掉标签"当时就是这么写的）。这些文档**每一处
   * 落盘/比对路径**都当它是"没这个字段"（JSON 序列化直接丢键、`contentFingerprint` 是 JSON 比
   * 语义），只有规范化哈希把它当成垃圾并抛出去 —— 于是 Agent 规划到一半死在
   * `Error: canonicalContentHash: unsupported value of type undefined`，用户看到的是一句内部函数名。
   *
   * 这里钉住的契约：**哈希值等于同一份数据 JSON 往返之后的哈希值**。两份"文档是什么"的实现
   * 不许分叉。
   */
  it("treats an undefined field as absent, exactly like a JSON round trip", () => {
    const document = { primitives: [{ id: "solid-1", label: undefined, style: undefined, size: { x: 1, y: 1, z: 1 } }] }
    const roundTripped = JSON.parse(JSON.stringify(document)) as unknown

    expect(canonicalContentHash(document)).toBe(canonicalContentHash(roundTripped))
  })

  it("hashes undefined inside an array the same way JSON does", () => {
    expect(canonicalContentHash({ points: [1, undefined, 3] })).toBe(canonicalContentHash(JSON.parse(JSON.stringify({ points: [1, undefined, 3] })) as unknown))
  })

  it("still refuses values JSON cannot carry, and says where they are", () => {
    // 真正无法表达的值照旧拒绝 —— 但错误信息必须指出**在哪**，否则排障只剩一个函数名。
    expect(() => canonicalContentHash({ primitives: [{ id: "p", broken: () => 1 }] })).toThrow(/primitives\[0\]\.broken/)
    expect(() => canonicalContentHash({ primitives: [{ id: "p", x: Number.NaN }] })).toThrow(/primitives\[0\]\.x/)
  })
})

describe("hashing raw bytes", () => {
  /**
   * 附件的内容哈希走的是**字节**入口（`put_attachment` 会拿它校验落盘的字节）。
   *
   * 这里用 FIPS 180-4 的公开向量当基准：`abc` 与空串的那两个值是标准里印着的，
   * 所以"这个哈希对不对"不需要相信我的实现。
   */
  it("matches the published vectors", () => {
    expect(sha256HexBytes(new Uint8Array([]))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    expect(sha256HexBytes(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("hashes the bytes themselves, not a UTF-8 re-encoding of them", () => {
    // 这一条是那个入口存在的理由。若实现先把字节当成 latin1 字符串、再过一遍 `TextEncoder`，
    // 0x89 会变成两个字节（0xc2 0x89）—— 哈希与 Rust 侧永远对不上，
    // 而症状会是"每一次附加都失败，理由却是内容哈希不符"。
    const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const reEncoded = new TextEncoder().encode("\u0089PNG")

    expect(reEncoded.length).toBe(5) // 0x89 在 UTF-8 里是两个字节：这条是前提
    expect(sha256HexBytes(raw)).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256HexBytes(raw)).not.toBe(sha256HexBytes(reEncoded))
    // 同样的字节永远得到同样的哈希（附件按内容去重、按内容自验都靠它）。
    expect(sha256HexBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(sha256HexBytes(raw))
    // 差一个字节就是另一份附件。
    expect(sha256HexBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x48]))).not.toBe(sha256HexBytes(raw))
  })
})
