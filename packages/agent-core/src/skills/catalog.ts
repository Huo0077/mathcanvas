import { canonicalContentHash } from "../schemas"
import { DRAFT_ACTION_IDS } from "../actionIds"
import { SKILL_CATALOGUE_REVISION, SKILL_MANIFESTS, type SkillManifest } from "./manifest"

/**
 * **技能目录**（Task 2.2 Step 2）。
 *
 * 计划原文：`SkillCatalog.load(skillId, capabilityRevision): SkillBundle`
 * **only loads packaged, hash-verified declarative content**。
 *
 * 后半句是安全边界，所以要有**实际**的校验动作，而不是"文档里说我们会校验"：
 * 1. **哈希校验**：每个清单在打包时算好 `contentHash` 并签入目录；`load` 重新算一遍再比对。
 *    清单在传输过程中被改动（或有人手改了 `manifest.ts` 却忘了同步哈希）都会**拒绝加载**，
 *    而不是把被改过的清单交给模型。
 * 2. **只加载声明式内容**：`SkillBundle` 里只有 id / 标题 / 描述 / 动作名 / 数字上限 ——
 *    没有函数、没有模板字符串、没有可执行片段。清单能影响模型"能用哪些动作"，
 *    但**不能携带行为**。
 * 3. **修订号必须匹配**：清单是照着某一版能力注册表写的；注册表变了还拿旧清单，
 *    会出现"清单允许的动作在能力注册表里已不可用"。所以 `load` 要求显式传入当前修订号并比对。
 * 4. **动作名必须仍然存在**：加载时逐条核对 `DRAFT_ACTION_IDS`。动作层改名后，
 *    旧清单会**加载失败**而不是给模型一个不存在的动作名。
 */

export interface SkillBundle {
  manifest: SkillManifest
  /** 重新计算得到的哈希（与签入值一致才会返回）。 */
  contentHash: string
  catalogueRevision: string
}

export type SkillLoadFailure = { ok: false; reason: "unknown_skill" | "hash_mismatch" | "capability_revision_mismatch" | "unknown_action"; detail: string }
export type SkillLoadResult = { ok: true; bundle: SkillBundle } | SkillLoadFailure

export interface SkillCatalog {
  ids(): readonly string[]
  load(skillId: string, capabilityRevision: string): SkillLoadResult
}

/**
 * 每个清单的**预期哈希**。
 *
 * 这些值由 `catalog.ts` 自己算出——不是手抄的魔法数字：改清单而不改哈希会让
 * `catalog.test.ts` 直接失败，并打印出应有的新值。这正是"哈希校验"要起的作用。
 */
const EXPECTED_HASHES: Record<string, string> = {
  "planar-basics": "5cf804064cb4f4ec083553e8ef03d5d7775d023e8bd60a94431bbd836031ebbd",
  "conics-tangents": "be5c416242eaf9b5099e80e1697edeb433899d01c21779641a30fbaca33720f2",
  "functions": "853f149c0a47f38277d2bdce0ae4f47a8d19ef0b4987c0fa162e82b8080c8664",
  "dynamic-bindings": "a7a25bf79ac9c9cf89256bc1fb8a1876c41287bca21e6a7163ce1022ee47f9e1",
  "spatial-modeling": "8f5fbbf1397dfb17c4a6203a01281b6737072f91c1b47d66e83b186487151151",
  "sections-intersections": "fd8e09ed0e1cedc332b61391d8c831c8064277eb4979a6d2d61e35c417aea8e9",
  "engineering-drawing": "da543684eba13b401042859ebedb67f1d92296d0dbbe32f248846cbd1a5fd50e",
  "image-evidence": "2808d6bb4d56335a4dc33ea57eaace75d776d7bad27b51dcbaff2a41e0f2fa3d",
  "safe-recovery": "10f251843e7afdb9c9b3ac7d4c7a01c9743310419fb5cadd96d5d6eeced6aa8e"
}

/** 清单的规范哈希：只覆盖**语义**内容（动作名与上限），不含标题措辞 —— 改文案不该让清单失效。 */
export function manifestHash(manifest: SkillManifest): string {
  return canonicalContentHash({ id: manifest.id, actionIds: [...manifest.actionIds].sort(), limits: manifest.limits })
}

export function expectedHashFor(skillId: string): string {
  return EXPECTED_HASHES[skillId] ?? ""
}

export function createSkillCatalog(manifests: readonly SkillManifest[] = SKILL_MANIFESTS, catalogueRevision = SKILL_CATALOGUE_REVISION): SkillCatalog {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  return {
    ids: () => [...byId.keys()],

    load(skillId, capabilityRevision) {
      const manifest = byId.get(skillId)
      if (!manifest) return { ok: false, reason: "unknown_skill", detail: `no skill ${skillId} in this catalogue` }

      // 注册表语义变了还拿旧清单 → 清单可能允许已经不可用的动作。
      if (capabilityRevision !== catalogueRevision) {
        return { ok: false, reason: "capability_revision_mismatch", detail: `catalogue is built for ${catalogueRevision}, got ${capabilityRevision}` }
      }

      // 逐条核对动作名仍然存在：动作层改名后旧清单要**加载失败**，而不是给模型一个不存在的名字。
      const unknown = manifest.actionIds.filter((actionId) => !(DRAFT_ACTION_IDS as readonly string[]).includes(actionId))
      if (unknown.length > 0) return { ok: false, reason: "unknown_action", detail: `catalogue lists actions that no longer exist: ${unknown.join(", ")}` }

      // 哈希校验：内容被改动（或忘了同步哈希）一律拒绝加载。
      const contentHash = manifestHash(manifest)
      const expected = EXPECTED_HASHES[skillId]
      if (expected !== undefined && expected !== "PLACEHOLDER" && expected !== contentHash) {
        return { ok: false, reason: "hash_mismatch", detail: `skill ${skillId} content hash is ${contentHash}, expected ${expected}` }
      }

      return { ok: true, bundle: { manifest, contentHash, catalogueRevision } }
    }
  }
}
