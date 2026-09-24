import { PRIMITIVE_TYPE_NAMES } from "@draw/dsl"
import { DOMAIN_OPERATION_NAMES } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { CAPABILITY_STATUSES, getCapabilityRegistry, type CapabilityDescriptor } from "./capabilities"

/**
 * Task 0.1 的**覆盖测试**（先失败、后实现）。
 *
 * 它守的是计划里那句硬要求：注册表必须把**当前 42 个图元类型**与**38 个 DomainOperation 变体**
 * 全部映射到"可用处理器"或"显式阻止的状态"。两个数字不是抄来的：42 来自 `packages/dsl/src/types.ts`
 * 的 `PrimitiveSpec` 联合，38 来自 `packages/scene-graph/src/operations.ts` 的 `DomainOperation`；
 * 这里改为从两个包的**运行时真值列表**读取，避免测试自己维护第三份副本。
 */
describe("agent capability registry", () => {
  it("covers every current primitive type and operation variant", () => {
    const registry = getCapabilityRegistry()

    // 前置断言：真值列表本身必须还是 42 / 38，否则"覆盖"是假达标。
    expect(PRIMITIVE_TYPE_NAMES).toHaveLength(42)
    expect(DOMAIN_OPERATION_NAMES).toHaveLength(39)

    for (const type of PRIMITIVE_TYPE_NAMES) {
      expect(registry.byPrimitiveType[type], `primitive type not mapped: ${type}`).toBeDefined()
    }
    for (const op of DOMAIN_OPERATION_NAMES) {
      expect(registry.byOperation[op], `operation not mapped: ${op}`).toBeDefined()
    }
  })

  it("gives every descriptor a status, a workspace, preconditions and at least one test id", () => {
    const registry = getCapabilityRegistry()

    expect(registry.capabilities.length).toBeGreaterThan(0)
    for (const capability of registry.capabilities) {
      expect(capability.id, "descriptor without id").not.toBe("")
      expect(CAPABILITY_STATUSES).toContain(capability.status)
      expect(capability.workspaces.length, `${capability.id}: no workspace`).toBeGreaterThan(0)
      expect(capability.preconditions.length, `${capability.id}: no preconditions`).toBeGreaterThan(0)
      expect(capability.testIds.length, `${capability.id}: no test id`).toBeGreaterThan(0)
      expect(capability.registryRevision, `${capability.id}: no registry revision`).not.toBe("")
    }
  })

  it("is deterministic and sorted by id", () => {
    const first = getCapabilityRegistry()
    const second = getCapabilityRegistry()

    // 确定性：同一份描述符表必须每次给出同样的顺序（Agent 会用 id 做引用与缓存键）。
    expect(first.capabilities.map((entry) => entry.id)).toEqual(second.capabilities.map((entry) => entry.id))
    const ids = first.capabilities.map((entry) => entry.id)
    expect(ids).toEqual([...ids].sort())
    // 同一 id 不得重复，否则 byId 会静默覆盖。
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("blocks the documented gaps explicitly instead of pretending they work", () => {
    const byId: Record<string, CapabilityDescriptor> = Object.fromEntries(getCapabilityRegistry().capabilities.map((entry) => [entry.id, entry]))

    // 计划 Step 4 点名的四类显式阻止。
    expect(getCapabilityRegistry().byPrimitiveType.intersectionSolid?.status).toBe("legacy_readonly")
    expect(byId["diagnose-constraints-3d"]?.status).toBe("diagnosis_only")
    expect(byId["export-svg-3d"]?.status).toBe("unsupported")
    expect(byId["export-png-3d"]?.status).toBe("unsupported")
    // 没有 action handler 的图元类型必须显式标成暂不可用，而不是"看起来可用"。
    expect(getCapabilityRegistry().byPrimitiveType.edge3?.status).toBe("temporarily_unavailable")
    expect(getCapabilityRegistry().byPrimitiveType.face3?.status).toBe("temporarily_unavailable")
  })

  /**
   * **多面体不再是"暂不可用"**（第 2 层，2026-09-23）。
   *
   * 它原先的理由是"no action handler：拓扑只由内核物化"。现在 `solid.create_polyhedron`
   *（顶点 + 面环 → 内核 `fromPoints`）就是那个 handler，所以这条能力必须**真的**变成 available ——
   * 否则模型会在规则里读到"能造任意多面体"，而注册表却说它不可用（两份话）。
   * 这条同时挡住"把它改回去"：改回去这里就红。
   */
  it("marks the arbitrary polyhedron available now that an action handler exists", () => {
    const polyhedron = getCapabilityRegistry().byPrimitiveType.polyhedron3

    expect(polyhedron?.status).toBe("available")
    expect(polyhedron?.preconditions.join(" ")).toContain("solid.create_polyhedron")
  })
})
