import { describe, expect, it } from "vitest"

import { DRAFT_ACTION_IDS } from "../actionIds"
import { getCapabilityRegistry } from "../capabilities"
import { createSkillCatalog, expectedHashFor, manifestHash } from "./catalog"
import { CAPABILITY_FOR_ACTION, SKILL_CATALOGUE_REVISION, SKILL_MANIFESTS, type SkillManifest } from "./manifest"

/**
 * Task 2.2 Step 1 里针对技能的两条：**skill admission** 与 **unregistered skill rejection**。
 * 另有 Step 2 的三条硬要求：九个清单、每个都写 action IDs / limits / 一个成功案例 / 一个拒绝案例。
 */
describe("skill manifests", () => {
  it("ships the nine skills the plan names", () => {
    expect(SKILL_MANIFESTS).toHaveLength(9)
    expect(SKILL_MANIFESTS.map((manifest) => manifest.id)).toEqual([
      "planar-basics",
      "conics-tangents",
      "functions",
      "dynamic-bindings",
      "spatial-modeling",
      "sections-intersections",
      "engineering-drawing",
      "image-evidence",
      "safe-recovery"
    ])
  })

  it("gives every manifest action ids, limits and both test cases", () => {
    for (const manifest of SKILL_MANIFESTS) {
      expect(manifest.id).not.toBe("")
      expect(manifest.title).not.toBe("")
      expect(manifest.summary).not.toBe("")
      expect(manifest.limits.actionsPerStage).toBeGreaterThanOrEqual(0)
      expect(manifest.limits.actionsPerRun).toBeGreaterThanOrEqual(0)
      // 每次暂存的上限不能超过整次运行的上限，否则那个上限没有意义。
      expect(manifest.limits.actionsPerStage, manifest.id).toBeLessThanOrEqual(manifest.limits.actionsPerRun)
      expect(manifest.successCase.prompt, manifest.id).not.toBe("")
      expect(manifest.successCase.expectation, manifest.id).not.toBe("")
      expect(manifest.refusalCase.prompt, manifest.id).not.toBe("")
      expect(manifest.refusalCase.expectation, manifest.id).not.toBe("")
    }
  })

  it("only names actions that exist in the compiler", () => {
    // 类型上已经限定为 `DraftActionIdName`，这里再从运行期核一遍：
    // 出现"清单声明了、编译器没有"的名字即为三方漂移。
    for (const manifest of SKILL_MANIFESTS) {
      for (const actionId of manifest.actionIds) {
        expect(DRAFT_ACTION_IDS as readonly string[], `${manifest.id} names ${actionId}`).toContain(actionId)
      }
    }
  })

  it("never advertises an action the capability registry blocks", () => {
    // 能力注册表说"不可用"，清单却把它摆给模型 → 模型会一直试一个注定失败的动作。
    //
    // 注册表的键是 `DomainOperation`（内核操作），不是动作层的 actionId，所以这里要
    // 显式建立"动作名 → 它背后的能力描述符"这层对应；`CAPABILITY_FOR_ACTION` 就是那张表。
    const registry = getCapabilityRegistry()
    const blocked = new Set(registry.capabilities.filter((capability) => capability.status !== "available").map((capability) => capability.id))

    for (const manifest of SKILL_MANIFESTS) {
      for (const actionId of manifest.actionIds) {
        const capabilityId = CAPABILITY_FOR_ACTION[actionId]
        expect(capabilityId, `${manifest.id} names ${actionId} with no capability mapping`).toBeTruthy()
        const capability = registry.byId[capabilityId]
        expect(capability, `${manifest.id}: ${capabilityId} is not in the registry`).toBeTruthy()
        expect(blocked.has(capabilityId), `${manifest.id} advertises blocked capability ${capabilityId}`).toBe(false)
      }
    }
  })

  it("keeps the read-only skills free of actions", () => {
    // 工程制图与图像证据是**只读**技能：它们存在，但一个动作都不该有。
    for (const id of ["engineering-drawing", "image-evidence"]) {
      const manifest = SKILL_MANIFESTS.find((candidate) => candidate.id === id)!
      expect(manifest.actionIds, id).toHaveLength(0)
      expect(manifest.limits.actionsPerRun, id).toBe(0)
    }
  })
})

describe("skill catalogue loading", () => {
  it("loads a packaged skill and returns its verified hash", () => {
    const catalog = createSkillCatalog()

    const result = catalog.load("planar-basics", SKILL_CATALOGUE_REVISION)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected the bundle")
    expect(result.bundle.manifest.id).toBe("planar-basics")
    // 返回的哈希必须等于签入目录里的预期值（否则"校验"没有意义）。
    expect(result.bundle.contentHash).toBe(expectedHashFor("planar-basics"))
  })

  it("rejects an unregistered skill id", () => {
    const catalog = createSkillCatalog()

    const result = catalog.load("planar.mind-control", SKILL_CATALOGUE_REVISION)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unknown_skill")
  })

  it("refuses a catalogue built for a different capability revision", () => {
    // 清单是照着某一版注册表写的；注册表变了还拿旧清单，会出现"清单允许的动作已经不可用"。
    const catalog = createSkillCatalog()

    const result = catalog.load("planar-basics", "2020-01-01.1")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("capability_revision_mismatch")
    // 诊断要说明清单是照哪一版写的，否则调用方不知道该传什么。
    if (!result.ok) expect(result.detail).toContain(SKILL_CATALOGUE_REVISION)
  })

  it("refuses a manifest whose content was changed after packaging", () => {
    // 这是哈希校验真正要挡的事：清单在打包后被改过。
    const tampered: SkillManifest = { ...SKILL_MANIFESTS[0], actionIds: [...SKILL_MANIFESTS[0].actionIds, "parameter.set"] }
    const catalog = createSkillCatalog([tampered, ...SKILL_MANIFESTS.slice(1)])

    const result = catalog.load("planar-basics", SKILL_CATALOGUE_REVISION)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("hash_mismatch")
      // 诊断要给出实际算出的哈希，否则没法判断是"被改过"还是"忘了同步"。
      expect(result.detail).toContain(manifestHash(tampered))
    }
  })

  it("refuses a manifest that names an action the compiler no longer has", () => {
    const stale: SkillManifest = { ...SKILL_MANIFESTS[0], actionIds: ["planar.create_dragon" as never] }
    const catalog = createSkillCatalog([stale, ...SKILL_MANIFESTS.slice(1)])

    const result = catalog.load("planar-basics", SKILL_CATALOGUE_REVISION)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unknown_action")
  })

  it("lists every skill id it can load", () => {
    const catalog = createSkillCatalog()

    expect(catalog.ids()).toHaveLength(9)
    for (const id of catalog.ids()) expect(catalog.load(id, SKILL_CATALOGUE_REVISION).ok).toBe(true)
  })
})
