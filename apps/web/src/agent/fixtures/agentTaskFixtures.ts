export type AgentTaskCategory = "create" | "dependency" | "modify" | "reject" | "recovery" | "visual"

export interface AgentAcceptanceCheck {
  type: string
  target?: string
  expected?: string | number | boolean
}

export interface AgentTaskFixture {
  id: string
  category: AgentTaskCategory
  prompt: string
  expected: {
    toolIntent: readonly string[]
    acceptance: readonly AgentAcceptanceCheck[]
  }
}

export const AGENT_TASK_FIXTURES: readonly AgentTaskFixture[] = [
  {
    id: "create-cube",
    category: "create",
    prompt: "画一个边长为 3、中心在原点的立方体",
    expected: {
      toolIntent: ["geometry.create_solid"],
      acceptance: [
        { type: "primitive_exists", target: "polyhedron3", expected: true },
        { type: "edge_length", expected: 3 },
        { type: "center", expected: "origin" }
      ]
    }
  },
  {
    id: "create-tetrahedron",
    category: "create",
    prompt: "画一个棱长为 3 的正四面体",
    expected: {
      toolIntent: ["geometry.create_tetrahedron"],
      acceptance: [{ type: "edge_length", expected: 3 }]
    }
  },
  {
    id: "section-after-solid",
    category: "dependency",
    prompt: "先创建一个立方体，再用指定平面创建它的截面",
    expected: {
      toolIntent: ["geometry.create_solid", "scene.describe_entities", "geometry.create_section"],
      acceptance: [
        { type: "dependency_order", expected: "solid-before-section" },
        { type: "section_source", expected: "solid" }
      ]
    }
  },
  {
    id: "modify-section",
    category: "modify",
    prompt: "修改刚才的截面平面，并保持原来的实体不变",
    expected: {
      toolIntent: ["scene.search_entities", "geometry.update_object", "draft.verify"],
      acceptance: [
        { type: "solid_unchanged", expected: true },
        { type: "section_updated", expected: true }
      ]
    }
  },
  {
    id: "reject-degenerate-cube",
    category: "reject",
    prompt: "画一个边长为 0 的立方体",
    expected: {
      toolIntent: ["geometry.create_solid"],
      acceptance: [{ type: "status", expected: "rejected" }]
    }
  },
  {
    id: "visual-fit",
    category: "visual",
    prompt: "生成图形后调整视角，确保实体和标签都完整显示在画布内",
    expected: {
      toolIntent: ["render.capture", "render.inspect_layout"],
      acceptance: [
        { type: "clipped_objects", expected: 0 },
        { type: "label_overlaps", expected: 0 }
      ]
    }
  },
  {
    /**
     * **"先画出来、再检查取景"**（Phase 4 补的一条）。
     *
     * 为什么需要它：上一条 `visual-fit` 的原话只有"调整视角"，**没有任何构图动词** ——
     * 本地确定性规划器对它产不出候选文档，于是布局判据没有东西可判，
     * 如实报 `not_supported`。那条任务测的是"我们还没接线的部分"，这一条测的是
     * **"画完之后取景对不对"**，而后者在纯本地就能判定。
     *
     * 两点必须同时成立才算数：①这句话真的能画出图形（否则这里也会退化成
     * `not_supported` 而看不出任何东西）；②画出来的东西**确实**落在画布里、标签不叠。
     * ②由 `diagnoseLayout` 算出来，不是"没报错所以通过"。
     */
    id: "visual-fit-drawn",
    category: "visual",
    prompt: "画一个边长为 3、中心在原点的立方体，并调整视角让实体完整显示在画布内",
    expected: {
      toolIntent: ["geometry.create_solid", "render.inspect_layout"],
      acceptance: [
        { type: "primitive_exists", target: "polyhedron3", expected: true },
        { type: "clipped_objects", expected: 0 },
        { type: "label_overlaps", expected: 0 }
      ]
    }
  },
  {
    id: "recover-invalid-reference",
    category: "recovery",
    prompt: "在引用不存在对象时停止猜测，并说明下一步需要什么信息",
    expected: {
      toolIntent: ["scene.search_entities", "run.explain_refusal"],
      acceptance: [{ type: "status", expected: "waiting" }]
    }
  }
]
