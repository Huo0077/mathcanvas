import { describe, expect, it } from "vitest"

import { auditEntryFor, canonicalContentHash, describeDefaultPolicies, isRegisteredActionId, newDraftId, newRunId, parsePlanEnvelope, parseDraftAction, repairRequestFor, sha256HexBytes, unsupportedActionReason } from "./schemas"
import { DRAFT_ACTION_IDS } from "./actionIds"
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

  /**
   * **`solid.create_prism` 必须真的能到达编译器**（Solid/Prism 切片 Task 5）。
   *
   * 这条用例守的是本仓库踩过的那个坑（见 `actionIds.ts` 的头注释）：动作层实现了动作而传输层
   * 没登记，模型给出的合法动作被报成 `unknown_action` —— 看起来像"模型编了个动作"，
   * 实际是登记表过期。所以这里从**传输层**出发走一遍。
   */
  it("accepts a prism action with a base polygon and an extrusion vector", () => {
    const action = {
      actionId: "solid.create_prism",
      actionKey: "create-prism",
      inputs: {
        alias: "prism",
        basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }],
        vector: { x: 1, y: 0.5, z: 3 }
      },
      factIds: []
    }

    const result = parseDraftAction(action)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.actionId).toBe("solid.create_prism")
      expect(result.value.inputs).toMatchObject({ alias: "prism", vector: { x: 1, y: 0.5, z: 3 } })
    }
  })

  it("rejects a prism action whose payload is malformed", () => {
    const base = { actionId: "solid.create_prism", actionKey: "create-prism", factIds: [], inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], vector: { x: 0, y: 0, z: 1 } } }

    // 少于三个底面顶点：那不是多边形。
    expectRejected(parseDraftAction({ ...base, inputs: { ...base.inputs, basePolygon: [{ x: 0, y: 0, z: 0 }] } }), "invalid_type")
    // 向量缺一个分量 / 分量不是有限数。
    expectRejected(parseDraftAction({ ...base, inputs: { ...base.inputs, vector: { x: 0, y: 0 } } }), "non_finite_number")
    expectRejected(parseDraftAction({ ...base, inputs: { ...base.inputs, vector: { x: 0, y: 0, z: Number.NaN } } }), "non_finite_number")
    // 底面点掉了一个分量。
    expectRejected(parseDraftAction({ ...base, inputs: { ...base.inputs, basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0 }, { x: 0, y: 1, z: 0 }] } }), "non_finite_number")
    // 没有别名的新对象。
    expectRejected(parseDraftAction({ ...base, inputs: { basePolygon: base.inputs.basePolygon, vector: base.inputs.vector } }), "missing_field")
    // 白名单之外的字段（棱柱的面由内核生成，不许调用方塞进来）。
    expectRejected(parseDraftAction({ ...base, inputs: { ...base.inputs, faces: [] } }), "unknown_field")
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

/**
 * **动作登记表要覆盖 Agent 计划里的七个族**（Agent DSL 切片 Task 1，规格 §6.2/§6.3）。
 *
 * 七个族里四个**已经有实现**（棱柱、截面、切线、轨迹）；另外三个（球体、五心、符号圆锥曲线）
 * 里只有圆锥曲线能靠现有图元承载，球体与五心是**派生量** —— 内核算得出来
 * （`solveCircumsphere3` / `triangleCenter2`），但还没有承载它们的图元与重算路径。
 *
 * 这一组用例钉住的是"这三个名字必须被**认出来并说清原因**"：报成 `unknown_action`
 * 会让排障者以为"模型编了一个动作"，而事实是登记表里没有承载它的位置 —— 这两种失败
 * 必须能分开（这正是 `actionIds.ts` 头注释里那次真实故障的教训）。
 */
describe("action registry coverage for the agent plan families", () => {
  it("keeps the already-implemented prism, section, tangent and locus actions registered", () => {
    for (const actionId of ["solid.create_prism", "section.create", "function.create_tangent", "dynamic.create_locus"]) {
      expect(isRegisteredActionId(actionId), `${actionId} should be registered`).toBe(true)
    }
  })

  it("recognises the derived sphere and triangle-centre vocabulary and explains why it cannot be carried", () => {
    for (const actionId of ["derived.create_sphere", "derived.create_insphere", "derived.create_triangle_center"]) {
      expect(unsupportedActionReason(actionId), `${actionId} should have a reason`).toBeTruthy()

      const result = parseDraftAction({ actionId, actionKey: "k", factIds: [], inputs: {} })

      expect(result.ok, `${actionId} must not be accepted`).toBe(false)
      if (!result.ok) {
        expect(result.errors[0].code).toBe("unsupported_action")
        expect(result.errors[0].path).toBe("action.actionId")
        expect(result.errors[0].detail.length).toBeGreaterThan(0)
      }
    }
    // 谁都没实现过的名字仍然是 `unknown_action`：两类失败分得开。
    expect(unsupportedActionReason("planar.create_dragon")).toBeNull()
  })

  it("accepts a point bound to a draft host and rejects an unscoped host with its exact path", () => {
    const action = {
      actionId: "dynamic.create_bound_point",
      actionKey: "midpoint",
      factIds: [],
      inputs: { alias: "E", host: { scope: "draft", alias: "prism" }, hostSub: 0, parameter: 0.5 }
    }

    const accepted = parseDraftAction(action)
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.value.inputs).toMatchObject({ alias: "E", hostSub: 0, parameter: 0.5 })

    // 引用作用域是闭集：只给 entityId 的裸引用不算数，而且路径要指到那个字段。
    const unscoped = parseDraftAction({ ...action, inputs: { ...action.inputs, host: { entityId: "solid-1:e0" } } })
    expect(unscoped.ok).toBe(false)
    if (!unscoped.ok) {
      expect(unscoped.errors[0].code).toBe("unscoped_reference")
      expect(unscoped.errors[0].path).toBe("action.inputs.host")
    }

    // 白名单之外的字段必须被拒，并报出具体路径（不是一句笼统的"格式不对"）。
    const extra = parseDraftAction({ ...action, inputs: { ...action.inputs, position: { x: 0, y: 0, z: 0 } } })
    expect(extra.ok).toBe(false)
    if (!extra.ok) expect(extra.errors[0].path).toBe("action.inputs.position")
  })

  it("accepts a symbolic conic action and a parameter-creation action", () => {
    const conic = parseDraftAction({
      actionId: "planar.create_conic",
      actionKey: "ellipse",
      factIds: [],
      inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, label: "椭圆" }
    })
    expect(conic.ok).toBe(true)

    // `kind` 是闭集：不认识的圆锥曲线名要被拒，并且指到那个字段。
    const badKind = parseDraftAction({
      actionId: "planar.create_conic",
      actionKey: "ellipse",
      factIds: [],
      inputs: { alias: "ellipse", kind: "spiral", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }
    })
    expect(badKind.ok).toBe(false)
    if (!badKind.ok) {
      expect(badKind.errors[0].code).toBe("invalid_conic_kind")
      expect(badKind.errors[0].path).toBe("action.inputs.kind")
    }

    // 符号参数：新建一个由文档参数驱动的参数（`parameter.set` 只能改**已经存在**的参数）。
    const parameter = parseDraftAction({
      actionId: "parameter.create",
      actionKey: "theta",
      factIds: [],
      inputs: { id: "theta", value: 0.4, min: 0, max: 6.283185307179586, step: 0.01, label: "θ" }
    })
    expect(parameter.ok).toBe(true)
  })

  it("carries a default policy for every field the audit may have to fill", () => {
    const prism = auditEntryFor("solid.create_prism")
    // 底面与向量是**显式约束**：不给就不是"有安全默认"，而是欠定（由 witness 选择处理）。
    expect(prism?.required).toEqual(expect.arrayContaining(["basePolygon", "vector"]))

    const boundPoint = auditEntryFor("dynamic.create_bound_point")
    expect(boundPoint?.required).toEqual(expect.arrayContaining(["alias", "host"]))
    // 规格 §6.3：普通动点未指定位置时取 t = 0.4（中点是 0.5，由调用方显式给出）。
    expect(boundPoint?.defaults.find((entry) => entry.field === "parameter")).toMatchObject({ policy: "safe_default", value: 0.4 })

    // 截面平面是**不安全**的省略：平面无穷多，必须问用户，而不是替他挑一个。
    const section = auditEntryFor("section.create")
    expect(section?.defaults.find((entry) => entry.field === "plane")).toMatchObject({ policy: "ask_user" })
    expect(section?.defaults.find((entry) => entry.field === "plane")?.question).toBeTruthy()

    // 没登记的名字没有审计记录（审计据此走 unknown/unsupported 分支，而不是编一份出来）。
    expect(auditEntryFor("planar.create_dragon")).toBeNull()

    // 全量导出必须覆盖每一个登记的动作：漏一个，审计就只能靠猜。
    const all = describeDefaultPolicies()
    expect(all.length).toBe(DRAFT_ACTION_IDS.length)
    for (const entry of all) expect(entry.inputs.length).toBeGreaterThan(0)
    // 过滤参数只影响条数，不影响内容。
    expect(describeDefaultPolicies(["solid.create_prism"]).map((entry) => entry.actionId)).toEqual(["solid.create_prism"])
  })
})

describe("repair envelopes", () => {
  it("carries only code/path/allowed changes, limited to one attempt", () => {
    const request = repairRequestFor([{ code: "unknown_field", path: "envelope.actions[0].inputs.faces", detail: "unexpected field 'faces'" }], 1)

    expect(request.reason).toBe("schema_invalid")
    expect(request.attempt).toBe(1)
    expect(request.allowedChanges).toEqual(["envelope.actions[0].inputs.faces"])
    expect(request.errors).toEqual([{ code: "unknown_field", path: "envelope.actions[0].inputs.faces", detail: "unexpected field 'faces'" }])
    // 重复路径只出现一次：allowedChanges 是"允许改哪几处"，不是错误列表的副本。
    expect(repairRequestFor([{ code: "a", path: "x", detail: "" }, { code: "b", path: "x", detail: "" }], 2).allowedChanges).toEqual(["x"])
  })
})
